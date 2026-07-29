import type {
  PiExtensionDefinition,
  PiExtensionMetadataEntry,
  PiExtensionOwnership,
} from '../types'
import { i18n } from '../i18n'
import type { PiRuntimeInspection } from './pi-runtime'
import { inspectPiRuntime, runPiPackageCommand } from './pi-runtime'

export const PI_EXTENSION_CATALOG = [
  {
    id: 'core-subagents',
    packageSpec: 'npm:pi-subagents',
    category: 'orchestration',
    tier: 'required',
    defaultSelected: true,
    docsUrl: 'https://www.npmjs.com/package/pi-subagents',
  },
  {
    id: 'mcp-adapter',
    packageSpec: 'npm:pi-mcp-adapter',
    category: 'mcp',
    tier: 'recommended',
    defaultSelected: true,
    docsUrl: 'https://github.com/nicobailon/pi-mcp-adapter',
  },
  {
    id: 'memory-context',
    packageSpec: 'npm:pi-memctx',
    category: 'context',
    tier: 'recommended',
    defaultSelected: true,
    docsUrl: 'https://github.com/weauratech/pi-memctx',
  },
  {
    id: 'session-continuity',
    packageSpec: 'npm:pi-session-continuity',
    category: 'continuity',
    tier: 'recommended',
    defaultSelected: true,
    docsUrl: 'https://github.com/bernardofortes/pi-session-continuity',
  },
  {
    id: 'pr-review',
    packageSpec: 'npm:pi-pr-review',
    category: 'review',
    tier: 'optional',
    defaultSelected: false,
    docsUrl: 'https://github.com/10ego/pi-pr-review',
  },
  {
    id: 'security-audit',
    packageSpec: 'npm:@vigolium/piolium',
    category: 'security',
    tier: 'experimental',
    defaultSelected: false,
    docsUrl: 'https://github.com/vigolium/piolium',
  },
] as const satisfies readonly PiExtensionDefinition[]

export const REQUIRED_PI_EXTENSION = PI_EXTENSION_CATALOG[0]

export type PiExtensionPresentationStatus
  = 'installed'
    | 'adopted'
    | 'missing'
    | 'planned-install'
    | 'runtime-unavailable'

export interface PiExtensionSelectionState {
  extension: PiExtensionDefinition
  checked: boolean
  disabled: boolean
  installed: boolean
  installedVersion?: string
  ownership: PiExtensionOwnership
  installAuthorized: boolean
  status: PiExtensionPresentationStatus
}

export interface PiExtensionPackageOperation {
  action: 'install' | 'remove'
  packageSpec: `npm:${string}`
  id: string
}

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options) as string
}

function extensionKey(extensionOrId: PiExtensionDefinition | string): string {
  return typeof extensionOrId === 'string' ? extensionOrId : extensionOrId.id
}

function translationArray(key: string): string[] {
  const value = i18n.t(key, { returnObjects: true }) as unknown
  return Array.isArray(value) ? value.map(item => String(item)) : []
}

function installedOwnership(prior?: PiExtensionMetadataEntry): PiExtensionOwnership {
  return prior?.ownership === 'ccg-installed' ? 'ccg-installed' : 'adopted'
}

function optionalSelection(ids: readonly string[]): string[] {
  return normalizePiExtensionIds(ids).filter(id => id !== REQUIRED_PI_EXTENSION.id)
}

function buildInstalledMap(runtime: PiRuntimeInspection): Map<`npm:${string}`, string | null> {
  return new Map(runtime.packages.map(item => [item.packageSpec, item.version]))
}

function isProtectedRuntimeEntry(entry: PiExtensionMetadataEntry): boolean {
  return entry.id === REQUIRED_PI_EXTENSION.id || entry.packageSpec === REQUIRED_PI_EXTENSION.packageSpec
}

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

export function presentPiExtensionLabel(extensionOrId: PiExtensionDefinition | string): string {
  return t(`piExtensions.catalog.${extensionKey(extensionOrId)}.label`)
}

export function presentPiExtensionDescription(extensionOrId: PiExtensionDefinition | string): string {
  return t(`piExtensions.catalog.${extensionKey(extensionOrId)}.description`)
}

export function presentPiExtensionSecurityNotes(extensionOrId: PiExtensionDefinition | string): string[] {
  return translationArray(`piExtensions.catalog.${extensionKey(extensionOrId)}.securityNotes`)
}

export function presentPiExtensionTier(extension: PiExtensionDefinition): string {
  return t(`piExtensions.tiers.${extension.tier}`)
}

export function presentPiExtensionStatus(state: PiExtensionSelectionState): string {
  return t(`piExtensions.status.${state.status}`)
}

export function describePiExtensionState(state: PiExtensionSelectionState): string {
  const tags = [presentPiExtensionStatus(state)]
  if (state.disabled) tags.push(t('piExtensions.status.readOnly'))
  return tags.join(' · ')
}

export function buildPiExtensionSelectionStates(options: {
  previous?: readonly PiExtensionMetadataEntry[]
  runtime: PiRuntimeInspection
  selectedIds: readonly string[]
  installRequiredPackage: boolean
}): PiExtensionSelectionState[] {
  const optionalIds = new Set(optionalSelection(options.selectedIds))
  const previous = new Map((options.previous ?? []).map(entry => [entry.id, entry]))
  const installed = buildInstalledMap(options.runtime)

  return PI_EXTENSION_CATALOG.map((extension) => {
    const prior = previous.get(extension.id)
    const installedVersion = installed.get(extension.packageSpec) ?? undefined
    const isInstalled = installed.has(extension.packageSpec)
    const checked = extension.id === REQUIRED_PI_EXTENSION.id
      ? isInstalled || options.installRequiredPackage
      : optionalIds.has(extension.id)
    const installAuthorized = extension.id === REQUIRED_PI_EXTENSION.id
      ? !isInstalled && options.installRequiredPackage
      : checked
    const ownership = isInstalled ? installedOwnership(prior) : 'missing'
    const status: PiExtensionPresentationStatus = isInstalled
      ? ownership === 'ccg-installed' ? 'installed' : 'adopted'
      : checked
        ? 'planned-install'
        : extension.id === REQUIRED_PI_EXTENSION.id
          ? 'runtime-unavailable'
          : 'missing'

    return {
      extension,
      checked,
      disabled: extension.id === REQUIRED_PI_EXTENSION.id && isInstalled,
      installed: isInstalled,
      installedVersion,
      ownership,
      installAuthorized,
      status,
    }
  })
}

export function presentPiExtensionChoice(state: PiExtensionSelectionState): string {
  return `${presentPiExtensionLabel(state.extension)} [${presentPiExtensionTier(state.extension)}] — ${presentPiExtensionDescription(state.extension)} (${describePiExtensionState(state)})`
}

export function summarizeSelectedPiExtensions(states: readonly PiExtensionSelectionState[]): string[] {
  return states
    .filter(state => state.extension.id !== REQUIRED_PI_EXTENSION.id && state.checked)
    .map(state => presentPiExtensionLabel(state.extension))
}

export function requiredPiExtensionState(states: readonly PiExtensionSelectionState[]): PiExtensionSelectionState {
  const state = states.find(item => item.extension.id === REQUIRED_PI_EXTENSION.id)
  if (!state) throw new Error('Required Pi extension state is missing')
  return state
}

export function planPiExtensionPackageOperations(options: {
  previous?: readonly PiExtensionMetadataEntry[]
  states: readonly PiExtensionSelectionState[]
}): PiExtensionPackageOperation[] {
  const operations: PiExtensionPackageOperation[] = []
  const statesById = new Map(options.states.map(state => [state.extension.id, state]))

  for (const state of options.states) {
    if (!state.installed && state.installAuthorized) {
      operations.push({
        action: 'install',
        packageSpec: state.extension.packageSpec,
        id: state.extension.id,
      })
    }
  }

  for (const entry of options.previous ?? []) {
    if (isProtectedRuntimeEntry(entry) || entry.ownership !== 'ccg-installed' || !entry.selected) continue
    const state = statesById.get(entry.id)
    if (state?.checked) continue
    operations.push({
      action: 'remove',
      packageSpec: entry.packageSpec,
      id: entry.id,
    })
  }

  return operations
}

export function presentPiExtensionOperation(operation: PiExtensionPackageOperation): string {
  return t(`piExtensions.operations.${operation.action}`, {
    packageSpec: operation.packageSpec,
    label: presentPiExtensionLabel(operation.id),
  })
}

export function presentPiExtensionSecuritySection(states: readonly PiExtensionSelectionState[]): string[] {
  return states.map((state) => {
    const notes = presentPiExtensionSecurityNotes(state.extension)
    return `  - ${presentPiExtensionLabel(state.extension)}: ${notes.join(' ')}`
  })
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
  const runtime = inspectPiRuntime(options.piHome)
  const errors: string[] = []
  const states = buildPiExtensionSelectionStates({
    previous: options.previous,
    runtime,
    selectedIds: options.selectedIds,
    installRequiredPackage: options.installRequiredPackage,
  })
  const entries: PiExtensionMetadataEntry[] = []
  const previousById = new Map((options.previous ?? []).map(entry => [entry.id, entry]))

  for (const state of states) {
    if (!state.checked && state.extension.id !== REQUIRED_PI_EXTENSION.id) continue

    const prior = previousById.get(state.extension.id)
    const now = new Date().toISOString()

    if (state.installed) {
      entries.push({
        id: state.extension.id,
        packageSpec: state.extension.packageSpec,
        selected: true,
        ownership: state.ownership,
        installedVersion: state.installedVersion,
        installedAt: prior?.installedAt,
        updatedAt: now,
      })
      continue
    }

    if (!runtime.piAvailable || !state.installAuthorized) {
      entries.push({
        id: state.extension.id,
        packageSpec: state.extension.packageSpec,
        selected: true,
        ownership: 'missing',
        updatedAt: now,
      })
      continue
    }

    const result = await runPiPackageCommand('install', state.extension.packageSpec, { piHome: options.piHome })
    if (!result.success) errors.push(`${result.command}: ${result.stderr || `exit ${result.exitCode ?? 'unknown'}`}`)
    entries.push({
      id: state.extension.id,
      packageSpec: state.extension.packageSpec,
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
    if (isProtectedRuntimeEntry(entry) || entry.ownership !== 'ccg-installed') {
      preserved.push(entry.packageSpec)
      continue
    }
    const result = await runPiPackageCommand('remove', entry.packageSpec, { piHome })
    if (result.success) removed.push(entry.packageSpec)
    else errors.push(`${result.command}: ${result.stderr || `exit ${result.exitCode ?? 'unknown'}`}`)
  }
  return { removed, preserved, errors }
}
