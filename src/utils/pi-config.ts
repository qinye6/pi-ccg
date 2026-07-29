import { open } from 'node:fs/promises'
import fs from 'fs-extra'
import { dirname } from 'pathe'
import {
  DEFAULT_PI_CAPS,
  getPiModelsPath,
  getPiSettingsPath,
  getSubagentExtensionConfigPath,
} from './pi-paths'

export interface PiAgentOverride {
  model?: string
  fallbackModels?: string[]
  thinking?: string
  systemPromptMode?: string
  inheritProjectContext?: boolean
  inheritSkills?: boolean
  defaultContext?: string[]
  acceptanceRole?: string
  disabled?: boolean
  skills?: string[]
  tools?: string[]
  systemPrompt?: string
}

export interface PiSubagentsSettings {
  defaultModel?: string
  agentOverrides?: Record<string, PiAgentOverride>
}

export interface PiSettingsFile {
  subagents?: PiSubagentsSettings
  [key: string]: unknown
}

export interface PiModelConfig {
  id: string
  name?: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max', string | null>>
  input?: ('text' | 'image')[]
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    [key: string]: unknown
  }
  contextWindow?: number
  maxTokens?: number
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

export interface PiProvider {
  name?: string
  api?: string
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  authHeader?: boolean
  models?: (PiModelConfig | string)[]
  modelOverrides?: Record<string, Omit<PiModelConfig, 'id'>>
  [key: string]: unknown
}

export interface PiModelsFile {
  providers?: Record<string, PiProvider>
  [key: string]: unknown
}

export type PiModelsInspection
  = | { status: 'missing', path: string, providers: string[], models: string[] }
    | { status: 'invalid', path: string, error: string, providers: string[], models: string[] }
    | { status: 'valid', path: string, data: PiModelsFile, providers: string[], models: string[] }

export interface SubagentExtensionConfig {
  globalConcurrencyLimit?: number
  maxSubagentSpawnsPerSession?: number
  maxSubagentDepth?: number
  parallel?: {
    concurrency?: number
    maxTasks?: number
  }
  [key: string]: unknown
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withoutUndefinedAgentOverride(value: PiAgentOverride): PiAgentOverride {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as PiAgentOverride
}

function asAgentOverrides(value: unknown): Record<string, PiAgentOverride> {
  return isRecord(value) ? value as Record<string, PiAgentOverride> : {}
}

function asProviders(value: unknown): Record<string, PiProvider> {
  return isRecord(value) ? value as Record<string, PiProvider> : {}
}

function asParallelConfig(value: unknown): NonNullable<SubagentExtensionConfig['parallel']> & JsonRecord {
  return isRecord(value) ? value as NonNullable<SubagentExtensionConfig['parallel']> & JsonRecord : {}
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeJson(item))
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => [key, normalizeJson(value[key])]),
  )
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value))
}

function hasSubagentsPatch(patch: PiSubagentsSettings): boolean {
  return patch.defaultModel !== undefined
    || (patch.agentOverrides !== undefined && Object.keys(patch.agentOverrides).length > 0)
}

async function readJsonOrEmpty<T extends JsonRecord>(filePath: string): Promise<{ existed: boolean, data: T }> {
  if (!(await fs.pathExists(filePath))) {
    return { existed: false, data: {} as T }
  }

  return {
    existed: true,
    data: await fs.readJson(filePath) as T,
  }
}

let atomicWriteCounter = 0

async function syncDirectory(dirPath: string): Promise<void> {
  try {
    const directory = await open(dirPath, 'r')
    try {
      await directory.sync()
    }
    finally {
      await directory.close()
    }
  }
  catch {
    // Directory fsync is not supported on every platform.
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dirPath = dirname(filePath)
  await fs.ensureDir(dirPath)

  let mode = 0o600
  if (await fs.pathExists(filePath)) {
    mode = (await fs.stat(filePath)).mode & 0o777
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteCounter++}.ccg-tmp`
  const handle = await open(tempPath, 'wx', mode)
  let handleOpen = true

  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf-8')
    await handle.sync()
    await handle.close()
    handleOpen = false
    await fs.rename(tempPath, filePath)
    await syncDirectory(dirPath)
  }
  catch (error) {
    if (handleOpen) await handle.close().catch(() => {})
    await fs.remove(tempPath).catch(() => {})
    throw error
  }
}

function mergeSubagents(current: unknown, patch: PiSubagentsSettings): PiSubagentsSettings {
  const currentSubagents = isRecord(current) ? current as PiSubagentsSettings : {}
  const nextSubagents: PiSubagentsSettings = { ...currentSubagents }

  if (patch.defaultModel !== undefined) {
    nextSubagents.defaultModel = patch.defaultModel
  }

  if (patch.agentOverrides !== undefined) {
    const currentOverrides = asAgentOverrides(currentSubagents.agentOverrides)
    const nextOverrides: Record<string, PiAgentOverride> = { ...currentOverrides }

    for (const [agentName, overridePatch] of Object.entries(patch.agentOverrides)) {
      const currentOverride = isRecord(currentOverrides[agentName])
        ? currentOverrides[agentName]
        : {}
      nextOverrides[agentName] = {
        ...currentOverride,
        ...withoutUndefinedAgentOverride(overridePatch),
      }
    }

    if (Object.keys(nextOverrides).length > 0) {
      nextSubagents.agentOverrides = nextOverrides
    }
  }

  return nextSubagents
}

export async function mergePiSettingsSubagents(
  patch: PiSubagentsSettings,
  settingsPath: string = getPiSettingsPath(),
): Promise<{ changed: boolean, backupPath: string | null }> {
  const { existed, data } = await readJsonOrEmpty<PiSettingsFile>(settingsPath)
  const nextSettings: PiSettingsFile = { ...data }
  if (data.subagents !== undefined || hasSubagentsPatch(patch)) {
    nextSettings.subagents = mergeSubagents(data.subagents, patch)
  }

  if (stableJson(data) === stableJson(nextSettings)) {
    return { changed: false, backupPath: null }
  }

  const backupPath = existed ? `${settingsPath}.ccg-bak` : null
  if (backupPath !== null) {
    await fs.copy(settingsPath, backupPath)
  }

  await writeJsonAtomic(settingsPath, nextSettings)
  return { changed: true, backupPath }
}

export async function reconcilePiSettingsSubagents(
  patch: PiSubagentsSettings,
  removeAgentNames: readonly string[],
  settingsPath: string = getPiSettingsPath(),
): Promise<{ changed: boolean, backupPath: string | null }> {
  const { existed, data } = await readJsonOrEmpty<PiSettingsFile>(settingsPath)
  const nextSettings: PiSettingsFile = { ...data }
  const nextSubagents = mergeSubagents(data.subagents, patch)
  const nextOverrides = { ...asAgentOverrides(nextSubagents.agentOverrides) }

  for (const agentName of removeAgentNames) {
    delete nextOverrides[agentName]
  }

  if (Object.keys(nextOverrides).length === 0) delete nextSubagents.agentOverrides
  else nextSubagents.agentOverrides = nextOverrides

  if (Object.keys(nextSubagents).length === 0) delete nextSettings.subagents
  else nextSettings.subagents = nextSubagents

  if (stableJson(data) === stableJson(nextSettings)) {
    return { changed: false, backupPath: null }
  }

  const backupPath = existed ? `${settingsPath}.ccg-bak` : null
  if (backupPath !== null) await fs.copy(settingsPath, backupPath)
  await writeJsonAtomic(settingsPath, nextSettings)
  return { changed: true, backupPath }
}

function modelId(model: PiModelConfig | string): string | null {
  if (typeof model === 'string') return model
  return typeof model.id === 'string' && model.id.trim() ? model.id : null
}

export async function inspectPiModels(
  modelsPath: string = getPiModelsPath(),
): Promise<PiModelsInspection> {
  if (!(await fs.pathExists(modelsPath))) {
    return { status: 'missing', path: modelsPath, providers: [], models: [] }
  }

  let value: unknown
  try {
    value = await fs.readJson(modelsPath) as unknown
  }
  catch {
    return { status: 'invalid', path: modelsPath, error: 'invalid JSON', providers: [], models: [] }
  }
  if (!isRecord(value)) {
    return { status: 'invalid', path: modelsPath, error: 'JSON root must be an object', providers: [], models: [] }
  }
  if (value.providers !== undefined && !isRecord(value.providers)) {
    return { status: 'invalid', path: modelsPath, error: 'providers must be an object', providers: [], models: [] }
  }

  const data = value as PiModelsFile
  const providers = Object.keys(asProviders(data.providers))
  const models = providers.flatMap((providerId) => {
    const provider = asProviders(data.providers)[providerId]
    return Array.isArray(provider.models)
      ? provider.models.flatMap((model) => {
          const id = modelId(model)
          return id ? [`${providerId}/${id}`] : []
        })
      : []
  })
  return { status: 'valid', path: modelsPath, data, providers, models }
}

function mergeModelLists(
  current: readonly (PiModelConfig | string)[] | undefined,
  patch: readonly (PiModelConfig | string)[] | undefined,
): (PiModelConfig | string)[] | undefined {
  if (patch === undefined) return current ? [...current] : undefined
  const next = [...(current ?? [])]
  const positions = new Map<string, number>()
  next.forEach((model, index) => {
    const id = modelId(model)
    if (id) positions.set(id, index)
  })
  for (const model of patch) {
    const id = modelId(model)
    if (!id) continue
    const index = positions.get(id)
    if (index === undefined) {
      positions.set(id, next.length)
      next.push(model)
    }
    else if (typeof next[index] === 'object' && typeof model === 'object') {
      next[index] = { ...next[index] as PiModelConfig, ...model }
    }
    else {
      next[index] = model
    }
  }
  return next
}

function mergeRecords(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    next[key] = isRecord(next[key]) && isRecord(value)
      ? mergeRecords(next[key], value)
      : value
  }
  return next
}

function mergeProvider(current: PiProvider | undefined, patch: PiProvider): PiProvider {
  const currentOverrides = isRecord(current?.modelOverrides) ? current.modelOverrides : {}
  const patchOverrides = isRecord(patch.modelOverrides) ? patch.modelOverrides : {}
  const next: PiProvider = {
    ...(current ?? {}),
    ...patch,
  }
  const models = mergeModelLists(current?.models, patch.models)
  if (models !== undefined) next.models = models
  if (Object.keys(currentOverrides).length > 0 || Object.keys(patchOverrides).length > 0) {
    next.modelOverrides = { ...currentOverrides }
    for (const [modelId, override] of Object.entries(patchOverrides)) {
      next.modelOverrides[modelId] = mergeRecords(
        isRecord(currentOverrides[modelId]) ? currentOverrides[modelId] : {},
        isRecord(override) ? override : {},
      )
    }
  }
  return next
}

export async function mergePiProviders(
  providers: Record<string, PiProvider>,
  opts: { force?: boolean, modelsPath?: string } = {},
): Promise<{ changed: boolean, added: string[], updated: string[], skipped: string[], backupPath: string | null }> {
  const modelsPath = opts.modelsPath ?? getPiModelsPath()
  const inspection = await inspectPiModels(modelsPath)
  if (inspection.status === 'invalid') {
    throw new Error(`Refusing to overwrite invalid models.json: ${modelsPath}`)
  }

  const data = inspection.status === 'valid' ? inspection.data : {}
  const currentProviders = asProviders(data.providers)
  const nextProviders = { ...currentProviders }
  const added: string[] = []
  const updated: string[] = []
  const skipped: string[] = []

  for (const [providerId, patch] of Object.entries(providers)) {
    const current = currentProviders[providerId]
    if (current === undefined) {
      nextProviders[providerId] = patch
      added.push(providerId)
      continue
    }
    const merged = mergeProvider(current, patch)
    if (stableJson(current) === stableJson(merged)) skipped.push(providerId)
    else {
      nextProviders[providerId] = merged
      updated.push(providerId)
    }
  }

  const nextData: PiModelsFile = { ...data, providers: nextProviders }
  if (stableJson(data) === stableJson(nextData)) {
    return { changed: false, added, updated, skipped, backupPath: null }
  }
  const backupPath = inspection.status === 'valid' && opts.force ? `${modelsPath}.ccg-bak` : null
  if (backupPath) await fs.copy(modelsPath, backupPath)
  await writeJsonAtomic(modelsPath, nextData)
  return { changed: true, added, updated, skipped, backupPath }
}

export async function appendPiProviders(
  providers: Record<string, PiProvider>,
  opts: { force?: boolean, modelsPath?: string } = {},
): Promise<{ added: string[], skipped: string[] }> {
  const modelsPath = opts.modelsPath ?? getPiModelsPath()
  const { existed, data } = await readJsonOrEmpty<PiModelsFile>(modelsPath)
  const currentProviders = asProviders(data.providers)
  const nextProviders: Record<string, PiProvider> = { ...currentProviders }
  const added: string[] = []
  const skipped: string[] = []
  let overwroteExistingProvider = false

  for (const [providerName, provider] of Object.entries(providers)) {
    if (Object.prototype.hasOwnProperty.call(currentProviders, providerName) && !opts.force) {
      skipped.push(providerName)
      continue
    }

    if (Object.prototype.hasOwnProperty.call(currentProviders, providerName) && opts.force) {
      overwroteExistingProvider = true
    }

    nextProviders[providerName] = provider
    added.push(providerName)
  }

  const nextData: PiModelsFile = {
    ...data,
    providers: nextProviders,
  }

  if (stableJson(data) !== stableJson(nextData)) {
    if (existed && opts.force && overwroteExistingProvider) {
      await fs.copy(modelsPath, `${modelsPath}.ccg-bak`)
    }
    await writeJsonAtomic(modelsPath, nextData)
  }

  return { added, skipped }
}

export async function mergeSubagentExtensionConfig(
  caps: {
    devAgentCap?: number
    globalConcurrencyLimit?: number
    maxSpawnsPerSession?: number
    maxSubagentDepth?: number
  },
  configPath: string = getSubagentExtensionConfigPath(),
): Promise<SubagentExtensionConfig> {
  const { data } = await readJsonOrEmpty<SubagentExtensionConfig>(configPath)
  const globalConcurrencyLimit = caps.globalConcurrencyLimit ?? DEFAULT_PI_CAPS.globalConcurrencyLimit
  const maxSubagentSpawnsPerSession = caps.maxSpawnsPerSession ?? DEFAULT_PI_CAPS.maxSpawnsPerSession
  const maxSubagentDepth = caps.maxSubagentDepth ?? DEFAULT_PI_CAPS.maxSubagentDepth
  const devAgentCap = caps.devAgentCap ?? DEFAULT_PI_CAPS.devAgentCap
  const currentParallel = asParallelConfig(data.parallel)

  const nextConfig: SubagentExtensionConfig = {
    ...data,
    globalConcurrencyLimit,
    maxSubagentSpawnsPerSession,
    maxSubagentDepth,
    parallel: {
      ...currentParallel,
      concurrency: globalConcurrencyLimit,
      maxTasks: devAgentCap,
    },
  }

  await writeJsonAtomic(configPath, nextConfig)
  return nextConfig
}

export function computeEffectiveDevParallelism(cfg: {
  devAgentCap: number
  globalConcurrencyLimit: number
  parallelConcurrency: number
  parallelMaxTasks: number
}): number {
  return Math.min(
    cfg.devAgentCap,
    cfg.globalConcurrencyLimit,
    cfg.parallelConcurrency,
    cfg.parallelMaxTasks,
  )
}

export function computeRequiredSpawns(builderCount: number): number {
  return 2 + builderCount + 1 + 1
}
