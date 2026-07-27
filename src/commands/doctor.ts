import { spawnSync } from 'node:child_process'
import ansis from 'ansis'
import fs from 'fs-extra'
import { join } from 'pathe'
import { version as packageVersion } from '../../package.json'
import {
  CCG_MANAGED_BLOCK_START,
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

const OK = ansis.green('✓')
const WARN = ansis.yellow('⚠')
const FAIL = ansis.red('✗')

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

function piVersion(): string | null {
  const result = spawnSync('pi', ['--version'], { encoding: 'utf-8', shell: process.platform === 'win32' })
  return result.status === 0 ? (result.stdout || result.stderr).trim() : null
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

async function collectChecks(projectDir = process.cwd()): Promise<Check[]> {
  const piHome = getPiAgentHome()
  const checks: Check[] = []
  const version = piVersion()
  checks.push({ label: 'Pi CLI', status: version ? OK : FAIL, detail: version || 'not found in PATH', required: true })

  const agentNames = ['ccg-project-scout', 'ccg-planner', 'ccg-backend-builder', 'ccg-frontend-builder', 'ccg-miniprogram-builder', 'ccg-test-runner', 'ccg-reviewer']
  const missingAgents: string[] = []
  for (const name of agentNames) {
    if (!(await fs.pathExists(join(piHome, 'agents', `${name}.md`)))) missingAgents.push(name)
  }
  checks.push({
    label: 'Pi agents', status: missingAgents.length === 0 ? OK : FAIL,
    detail: missingAgents.length === 0 ? `${agentNames.length}/${agentNames.length} installed` : `missing: ${missingAgents.join(', ')}`,
    required: true,
  })

  const chain = join(getProjectPiChainsDir(projectDir), 'ccg-plan.chain.md')
  const prompt = join(getProjectPiPromptsDir(projectDir), 'ccg-go.md')
  checks.push({ label: 'Project chain', status: await fs.pathExists(chain) ? OK : WARN, detail: chain })
  checks.push({ label: 'Prompt workflow', status: await fs.pathExists(prompt) ? OK : WARN, detail: prompt })

  const agentsMd = getProjectAgentsMdPath(projectDir)
  const managedBlock = await fs.pathExists(agentsMd)
    && (await fs.readFile(agentsMd, 'utf-8')).includes(CCG_MANAGED_BLOCK_START)
  checks.push({ label: 'AGENTS.md block', status: managedBlock ? OK : WARN, detail: managedBlock ? 'CCG managed block present' : 'not installed in current project' })

  const settings = await readJson(getPiSettingsPath())
  const references = modelReferences(settings)
  checks.push({ label: 'Model overrides', status: references.length > 0 ? OK : WARN, detail: references.length > 0 ? `${references.length} agent override(s)` : 'agents inherit Pi default model' })

  const models = configuredModels(await readJson(getPiModelsPath()))
  const unresolved = references.filter(reference => reference.includes('/') && !models.has(reference))
  checks.push({ label: 'Model references', status: unresolved.length === 0 ? OK : WARN, detail: unresolved.length === 0 ? 'resolved or delegated to Pi built-ins' : `${unresolved.length} reference(s) not found in models.json` })

  const caps = await readJson(getSubagentExtensionConfigPath())
  const parallel = caps?.parallel
  const concurrency = Number(caps?.globalConcurrencyLimit)
  const spawns = Number(caps?.maxSubagentSpawnsPerSession)
  const depth = Number(caps?.maxSubagentDepth)
  const parallelConcurrency = typeof parallel === 'object' && parallel !== null ? Number((parallel as Record<string, unknown>).concurrency) : Number.NaN
  const maxTasks = typeof parallel === 'object' && parallel !== null ? Number((parallel as Record<string, unknown>).maxTasks) : Number.NaN
  const validCaps = [concurrency, spawns, depth, parallelConcurrency, maxTasks].every(value => Number.isInteger(value) && value > 0)
  const effective = validCaps ? computeEffectiveDevParallelism({ devAgentCap: maxTasks, globalConcurrencyLimit: concurrency, parallelConcurrency, parallelMaxTasks: maxTasks }) : 0
  const spawnBudgetOk = validCaps && computeRequiredSpawns(effective) <= spawns
  checks.push({
    label: 'Subagent caps', status: validCaps && spawnBudgetOk ? OK : FAIL,
    detail: validCaps ? `effective=${effective}, requiredSpawns=${computeRequiredSpawns(effective)}, budget=${spawns}, depth=${depth}` : 'missing or invalid config',
    required: true,
  })

  const metadata = await readJson(getCcgMetadataPath())
  checks.push({ label: 'CCG metadata', status: metadata ? OK : WARN, detail: metadata ? `v${String(metadata.version ?? '?')}` : 'not found' })

  const memoryDir = join(projectDir, '.pi', 'agent-memory')
  checks.push({ label: 'Project memory', status: await fs.pathExists(memoryDir) ? OK : WARN, detail: await fs.pathExists(memoryDir) ? 'native Pi project memory present' : 'created lazily when memory-enabled agents run' })
  checks.push({ label: 'External memory adapter', status: WARN, detail: 'optional/report-only; CCG does not require or manage real credentials' })
  return checks
}

export async function doctor(): Promise<void> {
  const checks = await collectChecks()
  console.log(ansis.cyan.bold(`\n  CCG Pi Doctor v${packageVersion}\n`))
  for (const check of checks) console.log(`  ${check.status} ${check.label.padEnd(24)} ${ansis.gray(check.detail)}`)
  const failures = checks.filter(check => check.required && check.status === FAIL).length
  console.log()
  console.log(failures === 0 ? ansis.green('  Required Pi checks passed.') : ansis.red(`  ${failures} required check(s) failed.`))
  console.log()
}

export async function status(): Promise<void> {
  const checks = await collectChecks()
  const metadata = await readJson(getCcgMetadataPath())
  const settings = await readJson(getPiSettingsPath())
  console.log(ansis.cyan.bold(`\n  CCG for Pi CLI v${packageVersion}\n`))
  console.log(`  Pi CLI:       ${piVersion() ?? 'not found'}`)
  console.log(`  Install scope:${metadata ? ` ${String(metadata.scope ?? 'unknown')}` : ' not installed'}`)
  console.log(`  Agent models: ${modelReferences(settings).length || 'inherit default'}`)
  console.log(`  Health:       ${checks.filter(check => check.required && check.status === FAIL).length === 0 ? 'ready' : 'needs attention'}`)
  console.log(`  Pi home:      ${getPiAgentHome()}`)
  console.log()
}
