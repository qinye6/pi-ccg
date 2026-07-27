import type {
  CcgConfig,
  CcgInstallerMetadata,
  InstallScope,
  ModelRouting,
  PiCapsConfig,
  SupportedLang,
} from '../types'
import fs from 'fs-extra'
import { homedir } from 'node:os'
import { dirname, join } from 'pathe'
import { parse, stringify } from 'smol-toml'
import { version as packageVersion } from '../../package.json'
import {
  DEFAULT_PI_CAPS,
  getCcgMetadataPath,
  getLegacyClaudeCcgDir,
  getLegacyClaudeConfigPath,
} from './pi-paths'

// v1.4.0: 配置目录统一到 ~/.claude/.ccg/（Pi 化后仅迁移/卸载分支使用）
const CCG_DIR = getLegacyClaudeCcgDir()
const CONFIG_FILE = getLegacyClaudeConfigPath()

/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export function getCcgDir(): string {
  return CCG_DIR
}

/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export function getConfigPath(): string {
  return CONFIG_FILE
}

/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export async function ensureCcgDir(): Promise<void> {
  await fs.ensureDir(CCG_DIR)
}

/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export async function readCcgConfig(): Promise<CcgConfig | null> {
  try {
    if (await fs.pathExists(CONFIG_FILE)) {
      const content = await fs.readFile(CONFIG_FILE, 'utf-8')
      return parse(content) as unknown as CcgConfig
    }
  }
  catch {
    // Config doesn't exist or is invalid
  }
  return null
}

/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export async function writeCcgConfig(config: CcgConfig): Promise<void> {
  await ensureCcgDir()
  const content = stringify(config as any)
  await fs.writeFile(CONFIG_FILE, content, 'utf-8')
}

/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export function createDefaultConfig(options: {
  language: SupportedLang
  routing: ModelRouting
  installedWorkflows: string[]
  mcpProvider?: string
  liteMode?: boolean
  skipImpeccable?: boolean
}): CcgConfig {
  return {
    general: {
      version: packageVersion,
      language: options.language,
      createdAt: new Date().toISOString(),
    },
    routing: options.routing,
    workflows: {
      installed: options.installedWorkflows,
    },
    paths: {
      commands: join(homedir(), '.claude', 'commands', 'ccg'),
      prompts: join(CCG_DIR, 'prompts'), // v1.4.0: 移到配置目录
      backup: join(CCG_DIR, 'backup'),
    },
    mcp: {
      provider: options.mcpProvider || 'fast-context',
      setup_url: 'https://augmentcode.com/',
    },
    performance: {
      liteMode: options.liteMode || false,
      skipImpeccable: options.skipImpeccable || false,
    },
  }
}

/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export function createDefaultRouting(): ModelRouting {
  return {
    frontend: {
      models: ['antigravity'],
      primary: 'antigravity',
      strategy: 'parallel',
    },
    backend: {
      models: ['codex'],
      primary: 'codex',
      strategy: 'parallel',
    },
    review: {
      models: ['codex', 'antigravity'],
      strategy: 'parallel',
    },
    mode: 'smart',
  }
}

export async function readCcgMetadata(): Promise<CcgInstallerMetadata | null> {
  try {
    const metadataPath = getCcgMetadataPath()
    if (await fs.pathExists(metadataPath)) {
      return await fs.readJson(metadataPath) as CcgInstallerMetadata
    }
  }
  catch {
    // 元数据缺失或损坏时不阻塞安装流程
  }
  return null
}

export async function writeCcgMetadata(meta: CcgInstallerMetadata): Promise<void> {
  const metadataPath = getCcgMetadataPath()
  await fs.ensureDir(dirname(metadataPath))
  await fs.writeJson(metadataPath, meta, { spaces: 2 })
}

export function createDefaultMetadata(options: {
  language: SupportedLang
  scope?: InstallScope
  caps?: Partial<PiCapsConfig>
  lastChoices?: Partial<CcgInstallerMetadata['lastChoices']>
}): CcgInstallerMetadata {
  const { caps: lastChoiceCaps, ...lastChoices } = options.lastChoices ?? {}
  const caps: PiCapsConfig = {
    ...DEFAULT_PI_CAPS,
    ...options.caps,
    ...lastChoiceCaps,
  }
  const now = new Date().toISOString()

  return {
    version: packageVersion,
    language: options.language,
    createdAt: now,
    updatedAt: now,
    scope: options.scope ?? 'user',
    lastChoices: {
      ...lastChoices,
      caps,
    },
    managedFiles: [],
  }
}

export async function updateCcgMetadata(
  patch: Partial<CcgInstallerMetadata>,
): Promise<CcgInstallerMetadata> {
  const current = await readCcgMetadata() ?? createDefaultMetadata({ language: 'zh-CN' })
  const patchLastChoices = patch.lastChoices as Partial<CcgInstallerMetadata['lastChoices']> | undefined
  const lastChoices = patchLastChoices
    ? {
        ...current.lastChoices,
        ...patchLastChoices,
        caps: {
          ...current.lastChoices.caps,
          ...(patchLastChoices.caps ?? {}),
        },
      }
    : current.lastChoices

  const next: CcgInstallerMetadata = {
    ...current,
    ...patch,
    lastChoices,
    managedFiles: patch.managedFiles ?? current.managedFiles,
    updatedAt: new Date().toISOString(),
  }

  await writeCcgMetadata(next)
  return next
}
