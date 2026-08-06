import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import { uninstallPiWorkflow } from '../installer'
import { CCG_MANAGED_BLOCK_END, CCG_MANAGED_BLOCK_START, CCG_PI_MANAGED_PROMPT_NAMES } from '../pi-paths'

const mockHome = vi.hoisted(() => ({
  path: `/tmp/ccg-pi-uninstall-home-${process.pid}`,
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => mockHome.path }
})

const runtime = vi.hoisted(() => ({
  inspectPiRuntime: vi.fn(),
  runPiPackageCommand: vi.fn(),
}))

vi.mock('../pi-runtime', () => runtime)

let root: string | null = null

async function sandbox(name: string): Promise<{ piHome: string, projectDir: string }> {
  root = join(tmpdir(), `ccg-pi-uninstall-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const piHome = join(root, 'pi-home')
  const projectDir = join(root, 'project')
  await fs.ensureDir(join(piHome, 'agents'))
  await fs.ensureDir(join(piHome, 'extensions', 'subagent'))
  await fs.ensureDir(join(projectDir, '.pi', 'chains'))
  await fs.ensureDir(join(projectDir, '.pi', 'prompts'))
  return { piHome, projectDir }
}

beforeEach(async () => {
  await fs.remove(mockHome.path)
  runtime.runPiPackageCommand.mockReset()
  runtime.runPiPackageCommand.mockResolvedValue({
    success: true,
    command: 'pi remove npm:package',
    packageSpec: 'npm:package',
    stdout: '',
    stderr: '',
    exitCode: 0,
  })
})

afterEach(async () => {
  if (root) await fs.remove(root)
  await fs.remove(mockHome.path)
  root = null
})

describe('uninstallPiWorkflow', () => {
  it('removes CCG assets while preserving user settings, providers, credentials and AGENTS.md content', async () => {
    const { piHome, projectDir } = await sandbox('preserve')
    const metadataPath = join(piHome, 'ccg-workflow.json')
    const projectSettings = join(projectDir, '.pi', 'settings.json')

    await fs.writeFile(join(piHome, 'agents', 'ccg-backend-builder.md'), 'managed')
    await fs.writeFile(join(piHome, 'agents', 'ccg-miniprogram-builder.md'), 'retired managed')
    await fs.writeFile(join(piHome, 'agents', 'user-agent.md'), 'user')
    await fs.writeFile(join(projectDir, '.pi', 'chains', 'ccg-plan.chain.md'), 'managed')
    for (const promptFile of CCG_PI_MANAGED_PROMPT_NAMES) {
      await fs.writeFile(join(projectDir, '.pi', 'prompts', promptFile), 'managed')
    }
    await fs.writeFile(join(projectDir, '.pi', 'prompts', 'user-prompt.md'), 'user')
    const boardPath = join(projectDir, '.pi', 'ccg', 'tasks', 'task-1', 'board.json')
    await fs.ensureDir(join(boardPath, '..'))
    await fs.writeJson(boardPath, { schema: 'ccg.taskBoard.v1', state: 'completed' })
    await fs.writeFile(join(projectDir, '.pi', 'mcp.json.example'), '{"example":true}')
    await fs.writeFile(join(projectDir, '.pi', 'mcp.json'), '{"token":"[密钥]"}')
    await fs.writeJson(projectSettings, { ccg: { enabled: true } })
    await fs.writeFile(join(projectDir, 'AGENTS.md'), `before\n\n${CCG_MANAGED_BLOCK_START}\nmanaged\n${CCG_MANAGED_BLOCK_END}\nafter\n`)

    await fs.writeJson(join(piHome, 'settings.json'), {
      theme: 'user',
      subagents: {
        defaultModel: 'user/default',
        agentOverrides: {
          'ccg-backend-builder': { model: 'provider/backend' },
          'ccg-miniprogram-builder': { model: 'provider/frontend' },
          'user-agent': { model: 'provider/user' },
        },
      },
    })
    await fs.writeJson(join(piHome, 'models.json'), {
      providers: { private: { apiKey: '[密钥]', models: [] } },
    })
    const webSearchConfig = join(mockHome.path, '.pi', 'web-search.json')
    await fs.ensureDir(join(mockHome.path, '.pi'))
    await fs.writeJson(webSearchConfig, {
      workflow: 'custom-user-workflow',
      apiKey: '[密钥]',
    })
    await fs.writeJson(join(piHome, 'extensions', 'subagent', 'config.json'), {
      userKey: true,
      globalConcurrencyLimit: 4,
      maxSubagentSpawnsPerSession: 24,
      maxSubagentDepth: 1,
      parallel: { concurrency: 4, maxTasks: 4, strategy: 'user' },
    })
    await fs.writeJson(metadataPath, {
      extensions: [
        {
          id: 'memory-context',
          packageSpec: 'npm:pi-memctx',
          selected: true,
          ownership: 'ccg-installed',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'mcp-adapter',
          packageSpec: 'npm:pi-mcp-adapter',
          selected: true,
          ownership: 'adopted',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
      managedFiles: [{ path: projectSettings, kind: 'created' }],
    })

    const result = await uninstallPiWorkflow({ piHome, projectDir, metadataPath })

    expect(result.success).toBe(true)
    expect(runtime.runPiPackageCommand).toHaveBeenCalledOnce()
    expect(runtime.runPiPackageCommand).toHaveBeenCalledWith('remove', 'npm:pi-memctx', { piHome })
    expect(result.preserved).toContain('npm:pi-mcp-adapter#user-owned-package')
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-backend-builder.md'))).toBe(false)
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-miniprogram-builder.md'))).toBe(false)
    expect(await fs.pathExists(join(piHome, 'agents', 'user-agent.md'))).toBe(true)
    for (const promptFile of CCG_PI_MANAGED_PROMPT_NAMES) {
      expect(await fs.pathExists(join(projectDir, '.pi', 'prompts', promptFile))).toBe(false)
    }
    expect(await fs.pathExists(join(projectDir, '.pi', 'prompts', 'user-prompt.md'))).toBe(true)
    expect(await fs.readJson(boardPath)).toEqual({ schema: 'ccg.taskBoard.v1', state: 'completed' })
    expect(await fs.readJson(join(projectDir, '.pi', 'mcp.json'))).toEqual({ token: '[密钥]' })
    expect(await fs.readJson(join(piHome, 'models.json'))).toEqual({
      providers: { private: { apiKey: '[密钥]', models: [] } },
    })
    expect(await fs.readJson(webSearchConfig)).toEqual({
      workflow: 'custom-user-workflow',
      apiKey: '[密钥]',
    })
    expect(await fs.readFile(join(projectDir, 'AGENTS.md'), 'utf-8')).toBe('before\nafter\n')
    expect(await fs.readJson(join(piHome, 'settings.json'))).toEqual({
      theme: 'user',
      subagents: {
        defaultModel: 'user/default',
        agentOverrides: { 'user-agent': { model: 'provider/user' } },
      },
    })
    expect(await fs.readJson(join(piHome, 'extensions', 'subagent', 'config.json'))).toEqual({
      userKey: true,
      parallel: { strategy: 'user' },
    })
  })

  it('preserves metadata when a CCG-owned package cannot be removed', async () => {
    const { piHome, projectDir } = await sandbox('package-failure')
    const metadataPath = join(piHome, 'ccg-workflow.json')
    await fs.writeJson(metadataPath, {
      extensions: [{
        id: 'memory-context',
        packageSpec: 'npm:pi-memctx',
        selected: true,
        ownership: 'ccg-installed',
        updatedAt: '2026-07-28T00:00:00.000Z',
      }],
      managedFiles: [],
    })
    runtime.runPiPackageCommand.mockResolvedValueOnce({
      success: false,
      command: 'pi remove npm:pi-memctx',
      packageSpec: 'npm:pi-memctx',
      stdout: '',
      stderr: 'package manager unavailable',
      exitCode: 1,
    })

    const result = await uninstallPiWorkflow({ piHome, projectDir, metadataPath })

    expect(result.success).toBe(false)
    expect(result.errors).toContain('pi remove npm:pi-memctx: package manager unavailable')
    expect(await fs.pathExists(metadataPath)).toBe(true)
    expect(result.preserved).toContain(`${metadataPath}#extension-removal-retry`)
  })

  it('preserves the required pi-subagents runtime during uninstall', async () => {
    const { piHome, projectDir } = await sandbox('preserve-required-runtime')
    const metadataPath = join(piHome, 'ccg-workflow.json')
    await fs.writeJson(metadataPath, {
      extensions: [
        {
          id: 'core-subagents',
          packageSpec: 'npm:pi-subagents',
          selected: true,
          ownership: 'ccg-installed',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'memory-context',
          packageSpec: 'npm:pi-memctx',
          selected: true,
          ownership: 'ccg-installed',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
      managedFiles: [],
    })

    const result = await uninstallPiWorkflow({ piHome, projectDir, metadataPath })

    expect(result.success).toBe(true)
    expect(runtime.runPiPackageCommand).toHaveBeenCalledOnce()
    expect(runtime.runPiPackageCommand).toHaveBeenCalledWith('remove', 'npm:pi-memctx', { piHome })
    expect(result.removed).toContain('npm:pi-memctx#pi-package')
    expect(result.preserved).toContain('npm:pi-subagents#user-owned-package')
    expect(result.removed).not.toContain('npm:pi-subagents#pi-package')
  })

  it('is idempotent and conservatively preserves project settings without a manifest', async () => {
    const { piHome, projectDir } = await sandbox('idempotent')
    const projectSettings = join(projectDir, '.pi', 'settings.json')
    await fs.writeJson(projectSettings, { user: true })
    await fs.writeFile(join(projectDir, 'AGENTS.md'), 'user instructions\n')

    const first = await uninstallPiWorkflow({ piHome, projectDir })
    const second = await uninstallPiWorkflow({ piHome, projectDir })

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(second.removed).toEqual([])
    expect(await fs.readJson(projectSettings)).toEqual({ user: true })
    expect(await fs.readFile(join(projectDir, 'AGENTS.md'), 'utf-8')).toBe('user instructions\n')
  })
})
