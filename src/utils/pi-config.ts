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

export interface PiProvider {
  api: string
  baseUrl: string
  apiKey?: string
  models: unknown[]
  [key: string]: unknown
}

export interface PiModelsFile {
  providers?: Record<string, PiProvider>
  [key: string]: unknown
}

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

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.ensureDir(dirname(filePath))
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
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

  await writeJson(settingsPath, nextSettings)
  return { changed: true, backupPath }
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
    await writeJson(modelsPath, nextData)
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

  await writeJson(configPath, nextConfig)
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

export function computeRequiredSpawns(effectiveDevParallelism: number): number {
  return 2 + effectiveDevParallelism + 1 + 1
}
