import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import { init } from '../../commands/init'
import { buildLatestInitArgs, performUpdate } from '../../commands/update'

const CCG_AGENTS = [
  'ccg-project-scout',
  'ccg-planner',
  'ccg-backend-builder',
  'ccg-frontend-builder',
  'ccg-test-runner',
  'ccg-reviewer',
]
const RETIRED_MINIPROGRAM_AGENT = 'ccg-miniprogram-builder'

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
    const metadataTempFiles = (await fs.readdir(piHome))
      .filter(name => name.includes('ccg-workflow.json.') && name.endsWith('.ccg-tmp'))
    expect(metadataTempFiles).toEqual([])
    expect(metadata.lastChoices).toMatchObject({
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
    })
    for (const agent of CCG_AGENTS) {
      expect(await fs.pathExists(join(piHome, 'agents', `${agent}.md`))).toBe(true)
    }
    expect(await fs.pathExists(join(piHome, 'agents', `${RETIRED_MINIPROGRAM_AGENT}.md`))).toBe(false)
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
      extensions: [
        {
          id: 'mcp-adapter',
          packageSpec: 'npm:pi-mcp-adapter',
          selected: true,
          ownership: 'adopted',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      managedFiles: [],
    })
    await fs.writeJson(join(piHome, 'settings.json'), {
      userTheme: 'preserve-me',
      subagents: {
        defaultModel: 'demo/default',
        agentOverrides: {
          'user-agent': { model: 'demo/user' },
          [RETIRED_MINIPROGRAM_AGENT]: { model: 'demo/old-mini' },
        },
      },
    })
    await fs.writeJson(join(piHome, 'models.json'), {
      providers: { userProvider: { apiKey: '[密钥]', models: [] } },
      userField: true,
    })
    await fs.ensureDir(join(piHome, 'agents'))
    await fs.writeFile(
      join(piHome, 'agents', `${RETIRED_MINIPROGRAM_AGENT}.md`),
      'unknown user-owned stale content\n',
      'utf-8',
    )
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
    const updatedMetadata = await fs.readJson(metadataPath)
    expect(updatedMetadata.extensions).toEqual([
      expect.objectContaining({
        id: 'mcp-adapter',
        packageSpec: 'npm:pi-mcp-adapter',
        ownership: 'adopted',
      }),
    ])
    const settings = await fs.readJson(join(piHome, 'settings.json'))
    expect(settings.userTheme).toBe('preserve-me')
    expect(settings.subagents.defaultModel).toBe('demo/default')
    expect(settings.subagents.agentOverrides['user-agent']).toEqual({ model: 'demo/user' })
    expect(settings.subagents.agentOverrides['ccg-backend-builder']).toEqual({ model: 'demo/backend' })
    expect(settings.subagents.agentOverrides['ccg-frontend-builder']).toEqual({ model: 'demo/frontend' })
    expect(settings.subagents.agentOverrides['ccg-reviewer']).toEqual({ model: 'demo/review' })
    expect(settings.subagents.agentOverrides['ccg-test-runner']).toEqual({ model: 'demo/review' })
    expect(settings.subagents.agentOverrides[RETIRED_MINIPROGRAM_AGENT]).toBeUndefined()
    expect(await fs.readJson(join(piHome, 'models.json'))).toEqual({
      providers: { userProvider: { apiKey: '[密钥]', models: [] } },
      userField: true,
    })
    expect(await fs.readJson(join(projectDir, '.pi', 'mcp.json'))).toEqual({
      token: '[密钥]',
    })
    expect(await fs.readFile(join(piHome, 'agents', `${RETIRED_MINIPROGRAM_AGENT}.md`), 'utf-8')).toBe('unknown user-owned stale content\n')
    expect(await fs.readFile(join(projectDir, 'AGENTS.md'), 'utf-8')).toContain('user instructions\n')
  })

  it('tolerates legacy metadata without lastChoices or cap fields', async () => {
    const { piHome, projectDir } = await createSandbox('legacy-metadata')
    const metadataPath = join(piHome, 'ccg-workflow.json')
    await fs.writeJson(metadataPath, {
      version: '0.1.0',
      language: 'en',
      scope: 'user',
    })

    const result = await performUpdate({
      projectDir,
      piHome,
      metadataPath,
      useLatestPackage: false,
    })

    expect(result).toEqual({ success: true, errors: [] })
    const metadata = await fs.readJson(metadataPath)
    expect(metadata.version).toBe('3.2.6')
    expect(metadata.scope).toBe('user')
    expect(metadata.lastChoices.caps).toEqual({
      devAgentCap: 4,
      globalConcurrencyLimit: 4,
      maxSpawnsPerSession: 24,
      maxSubagentDepth: 1,
    })
  })

  it('passes a custom Pi home to the latest package installer', () => {
    const args = buildLatestInitArgs({
      lang: 'en',
      installDir: '/tmp/custom pi home',
      skipPrompt: true,
      force: true,
      installProjectAssets: false,
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
      extensionIds: ['mcp-adapter', 'memory-context'],
      preserveExtensions: true,
      devAgentCap: 3,
      globalConcurrencyLimit: 4,
      maxSpawnsPerSession: 20,
      maxSubagentDepth: 1,
    })

    expect(args).toContain('pi-ccg@latest')
    expect(args.slice(args.indexOf('--install-dir'), args.indexOf('--install-dir') + 2))
      .toEqual(['--install-dir', '/tmp/custom pi home'])
    expect(args).toContain('--no-project-assets')
    expect(args.slice(args.indexOf('--extensions'), args.indexOf('--extensions') + 2))
      .toEqual(['--extensions', 'mcp-adapter,memory-context'])
    expect(args).toContain('--preserve-extensions')
  })
})
