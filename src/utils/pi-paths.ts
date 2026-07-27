import { homedir } from 'node:os'
import { join } from 'pathe'

// Pi 化改造：所有 Pi 目标路径与共享常量集中于此（plan step 2）

/** Pi 用户级根目录 ~/.pi/agent */
export function getPiAgentHome(): string {
  return join(homedir(), '.pi', 'agent')
}

/** Pi 全局设置 ~/.pi/agent/settings.json（仅深合并 subagents 命名空间） */
export function getPiSettingsPath(): string {
  return join(getPiAgentHome(), 'settings.json')
}

/** Pi provider 注册表 ~/.pi/agent/models.json（只追加，不覆盖同名 provider） */
export function getPiModelsPath(): string {
  return join(getPiAgentHome(), 'models.json')
}

/** 用户级 agents 目录 ~/.pi/agent/agents */
export function getPiAgentsDir(): string {
  return join(getPiAgentHome(), 'agents')
}

/** 用户级 chains 目录 ~/.pi/agent/chains */
export function getPiChainsDir(): string {
  return join(getPiAgentHome(), 'chains')
}

/** 用户级 prompts 目录 ~/.pi/agent/prompts */
export function getPiPromptsDir(): string {
  return join(getPiAgentHome(), 'prompts')
}

/** pi-subagents 扩展上限配置 ~/.pi/agent/extensions/subagent/config.json */
export function getSubagentExtensionConfigPath(): string {
  return join(getPiAgentHome(), 'extensions', 'subagent', 'config.json')
}

/** CCG 安装器元数据落点 ~/.pi/agent/ccg-workflow.json（取代 ~/.claude/.ccg/config.toml） */
export function getCcgMetadataPath(): string {
  return join(getPiAgentHome(), 'ccg-workflow.json')
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

/** 默认代理上限（plan §5 公式输入：dev=4 时 requiredSpawns=8 ≤ 24） */
export const DEFAULT_PI_CAPS = {
  devAgentCap: 4,
  globalConcurrencyLimit: 4,
  maxSpawnsPerSession: 24,
  maxSubagentDepth: 1,
} as const

/** AGENTS.md 受管块定界符（risk 3：严格只替换块内内容） */
export const CCG_MANAGED_BLOCK_START = '<!-- CCG:PI-START -->'
export const CCG_MANAGED_BLOCK_END = '<!-- CCG:PI-END -->'
