import type { PiAgentOverride, PiSubagentsSettings, SubagentExtensionConfig } from '../utils/pi-config'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { version } from '../../package.json'
import { uninstallPiWorkflow } from '../utils/installer'
import { mergeSubagentExtensionConfig, reconcilePiSettingsSubagents } from '../utils/pi-config'
import {
  CCG_PI_MODEL_AGENTS,
  CCG_PI_RETIRED_AGENT_NAMES,
  DEFAULT_PI_CAPS,
  getCcgMetadataPath,
  getPiAgentHome,
  getPiSettingsPath,
  getSubagentExtensionConfigPath,
} from '../utils/pi-paths'
import { doctor, status } from './doctor'
import { extensions } from './extensions'
import { init } from './init'
import { update } from './update'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  if (!(await fs.pathExists(path))) return {}
  try {
    return await fs.readJson(path) as Record<string, unknown>
  }
  catch {
    return {}
  }
}

function currentModel(overrides: Record<string, unknown>, agents: readonly string[]): string {
  for (const agent of agents) {
    const override = asRecord(overrides[agent])
    if (typeof override.model === 'string' && override.model.trim()) return override.model
  }
  return ''
}

async function configureModels(): Promise<void> {
  const settings = await readJson(getPiSettingsPath())
  const subagents = asRecord(settings.subagents)
  const overrides = asRecord(subagents.agentOverrides)

  const current = {
    frontendModel: currentModel(overrides, CCG_PI_MODEL_AGENTS.frontendModel),
    backendModel: currentModel(overrides, CCG_PI_MODEL_AGENTS.backendModel),
    reviewModel: currentModel(overrides, CCG_PI_MODEL_AGENTS.reviewModel),
  }

  console.log(ansis.cyan.bold('\n  Pi 子代理模型配置'))
  console.log(ansis.gray('  只保存 provider/model 引用；不会读取、显示或复制 API Key。\n'))

  const answers = await inquirer.prompt<typeof current>([
    {
      type: 'input',
      name: 'frontendModel',
      message: 'Frontend builder 模型（所有 frontend component profiles）:',
      default: current.frontendModel,
      validate: value => String(value).trim().length > 0 || '请输入 provider/model',
    },
    {
      type: 'input',
      name: 'backendModel',
      message: 'Backend builder 模型:',
      default: current.backendModel,
      validate: value => String(value).trim().length > 0 || '请输入 provider/model',
    },
    {
      type: 'input',
      name: 'reviewModel',
      message: 'Reviewer / Test runner 模型:',
      default: current.reviewModel,
      validate: value => String(value).trim().length > 0 || '请输入 provider/model',
    },
  ])

  const agentOverrides: NonNullable<PiSubagentsSettings['agentOverrides']> = {}
  const assign = (agents: readonly string[], model: string): void => {
    for (const agent of agents) agentOverrides[agent] = { model: model.trim() } satisfies PiAgentOverride
  }
  assign(CCG_PI_MODEL_AGENTS.frontendModel, answers.frontendModel)
  assign(CCG_PI_MODEL_AGENTS.backendModel, answers.backendModel)
  assign(CCG_PI_MODEL_AGENTS.reviewModel, answers.reviewModel)

  await reconcilePiSettingsSubagents({ agentOverrides }, CCG_PI_RETIRED_AGENT_NAMES)
  console.log(ansis.green('\n  ✓ Pi 子代理模型配置已更新'))
}

function positiveInteger(value: unknown): boolean | string {
  return Number.isInteger(value) && Number(value) > 0 ? true : '请输入正整数'
}

async function configureLimits(): Promise<void> {
  const current = await readJson(getSubagentExtensionConfigPath()) as SubagentExtensionConfig
  const parallel = asRecord(current.parallel)
  const defaults = {
    devAgentCap: Number(parallel.maxTasks) || DEFAULT_PI_CAPS.devAgentCap,
    globalConcurrencyLimit: Number(current.globalConcurrencyLimit) || DEFAULT_PI_CAPS.globalConcurrencyLimit,
    maxSpawnsPerSession: Number(current.maxSubagentSpawnsPerSession) || DEFAULT_PI_CAPS.maxSpawnsPerSession,
    maxSubagentDepth: Number(current.maxSubagentDepth) || DEFAULT_PI_CAPS.maxSubagentDepth,
  }

  const caps = await inquirer.prompt<typeof defaults>([
    { type: 'number', name: 'devAgentCap', message: '开发 builder 上限:', default: defaults.devAgentCap, validate: positiveInteger },
    { type: 'number', name: 'globalConcurrencyLimit', message: '全局并发上限:', default: defaults.globalConcurrencyLimit, validate: positiveInteger },
    { type: 'number', name: 'maxSpawnsPerSession', message: '每会话最大派生数:', default: defaults.maxSpawnsPerSession, validate: positiveInteger },
    { type: 'number', name: 'maxSubagentDepth', message: '最大子代理深度:', default: defaults.maxSubagentDepth, validate: positiveInteger },
  ])

  const effective = Math.min(caps.devAgentCap, caps.globalConcurrencyLimit)
  const requiredSpawns = 2 + effective + 1 + 1
  if (requiredSpawns > caps.maxSpawnsPerSession) {
    console.log(ansis.yellow(`\n  派生预算不足：至少需要 ${requiredSpawns}，配置未保存。`))
    return
  }

  await mergeSubagentExtensionConfig(caps)
  console.log(ansis.green('\n  ✓ Pi 子代理上限已更新'))
}

async function uninstall(): Promise<void> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
    type: 'confirm',
    name: 'confirm',
    message: '只移除 CCG 管理的 Pi assets？用户 providers、凭据、mcp.json 和 AGENTS.md 其他内容会保留。',
    default: false,
  }])
  if (!confirm) return

  const result = await uninstallPiWorkflow({ projectDir: process.cwd() })
  if (!result.success) {
    console.log(ansis.red('\n  ✗ Pi workflow 卸载未完整完成'))
    for (const error of result.errors) console.log(ansis.red(`    ${error}`))
    return
  }
  console.log(ansis.green(`\n  ✓ 已移除 ${result.removed.length} 个 CCG managed asset`))
  if (result.preserved.length > 0) console.log(ansis.gray(`  保留 ${result.preserved.length} 个用户或共享配置项`))
}

async function installSummary(): Promise<string[]> {
  const metadata = await readJson(getCcgMetadataPath())
  const summary = [ansis.green(`v${version}`), ansis.white('Pi CLI')]
  if (metadata.scope) summary.push(ansis.yellow(String(metadata.scope)))
  return summary
}

export async function showMainMenu(): Promise<void> {
  while (true) {
    console.log()
    console.log(ansis.cyan.bold('  CCG for Pi CLI'))
    console.log(ansis.gray('  Dynamic Supervisor + Intelligent Subagents'))
    console.log(ansis.gray(`  ${(await installSummary()).join('  |  ')}`))
    console.log(ansis.gray(`  Pi home: ${getPiAgentHome()}\n`))

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: '选择操作:',
      choices: [
        { name: '1. 安装 / 初始化 Pi workflow', value: 'init' },
        { name: '2. 更新 / 安全重装 Pi workflow', value: 'update' },
        { name: '3. 管理上下文、MCP、连续性、审查与安全扩展', value: 'extensions' },
        { name: '4. 配置 Frontend / Backend / Review 模型', value: 'models' },
        { name: '5. 配置 builder 与派生上限', value: 'limits' },
        { name: '6. Doctor 健康检查', value: 'doctor' },
        { name: '7. Status 安装概况', value: 'status' },
        { name: '8. 安全卸载 CCG managed Pi assets 与 CCG-owned packages', value: 'uninstall' },
        new inquirer.Separator(),
        { name: 'Q. 退出', value: 'quit' },
      ],
    }])

    if (action === 'quit') return
    if (action === 'init') await init()
    else if (action === 'update') await update()
    else if (action === 'extensions') await extensions()
    else if (action === 'models') await configureModels()
    else if (action === 'limits') await configureLimits()
    else if (action === 'doctor') await doctor()
    else if (action === 'status') await status()
    else if (action === 'uninstall') await uninstall()

    await inquirer.prompt([{ type: 'input', name: 'continue', message: ansis.gray('按 Enter 返回主菜单') }])
  }
}
