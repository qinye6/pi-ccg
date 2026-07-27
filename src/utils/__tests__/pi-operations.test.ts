import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import { init } from '../../commands/init'
import { performUpdate } from '../../commands/update'

const CCG_AGENTS = [
  'ccg-project-scout',
  'ccg-planner',
  'ccg-backend-builder',
  'ccg-frontend-builder',
  'ccg-miniprogram-builder',
  'ccg-test-runner',
  'ccg-reviewer',
]

let root: string | null = null
const originalCwd = process.cwd()

async function createSandbox(name: string): Promise<{ piHome: string, projectDir: string }> {
  root = join(tmpdir(), `ccg-pi-operations-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const piHome = join(root, 'pi-home')
  const projectDir = join(root, 'project')
  await fs.ensureDir(piHome)
  await fs.ensureDir(projectDir)
  return { piHome, projectDir }
}

afterEach(async () => {
  process.chdir(originalCwd)
  if (root) await fs.remove(root)
  root = null
})

describe('Pi init and update operations', () => {
  it('writes metadata into a custom Pi home during non-interactive init', async () => {
    const { piHome, projectDir } = await createSandbox('init-metadata')
    process.chdir(projectDir)

    await init({
      installDir: piHome,
      skipPrompt: true,
      installProjectAssets: false,
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
    })

    const metadataPath = join(piHome, 'ccg-workflow.json')
    expect(await fs.pathExists(metadataPath)).toBe(true)
    const metadata = await fs.readJson(metadataPath)
    expect(metadata.scope).toBe('user')
    expect(metadata.lastChoices).toMatchObject({
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
    })
    for (const agent of CCG_AGENTS) {
      expect(await fs.pathExists(join(piHome, 'agents', `${agent}.md`))).toBe(true)
    }
  })

  it('restores metadata choices and preserves unrelated Pi configuration during update', async () => {
    const { piHome, projectDir } = await createSandbox('update')
    const metadataPath = join(piHome, 'ccg-workflow.json')
    await fs.writeJson(metadataPath, {
      version: '0.0.0',
      language: 'zh-CN',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      scope: 'user-project',
      lastChoices: {
        frontendModel: 'demo/frontend',
        backendModel: 'demo/backend',
        reviewModel: 'demo/review',
        caps: {
          devAgentCap: 3,
          globalConcurrencyLimit: 3,
          maxSpawnsPerSession: 16,
          maxSubagentDepth: 1,
        },
      },
      managedFiles: [],
    })
    await fs.writeJson(join(piHome, 'settings.json'), {
      userTheme: 'preserve-me',
      subagents: {
        defaultModel: 'demo/default',
        agentOverrides: { 'user-agent': { model: 'demo/user' } },
      },
    })
    await fs.writeJson(join(piHome, 'models.json'), {
      providers: { userProvider: { apiKey: '[密钥]', models: [] } },
      userField: true,
    })
    await fs.ensureDir(join(projectDir, '.pi'))
    await fs.writeJson(join(projectDir, '.pi', 'mcp.json'), {
      token: '[密钥]',
    })
    await fs.writeFile(join(projectDir, 'AGENTS.md'), 'user instructions\n')

    const result = await performUpdate({
      projectDir,
      piHome,
      metadataPath,
      useLatestPackage: false,
    })

    expect(result).toEqual({ success: true, errors: [] })
    const settings = await fs.readJson(join(piHome, 'settings.json'))
    expect(settings.userTheme).toBe('preserve-me')
    expect(settings.subagents.defaultModel).toBe('demo/default')
    expect(settings.subagents.agentOverrides['user-agent']).toEqual({ model: 'demo/user' })
    expect(settings.subagents.agentOverrides['ccg-backend-builder']).toEqual({ model: 'demo/backend' })
    expect(settings.subagents.agentOverrides['ccg-frontend-builder']).toEqual({ model: 'demo/frontend' })
    expect(settings.subagents.agentOverrides['ccg-miniprogram-builder']).toEqual({ model: 'demo/frontend' })
    expect(settings.subagents.agentOverrides['ccg-reviewer']).toEqual({ model: 'demo/review' })
    expect(settings.subagents.agentOverrides['ccg-test-runner']).toEqual({ model: 'demo/review' })
    expect(await fs.readJson(join(piHome, 'models.json'))).toEqual({
      providers: { userProvider: { apiKey: '[密钥]', models: [] } },
      userField: true,
    })
    expect(await fs.readJson(join(projectDir, '.pi', 'mcp.json'))).toEqual({
      token: '[密钥]',
    })
    expect(await fs.readFile(join(projectDir, 'AGENTS.md'), 'utf-8')).toContain('user instructions\n')
  })
})
