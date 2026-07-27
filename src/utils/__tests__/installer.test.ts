import { tmpdir } from 'node:os'
import { dirname, join } from 'pathe'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { installPiWorkflow } from '../installer'
import {
  CCG_MANAGED_BLOCK_END,
  CCG_MANAGED_BLOCK_START,
} from '../pi-paths'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PI_TEMPLATES = join(PACKAGE_ROOT, 'templates', 'pi')
const CCG_AGENTS = [
  'ccg-project-scout',
  'ccg-planner',
  'ccg-backend-builder',
  'ccg-frontend-builder',
  'ccg-miniprogram-builder',
  'ccg-test-runner',
  'ccg-reviewer',
]

const roots: string[] = []

async function sandbox(name: string): Promise<{ piHome: string, projectDir: string }> {
  const root = join(tmpdir(), `ccg-pi-release-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  roots.push(root)
  return {
    piHome: join(root, 'pi-home'),
    projectDir: join(root, 'project'),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.remove(root)))
})

describe('Pi installer release contract', () => {
  it('installs the complete Pi-only runtime from packaged templates without network access', async () => {
    const { piHome, projectDir } = await sandbox('complete')

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir: PI_TEMPLATES,
      installProjectAssets: true,
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
      force: true,
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.installedPiAgents?.sort()).toEqual([...CCG_AGENTS].sort())

    for (const agent of CCG_AGENTS) {
      expect(await fs.pathExists(join(piHome, 'agents', `${agent}.md`))).toBe(true)
    }

    expect(await fs.pathExists(join(projectDir, '.pi', 'chains', 'ccg-plan.chain.md'))).toBe(true)
    expect(await fs.pathExists(join(projectDir, '.pi', 'prompts', 'ccg-go.md'))).toBe(true)
    expect(await fs.pathExists(join(projectDir, '.pi', 'settings.json'))).toBe(true)
    expect(await fs.pathExists(join(projectDir, '.pi', 'mcp.json.example'))).toBe(true)
    expect(await fs.pathExists(join(piHome, 'extensions', 'subagent', 'config.json'))).toBe(true)
    expect(await fs.pathExists(join(piHome, 'bin', 'codeagent-wrapper'))).toBe(false)

    const agentsMd = await fs.readFile(join(projectDir, 'AGENTS.md'), 'utf-8')
    expect(agentsMd).toContain(CCG_MANAGED_BLOCK_START)
    expect(agentsMd).toContain(CCG_MANAGED_BLOCK_END)
    expect(agentsMd).not.toContain('.claude')
    expect(agentsMd).not.toContain('codeagent-wrapper')
  })

  it('preserves existing agent files when force is disabled and reports them as skipped', async () => {
    const { piHome, projectDir } = await sandbox('skip')
    const existingAgent = join(piHome, 'agents', 'ccg-backend-builder.md')
    await fs.ensureDir(dirname(existingAgent))
    await fs.writeFile(existingAgent, 'user-owned content\n', 'utf-8')

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir: PI_TEMPLATES,
      installProjectAssets: false,
      force: false,
    })

    expect(result.success).toBe(true)
    expect(await fs.readFile(existingAgent, 'utf-8')).toBe('user-owned content\n')
    expect(result.installedPiAgents).not.toContain('ccg-backend-builder')
    expect(result.installedPiAgents).toContain('ccg-project-scout')
  })

  it('maps role-specific models and bounded fanout settings to Pi configuration', async () => {
    const { piHome, projectDir } = await sandbox('models-and-caps')

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir: PI_TEMPLATES,
      installProjectAssets: false,
      frontendModel: 'provider/frontend',
      backendModel: 'provider/backend',
      reviewModel: 'provider/review',
      caps: {
        devAgentCap: 3,
        globalConcurrencyLimit: 4,
        maxSpawnsPerSession: 20,
        maxSubagentDepth: 1,
      },
      force: true,
    })

    expect(result.success).toBe(true)
    const settings = await fs.readJson(join(piHome, 'settings.json'))
    expect(settings.subagents.agentOverrides).toMatchObject({
      'ccg-backend-builder': { model: 'provider/backend' },
      'ccg-frontend-builder': { model: 'provider/frontend' },
      'ccg-miniprogram-builder': { model: 'provider/frontend' },
      'ccg-reviewer': { model: 'provider/review' },
      'ccg-test-runner': { model: 'provider/review' },
    })

    const caps = await fs.readJson(join(piHome, 'extensions', 'subagent', 'config.json'))
    expect(caps).toMatchObject({
      globalConcurrencyLimit: 4,
      maxSubagentSpawnsPerSession: 20,
      maxSubagentDepth: 1,
      parallel: {
        concurrency: 4,
        maxTasks: 3,
      },
    })
  })
})
