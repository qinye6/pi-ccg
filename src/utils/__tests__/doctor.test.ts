import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'

const mockHome = vi.hoisted(() => ({
  path: `/tmp/ccg-doctor-test-${process.pid}-${Math.random().toString(16).slice(2)}`,
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => mockHome.path,
  }
})

const spawnSync = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawnSync }))

const { doctor, status } = await import('../../commands/doctor')

const ACTIVE_AGENTS = [
  'ccg-project-scout',
  'ccg-planner',
  'ccg-backend-builder',
  'ccg-frontend-builder',
  'ccg-test-runner',
  'ccg-reviewer',
]

const RETIRED_MINIPROGRAM_AGENT = 'ccg-miniprogram-builder'
let originalCwd: string
let projectDir: string

beforeEach(async () => {
  spawnSync.mockReset()
  spawnSync.mockImplementation((_command: string, args: string[]) => args[0] === '--version'
    ? { status: 0, stdout: 'pi 1.0.0\n', stderr: '' }
    : { status: 0, stdout: 'Packages:\n  npm:pi-subagents@0.37.0\n', stderr: '' })
  originalCwd = process.cwd()
  projectDir = join(mockHome.path, 'project')
  const piHome = join(mockHome.path, '.pi', 'agent')
  await fs.remove(mockHome.path)
  await fs.ensureDir(join(piHome, 'agents'))
  await fs.ensureDir(projectDir)

  for (const agent of ACTIVE_AGENTS) {
    await fs.writeFile(join(piHome, 'agents', `${agent}.md`), `${agent}\n`, 'utf-8')
  }
  await fs.writeFile(join(piHome, 'agents', `${RETIRED_MINIPROGRAM_AGENT}.md`), 'user-owned stale asset\n', 'utf-8')
  await fs.ensureDir(join(piHome, 'extensions', 'subagent'))
  await fs.writeJson(join(piHome, 'extensions', 'subagent', 'config.json'), {
    globalConcurrencyLimit: 4,
    maxSubagentSpawnsPerSession: 24,
    maxSubagentDepth: 1,
    parallel: { concurrency: 4, maxTasks: 4 },
  })
  process.chdir(projectDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.remove(mockHome.path)
  vi.restoreAllMocks()
})

describe('doctor retired Pi agent handling', () => {
  it('warns about unknown stale retired files without requiring them as active agents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('Pi agents')
    expect(output).toContain(`${ACTIVE_AGENTS.length}/${ACTIVE_AGENTS.length} installed`)
    expect(output).toContain('Retired Pi agents')
    expect(output).toContain(`stale legacy asset(s) preserved: ${RETIRED_MINIPROGRAM_AGENT}`)
    expect(output).not.toContain(`missing: ${RETIRED_MINIPROGRAM_AGENT}`)
    expect(output).toContain('Required Pi checks passed.')
  })

  it('fails the required runtime check when pi-subagents is missing', async () => {
    spawnSync.mockImplementation((_command: string, args: string[]) => args[0] === '--version'
      ? { status: 0, stdout: 'pi 1.0.0\n', stderr: '' }
      : { status: 0, stdout: 'Packages:\n  npm:other-package\n', stderr: '' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('pi-subagents package')
    expect(output).toContain('pi install npm:pi-subagents')
    expect(output).toContain('1 required check(s) failed.')
    expect(output).not.toContain('Required Pi checks passed.')
  })

  it('reports selected missing extensions without exposing MCP credentials', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    await fs.writeJson(join(piHome, 'ccg-workflow.json'), {
      version: '3.2.5',
      scope: 'user-project',
      extensions: [
        {
          id: 'core-subagents',
          packageSpec: 'npm:pi-subagents',
          selected: true,
          ownership: 'adopted',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'mcp-adapter',
          packageSpec: 'npm:pi-mcp-adapter',
          selected: true,
          ownership: 'missing',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    })
    await fs.ensureDir(join(projectDir, '.pi'))
    await fs.writeJson(join(projectDir, '.pi', 'mcp.json'), { token: 'do-not-print-this-value' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('Pi MCP Adapter')
    expect(output).toContain('selected but missing; install with: pi install npm:pi-mcp-adapter')
    expect(output).toContain('MCP integration')
    expect(output).not.toContain('do-not-print-this-value')
  })

  it('checks and reports a custom Pi home consistently', async () => {
    const customPiHome = join(mockHome.path, 'custom-pi-home')
    await fs.ensureDir(join(customPiHome, 'agents'))
    for (const agent of ACTIVE_AGENTS) {
      await fs.writeFile(join(customPiHome, 'agents', `${agent}.md`), `${agent}\n`, 'utf-8')
    }
    await fs.ensureDir(join(customPiHome, 'extensions', 'subagent'))
    await fs.writeJson(join(customPiHome, 'extensions', 'subagent', 'config.json'), {
      globalConcurrencyLimit: 4,
      maxSubagentSpawnsPerSession: 24,
      maxSubagentDepth: 1,
      parallel: { concurrency: 4, maxTasks: 4 },
    })
    await fs.writeJson(join(customPiHome, 'ccg-workflow.json'), {
      version: '3.2.5',
      scope: 'user',
      extensions: [],
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor({ installDir: customPiHome })
    await status({ installDir: customPiHome })

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain(`${ACTIVE_AGENTS.length}/${ACTIVE_AGENTS.length} installed`)
    expect(output).toContain(`Pi home:      ${customPiHome}`)
    expect(spawnSync).toHaveBeenCalledWith('pi', ['list', '--no-approve'], expect.objectContaining({
      env: expect.objectContaining({ PI_CODING_AGENT_DIR: customPiHome }),
    }))
  })

  it('uses user-level chain and prompt paths for user-only metadata', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    await fs.ensureDir(join(piHome, 'chains'))
    await fs.ensureDir(join(piHome, 'prompts'))
    await fs.writeFile(join(piHome, 'chains', 'ccg-plan.chain.md'), 'chain\n', 'utf-8')
    await fs.writeFile(join(piHome, 'prompts', 'ccg-go.md'), 'prompt\n', 'utf-8')
    await fs.writeJson(join(piHome, 'ccg-workflow.json'), {
      version: '1.0.1',
      scope: 'user',
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain(join(piHome, 'chains', 'ccg-plan.chain.md'))
    expect(output).toContain(join(piHome, 'prompts', 'ccg-go.md'))
    expect(output).toContain('not required for user-only install scope')
    expect(output).not.toContain('not installed in current project')
  })
})
