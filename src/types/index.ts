import type { PiPersonaId } from '../utils/pi-personas'

// 支持的语言
export type SupportedLang = 'zh-CN' | 'en'

// 模型类型
export type ModelType = 'codex' | 'gemini' | 'claude' | 'antigravity' | 'grok'

// 协作模式
export type CollaborationMode = 'parallel' | 'smart' | 'sequential'

// 路由策略
export type RoutingStrategy = 'parallel' | 'fallback' | 'round-robin'

// 模型路由配置
export interface ModelRouting {
  frontend: {
    models: ModelType[]
    primary: ModelType
    strategy: RoutingStrategy
  }
  backend: {
    models: ModelType[]
    primary: ModelType
    strategy: RoutingStrategy
  }
  review: {
    models: ModelType[]
    strategy: 'parallel'
  }
  mode: CollaborationMode
  geminiModel?: string // Gemini 具体型号（默认 gemini-3.1-pro-preview）
  grokModel?: string // Grok 具体型号（默认 grok-4.5，代码任务可选 grok-composer-2.5-fast）
}

// 安装范围
export type InstallScope = 'user' | 'user-project'

// Pi 子代理上限配置
export interface PiCapsConfig {
  devAgentCap: number
  globalConcurrencyLimit: number
  maxSpawnsPerSession: number
  maxSubagentDepth: number
}

// 受管理文件清单，用于回滚
export interface ManagedFileEntry {
  path: string
  kind: 'created' | 'merged' | 'block'
  backupPath?: string
}

// Pi 扩展目录与安装状态
export type PiExtensionTier = 'required' | 'recommended' | 'optional' | 'experimental'
export type PiExtensionCategory
  = | 'orchestration'
    | 'mcp'
    | 'context'
    | 'continuity'
    | 'review'
    | 'security'
    | 'editing'
    | 'planning'
    | 'search'
    | 'ui'
    | 'productivity'
    | 'optimization'
export type PiExtensionOwnership = 'ccg-installed' | 'adopted' | 'missing'

export interface PiExtensionDefinition {
  id: string
  packageSpec: `npm:${string}`
  category: PiExtensionCategory
  tier: PiExtensionTier
  defaultSelected: boolean
  docsUrl: string
  conflicts?: readonly string[]
}

export interface PiExtensionMetadataEntry {
  id: string
  packageSpec: `npm:${string}`
  selected: boolean
  ownership: PiExtensionOwnership
  installedVersion?: string
  installedAt?: string
  updatedAt: string
}

// Pi 化安装器元数据
export interface CcgInstallerMetadata {
  version: string
  language: SupportedLang
  createdAt: string
  updatedAt: string
  scope: InstallScope
  lastChoices: {
    provider?: string
    frontendModel?: string
    backendModel?: string
    reviewModel?: string
    persona?: PiPersonaId
    caps: PiCapsConfig
  }
  extensions?: PiExtensionMetadataEntry[]
  managedFiles: ManagedFileEntry[]
}

// CCG 配置
/** @deprecated Pi 化后仅迁移/卸载分支使用。 */
export interface CcgConfig {
  general: {
    version: string
    language: SupportedLang
    createdAt: string
  }
  routing: ModelRouting
  workflows: {
    installed: string[]
  }
  paths: {
    commands: string
    prompts: string
    backup: string
  }
  mcp: {
    provider: string
    setup_url: string
  }
  performance?: {
    liteMode?: boolean // 轻量模式：禁用 Web UI，更快响应
    skipImpeccable?: boolean // 跳过 Impeccable 前端设计命令安装
  }
}

// 工作流定义
export interface WorkflowConfig {
  id: string
  name: string
  nameEn: string
  category: string
  commands: string[]
  defaultSelected: boolean
  order: number
  description?: string
  descriptionEn?: string
}

// 初始化选项
export interface InitOptions {
  lang?: SupportedLang
  skipPrompt?: boolean
  skipMcp?: boolean // 更新时跳过 MCP 配置
  force?: boolean
  // 非交互模式参数
  frontend?: string
  backend?: string
  mode?: CollaborationMode
  workflows?: string
  installDir?: string
  installProjectAssets?: boolean
  frontendModel?: string
  backendModel?: string
  reviewModel?: string
  persona?: PiPersonaId
  providerFile?: string
  extensionIds?: string[]
  noOptionalExtensions?: boolean
  installRequiredPackage?: boolean
  preserveExtensions?: boolean
  devAgentCap?: number
  globalConcurrencyLimit?: number
  maxSpawnsPerSession?: number
  maxSubagentDepth?: number
}

// 安装结果
export interface InstallResult {
  success: boolean
  installedCommands: string[]
  installedPrompts: string[]
  installedSkills?: number
  installedSkillCommands?: number
  installedRules?: boolean
  errors: string[]
  configPath: string
  binPath?: string
  binInstalled?: boolean
  installedPiAgents?: string[]
  installedPiChains?: string[]
  installedPiPrompts?: string[]
  installedProjectFiles?: string[]
  managedFiles?: ManagedFileEntry[]
  piHome?: string
  projectDir?: string
  addedProviders?: string[]
  skippedProviders?: string[]
}

// ace-tool 配置
export interface AceToolConfig {
  baseUrl: string
  token: string
}

// fast-context (Windsurf Fast Context) 配置
export interface FastContextConfig {
  apiKey?: string // WINDSURF_API_KEY (本地装 Windsurf 登录后可自动提取)
  includeSnippets?: boolean // FC_INCLUDE_SNIPPETS — true 返回完整代码片段
}

// Re-export CLI types
export * from './cli'
