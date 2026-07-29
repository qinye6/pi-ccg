import type { PiExtensionDefinition, PiExtensionMetadataEntry } from '../types'
import { inspectPiRuntime, runPiPackageCommand } from './pi-runtime'

export const PI_EXTENSION_CATALOG = [
  {
    id: 'core-subagents',
    packageSpec: 'npm:pi-subagents',
    label: 'Pi Subagents',
    category: 'orchestration',
    tier: 'required',
    description: 'CCG supervisor coordination, bounded dynamic builders, and per-agent project memory.',
    defaultSelected: true,
    docsUrl: 'https://www.npmjs.com/package/pi-subagents',
    securityNotes: ['Required runtime package. Pi packages execute with the current user permissions.'],
  },
  {
    id: 'mcp-adapter',
    packageSpec: 'npm:pi-mcp-adapter',
    label: 'Pi MCP Adapter',
    category: 'mcp',
    tier: 'recommended',
    description: 'Lazy MCP servers through one compact proxy tool, with metadata caching and output guards.',
    defaultSelected: true,
    docsUrl: 'https://github.com/nicobailon/pi-mcp-adapter',
    securityNotes: [
      'MCP servers may execute commands or access external services.',
      'CCG never writes real MCP credentials and preserves user-managed MCP configuration.',
    ],
  },
  {
    id: 'memory-context',
    packageSpec: 'npm:pi-memctx',
    label: 'Memory Context',
    category: 'context',
    tier: 'recommended',
    description: 'Local Markdown knowledge packs with search, persistence, and automatic context injection.',
    defaultSelected: true,
    docsUrl: 'https://github.com/weauratech/pi-memctx',
    securityNotes: ['Review persisted project knowledge before sharing a repository or machine profile.'],
  },
  {
    id: 'session-continuity',
    packageSpec: 'npm:pi-session-continuity',
    label: 'Session Continuity',
    category: 'continuity',
    tier: 'recommended',
    description: 'Durable checkpoints and handoffs for recoverable long-running Pi sessions.',
    defaultSelected: true,
    docsUrl: 'https://github.com/bernardofortes/pi-session-continuity',
    securityNotes: ['Handoff files may contain project context; do not place secrets in task summaries.'],
  },
  {
    id: 'pr-review',
    packageSpec: 'npm:pi-pr-review',
    label: 'PR Review',
    category: 'review',
    tier: 'optional',
    description: 'Parallel GitHub pull-request review with structured findings and optional verification.',
    defaultSelected: false,
    docsUrl: 'https://github.com/10ego/pi-pr-review',
    securityNotes: ['Publishing review comments is outward-facing and requires separate confirmation in the extension.'],
  },
  {
    id: 'security-audit',
    packageSpec: 'npm:@vigolium/piolium',
    label: 'Piolium Security Audit',
    category: 'security',
    tier: 'experimental',
    description: 'Multi-phase security audits with specialist agents, bounded concurrency, and resumable state.',
    defaultSelected: false,
    docsUrl: 'https://github.com/vigolium/piolium',
    securityNotes: [
      'Experimental 0.0.x package; inspect the source and release before enabling.',
      'Security agents may read broad portions of the repository and invoke local tools.',
    ],
  },
] as const satisfies readonly PiExtensionDefinition[]

export const REQUIRED_PI_EXTENSION = PI_EXTENSION_CATALOG[0]

export function validatePiExtensionCatalog(
  catalog: readonly PiExtensionDefinition[] = PI_EXTENSION_CATALOG,
): void {
  const ids = new Set<string>()
  const packages = new Set<string>()
  for (const extension of catalog) {
    if (!extension.id.trim() || ids.has(extension.id)) throw new Error(`Duplicate or empty Pi extension id: ${extension.id}`)
    if (!/^npm:(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(extension.packageSpec)) {
      throw new Error(`Invalid Pi extension package: ${extension.packageSpec}`)
    }
    if (packages.has(extension.packageSpec)) throw new Error(`Duplicate Pi extension package: ${extension.packageSpec}`)
    if (extension.securityNotes.length === 0) throw new Error(`Missing security notes for Pi extension: ${extension.id}`)
    if (extension.tier === 'required' && !extension.defaultSelected) {
      throw new Error(`Required Pi extension must be selected by default: ${extension.id}`)
    }
    ids.add(extension.id)
    packages.add(extension.packageSpec)
  }
}

validatePiExtensionCatalog()

export function getPiExtension(id: string): PiExtensionDefinition | undefined {
  return PI_EXTENSION_CATALOG.find(extension => extension.id === id)
}

export function recommendedPiExtensionIds(): string[] {
  return PI_EXTENSION_CATALOG
    .filter(extension => extension.tier !== 'required' && extension.defaultSelected)
    .map(extension => extension.id)
}

export function normalizePiExtensionIds(ids: readonly string[]): string[] {
  const requested = new Set(ids.map(id => id.trim()).filter(Boolean))
  const unknown = [...requested].filter(id => !getPiExtension(id))
  if (unknown.length > 0) throw new Error(`Unknown Pi extension id(s): ${unknown.join(', ')}`)
  return PI_EXTENSION_CATALOG
    .filter(extension => requested.has(extension.id))
    .map(extension => extension.id)
}

export function selectedExtensionMetadata(
  entries: readonly PiExtensionMetadataEntry[] | undefined,
): PiExtensionMetadataEntry[] {
  return (entries ?? []).filter(entry => entry.selected && getPiExtension(entry.id) !== undefined)
}

export interface ApplyPiExtensionSelectionOptions {
  selectedIds: readonly string[]
  installRequiredPackage: boolean
  piHome?: string
  previous?: readonly PiExtensionMetadataEntry[]
}

export interface ApplyPiExtensionSelectionResult {
  entries: PiExtensionMetadataEntry[]
  errors: string[]
}

export async function applyPiExtensionSelection(
  options: ApplyPiExtensionSelectionOptions,
): Promise<ApplyPiExtensionSelectionResult> {
  const optionalIds = normalizePiExtensionIds(options.selectedIds)
    .filter(id => id !== REQUIRED_PI_EXTENSION.id)
  const selectedIds = new Set([REQUIRED_PI_EXTENSION.id, ...optionalIds])
  const previous = new Map((options.previous ?? []).map(entry => [entry.id, entry]))
  const runtime = inspectPiRuntime(options.piHome)
  const installed = new Map(runtime.packages.map(item => [item.packageSpec, item.version]))
  const entries: PiExtensionMetadataEntry[] = []
  const errors: string[] = []

  for (const extension of PI_EXTENSION_CATALOG) {
    if (!selectedIds.has(extension.id)) continue
    const prior = previous.get(extension.id)
    const detectedVersion = installed.get(extension.packageSpec)
    const now = new Date().toISOString()

    if (installed.has(extension.packageSpec)) {
      entries.push({
        id: extension.id,
        packageSpec: extension.packageSpec,
        selected: true,
        ownership: prior?.ownership === 'ccg-installed' ? 'ccg-installed' : 'adopted',
        installedVersion: detectedVersion ?? undefined,
        installedAt: prior?.installedAt,
        updatedAt: now,
      })
      continue
    }

    const shouldInstall = extension.tier !== 'required' || options.installRequiredPackage
    if (!runtime.piAvailable || !shouldInstall) {
      entries.push({
        id: extension.id,
        packageSpec: extension.packageSpec,
        selected: true,
        ownership: 'missing',
        updatedAt: now,
      })
      continue
    }

    const result = await runPiPackageCommand('install', extension.packageSpec, { piHome: options.piHome })
    if (!result.success) errors.push(`${result.command}: ${result.stderr || `exit ${result.exitCode ?? 'unknown'}`}`)
    entries.push({
      id: extension.id,
      packageSpec: extension.packageSpec,
      selected: true,
      ownership: result.success ? 'ccg-installed' : 'missing',
      installedAt: result.success ? now : undefined,
      updatedAt: now,
    })
  }

  return { entries, errors }
}

export async function removeCcgInstalledExtensions(
  entries: readonly PiExtensionMetadataEntry[] | undefined,
  piHome?: string,
): Promise<{ removed: string[], preserved: string[], errors: string[] }> {
  const removed: string[] = []
  const preserved: string[] = []
  const errors: string[] = []
  for (const entry of entries ?? []) {
    if (entry.ownership !== 'ccg-installed') {
      preserved.push(entry.packageSpec)
      continue
    }
    const result = await runPiPackageCommand('remove', entry.packageSpec, { piHome })
    if (result.success) removed.push(entry.packageSpec)
    else errors.push(`${result.command}: ${result.stderr || `exit ${result.exitCode ?? 'unknown'}`}`)
  }
  return { removed, preserved, errors }
}
