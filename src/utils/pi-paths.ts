import { homedir } from 'node:os'
import { join } from 'pathe'

// Pi 化改造：所有 Pi 目标路径与共享常量集中于此（plan step 2）

/** 当前安装、验证和模型路由使用的六个通用角色模板。 */
export const CCG_PI_ACTIVE_AGENT_NAMES = [
  'ccg-project-scout',
  'ccg-planner',
  'ccg-backend-builder',
  'ccg-frontend-builder',
  'ccg-test-runner',
  'ccg-reviewer',
] as const

/** 仅用于升级迁移和卸载清理，不再作为 active runtime 安装。 */
export const CCG_PI_RETIRED_AGENT_NAMES = [
  'ccg-miniprogram-builder',
] as const

export const CCG_PI_CLEANUP_AGENT_NAMES = [
  ...CCG_PI_ACTIVE_AGENT_NAMES,
  ...CCG_PI_RETIRED_AGENT_NAMES,
] as const

export const CCG_PI_MODEL_AGENTS = {
  frontendModel: ['ccg-frontend-builder'],
  backendModel: ['ccg-backend-builder'],
  reviewModel: ['ccg-reviewer', 'ccg-test-runner'],
} as const

/** Pi 用户级根目录 ~/.pi/agent */
export function getPiAgentHome(): string {
  return join(homedir(), '.pi', 'agent')
}

/** Pi web-search extension config ~/.pi/web-search.json (intentionally independent from Pi agent home overrides). */
export function getPiWebSearchConfigPath(): string {
  return join(homedir(), '.pi', 'web-search.json')
}

/** Pi 全局设置 <piHome>/settings.json（仅深合并 subagents 命名空间） */
export function getPiSettingsPath(piHome = getPiAgentHome()): string {
  return join(piHome, 'settings.json')
}

/** Pi provider 注册表 <piHome>/models.json（只追加，不覆盖同名 provider） */
export function getPiModelsPath(piHome = getPiAgentHome()): string {
  return join(piHome, 'models.json')
}

/** 用户级 agents 目录 <piHome>/agents */
export function getPiAgentsDir(piHome = getPiAgentHome()): string {
  return join(piHome, 'agents')
}

/** 用户级 chains 目录 <piHome>/chains */
export function getPiChainsDir(piHome = getPiAgentHome()): string {
  return join(piHome, 'chains')
}

/** 用户级 prompts 目录 <piHome>/prompts */
export function getPiPromptsDir(piHome = getPiAgentHome()): string {
  return join(piHome, 'prompts')
}

/** pi-subagents 扩展上限配置 <piHome>/extensions/subagent/config.json */
export function getSubagentExtensionConfigPath(piHome = getPiAgentHome()): string {
  return join(piHome, 'extensions', 'subagent', 'config.json')
}

/** CCG 安装器元数据落点 <piHome>/ccg-workflow.json（取代 ~/.claude/.ccg/config.toml） */
export function getCcgMetadataPath(piHome = getPiAgentHome()): string {
  return join(piHome, 'ccg-workflow.json')
}

/** 项目级 Pi 目录 <cwd>/.pi */
export function getProjectPiDir(cwd: string): string {
  return join(cwd, '.pi')
}

export function getProjectPiSettingsPath(cwd: string): string {
  return join(getProjectPiDir(cwd), 'settings.json')
}

export function getProjectPiAgentsDir(cwd: string): string {
  return join(getProjectPiDir(cwd), 'agents')
}

export function getProjectPiChainsDir(cwd: string): string {
  return join(getProjectPiDir(cwd), 'chains')
}

export function getProjectPiPromptsDir(cwd: string): string {
  return join(getProjectPiDir(cwd), 'prompts')
}

/** nocturne_memory 等 MCP 服务样例配置落点（plan §8.2，用户手工改路径后合并生效） */
export function getProjectMcpExamplePath(cwd: string): string {
  return join(getProjectPiDir(cwd), 'mcp.json.example')
}

/** 项目根 AGENTS.md（受管块宿主） */
export function getProjectAgentsMdPath(cwd: string): string {
  return join(cwd, 'AGENTS.md')
}

/** 旧版 Claude 配置目录 ~/.claude/.ccg（仅迁移/卸载分支可读） */
export function getLegacyClaudeCcgDir(): string {
  return join(homedir(), '.claude', '.ccg')
}

/** 旧版 Claude 配置文件 ~/.claude/.ccg/config.toml */
export function getLegacyClaudeConfigPath(): string {
  return join(getLegacyClaudeCcgDir(), 'config.toml')
}

/** 默认代理上限（并发 builder 上限为 4；实际总数由 supervisor 按 waves 与 spawn budget 决定） */
export const DEFAULT_PI_CAPS = {
  devAgentCap: 4,
  globalConcurrencyLimit: 4,
  maxSpawnsPerSession: 24,
  maxSubagentDepth: 1,
} as const

/** AGENTS.md 受管块定界符（risk 3：严格只替换块内内容） */
export const CCG_MANAGED_BLOCK_START = '<!-- CCG:PI-START -->'
export const CCG_MANAGED_BLOCK_END = '<!-- CCG:PI-END -->'
