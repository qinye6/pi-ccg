import type { InitOptions, InstallScope, PiCapsConfig, PiExtensionMetadataEntry, PiThinkingLevel, PiThinkingOverrides, SupportedLang } from '../types'
import type { PiPersonaId } from '../utils/pi-personas'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { join } from 'pathe'
import { i18n, initI18n } from '../i18n'
import { readCcgMetadata } from '../utils/config'
import { installPiWorkflow } from '../utils/installer'
import {
  DEFAULT_PI_PERSONA_ID,
  PI_PERSONA_IDS,
  getPiPersonaDefinition,
  isPiPersonaId,
  normalizePiPersonaId,
} from '../utils/pi-personas'
import {
  applyPiExtensionSelection,
  buildPiExtensionSelectionStates,
  presentPiExtensionChoice,
  presentPiExtensionSecuritySection,
  requiredPiExtensionState,
  recommendedPiExtensionIds,
  REQUIRED_PI_EXTENSION,
  summarizeSelectedPiExtensions,
} from '../utils/pi-extensions'
import type { PiProvider } from '../utils/pi-config'
import { assessPiThinkingLevel, computeEffectiveDevParallelism, computeRequiredSpawns, inspectPiModels, mergePiProviders, parsePiThinkingLevel, PI_THINKING_LEVELS, writeJsonAtomic } from '../utils/pi-config'
import { buildPiProviderPresetOverride, findPiProviderModelPreset, PI_PROVIDER_MODEL_PRESETS } from '../utils/pi-provider-presets'
import { applyPiExtensionConfigOperation, inspectPiWebSearchConfig, planPiWebSearchConfigOperation } from '../utils/pi-extension-config'
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

type StepId = 'lang' | 'env' | 'extensions' | 'scope' | 'provider' | 'frontend' | 'backend' | 'review' | 'thinking' | 'limits' | 'persona' | 'entry' | 'summary'
type StepResult = 'next' | 'back' | 'cancel' | StepId

const STEP_ORDER: StepId[] = ['lang', 'env', 'extensions', 'scope', 'provider', 'frontend', 'backend', 'review', 'thinking', 'limits', 'persona', 'entry', 'summary']
const BACK = '__back__'
const CANCEL = '__cancel__'
const INHERIT = '__inherit__'

function tx(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options) as string
}

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
  modelsStatus: 'missing' | 'valid' | 'invalid'
  pendingProviders: Record<string, PiProvider>
  frontendModel?: string
  backendModel?: string
  reviewModel?: string
  thinking: PiThinkingOverrides
  persona: PiPersonaId
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

function normalizeThinking(options: InitOptions): PiThinkingOverrides {
  return {
    planningThinking: parsePiThinkingLevel(options.planningThinking, 'planning thinking'),
    frontendThinking: parsePiThinkingLevel(options.frontendThinking, 'frontend thinking'),
    backendThinking: parsePiThinkingLevel(options.backendThinking, 'backend thinking'),
    reviewThinking: parsePiThinkingLevel(options.reviewThinking, 'review thinking'),
  }
}

function presetForModelReference(modelReference: string | undefined) {
  if (!modelReference?.includes('/')) return undefined
  const [providerId, ...modelParts] = modelReference.split('/')
  return findPiProviderModelPreset(providerId, modelParts.join('/'))
}

function assertThinkingSupported(
  label: string,
  modelReference: string | undefined,
  level: PiThinkingLevel | undefined,
): void {
  if (!level || !modelReference) return
  const preset = presetForModelReference(modelReference)
  if (!preset) return
  const assessment = assessPiThinkingLevel(preset.model, level)
  if (assessment.status === 'unsupported') {
    throw new Error(`${label} model ${modelReference} does not support thinking=${level}: ${assessment.reason}`)
  }
}

function assertKnownThinkingSelections(state: WizardState): void {
  assertThinkingSupported('Frontend', state.frontendModel, state.thinking.frontendThinking)
  assertThinkingSupported('Backend', state.backendModel, state.thinking.backendThinking)
  assertThinkingSupported('Review', state.reviewModel, state.thinking.reviewThinking)
}

function thinkingChoices(): Array<{ name: string, value: string }> {
  return [
    { name: '继承 Pi/模型默认（不写入）', value: INHERIT },
    ...PI_THINKING_LEVELS.map(level => ({ name: level, value: level })),
    ...navChoices(),
  ]
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
    { name: tx('piExtensions.nav.back'), value: BACK },
    { name: tx('piExtensions.nav.cancel'), value: CANCEL },
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

async function addCustomProvider(state: WizardState): Promise<void> {
  const provider = await inquirer.prompt<{
    id: string
    baseUrl: string
    api: string
    apiKeyEnv: string
    modelId: string
    modelName: string
    contextWindow: number
    maxTokens: number
    reasoning: boolean
    image: boolean
  }>([
    { type: 'input', name: 'id', message: 'Provider ID:', validate: value => /^[A-Za-z0-9._-]+$/.test(String(value)) || '仅允许字母、数字、点、下划线和连字符' },
    { type: 'input', name: 'baseUrl', message: 'API base URL:', validate: value => /^https?:\/\//.test(String(value)) || '请输入 http(s) URL' },
    { type: 'list', name: 'api', message: 'API protocol:', choices: ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] },
    { type: 'input', name: 'apiKeyEnv', message: 'API key 环境变量名（不输入真实 key，可留空）:', validate: value => !value || /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value)) || '请输入环境变量名，而不是真实 key' },
    { type: 'input', name: 'modelId', message: 'Model ID:', validate: value => String(value).trim().length > 0 || 'Model ID 不能为空' },
    { type: 'input', name: 'modelName', message: 'Model display name（可留空）:' },
    { type: 'number', name: 'contextWindow', message: 'Context window tokens:', validate: isPositiveInteger },
    { type: 'number', name: 'maxTokens', message: 'Maximum output tokens:', validate: isPositiveInteger },
    { type: 'confirm', name: 'reasoning', message: '支持 reasoning/thinking?', default: false },
    { type: 'confirm', name: 'image', message: '支持 image input?', default: false },
  ])
  const id = provider.id.trim()
  const modelId = provider.modelId.trim()
  state.pendingProviders[id] = {
    baseUrl: provider.baseUrl.trim(),
    api: provider.api,
    ...(provider.apiKeyEnv ? { apiKey: `$${provider.apiKeyEnv}` } : {}),
    models: [{
      id: modelId,
      ...(provider.modelName.trim() ? { name: provider.modelName.trim() } : {}),
      reasoning: provider.reasoning,
      input: provider.image ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: provider.contextWindow,
      maxTokens: provider.maxTokens,
    }],
  }
  state.provider = id
  const reference = `${id}/${modelId}`
  if (!state.models.includes(reference)) state.models.push(reference)
}

function addPresetOverride(state: WizardState, modelReference: string | undefined): void {
  if (!modelReference?.includes('/')) return
  const [providerId, ...modelParts] = modelReference.split('/')
  const preset = buildPiProviderPresetOverride(providerId, modelParts.join('/'))
  if (!preset) return
  const current = state.pendingProviders[providerId] ?? {}
  state.pendingProviders[providerId] = {
    ...current,
    modelOverrides: {
      ...(current.modelOverrides ?? {}),
      ...(preset[providerId].modelOverrides ?? {}),
    },
  }
}

function normalizeRequestedPersona(value: unknown, strict: boolean): PiPersonaId {
  if (value === undefined || value === '') return DEFAULT_PI_PERSONA_ID
  if (typeof value !== 'string' || !isPiPersonaId(value)) {
    if (strict) throw new Error(`Unknown Pi persona: ${String(value)}`)
    return DEFAULT_PI_PERSONA_ID
  }
  return normalizePiPersonaId(value) as PiPersonaId
}

function personaLabel(id: PiPersonaId): string {
  const definition = getPiPersonaDefinition(id) as unknown as Record<string, unknown>
  const label = i18n.language === 'en'
    ? definition.labelEn ?? definition.nameEn ?? definition.label
    : definition.labelZh ?? definition.nameZh ?? definition.label
  return typeof label === 'string' ? label : id
}

function personaDescription(id: PiPersonaId): string {
  const definition = getPiPersonaDefinition(id) as unknown as Record<string, unknown>
  const description = i18n.language === 'en'
    ? definition.descriptionEn ?? definition.description
    : definition.descriptionZh ?? definition.description
  return typeof description === 'string' ? description : ''
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
      ? ansis.green(tx('piExtensions.env.piAvailable', { version: runtime.piVersion ?? 'installed' }))
      : ansis.yellow(tx('piExtensions.env.piMissing')))
    console.log(state.piSubagentsAvailable
      ? ansis.green(tx('piExtensions.env.requiredInstalled'))
      : ansis.yellow(tx('piExtensions.env.requiredMissing', { command: PI_SUBAGENTS_INSTALL_COMMAND })))
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'list', name: 'value', message: tx('piExtensions.env.title'),
      choices: [{ name: tx('piExtensions.nav.continue'), value: 'next' }, ...navChoices()],
    }])
    return value === BACK ? 'back' : value === CANCEL ? 'cancel' : 'next'
  }

  if (step === 'extensions') {
    const runtime = inspectPiRuntime(state.piHome)
    state.piAvailable = runtime.piAvailable
    state.piSubagentsAvailable = runtime.piSubagentsAvailable
    const states = buildPiExtensionSelectionStates({
      runtime,
      selectedIds: state.extensionIds,
      installRequiredPackage: state.installRequiredPackage,
    })
    const requiredState = requiredPiExtensionState(states)

    console.log(ansis.yellow(tx('piExtensions.warnings.execution')))
    console.log(ansis.gray(tx('piExtensions.warnings.credentials')))
    if (requiredState.disabled) console.log(ansis.gray(tx('piExtensions.warnings.requiredReadOnly')))
    for (const line of presentPiExtensionSecuritySection(states)) console.log(ansis.gray(line))
    const { value } = await inquirer.prompt<{ value: string[] }>([{
      type: 'checkbox',
      name: 'value',
      message: tx('piExtensions.prompt.message'),
      choices: [
        ...states.map(extensionState => ({
          name: presentPiExtensionChoice(extensionState),
          value: extensionState.extension.id,
          checked: extensionState.checked,
          disabled: extensionState.disabled ? tx('piExtensions.status.readOnly') : undefined,
        })),
        new inquirer.Separator(),
        { name: tx('piExtensions.nav.back'), value: BACK },
        { name: tx('piExtensions.nav.cancel'), value: CANCEL },
      ],
    }])
    if (value.includes(BACK)) return 'back'
    if (value.includes(CANCEL)) return 'cancel'
    state.installRequiredPackage = value.includes(REQUIRED_PI_EXTENSION.id) && !requiredState.installed
    state.extensionIds = value.filter(id => id !== REQUIRED_PI_EXTENSION.id)
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
    if (state.modelsStatus === 'invalid') {
      console.log(ansis.yellow(`  ${getPiModelsPath(state.piHome)} 无法解析；CCG 不会覆盖该文件。请先修复 JSON，或仅使用已有 Pi built-in provider。`))
    }
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'list', name: 'value', message: '模型供应商（不会显示、复制或保存真实凭据）:',
      choices: [
        { name: '全部已发现供应商', value: '__all__' },
        ...providers.map(provider => ({ name: provider, value: provider })),
        { name: '新增自定义 provider/model…', value: '__custom__' },
        ...navChoices(),
      ], default: state.provider ?? '__all__',
    }])
    if (value === BACK) return 'back'
    if (value === CANCEL) return 'cancel'
    if (value === '__custom__') {
      await addCustomProvider(state)
      return 'next'
    }
    state.provider = value === '__all__' ? undefined : value
    return 'next'
  }

  if (step === 'frontend' || step === 'backend' || step === 'review') {
    const field = `${step}Model` as 'frontendModel' | 'backendModel' | 'reviewModel'
    const value = await selectModel(`选择${step === 'frontend' ? '前端' : step === 'backend' ? '后端' : '审查/测试'}模型:`, state, state[field])
    if (value === BACK) return 'back'
    if (value === CANCEL) return 'cancel'
    state[field] = value
    addPresetOverride(state, value)
    return 'next'
  }

  if (step === 'thinking') {
    const answer = await inquirer.prompt<Record<keyof PiThinkingOverrides, string>>([
      { type: 'list', name: 'planningThinking', message: 'Scout/planner thinking:', choices: thinkingChoices(), default: state.thinking.planningThinking ?? INHERIT },
      { type: 'list', name: 'frontendThinking', message: 'Frontend builder thinking:', choices: thinkingChoices(), default: state.thinking.frontendThinking ?? INHERIT },
      { type: 'list', name: 'backendThinking', message: 'Backend builder thinking:', choices: thinkingChoices(), default: state.thinking.backendThinking ?? INHERIT },
      { type: 'list', name: 'reviewThinking', message: 'Reviewer/test-runner thinking:', choices: thinkingChoices(), default: state.thinking.reviewThinking ?? INHERIT },
    ])
    const values = Object.values(answer)
    if (values.includes(BACK)) return 'back'
    if (values.includes(CANCEL)) return 'cancel'
    state.thinking = {
      planningThinking: answer.planningThinking === INHERIT ? undefined : parsePiThinkingLevel(answer.planningThinking),
      frontendThinking: answer.frontendThinking === INHERIT ? undefined : parsePiThinkingLevel(answer.frontendThinking),
      backendThinking: answer.backendThinking === INHERIT ? undefined : parsePiThinkingLevel(answer.backendThinking),
      reviewThinking: answer.reviewThinking === INHERIT ? undefined : parsePiThinkingLevel(answer.reviewThinking),
    }
    try {
      assertKnownThinkingSelections(state)
    }
    catch (error) {
      console.log(ansis.yellow(`  ${error instanceof Error ? error.message : String(error)}`))
      return 'thinking'
    }
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

  if (step === 'persona') {
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'list',
      name: 'value',
      message: tx('piExtensions.persona.prompt'),
      choices: [...PI_PERSONA_IDS.map(id => ({ name: `${personaLabel(id)}${personaDescription(id) ? ` — ${personaDescription(id)}` : ''}`, value: id })), ...navChoices()],
      default: state.persona,
    }])
    if (value === BACK) return 'back'
    if (value === CANCEL) return 'cancel'
    state.persona = normalizePiPersonaId(value) as PiPersonaId
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

  console.log(ansis.cyan.bold(`\n  ${tx('piExtensions.summary.title')}`))
  const runtime = inspectPiRuntime(state.piHome)
  const states = buildPiExtensionSelectionStates({
    runtime,
    selectedIds: state.extensionIds,
    installRequiredPackage: state.installRequiredPackage,
  })
  const requiredState = requiredPiExtensionState(states)
  const selectedExtensions = summarizeSelectedPiExtensions(states)
  console.log(`  ${tx('piExtensions.fields.piCli')}: ${state.piAvailable ? tx('piExtensions.status.ready') : tx('piExtensions.status.missing')}`)
  console.log(`  ${tx('piExtensions.fields.requiredRuntime')}: ${requiredState.installed ? tx(`piExtensions.status.${requiredState.status}`) : state.installRequiredPackage ? tx('piExtensions.summary.requiredWillInstall') : tx('piExtensions.summary.requiredMissing')}`)
  console.log(`  ${tx('piExtensions.fields.optionalExtensions')}: ${selectedExtensions.length > 0 ? selectedExtensions.join(', ') : tx('piExtensions.summary.selectedNone')}`)
  if (state.extensionIds.includes('web-access')) {
    console.log(`  pi-web-access: 安装成功后仅在 workflow 字段缺失时写入 ~/.pi/web-search.json → none；已有值和无效 JSON 均保留`)
  }
  console.log(ansis.yellow(tx('piExtensions.warnings.summaryAuthorization')))
  if (!requiredState.installed && !state.installRequiredPackage) {
    console.log(ansis.yellow(tx('piExtensions.warnings.runtimeUnavailable', { command: PI_SUBAGENTS_INSTALL_COMMAND })))
  }
  console.log(`  ${tx('piExtensions.fields.scope')}: ${state.scope}`)
  console.log(`  ${tx('piExtensions.fields.persona')}: ${personaLabel(state.persona)}`)
  console.log(`  ${tx('piExtensions.fields.frontend')}: ${state.frontendModel ?? tx('piExtensions.summary.inheritDefault')}`)
  console.log(`  ${tx('piExtensions.fields.backend')}: ${state.backendModel ?? tx('piExtensions.summary.inheritDefault')}`)
  console.log(`  ${tx('piExtensions.fields.review')}: ${state.reviewModel ?? tx('piExtensions.summary.inheritDefault')}`)
  console.log(`  thinking: planning=${state.thinking.planningThinking ?? 'inherit'}, frontend=${state.thinking.frontendThinking ?? 'inherit'}, backend=${state.thinking.backendThinking ?? 'inherit'}, review=${state.thinking.reviewThinking ?? 'inherit'}`)
  console.log(`  ${tx('piExtensions.fields.caps')}: dev=${state.caps.devAgentCap}, concurrency=${state.caps.globalConcurrencyLimit}, spawns=${state.caps.maxSpawnsPerSession}, depth=${state.caps.maxSubagentDepth}`)
  const { value } = await inquirer.prompt<{ value: string }>([{
    type: 'list', name: 'value', message: tx('piExtensions.confirm.title'),
    choices: [
      { name: tx('piExtensions.confirm.install'), value: 'confirm' },
      { name: tx('piExtensions.confirm.editLang'), value: 'lang' },
      { name: tx('piExtensions.confirm.editScope'), value: 'scope' },
      { name: tx('piExtensions.confirm.editExtensions'), value: 'extensions' },
      { name: tx('piExtensions.confirm.editProvider'), value: 'provider' },
      { name: tx('piExtensions.confirm.editFrontend'), value: 'frontend' },
      { name: tx('piExtensions.confirm.editBackend'), value: 'backend' },
      { name: tx('piExtensions.confirm.editReview'), value: 'review' },
      { name: '修改 thinking 强度', value: 'thinking' },
      { name: tx('piExtensions.confirm.editLimits'), value: 'limits' },
      { name: tx('piExtensions.confirm.editPersona'), value: 'persona' },
      { name: tx('piExtensions.confirm.editEntry'), value: 'entry' },
      { name: tx('piExtensions.nav.cancel'), value: CANCEL },
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
  let previous: Record<string, unknown> = {}
  if (await fs.pathExists(path)) {
    try {
      const value = await fs.readJson(path) as unknown
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        previous = value as Record<string, unknown>
      }
    }
    catch {}
  }
  const previousChoices = typeof previous.lastChoices === 'object'
    && previous.lastChoices !== null
    && !Array.isArray(previous.lastChoices)
    ? previous.lastChoices as Record<string, unknown>
    : {}
  await fs.ensureDir(join(path, '..'))
  await writeJsonAtomic(path, {
    ...previous,
    version: await getCurrentVersion(),
    language: state.lang,
    createdAt: typeof previous.createdAt === 'string' ? previous.createdAt : now,
    updatedAt: now,
    scope: state.scope,
    lastChoices: {
      ...previousChoices,
      provider: state.provider,
      frontendModel: state.frontendModel,
      backendModel: state.backendModel,
      reviewModel: state.reviewModel,
      persona: state.persona,
      caps: state.caps,
      thinking: state.thinking,
    },
    extensions,
    managedFiles,
  })
}

export async function init(options: InitOptions = {}): Promise<void> {
  const piHome = options.installDir ?? getPiAgentHome()
  const modelsInspection = await inspectPiModels(getPiModelsPath(piHome))
  const presetModels = PI_PROVIDER_MODEL_PRESETS.map(preset => `${preset.providerId}/${preset.model.id}`)
  const discoveredModels = modelsInspection.status === 'valid' ? modelsInspection.models : []
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
    installRequiredPackage: options.installRequiredPackage ?? (!options.skipPrompt && !runtime.piSubagentsAvailable),
    scope: options.installProjectAssets === false ? 'user' : 'user-project',
    provider: undefined,
    models: [...new Set([...discoveredModels, ...presetModels])],
    modelsStatus: modelsInspection.status,
    pendingProviders: {},
    frontendModel: options.frontendModel ?? options.frontend,
    backendModel: options.backendModel ?? options.backend,
    reviewModel: options.reviewModel,
    thinking: normalizeThinking(options),
    persona: normalizeRequestedPersona(options.persona, options.skipPrompt === true),
    caps: normalizeCaps(options),
    installProjectAssets: options.installProjectAssets ?? true,
  }

  addPresetOverride(state, state.frontendModel)
  addPresetOverride(state, state.backendModel)
  addPresetOverride(state, state.reviewModel)

  await initI18n(state.lang)
  console.log(ansis.cyan.bold('\n  CCG for Pi CLI'))
  console.log(ansis.gray('  Dynamic supervisor + bounded intelligent subagents\n'))

  if (!options.skipPrompt) {
    let index = 0
    while (index < STEP_ORDER.length) {
      const result = await runStep(STEP_ORDER[index], state)
      if (result === 'cancel') {
        console.log(ansis.yellow(tx('piExtensions.outcomes.cancelled')))
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

  assertKnownThinkingSelections(state)
  const providers = await readProviderFile(options.providerFile)
  const spinner = ora(tx('piExtensions.outcomes.spinner')).start()
  try {
    const result = await (installPiWorkflow as unknown as (options: Record<string, unknown>) => ReturnType<typeof installPiWorkflow>)({
      piHome,
      projectDir: process.cwd(),
      installProjectAssets: state.installProjectAssets,
      frontendModel: state.frontendModel,
      backendModel: state.backendModel,
      reviewModel: state.reviewModel,
      ...state.thinking,
      persona: state.persona,
      caps: state.caps,
      providers,
      force: options.force,
    })

    if (!result.success) {
      spinner.fail(tx('piExtensions.outcomes.incomplete'))
      for (const error of result.errors) console.error(ansis.red(`  - ${error}`))
      return
    }

    const installedPiHome = result.piHome ?? piHome
    if (Object.keys(state.pendingProviders).length > 0) {
      await mergePiProviders(state.pendingProviders, {
        modelsPath: getPiModelsPath(installedPiHome),
        force: true,
      })
    }
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

    const webAccessReady = extensionResult.entries.some(entry => entry.id === 'web-access' && entry.ownership !== 'missing')
    if (!options.preserveExtensions && webAccessReady) {
      const webOperation = planPiWebSearchConfigOperation(await inspectPiWebSearchConfig())
      if (webOperation) await applyPiExtensionConfigOperation(webOperation)
    }

    await writeMetadata(
      state,
      result.managedFiles ?? [],
      extensionResult.entries,
      installedPiHome,
    )

    if (extensionResult.errors.length > 0) {
      spinner.warn(tx('piExtensions.outcomes.partial'))
      for (const error of extensionResult.errors) console.error(ansis.red(`  - ${error}`))
    }
    else if (requiredMissing) {
      spinner.warn(tx('piExtensions.outcomes.requiredMissing'))
    }
    else {
      spinner.succeed(tx('piExtensions.outcomes.success'))
    }

    console.log(ansis.gray(`  ${tx('piExtensions.fields.piHome')}: ${installedPiHome}`))
    if (state.installProjectAssets) console.log(ansis.gray(`  ${tx('piExtensions.fields.project')}: ${result.projectDir}`))
    console.log(ansis.gray(tx('piExtensions.outcomes.memory')))
    if (!state.piAvailable) console.log(ansis.yellow(tx('piExtensions.outcomes.piCliHint')))
    if (requiredMissing) console.log(ansis.yellow(tx('piExtensions.outcomes.runtimeHint', { command: PI_SUBAGENTS_INSTALL_COMMAND })))
  }
  catch (error) {
    spinner.fail(tx('piExtensions.outcomes.failed'))
    console.error(ansis.red(`  ${error instanceof Error ? error.message : String(error)}`))
  }
}
