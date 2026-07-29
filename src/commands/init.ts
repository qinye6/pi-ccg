import type { InitOptions, InstallScope, PiCapsConfig, PiExtensionMetadataEntry, SupportedLang } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { join } from 'pathe'
import { initI18n } from '../i18n'
import { readCcgMetadata } from '../utils/config'
import { installPiWorkflow } from '../utils/installer'
import {
  applyPiExtensionSelection,
  PI_EXTENSION_CATALOG,
  recommendedPiExtensionIds,
  REQUIRED_PI_EXTENSION,
} from '../utils/pi-extensions'
import type { PiProvider } from '../utils/pi-config'
import { computeEffectiveDevParallelism, computeRequiredSpawns, writeJsonAtomic } from '../utils/pi-config'
import {
  DEFAULT_PI_CAPS,
  getPiAgentHome,
  getPiModelsPath,
} from '../utils/pi-paths'
import {
  inspectPiRuntime,
  PI_SUBAGENTS_INSTALL_COMMAND,
} from '../utils/pi-runtime'
import { getCurrentVersion } from '../utils/version'

type StepId = 'lang' | 'env' | 'extensions' | 'scope' | 'provider' | 'frontend' | 'backend' | 'review' | 'limits' | 'entry' | 'summary'
type StepResult = 'next' | 'back' | 'cancel' | StepId

const STEP_ORDER: StepId[] = ['lang', 'env', 'extensions', 'scope', 'provider', 'frontend', 'backend', 'review', 'limits', 'entry', 'summary']
const BACK = '__back__'
const CANCEL = '__cancel__'

interface WizardState {
  lang: SupportedLang
  piHome: string
  piAvailable: boolean
  piSubagentsAvailable: boolean
  extensionIds: string[]
  installRequiredPackage: boolean
  scope: InstallScope
  provider?: string
  models: string[]
  frontendModel?: string
  backendModel?: string
  reviewModel?: string
  caps: PiCapsConfig
  installProjectAssets: boolean
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function normalizeCaps(options: InitOptions): PiCapsConfig {
  return {
    devAgentCap: isPositiveInteger(options.devAgentCap) ? options.devAgentCap : DEFAULT_PI_CAPS.devAgentCap,
    globalConcurrencyLimit: isPositiveInteger(options.globalConcurrencyLimit) ? options.globalConcurrencyLimit : DEFAULT_PI_CAPS.globalConcurrencyLimit,
    maxSpawnsPerSession: isPositiveInteger(options.maxSpawnsPerSession) ? options.maxSpawnsPerSession : DEFAULT_PI_CAPS.maxSpawnsPerSession,
    maxSubagentDepth: isPositiveInteger(options.maxSubagentDepth) ? options.maxSubagentDepth : DEFAULT_PI_CAPS.maxSubagentDepth,
  }
}

function modelId(provider: string, model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) return `${provider}/${model.trim()}`
  if (typeof model === 'object' && model !== null) {
    const id = (model as Record<string, unknown>).id
    if (typeof id === 'string' && id.trim()) return `${provider}/${id.trim()}`
  }
  return null
}

async function discoverModels(piHome = getPiAgentHome()): Promise<{ providers: string[], models: string[] }> {
  const path = getPiModelsPath(piHome)
  if (!(await fs.pathExists(path))) return { providers: [], models: [] }

  try {
    const data = await fs.readJson(path) as Record<string, unknown>
    const providersValue = data.providers
    if (typeof providersValue !== 'object' || providersValue === null || Array.isArray(providersValue)) {
      return { providers: [], models: [] }
    }

    const providers = Object.keys(providersValue)
    const models = providers.flatMap((provider) => {
      const value = (providersValue as Record<string, unknown>)[provider]
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
      const configuredModels = (value as Record<string, unknown>).models
      if (!Array.isArray(configuredModels)) return []
      return configuredModels.map(model => modelId(provider, model)).filter((id): id is string => id !== null)
    })
    return { providers, models }
  }
  catch {
    return { providers: [], models: [] }
  }
}

async function readProviderFile(path?: string): Promise<Record<string, PiProvider>> {
  if (!path) return {}
  const data = await fs.readJson(path) as Record<string, unknown>
  const providers = (data.providers ?? data) as Record<string, PiProvider>
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) {
    throw new TypeError('Provider file must contain a provider map or a { providers } object')
  }
  return providers
}

function navChoices(): Array<{ name: string, value: string }> {
  return [
    { name: '← 返回上一步', value: BACK },
    { name: '× 取消', value: CANCEL },
  ]
}

async function selectModel(message: string, state: WizardState, current?: string): Promise<string> {
  const choices = state.models
    .filter(model => !state.provider || model.startsWith(`${state.provider}/`))
    .map(model => ({ name: model, value: model }))
  choices.push({ name: '手动输入模型 ID', value: '__manual__' }, ...navChoices())

  const answer = await inquirer.prompt<{ value: string }>([{
    type: 'list',
    name: 'value',
    message,
    choices,
    default: current,
  }])
  if (answer.value !== '__manual__') return answer.value
  const manual = await inquirer.prompt<{ value: string }>([{
    type: 'input',
    name: 'value',
    message: '模型 ID（建议 provider/model）:',
    default: current,
    validate: value => String(value).trim().length > 0 || '模型 ID 不能为空',
  }])
  return manual.value.trim()
}

async function runStep(step: StepId, state: WizardState): Promise<StepResult> {
  if (step === 'lang') {
    const { value } = await inquirer.prompt<{ value: SupportedLang | typeof CANCEL }>([{
      type: 'list', name: 'value', message: '选择语言 / Select language:',
      choices: [
        { name: '简体中文', value: 'zh-CN' },
        { name: 'English', value: 'en' },
        { name: '× 取消 / Cancel', value: CANCEL },
      ], default: state.lang,
    }])
    if (value === CANCEL) return 'cancel'
    state.lang = value
    await initI18n(value)
    return 'next'
  }

  if (step === 'env') {
    const runtime = inspectPiRuntime(state.piHome)
    state.piAvailable = runtime.piAvailable
    state.piSubagentsAvailable = runtime.piSubagentsAvailable
    console.log(state.piAvailable
      ? ansis.green(`  ✓ Pi CLI 已可用 (${runtime.piVersion ?? 'installed'})`)
      : ansis.yellow('  ⚠ 未检测到 Pi CLI；可继续生成配置，但运行工作流前必须安装 Pi CLI。'))
    console.log(state.piSubagentsAvailable
      ? ansis.green('  ✓ 必需的 pi-subagents package 已安装')
      : ansis.yellow(`  ⚠ 未检测到必需的 pi-subagents package；运行前请执行: ${PI_SUBAGENTS_INSTALL_COMMAND}`))
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'list', name: 'value', message: 'Pi 环境检查:',
      choices: [{ name: '继续', value: 'next' }, ...navChoices()],
    }])
    return value === BACK ? 'back' : value === CANCEL ? 'cancel' : 'next'
  }

  if (step === 'extensions') {
    console.log(ansis.yellow('  Pi packages execute with your full user permissions. Review sources before installation.'))
    console.log(ansis.gray('  MCP credentials remain in user-managed .mcp.json / .pi/mcp.json files.'))
    const { value } = await inquirer.prompt<{ value: string[] }>([{
      type: 'checkbox',
      name: 'value',
      message: '选择可选 Pi 扩展（推荐项已预选）:',
      choices: [
        ...PI_EXTENSION_CATALOG
          .filter(extension => extension.tier !== 'required')
          .map(extension => ({
            name: `${extension.label} [${extension.tier}] — ${extension.description}`,
            value: extension.id,
            checked: state.extensionIds.includes(extension.id),
          })),
        new inquirer.Separator(),
        { name: '← 返回上一步', value: BACK },
        { name: '× 取消', value: CANCEL },
      ],
    }])
    if (value.includes(BACK)) return 'back'
    if (value.includes(CANCEL)) return 'cancel'
    state.extensionIds = value

    if (!state.piSubagentsAvailable) {
      const answer = await inquirer.prompt<{ install: boolean }>([{
        type: 'confirm',
        name: 'install',
        message: `安装运行必需 package（${PI_SUBAGENTS_INSTALL_COMMAND}）?`,
        default: true,
      }])
      state.installRequiredPackage = answer.install
    }
    return 'next'
  }

  if (step === 'scope') {
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'list', name: 'value', message: '安装范围:',
      choices: [
        { name: '用户 + 当前项目（推荐）', value: 'user-project' },
        { name: '仅用户级', value: 'user' },
        ...navChoices(),
      ], default: state.scope,
    }])
    if (value === BACK) return 'back'
    if (value === CANCEL) return 'cancel'
    state.scope = value as InstallScope
    state.installProjectAssets = state.scope === 'user-project'
    return 'next'
  }

  if (step === 'provider') {
    const providers = [...new Set(state.models.map(model => model.split('/')[0]).filter(Boolean))]
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'list', name: 'value', message: '模型供应商过滤（不会显示或复制凭据）:',
      choices: [
        { name: '全部已发现供应商', value: '__all__' },
        ...providers.map(provider => ({ name: provider, value: provider })),
        ...navChoices(),
      ], default: state.provider ?? '__all__',
    }])
    if (value === BACK) return 'back'
    if (value === CANCEL) return 'cancel'
    state.provider = value === '__all__' ? undefined : value
    return 'next'
  }

  if (step === 'frontend' || step === 'backend' || step === 'review') {
    const field = `${step}Model` as 'frontendModel' | 'backendModel' | 'reviewModel'
    const value = await selectModel(`选择${step === 'frontend' ? '前端' : step === 'backend' ? '后端' : '审查/测试'}模型:`, state, state[field])
    if (value === BACK) return 'back'
    if (value === CANCEL) return 'cancel'
    state[field] = value
    return 'next'
  }

  if (step === 'limits') {
    const answer = await inquirer.prompt<PiCapsConfig>([
      { type: 'number', name: 'devAgentCap', message: '开发代理上限:', default: state.caps.devAgentCap, validate: isPositiveInteger },
      { type: 'number', name: 'globalConcurrencyLimit', message: '全局并发上限:', default: state.caps.globalConcurrencyLimit, validate: isPositiveInteger },
      { type: 'number', name: 'maxSpawnsPerSession', message: '每会话最大派生数:', default: state.caps.maxSpawnsPerSession, validate: isPositiveInteger },
      { type: 'number', name: 'maxSubagentDepth', message: '最大子代理深度:', default: state.caps.maxSubagentDepth, validate: isPositiveInteger },
    ])
    const effective = computeEffectiveDevParallelism({
      devAgentCap: answer.devAgentCap,
      globalConcurrencyLimit: answer.globalConcurrencyLimit,
      parallelConcurrency: answer.globalConcurrencyLimit,
      parallelMaxTasks: answer.devAgentCap,
    })
    if (computeRequiredSpawns(effective) > answer.maxSpawnsPerSession) {
      console.log(ansis.yellow(`  派生预算不足：当前至少需要 ${computeRequiredSpawns(effective)}，请提高 maxSpawnsPerSession。`))
      return 'limits'
    }
    state.caps = answer
    return 'next'
  }

  if (step === 'entry') {
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'list', name: 'value', message: '项目入口:',
      choices: [
        { name: '安装 AGENTS.md 受管块、chain 和 prompt workflow', value: 'yes' },
        { name: '仅安装用户级 Pi agents', value: 'no' },
        ...navChoices(),
      ], default: state.installProjectAssets ? 'yes' : 'no',
    }])
    if (value === BACK) return 'back'
    if (value === CANCEL) return 'cancel'
    state.installProjectAssets = value === 'yes'
    state.scope = state.installProjectAssets ? 'user-project' : 'user'
    return 'next'
  }

  console.log(ansis.cyan.bold('\n  CCG Pi 安装摘要'))
  console.log(`  Pi CLI: ${state.piAvailable ? '可用' : '未检测到'}`)
  console.log(`  pi-subagents: ${state.piSubagentsAvailable ? '已安装' : state.installRequiredPackage ? '将安装' : '未检测到（运行前必需）'}`)
  console.log(`  可选扩展: ${state.extensionIds.length > 0 ? state.extensionIds.join(', ') : '不安装'}`)
  console.log(ansis.yellow('  第三方 Pi packages 以当前用户权限执行；确认安装即授权执行下列 package 操作。'))
  console.log(`  范围: ${state.scope}`)
  console.log(`  Frontend: ${state.frontendModel ?? '继承 Pi 默认模型'}`)
  console.log(`  Backend: ${state.backendModel ?? '继承 Pi 默认模型'}`)
  console.log(`  Review/Test: ${state.reviewModel ?? '继承 Pi 默认模型'}`)
  console.log(`  Caps: dev=${state.caps.devAgentCap}, concurrency=${state.caps.globalConcurrencyLimit}, spawns=${state.caps.maxSpawnsPerSession}, depth=${state.caps.maxSubagentDepth}`)
  const { value } = await inquirer.prompt<{ value: string }>([{
    type: 'list', name: 'value', message: '确认安装:',
    choices: [
      { name: '确认安装', value: 'confirm' },
      { name: '修改语言', value: 'lang' },
      { name: '修改安装范围', value: 'scope' },
      { name: '修改扩展选择', value: 'extensions' },
      { name: '修改供应商', value: 'provider' },
      { name: '修改前端模型', value: 'frontend' },
      { name: '修改后端模型', value: 'backend' },
      { name: '修改审查模型', value: 'review' },
      { name: '修改代理上限', value: 'limits' },
      { name: '修改项目入口', value: 'entry' },
      { name: '× 取消', value: CANCEL },
    ],
  }])
  if (value === CANCEL) return 'cancel'
  return value === 'confirm' ? 'next' : value as StepId
}

async function writeMetadata(
  state: WizardState,
  managedFiles: NonNullable<Awaited<ReturnType<typeof installPiWorkflow>>['managedFiles']>,
  extensions: PiExtensionMetadataEntry[],
  piHome = getPiAgentHome(),
): Promise<void> {
  const path = join(piHome, 'ccg-workflow.json')
  const now = new Date().toISOString()
  let createdAt = now
  if (await fs.pathExists(path)) {
    try {
      const previous = await fs.readJson(path) as Record<string, unknown>
      if (typeof previous.createdAt === 'string') createdAt = previous.createdAt
    }
    catch {}
  }
  await fs.ensureDir(join(path, '..'))
  await writeJsonAtomic(path, {
    version: await getCurrentVersion(),
    language: state.lang,
    createdAt,
    updatedAt: now,
    scope: state.scope,
    lastChoices: {
      provider: state.provider,
      frontendModel: state.frontendModel,
      backendModel: state.backendModel,
      reviewModel: state.reviewModel,
      caps: state.caps,
    },
    extensions,
    managedFiles,
  })
}

export async function init(options: InitOptions = {}): Promise<void> {
  const piHome = options.installDir ?? getPiAgentHome()
  const discovered = await discoverModels(piHome)
  const runtime = inspectPiRuntime(piHome)
  const extensionIds = options.noOptionalExtensions
    ? []
    : options.extensionIds ?? (options.skipPrompt ? [] : recommendedPiExtensionIds())
  const state: WizardState = {
    lang: options.lang ?? 'zh-CN',
    piHome,
    piAvailable: runtime.piAvailable,
    piSubagentsAvailable: runtime.piSubagentsAvailable,
    extensionIds,
    installRequiredPackage: options.installRequiredPackage ?? false,
    scope: options.installProjectAssets === false ? 'user' : 'user-project',
    provider: undefined,
    models: discovered.models,
    frontendModel: options.frontendModel ?? options.frontend,
    backendModel: options.backendModel ?? options.backend,
    reviewModel: options.reviewModel,
    caps: normalizeCaps(options),
    installProjectAssets: options.installProjectAssets ?? true,
  }

  await initI18n(state.lang)
  console.log(ansis.cyan.bold('\n  CCG for Pi CLI'))
  console.log(ansis.gray('  Dynamic supervisor + bounded intelligent subagents\n'))

  if (!options.skipPrompt) {
    let index = 0
    while (index < STEP_ORDER.length) {
      const result = await runStep(STEP_ORDER[index], state)
      if (result === 'cancel') {
        console.log(ansis.yellow('  已取消安装。'))
        return
      }
      if (result === 'back') {
        index = Math.max(0, index - 1)
        continue
      }
      if (result === 'next') {
        index += 1
        continue
      }
      index = STEP_ORDER.indexOf(result)
    }
  }

  const providers = await readProviderFile(options.providerFile)
  const spinner = ora('正在安装 Pi workflow...').start()
  try {
    const result = await installPiWorkflow({
      piHome,
      projectDir: process.cwd(),
      installProjectAssets: state.installProjectAssets,
      frontendModel: state.frontendModel,
      backendModel: state.backendModel,
      reviewModel: state.reviewModel,
      caps: state.caps,
      providers,
      force: options.force,
    })

    if (!result.success) {
      spinner.fail('Pi workflow 安装未完整完成')
      for (const error of result.errors) console.error(ansis.red(`  - ${error}`))
      return
    }

    const installedPiHome = result.piHome ?? piHome
    const metadataPath = join(installedPiHome, 'ccg-workflow.json')
    const previousMetadata = await readCcgMetadata(metadataPath)
    const extensionResult = options.preserveExtensions
      ? { entries: previousMetadata?.extensions ?? [], errors: [] }
      : await applyPiExtensionSelection({
          selectedIds: state.extensionIds,
          installRequiredPackage: state.installRequiredPackage,
          piHome: installedPiHome,
          previous: previousMetadata?.extensions,
        })
    const requiredEntry = extensionResult.entries.find(entry => entry.id === REQUIRED_PI_EXTENSION.id)
    const requiredMissing = requiredEntry?.ownership === 'missing'
      || (!requiredEntry && !state.piSubagentsAvailable)

    await writeMetadata(
      state,
      result.managedFiles ?? [],
      extensionResult.entries,
      installedPiHome,
    )

    if (extensionResult.errors.length > 0) {
      spinner.warn('Pi workflow assets 已安装，但部分扩展安装失败')
      for (const error of extensionResult.errors) console.error(ansis.red(`  - ${error}`))
    }
    else if (requiredMissing) {
      spinner.warn('Pi workflow assets 已安装，但缺少运行必需 package')
    }
    else {
      spinner.succeed('Pi workflow 安装完成')
    }

    console.log(ansis.gray(`  Pi home: ${installedPiHome}`))
    if (state.installProjectAssets) console.log(ansis.gray(`  Project: ${result.projectDir}`))
    console.log(ansis.gray('  Memory: pi-subagents 提供 per-agent memory；可选 memory-context 与 session-continuity 扩展提供跨会话上下文和 durable handoff。'))
    if (!state.piAvailable) console.log(ansis.yellow('  运行前请先安装并配置 Pi CLI。'))
    if (requiredMissing) console.log(ansis.yellow(`  运行前请安装必需 package: ${PI_SUBAGENTS_INSTALL_COMMAND}`))
  }
  catch (error) {
    spinner.fail('Pi workflow 安装失败')
    console.error(ansis.red(`  ${error instanceof Error ? error.message : String(error)}`))
  }
}
