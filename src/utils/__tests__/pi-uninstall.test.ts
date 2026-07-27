import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import { uninstallPiWorkflow } from '../installer'
import { CCG_MANAGED_BLOCK_END, CCG_MANAGED_BLOCK_START } from '../pi-paths'

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

afterEach(async () => {
  if (root) await fs.remove(root)
  root = null
})

describe('uninstallPiWorkflow', () => {
  it('removes CCG assets while preserving user settings, providers, credentials and AGENTS.md content', async () => {
    const { piHome, projectDir } = await sandbox('preserve')
    const metadataPath = join(piHome, 'ccg-workflow.json')
    const projectSettings = join(projectDir, '.pi', 'settings.json')

    await fs.writeFile(join(piHome, 'agents', 'ccg-backend-builder.md'), 'managed')
    await fs.writeFile(join(piHome, 'agents', 'user-agent.md'), 'user')
    await fs.writeFile(join(projectDir, '.pi', 'chains', 'ccg-plan.chain.md'), 'managed')
    await fs.writeFile(join(projectDir, '.pi', 'prompts', 'ccg-go.md'), 'managed')
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
          'user-agent': { model: 'provider/user' },
        },
      },
    })
    await fs.writeJson(join(piHome, 'models.json'), {
      providers: { private: { apiKey: '[密钥]', models: [] } },
    })
    await fs.writeJson(join(piHome, 'extensions', 'subagent', 'config.json'), {
      userKey: true,
      globalConcurrencyLimit: 4,
      maxSubagentSpawnsPerSession: 24,
      maxSubagentDepth: 1,
      parallel: { concurrency: 4, maxTasks: 4, strategy: 'user' },
    })
    await fs.writeJson(metadataPath, {
      managedFiles: [{ path: projectSettings, kind: 'created' }],
    })

    const result = await uninstallPiWorkflow({ piHome, projectDir, metadataPath })

    expect(result.success).toBe(true)
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-backend-builder.md'))).toBe(false)
    expect(await fs.pathExists(join(piHome, 'agents', 'user-agent.md'))).toBe(true)
    expect(await fs.pathExists(projectSettings)).toBe(false)
    expect(await fs.readJson(join(projectDir, '.pi', 'mcp.json'))).toEqual({ token: '[密钥]' })
    expect(await fs.readJson(join(piHome, 'models.json'))).toEqual({
      providers: { private: { apiKey: '[密钥]', models: [] } },
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
