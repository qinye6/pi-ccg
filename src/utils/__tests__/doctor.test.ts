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

import { CCG_PI_MANAGED_PROMPT_NAMES } from '../pi-paths'

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
    const defaultPiHome = join(mockHome.path, '.pi', 'agent')
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
      language: 'en',
      extensions: [
        {
          id: 'mcp-adapter',
          packageSpec: 'npm:pi-mcp-adapter',
          selected: true,
          ownership: 'missing',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    })
    await fs.writeJson(join(defaultPiHome, 'ccg-workflow.json'), {
      version: '3.2.5',
      scope: 'user',
      language: 'zh-CN',
      extensions: [],
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor({ installDir: customPiHome })
    await status({ installDir: customPiHome })

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('Memory Context')
    expect(output).toContain('not selected [Recommended]')
    expect(output).toContain('Pi MCP Adapter')
    expect(output).toContain('selected but missing; install with: pi install npm:pi-mcp-adapter')
    expect(output).toContain(`${ACTIVE_AGENTS.length}/${ACTIVE_AGENTS.length} installed`)
    expect(output).toContain(`Pi home:      ${customPiHome}`)
    expect(output).not.toContain('推荐')
    expect(output).not.toContain(`Pi home:      ${defaultPiHome}`)
    expect(spawnSync).toHaveBeenCalledWith('pi', ['list', '--no-approve'], expect.objectContaining({
      env: expect.objectContaining({ PI_CODING_AGENT_DIR: customPiHome }),
    }))
  })

  it('reports invalid provider and web config without exposing values', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    await fs.writeFile(join(piHome, 'models.json'), '{invalid', 'utf-8')
    await fs.writeJson(join(piHome, 'ccg-workflow.json'), {
      language: 'en',
      scope: 'user',
      extensions: [{
        id: 'web-access',
        packageSpec: 'npm:pi-web-access',
        selected: true,
        ownership: 'adopted',
        updatedAt: '2026-07-29T00:00:00.000Z',
      }],
    })
    await fs.ensureDir(join(mockHome.path, '.pi'))
    await fs.writeFile(join(mockHome.path, '.pi', 'web-search.json'), '{private-secret', 'utf-8')
    spawnSync.mockImplementation((_command: string, args: string[]) => args[0] === '--version'
      ? { status: 0, stdout: 'pi 1.0.0\n', stderr: '' }
      : { status: 0, stdout: 'Packages:\n  npm:pi-subagents@0.37.0\n  npm:pi-web-access@1.0.0\n', stderr: '' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()
    await status()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('Provider models.json')
    expect(output).toContain('Provider file: invalid')
    expect(output).toContain('invalid JSON; CCG will not overwrite it')
    expect(output).toContain('pi-web-access config')
    expect(output).toContain('Web access:   invalid')
    expect(output).toContain('invalid JSON; preserved without overwrite')
    expect(output).not.toContain('private-secret')
  })

  it('warns when custom models omit verified context or output limits', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    await fs.writeJson(join(piHome, 'models.json'), {
      providers: {
        custom: {
          apiKey: '$CUSTOM_API_KEY',
          models: [
            { id: 'complete', contextWindow: 100000, maxTokens: 8192 },
            { id: 'incomplete', contextWindow: 100000 },
          ],
        },
      },
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('Model capabilities')
    expect(output).toContain('1 custom model(s) rely on Pi defaults')
    expect(output).not.toContain('$CUSTOM_API_KEY')
  })

  it('reports only the board root path without reading task contents', async () => {
    const boardRoot = join(projectDir, '.pi', 'ccg', 'tasks')
    await fs.ensureDir(join(boardRoot, 'task-secret'))
    await fs.writeJson(join(boardRoot, 'task-secret', 'board.json'), {
      schema: 'ccg.taskBoard.v1',
      goal: 'do-not-print-board-secret',
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()
    await status()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain(boardRoot)
    expect(output).not.toContain('do-not-print-board-secret')
  })

  it('reports only validated persona IDs and falls back safely for corrupted metadata', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    const metadataPath = join(piHome, 'ccg-workflow.json')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await fs.writeJson(metadataPath, {
      version: '3.2.7',
      language: 'en',
      scope: 'user',
      lastChoices: {
        persona: 'nekomata-engineer',
        caps: {
          devAgentCap: 4,
          globalConcurrencyLimit: 4,
          maxSpawnsPerSession: 24,
          maxSubagentDepth: 1,
        },
      },
      extensions: [],
      managedFiles: [],
    })
    await doctor()
    await status()

    let output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('CCG leader persona')
    expect(output).toContain('Persona:      nekomata-engineer')
    expect(output).not.toContain('warm, lightly playful catlike tone')

    log.mockClear()
    await fs.writeJson(metadataPath, {
      version: '3.2.7',
      language: 'en',
      scope: 'user',
      lastChoices: {
        persona: '../private-persona-body',
        caps: {
          devAgentCap: 4,
          globalConcurrencyLimit: 4,
          maxSpawnsPerSession: 24,
          maxSubagentDepth: 1,
        },
      },
      extensions: [],
      managedFiles: [],
    })
    await doctor()
    await status()

    output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('invalid saved persona; runtime fallback=default')
    expect(output).toContain('Persona:      default')
    expect(output).not.toContain('../private-persona-body')
  })

  it('resolves saved thinking through agent and default model references', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    await fs.writeJson(join(piHome, 'ccg-workflow.json'), {
      version: '3.2.7',
      language: 'en',
      scope: 'user',
      lastChoices: {
        thinking: { planningThinking: 'medium', backendThinking: 'high' },
      },
    })
    await fs.writeJson(join(piHome, 'settings.json'), {
      subagents: {
        defaultModel: 'anthropic/claude-sonnet-5',
        agentOverrides: {
          'ccg-project-scout': { thinking: 'medium' },
          'ccg-planner': { thinking: 'medium' },
          'ccg-backend-builder': { model: 'anthropic/claude-sonnet-5', thinking: 'high' },
        },
      },
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('Subagent thinking')
    expect(output).toContain('groups=2')
    expect(output).toContain('settingsMismatch=0')
    expect(output).toContain('unsupported=0')
    expect(output).toContain('capabilityUnknown=0')
  })

  it('recognizes exact models registered through provider modelOverrides', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    await fs.writeJson(join(piHome, 'settings.json'), {
      subagents: {
        agentOverrides: {
          'ccg-backend-builder': { model: 'anthropic/claude-sonnet-5' },
        },
      },
    })
    await fs.writeJson(join(piHome, 'models.json'), {
      providers: {
        anthropic: {
          modelOverrides: {
            'claude-sonnet-5': { contextWindow: 1000000, maxTokens: 128000 },
          },
        },
      },
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('Model references')
    expect(output).toContain('resolved or delegated to Pi built-ins')
    expect(output).not.toContain('reference(s) not found in models.json')
  })

  it('distinguishes fresh init, update repair, and Pi reload remediation', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()
    let output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('not initialized:')
    expect(output).toContain('run: ccg init')
    expect(output).toContain('Pi command is /ccg-go, not /ccg:go')

    log.mockClear()
    await fs.writeJson(join(piHome, 'ccg-workflow.json'), { version: '3.2.7', scope: 'user' })
    await doctor()
    output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain('run: ccg update')
  })

  it('uses user-level chain and prompt paths for user-only metadata', async () => {
    const piHome = join(mockHome.path, '.pi', 'agent')
    await fs.ensureDir(join(piHome, 'chains'))
    await fs.ensureDir(join(piHome, 'prompts'))
    await fs.writeFile(join(piHome, 'chains', 'ccg-plan.chain.md'), 'chain\n', 'utf-8')
    for (const promptFile of CCG_PI_MANAGED_PROMPT_NAMES) {
      await fs.writeFile(join(piHome, 'prompts', promptFile), 'prompt\n', 'utf-8')
    }
    await fs.writeJson(join(piHome, 'ccg-workflow.json'), {
      version: '1.0.1',
      scope: 'user',
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await doctor()

    const output = log.mock.calls.map(args => args.join(' ')).join('\n')
    expect(output).toContain(join(piHome, 'chains', 'ccg-plan.chain.md'))
    expect(output).toContain('5/5 installed: /ccg, /ccg-board, /ccg-replay, /ccg-resume, /ccg-go')
    expect(output).toContain('restart/reload Pi if they are absent from the / menu')
    expect(output).toContain('Claude uses /ccg:go')
    expect(output).toContain('not required for user-only install scope')
    expect(output).not.toContain('not installed in current project')
  })
})
