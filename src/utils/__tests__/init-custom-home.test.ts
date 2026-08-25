import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  spawnSync: vi.fn(),
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
    Separator: class Separator {},
  },
}))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
    spawnSync: mocks.spawnSync,
  }
})

const { init } = await import('../../commands/init')

let root: string
let piHome: string
let projectDir: string
let originalCwd: string
let runtimeHasRequiredPackage: boolean
let extensionSelection: string[]
let finalChoice: 'confirm' | 'cancel'
let extensionChoices: Array<Record<string, unknown>>

beforeEach(async () => {
  root = join(tmpdir(), `ccg-init-custom-home-${process.pid}-${Math.random().toString(16).slice(2)}`)
  piHome = join(root, 'pi-home')
  projectDir = join(root, 'project')
  originalCwd = process.cwd()
  await fs.ensureDir(piHome)
  await fs.ensureDir(projectDir)
  process.chdir(projectDir)
  runtimeHasRequiredPackage = true
  extensionSelection = []
  finalChoice = 'confirm'
  extensionChoices = []

  mocks.spawnSync.mockReset()
  mocks.spawnSync.mockImplementation((_command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const targetsCustomHome = options.env?.PI_CODING_AGENT_DIR === piHome
    if (args[0] === '--version') return { status: 0, stdout: 'pi 1.0.0\n', stderr: '' }
    return {
      status: 0,
      stdout: targetsCustomHome && runtimeHasRequiredPackage ? 'Packages:\n  npm:pi-subagents@0.37.0\n' : 'Packages:\n',
      stderr: '',
    }
  })

  mocks.prompt.mockReset()
  mocks.prompt.mockImplementation(async (questions: Array<Record<string, unknown>>) => {
    const question = questions[0]
    const message = String(question.message ?? '')
    if (message.includes('选择语言')) return { value: 'zh-CN' }
    if (message === 'Pi 环境检查:') return { value: 'next' }
    if (message.includes('选择 Pi 扩展')) {
      extensionChoices = question.choices as Array<Record<string, unknown>>
      return { value: extensionSelection }
    }
    if (message === '安装范围:') return { value: 'user' }
    if (message.includes('模型供应商')) return { value: '__all__' }
    if (message.includes('选择前端模型')) return { value: 'demo/frontend' }
    if (message.includes('选择后端模型')) return { value: 'demo/backend' }
    if (message.includes('选择审查/测试模型')) return { value: 'demo/review' }
    if (message.endsWith('thinking:')) return { value: '__inherit__' }
    if (message.includes('人格与输出风格')) return { value: 'nekomata-engineer' }
    if (message === '项目入口:') return { value: 'no' }
    if (message === '确认安装:') return { value: finalChoice === 'confirm' ? 'confirm' : '__cancel__' }
    if (question.name === 'devAgentCap') {
      return {
        devAgentCap: 4,
        globalConcurrencyLimit: 4,
        maxSpawnsPerSession: 24,
        maxSubagentDepth: 1,
      }
    }
    throw new Error(`Unexpected prompt: ${message}`)
  })
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.remove(root)
  vi.restoreAllMocks()
})

describe('interactive init with a custom Pi home', () => {
  it('uses the custom home for every runtime inspection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await init({ installDir: piHome })

    const runtimeCalls = mocks.spawnSync.mock.calls.filter(([, args]) => args[0] === 'list')
    expect(runtimeCalls.length).toBeGreaterThanOrEqual(2)
    for (const [, , options] of runtimeCalls) {
      expect(options.env).toEqual(expect.objectContaining({ PI_CODING_AGENT_DIR: piHome }))
    }
    expect(mocks.prompt.mock.calls.flatMap(([questions]) => questions).some(
      (question: Record<string, unknown>) => question.name === 'install',
    )).toBe(false)
    const requiredChoice = extensionChoices.find(choice => choice.value === 'core-subagents')
    expect(requiredChoice).toMatchObject({ checked: true, disabled: '只读' })
    expect(await fs.pathExists(join(piHome, 'ccg-workflow.json'))).toBe(true)
    expect((await fs.readJson(join(piHome, 'ccg-workflow.json'))).lastChoices.persona)
      .toBe('nekomata-engineer')
  })

  it('keeps required runtime ownership as missing when the checkbox is deselected', async () => {
    runtimeHasRequiredPackage = false
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await init({ installDir: piHome })

    const requiredChoice = extensionChoices.find(choice => choice.value === 'core-subagents')
    expect(requiredChoice).toMatchObject({ checked: true })
    expect(requiredChoice?.disabled).toBeUndefined()

    const metadata = await fs.readJson(join(piHome, 'ccg-workflow.json'))
    expect(metadata.extensions).toEqual([
      expect.objectContaining({
        id: 'core-subagents',
        packageSpec: 'npm:pi-subagents',
        ownership: 'missing',
      }),
    ])
  })

  it('writes exact verified model capabilities without overriding built-in pricing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await init({
      installDir: piHome,
      skipPrompt: true,
      installProjectAssets: false,
      noOptionalExtensions: true,
      frontendModel: 'anthropic/claude-sonnet-5',
    })

    const models = await fs.readJson(join(piHome, 'models.json'))
    expect(models.providers.anthropic.modelOverrides['claude-sonnet-5']).toMatchObject({
      contextWindow: 1000000,
      maxTokens: 128000,
      reasoning: true,
    })
    expect(models.providers.anthropic.modelOverrides['claude-sonnet-5']).not.toHaveProperty('cost')
  })

  it('does not install assets or packages after the final confirmation is refused', async () => {
    runtimeHasRequiredPackage = false
    finalChoice = 'cancel'
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await init({ installDir: piHome })

    expect(await fs.pathExists(join(piHome, 'ccg-workflow.json'))).toBe(false)
    expect(mocks.prompt.mock.calls.flatMap(([questions]) => questions).some(
      (question: Record<string, unknown>) => question.name === 'install',
    )).toBe(false)
  })
})
