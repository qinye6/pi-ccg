import type { InstallScope, PiExtensionMetadataEntry } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import { join } from 'pathe'
import { version as packageVersion } from '../../package.json'
import { initI18n } from '../i18n'
import {
  CCG_MANAGED_BLOCK_START,
  CCG_PI_ACTIVE_AGENT_NAMES,
  CCG_PI_RETIRED_AGENT_NAMES,
  getCcgMetadataPath,
  getPiAgentHome,
  getPiModelsPath,
  getPiSettingsPath,
  getProjectAgentsMdPath,
  getProjectPiChainsDir,
  getProjectPiPromptsDir,
  getSubagentExtensionConfigPath,
} from '../utils/pi-paths'
import { computeEffectiveDevParallelism, computeRequiredSpawns } from '../utils/pi-config'
import {
  PI_EXTENSION_CATALOG,
  presentPiExtensionLabel,
  presentPiExtensionTier,
  REQUIRED_PI_EXTENSION,
} from '../utils/pi-extensions'
import {
  inspectPiRuntime,
  PI_SUBAGENTS_INSTALL_COMMAND,
} from '../utils/pi-runtime'

const OK = ansis.green('✓')
const WARN = ansis.yellow('⚠')
const FAIL = ansis.red('✗')
const SKIP = ansis.gray('–')

interface DoctorOptions {
  installDir?: string
  projectDir?: string
}

interface Check {
  label: string
  status: string
  detail: string
  required?: boolean
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  if (!(await fs.pathExists(path))) return null
  try { return await fs.readJson(path) as Record<string, unknown> }
  catch { return null }
}

function installScope(metadata: Record<string, unknown> | null): InstallScope | null {
  return metadata?.scope === 'user' || metadata?.scope === 'user-project'
    ? metadata.scope
    : null
}

function extensionMetadata(metadata: Record<string, unknown> | null): PiExtensionMetadataEntry[] {
  if (!Array.isArray(metadata?.extensions)) return []
  return metadata.extensions.filter((entry): entry is PiExtensionMetadataEntry => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
    const value = entry as Record<string, unknown>
    return typeof value.id === 'string'
      && typeof value.packageSpec === 'string'
      && typeof value.selected === 'boolean'
      && (value.ownership === 'ccg-installed' || value.ownership === 'adopted' || value.ownership === 'missing')
  })
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (await fs.pathExists(path)) return path
  }
  return null
}

function assetCandidates(
  scope: InstallScope | null,
  userPath: string,
  projectPath: string,
): string[] {
  if (scope === 'user') return [userPath]
  if (scope === 'user-project') return [projectPath]
  return [projectPath, userPath]
}

function modelReferences(settings: Record<string, unknown> | null): string[] {
  const subagents = settings?.subagents
  if (typeof subagents !== 'object' || subagents === null || Array.isArray(subagents)) return []
  const overrides = (subagents as Record<string, unknown>).agentOverrides
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) return []
  return Object.values(overrides as Record<string, unknown>).flatMap((override) => {
    if (typeof override !== 'object' || override === null || Array.isArray(override)) return []
    const model = (override as Record<string, unknown>).model
    return typeof model === 'string' && model ? [model] : []
  })
}

function configuredModels(models: Record<string, unknown> | null): Set<string> {
  const result = new Set<string>()
  const providers = models?.providers
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return result
  for (const [providerName, provider] of Object.entries(providers)) {
    if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) continue
    const list = (provider as Record<string, unknown>).models
    if (!Array.isArray(list)) continue
    for (const model of list) {
      const id = typeof model === 'string'
        ? model
        : typeof model === 'object' && model !== null && !Array.isArray(model)
          ? (model as Record<string, unknown>).id
          : null
      if (typeof id === 'string') result.add(`${providerName}/${id}`)
    }
  }
  return result
}

function metadataLanguage(metadata: Record<string, unknown> | null): 'zh-CN' | 'en' {
  return metadata?.language === 'en' ? 'en' : 'zh-CN'
}

async function collectChecks(options: DoctorOptions = {}): Promise<Check[]> {
  const projectDir = options.projectDir ?? process.cwd()
  const piHome = options.installDir ?? getPiAgentHome()
  const metadataPath = getCcgMetadataPath(piHome)
  const metadataExists = await fs.pathExists(metadataPath)
  const metadata = await readJson(metadataPath)
  await initI18n(metadataLanguage(metadata))
  const checks: Check[] = []
  const scope = installScope(metadata)
  const runtime = inspectPiRuntime(piHome)

  checks.push({
    label: 'Pi CLI',
    status: runtime.piAvailable ? OK : FAIL,
    detail: runtime.piVersion ?? 'not found in PATH',
    required: true,
  })
  checks.push({
    label: 'pi-subagents package',
    status: runtime.piSubagentsAvailable ? OK : FAIL,
    detail: runtime.piSubagentsAvailable
      ? 'installed (required runtime package)'
      : runtime.piAvailable
        ? `missing; install with: ${PI_SUBAGENTS_INSTALL_COMMAND}`
        : `install Pi CLI first, then run: ${PI_SUBAGENTS_INSTALL_COMMAND}`,
    required: true,
  })

  const installedPackages = new Map(runtime.packages.map(item => [item.packageSpec, item.version]))
  const extensionEntries = new Map(extensionMetadata(metadata).map(entry => [entry.id, entry]))
  for (const extension of PI_EXTENSION_CATALOG) {
    if (extension.id === REQUIRED_PI_EXTENSION.id) continue
    const entry = extensionEntries.get(extension.id)
    const installedVersion = installedPackages.get(extension.packageSpec)
    if (!entry?.selected) {
      checks.push({
        label: presentPiExtensionLabel(extension),
        status: SKIP,
        detail: installedPackages.has(extension.packageSpec)
          ? `not selected by CCG; package detected${installedVersion ? ` (${installedVersion})` : ''}`
          : `not selected [${presentPiExtensionTier(extension)}]`,
      })
      continue
    }
    checks.push({
      label: presentPiExtensionLabel(extension),
      status: installedPackages.has(extension.packageSpec) ? OK : WARN,
      detail: installedPackages.has(extension.packageSpec)
        ? `installed${installedVersion ? ` (${installedVersion})` : ''}; ${entry.ownership}`
        : `selected but missing; install with: pi install ${extension.packageSpec}`,
    })
  }
  if (runtime.packageListError) {
    checks.push({
      label: 'Pi package inventory',
      status: WARN,
      detail: 'unable to read package inventory; run `pi list --no-approve` for details',
    })
  }

  const missingAgents: string[] = []
  for (const name of CCG_PI_ACTIVE_AGENT_NAMES) {
    if (!(await fs.pathExists(join(piHome, 'agents', `${name}.md`)))) missingAgents.push(name)
  }
  checks.push({
    label: 'Pi agents', status: missingAgents.length === 0 ? OK : FAIL,
    detail: missingAgents.length === 0
      ? `${CCG_PI_ACTIVE_AGENT_NAMES.length}/${CCG_PI_ACTIVE_AGENT_NAMES.length} installed`
      : `missing: ${missingAgents.join(', ')}`,
    required: true,
  })

  const staleAgents: string[] = []
  for (const name of CCG_PI_RETIRED_AGENT_NAMES) {
    if (await fs.pathExists(join(piHome, 'agents', `${name}.md`))) staleAgents.push(name)
  }
  checks.push({
    label: 'Retired Pi agents',
    status: staleAgents.length > 0 ? WARN : OK,
    detail: staleAgents.length > 0
      ? `stale legacy asset(s) preserved: ${staleAgents.join(', ')}`
      : 'no retired CCG agent files detected',
  })

  const chain = await firstExisting(assetCandidates(
    scope,
    join(piHome, 'chains', 'ccg-plan.chain.md'),
    join(getProjectPiChainsDir(projectDir), 'ccg-plan.chain.md'),
  ))
  const prompt = await firstExisting(assetCandidates(
    scope,
    join(piHome, 'prompts', 'ccg-go.md'),
    join(getProjectPiPromptsDir(projectDir), 'ccg-go.md'),
  ))
  checks.push({
    label: 'Plan chain',
    status: chain ? OK : WARN,
    detail: chain ?? `ccg-plan.chain.md missing for ${scope ?? 'unknown'} install scope`,
  })
  checks.push({
    label: 'Prompt workflow',
    status: prompt ? OK : WARN,
    detail: prompt ?? `ccg-go.md missing for ${scope ?? 'unknown'} install scope`,
  })

  if (scope === 'user') {
    checks.push({
      label: 'AGENTS.md block',
      status: OK,
      detail: 'not required for user-only install scope',
    })
  }
  else {
    const agentsMd = getProjectAgentsMdPath(projectDir)
    const managedBlock = await fs.pathExists(agentsMd)
      && (await fs.readFile(agentsMd, 'utf-8')).includes(CCG_MANAGED_BLOCK_START)
    checks.push({
      label: 'AGENTS.md block',
      status: managedBlock ? OK : WARN,
      detail: managedBlock ? 'CCG managed block present' : 'not installed in current project',
    })
  }

  const settings = await readJson(getPiSettingsPath(piHome))
  const references = modelReferences(settings)
  checks.push({
    label: 'Model overrides',
    status: references.length > 0 ? OK : WARN,
    detail: references.length > 0 ? `${references.length} agent override(s)` : 'agents inherit Pi default model',
  })

  const models = configuredModels(await readJson(getPiModelsPath(piHome)))
  const unresolved = references.filter(reference => reference.includes('/') && !models.has(reference))
  checks.push({
    label: 'Model references',
    status: unresolved.length === 0 ? OK : WARN,
    detail: unresolved.length === 0
      ? 'resolved or delegated to Pi built-ins'
      : `${unresolved.length} reference(s) not found in models.json`,
  })

  const caps = await readJson(getSubagentExtensionConfigPath(piHome))
  const parallel = caps?.parallel
  const concurrency = Number(caps?.globalConcurrencyLimit)
  const spawns = Number(caps?.maxSubagentSpawnsPerSession)
  const depth = Number(caps?.maxSubagentDepth)
  const parallelConcurrency = typeof parallel === 'object' && parallel !== null
    ? Number((parallel as Record<string, unknown>).concurrency)
    : Number.NaN
  const maxTasks = typeof parallel === 'object' && parallel !== null
    ? Number((parallel as Record<string, unknown>).maxTasks)
    : Number.NaN
  const validCaps = [concurrency, spawns, depth, parallelConcurrency, maxTasks]
    .every(value => Number.isInteger(value) && value > 0)
  const effective = validCaps
    ? computeEffectiveDevParallelism({
        devAgentCap: maxTasks,
        globalConcurrencyLimit: concurrency,
        parallelConcurrency,
        parallelMaxTasks: maxTasks,
      })
    : 0
  const baselineSpawns = computeRequiredSpawns(effective)
  const spawnBudgetOk = validCaps && baselineSpawns <= spawns
  checks.push({
    label: 'Subagent caps', status: validCaps && spawnBudgetOk ? OK : FAIL,
    detail: validCaps
      ? `effective=${effective}, baselineSpawns=${baselineSpawns}, budget=${spawns}, depth=${depth}`
      : 'missing or invalid config',
    required: true,
  })

  checks.push({
    label: 'CCG metadata',
    status: metadata ? OK : WARN,
    detail: metadata
      ? `v${String(metadata.version ?? '?')} (${scope ?? 'unknown scope'})`
      : metadataExists
        ? 'unreadable or invalid'
        : 'not found',
  })

  const memoryDir = join(projectDir, '.pi', 'agent-memory')
  const memoryExists = await fs.pathExists(memoryDir)
  checks.push({
    label: 'pi-subagents memory',
    status: memoryExists ? OK : WARN,
    detail: memoryExists
      ? 'project-scoped per-agent memory present'
      : 'created lazily when memory-enabled pi-subagents agents run',
  })
  const mcpAdapterInstalled = installedPackages.has('npm:pi-mcp-adapter')
  const mcpConfig = await firstExisting([
    join(projectDir, '.pi', 'mcp.json'),
    join(projectDir, '.mcp.json'),
    join(piHome, 'mcp.json'),
  ])
  const mcpExample = await fs.pathExists(join(projectDir, '.pi', 'mcp.json.example'))
  checks.push({
    label: 'MCP integration',
    status: mcpAdapterInstalled && mcpConfig ? OK : WARN,
    detail: mcpAdapterInstalled
      ? mcpConfig
        ? `adapter installed; user-managed config detected at ${mcpConfig}`
        : `adapter installed; configure a user-managed MCP file${mcpExample ? ' (example available)' : ''}`
      : 'adapter not installed; manage with `ccg extensions`',
  })
  return checks
}

export async function doctor(options: DoctorOptions = {}): Promise<void> {
  const checks = await collectChecks(options)
  console.log(ansis.cyan.bold(`\n  CCG Pi Doctor v${packageVersion}\n`))
  for (const check of checks) console.log(`  ${check.status} ${check.label.padEnd(24)} ${ansis.gray(check.detail)}`)
  const failures = checks.filter(check => check.required && check.status === FAIL).length
  console.log()
  console.log(failures === 0 ? ansis.green('  Required Pi checks passed.') : ansis.red(`  ${failures} required check(s) failed.`))
  console.log()
}

export async function status(options: DoctorOptions = {}): Promise<void> {
  const piHome = options.installDir ?? getPiAgentHome()
  const checks = await collectChecks(options)
  const metadata = await readJson(getCcgMetadataPath(piHome))
  const settings = await readJson(getPiSettingsPath(piHome))
  const runtime = inspectPiRuntime(piHome)
  const entries = extensionMetadata(metadata)
  const selected = entries.filter(entry => entry.id !== REQUIRED_PI_EXTENSION.id && entry.selected)
  const installed = new Set(runtime.packages.map(item => item.packageSpec))
  const selectedInstalled = selected.filter(entry => installed.has(entry.packageSpec)).length
  const owned = entries.filter(entry => entry.ownership === 'ccg-installed').length
  const adopted = entries.filter(entry => entry.ownership === 'adopted').length
  console.log(ansis.cyan.bold(`\n  CCG for Pi CLI v${packageVersion}\n`))
  console.log(`  Pi CLI:       ${runtime.piVersion ?? 'not found'}`)
  console.log(`  pi-subagents: ${runtime.piSubagentsAvailable ? 'installed' : 'missing (required)'}`)
  console.log(`  Extensions:   ${selectedInstalled}/${selected.length} selected installed; owned=${owned}, adopted=${adopted}`)
  console.log(`  Install scope:${metadata ? ` ${String(metadata.scope ?? 'unknown')}` : ' not installed'}`)
  console.log(`  Agent models: ${modelReferences(settings).length || 'inherit default'}`)
  console.log(`  Health:       ${checks.filter(check => check.required && check.status === FAIL).length === 0 ? 'ready' : 'needs attention'}`)
  console.log(`  Pi home:      ${piHome}`)
  console.log()
}
