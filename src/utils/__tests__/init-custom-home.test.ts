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

beforeEach(async () => {
  root = join(tmpdir(), `ccg-init-custom-home-${process.pid}-${Math.random().toString(16).slice(2)}`)
  piHome = join(root, 'pi-home')
  projectDir = join(root, 'project')
  originalCwd = process.cwd()
  await fs.ensureDir(piHome)
  await fs.ensureDir(projectDir)
  process.chdir(projectDir)

  mocks.spawnSync.mockReset()
  mocks.spawnSync.mockImplementation((_command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const targetsCustomHome = options.env?.PI_CODING_AGENT_DIR === piHome
    if (args[0] === '--version') return { status: 0, stdout: 'pi 1.0.0\n', stderr: '' }
    return {
      status: 0,
      stdout: targetsCustomHome ? 'Packages:\n  npm:pi-subagents@0.37.0\n' : 'Packages:\n',
      stderr: '',
    }
  })

  mocks.prompt.mockReset()
  mocks.prompt.mockImplementation(async (questions: Array<Record<string, unknown>>) => {
    const question = questions[0]
    const message = String(question.message ?? '')
    if (message.includes('选择语言')) return { value: 'zh-CN' }
    if (message === 'Pi 环境检查:') return { value: 'next' }
    if (message.includes('选择可选 Pi 扩展')) return { value: [] }
    if (message === '安装范围:') return { value: 'user' }
    if (message.includes('模型供应商过滤')) return { value: '__all__' }
    if (message.includes('选择前端模型')) return { value: 'demo/frontend' }
    if (message.includes('选择后端模型')) return { value: 'demo/backend' }
    if (message.includes('选择审查/测试模型')) return { value: 'demo/review' }
    if (message === '项目入口:') return { value: 'no' }
    if (message === '确认安装:') return { value: 'confirm' }
    if (question.name === 'devAgentCap') {
      return {
        devAgentCap: 4,
        globalConcurrencyLimit: 4,
        maxSpawnsPerSession: 24,
        maxSubagentDepth: 1,
      }
    }
    if (question.name === 'install') return { install: false }
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
    expect(await fs.pathExists(join(piHome, 'ccg-workflow.json'))).toBe(true)
  })
})
