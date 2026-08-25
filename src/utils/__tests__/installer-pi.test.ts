import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import { installPiWorkflow } from '../installer'
import {
  CCG_MANAGED_BLOCK_END,
  CCG_MANAGED_BLOCK_START,
  CCG_PI_MANAGED_PROMPT_NAMES,
} from '../pi-paths'

interface Sandbox {
  root: string
  piHome: string
  projectDir: string
  templateDir: string
}

interface FixtureOptions {
  badAgent?: boolean
  omitPrompt?: string
}

let currentRoot: string | null = null

async function createSandbox(name: string, fixtureOptions: FixtureOptions = {}): Promise<Sandbox> {
  const root = join(tmpdir(), `ccg-pi-installer-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  currentRoot = root
  const piHome = join(root, 'pi-home')
  const projectDir = join(root, 'project')
  const templateDir = join(root, 'templates', 'pi')

  await createFixtureTemplates(templateDir, fixtureOptions)

  return { root, piHome, projectDir, templateDir }
}

async function createFixtureTemplates(templateDir: string, options: FixtureOptions): Promise<void> {
  await fs.ensureDir(join(templateDir, 'agents'))
  await fs.ensureDir(join(templateDir, 'chains'))
  await fs.ensureDir(join(templateDir, 'prompts'))
  await fs.ensureDir(join(templateDir, 'extensions'))
  await fs.ensureDir(join(templateDir, 'project'))
  await fs.ensureDir(join(templateDir, 'mcp'))

  await fs.writeFile(join(templateDir, 'agents', 'ccg-project-scout.md'), `# Project Scout
Home: {{PI_AGENT_HOME}}
Project: {{PI_PROJECT_DIR}}
`, 'utf-8')
  await fs.writeFile(join(templateDir, 'agents', 'ccg-planner.md'), `# Planner
Caps: {{DEV_AGENT_CAP}}/{{GLOBAL_CONCURRENCY_LIMIT}}/{{MAX_SPAWNS_PER_SESSION}}/{{MAX_SUBAGENT_DEPTH}}
`, 'utf-8')
  await fs.writeFile(join(templateDir, 'agents', 'ccg-backend-builder.md'), `# Backend Builder
Home: {{PI_AGENT_HOME}}
Project: {{PI_PROJECT_DIR}}
Backend: {{BACKEND_MODEL}}
Caps: {{DEV_AGENT_CAP}}/{{GLOBAL_CONCURRENCY_LIMIT}}/{{MAX_SPAWNS_PER_SESSION}}/{{MAX_SUBAGENT_DEPTH}}
`, 'utf-8')
  await fs.writeFile(join(templateDir, 'agents', 'ccg-frontend-builder.md'), options.badAgent
    ? `legacy codeagent-wrapper residue
`
    : `# Frontend Builder
Frontend: {{FRONTEND_MODEL}}
Project: {{PI_PROJECT_DIR}}
`, 'utf-8')
  await fs.writeFile(join(templateDir, 'agents', 'ccg-test-runner.md'), `# Test Runner
Review: {{REVIEW_MODEL}}
`, 'utf-8')
  await fs.writeFile(join(templateDir, 'agents', 'ccg-reviewer.md'), `# Reviewer
Review: {{REVIEW_MODEL}}
Frontend: {{FRONTEND_MODEL}}
`, 'utf-8')

  await fs.writeFile(join(templateDir, 'chains', 'ccg-plan.chain.md'), `# Plan Chain
Pi home: {{PI_AGENT_HOME}}
Project dir: {{PI_PROJECT_DIR}}
`, 'utf-8')

  for (const promptFile of CCG_PI_MANAGED_PROMPT_NAMES) {
    if (options.omitPrompt === promptFile) continue
    await fs.writeFile(join(templateDir, 'prompts', promptFile), `# ${promptFile}
Frontend={{FRONTEND_MODEL}}
Backend={{BACKEND_MODEL}}
Review={{REVIEW_MODEL}}
`, 'utf-8')
  }

  await fs.writeFile(join(templateDir, 'AGENTS.managed.md'), `Managed by CCG Pi
Home: {{PI_AGENT_HOME}}
Project: {{PI_PROJECT_DIR}}
Dev cap: {{DEV_AGENT_CAP}}
Frontend: {{FRONTEND_MODEL}}
Backend: {{BACKEND_MODEL}}
Review: {{REVIEW_MODEL}}
`, 'utf-8')

  await fs.writeFile(join(templateDir, 'extensions', 'subagent-config.json'), `{
  "globalConcurrencyLimit": {{GLOBAL_CONCURRENCY_LIMIT}},
  "maxSubagentSpawnsPerSession": {{MAX_SPAWNS_PER_SESSION}},
  "maxSubagentDepth": {{MAX_SUBAGENT_DEPTH}},
  "parallel": {
    "concurrency": {{GLOBAL_CONCURRENCY_LIMIT}},
    "maxTasks": {{DEV_AGENT_CAP}}
  }
}
`, 'utf-8')

  await fs.writeFile(join(templateDir, 'project', 'settings.json'), `{
  "ccg": {
    "enabled": true,
    "home": "{{PI_AGENT_HOME}}"
  }
}
`, 'utf-8')

  await fs.writeFile(join(templateDir, 'mcp', 'nocturne.example.json'), `{
  "mcpServers": {
    "nocturne_memory": {
      "command": "npx",
      "args": ["nocturne", "{{PI_PROJECT_DIR}}"]
    }
  }
}
`, 'utf-8')
}

async function collectFiles(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return []

  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath))
    }
    else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

afterEach(async () => {
  if (currentRoot) {
    await fs.remove(currentRoot)
    currentRoot = null
  }
})

describe('installPiWorkflow', () => {
  it('writes user-only agents and does not touch the project directory', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('user-only')

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      installProjectAssets: false,
      force: true,
    })

    expect(result.success).toBe(true)
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-backend-builder.md'))).toBe(true)
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-reviewer.md'))).toBe(true)
    for (const promptFile of CCG_PI_MANAGED_PROMPT_NAMES) {
      expect(await fs.pathExists(join(piHome, 'prompts', promptFile))).toBe(true)
    }
    expect(await fs.pathExists(projectDir)).toBe(false)
  })

  it('writes project chains, prompts, settings, and MCP example in user+project scope', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('user-project')

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      installProjectAssets: true,
      force: true,
    })

    expect(result.success).toBe(true)
    expect(await fs.pathExists(join(projectDir, '.pi', 'chains', 'ccg-plan.chain.md'))).toBe(true)
    for (const promptFile of CCG_PI_MANAGED_PROMPT_NAMES) {
      expect(await fs.pathExists(join(projectDir, '.pi', 'prompts', promptFile))).toBe(true)
    }
    expect(await fs.pathExists(join(projectDir, '.pi', 'settings.json'))).toBe(true)
    expect(await fs.pathExists(join(projectDir, '.pi', 'mcp.json.example'))).toBe(true)
  })

  it('creates and idempotently replaces the managed AGENTS.md block while preserving outside content', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('agents-block')
    const agentsMdPath = join(projectDir, 'AGENTS.md')

    const first = await installPiWorkflow({ piHome, projectDir, templateDir, force: true })
    expect(first.success).toBe(true)
    const created = await fs.readFile(agentsMdPath, 'utf-8')
    expect(created).toContain(CCG_MANAGED_BLOCK_START)
    expect(created).toContain(CCG_MANAGED_BLOCK_END)

    await fs.writeFile(agentsMdPath, `PREFACE\n${created}SUFFIX\n`, 'utf-8')
    await fs.writeFile(join(templateDir, 'AGENTS.managed.md'), 'Updated block for {{BACKEND_MODEL}}\n', 'utf-8')

    const secondResult = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      force: true,
      backendModel: 'backend-v2',
    })
    expect(secondResult.success).toBe(true)
    const second = await fs.readFile(agentsMdPath, 'utf-8')
    const startIndex = second.indexOf(CCG_MANAGED_BLOCK_START)
    const endIndex = second.indexOf(CCG_MANAGED_BLOCK_END)
    expect(second.slice(0, startIndex)).toBe('PREFACE\n')
    expect(second.slice(endIndex + CCG_MANAGED_BLOCK_END.length)).toBe('\nSUFFIX\n')
    expect(second).toContain('Updated block for backend-v2')
    expect(second).not.toContain('Managed by CCG Pi')

    const thirdResult = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      force: true,
      backendModel: 'backend-v2',
    })
    expect(thirdResult.success).toBe(true)
    expect(await fs.readFile(agentsMdPath, 'utf-8')).toBe(second)
  })

  it('never clobbers an existing project .pi/settings.json', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('project-settings')
    const settingsPath = join(projectDir, '.pi', 'settings.json')
    const existingSettings = { user: { preserved: true }, ccg: { enabled: false } }
    await fs.ensureDir(join(projectDir, '.pi'))
    await fs.writeJson(settingsPath, existingSettings, { spaces: 2 })

    const result = await installPiWorkflow({ piHome, projectDir, templateDir, force: true })

    expect(result.success).toBe(true)
    expect(await fs.readJson(settingsPath)).toEqual(existingSettings)
  })

  it('deep-merges subagent config and preserves unrelated existing keys', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('subagent-merge')
    const configPath = join(piHome, 'extensions', 'subagent', 'config.json')
    await fs.ensureDir(join(configPath, '..'))
    await fs.writeJson(configPath, {
      unrelatedTopLevel: 'keep',
      parallel: {
        mode: 'keep',
        concurrency: 99,
        maxTasks: 99,
      },
    }, { spaces: 2 })

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      caps: {
        devAgentCap: 2,
        globalConcurrencyLimit: 3,
        maxSpawnsPerSession: 12,
        maxSubagentDepth: 2,
      },
      force: true,
    })

    expect(result.success).toBe(true)
    expect(await fs.readJson(configPath)).toEqual({
      unrelatedTopLevel: 'keep',
      globalConcurrencyLimit: 3,
      maxSubagentSpawnsPerSession: 12,
      maxSubagentDepth: 2,
      parallel: {
        mode: 'keep',
        concurrency: 3,
        maxTasks: 2,
      },
    })
  })

  it('writes model overrides only for agents whose model was supplied', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('overrides')

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      backendModel: 'backend-model',
      reviewModel: 'review-model',
      force: true,
    })

    expect(result.success).toBe(true)
    const settings = await fs.readJson(join(piHome, 'settings.json'))
    const overrides = settings.subagents.agentOverrides
    expect(Object.keys(overrides).sort()).toEqual([
      'ccg-backend-builder',
      'ccg-reviewer',
      'ccg-test-runner',
    ])
    expect(overrides['ccg-backend-builder']).toEqual({ model: 'backend-model' })
    expect(overrides['ccg-reviewer']).toEqual({ model: 'review-model' })
    expect(overrides['ccg-test-runner']).toEqual({ model: 'review-model' })
    expect(overrides['ccg-frontend-builder']).toBeUndefined()
    expect(overrides['ccg-miniprogram-builder']).toBeUndefined()
    expect(overrides['ccg-project-scout']).toBeUndefined()
    expect(overrides['ccg-planner']).toBeUndefined()
  })

  it('writes role-group thinking overrides while preserving user fields', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('thinking-overrides')
    await fs.ensureDir(piHome)
    await fs.writeJson(join(piHome, 'settings.json'), {
      userSetting: true,
      subagents: {
        agentOverrides: {
          'ccg-backend-builder': { fallbackModels: ['demo/fallback'], tools: ['Read'] },
          'user-agent': { disabled: false },
        },
      },
    })

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
      planningThinking: 'medium',
      frontendThinking: 'low',
      backendThinking: 'high',
      reviewThinking: 'xhigh',
      force: true,
    })

    expect(result.success).toBe(true)
    const settings = await fs.readJson(join(piHome, 'settings.json'))
    expect(settings.userSetting).toBe(true)
    expect(settings.subagents.agentOverrides['user-agent']).toEqual({ disabled: false })
    expect(settings.subagents.agentOverrides['ccg-project-scout']).toEqual({ thinking: 'medium' })
    expect(settings.subagents.agentOverrides['ccg-planner']).toEqual({ thinking: 'medium' })
    expect(settings.subagents.agentOverrides['ccg-frontend-builder']).toEqual({ model: 'demo/frontend', thinking: 'low' })
    expect(settings.subagents.agentOverrides['ccg-backend-builder']).toEqual({
      model: 'demo/backend',
      thinking: 'high',
      fallbackModels: ['demo/fallback'],
      tools: ['Read'],
    })
    expect(settings.subagents.agentOverrides['ccg-reviewer']).toEqual({ model: 'demo/review', thinking: 'xhigh' })
    expect(settings.subagents.agentOverrides['ccg-test-runner']).toEqual({ model: 'demo/review', thinking: 'xhigh' })

    const inherited = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
      force: true,
    })

    expect(inherited.success).toBe(true)
    const inheritedSettings = await fs.readJson(join(piHome, 'settings.json'))
    expect(inheritedSettings.subagents.agentOverrides['ccg-project-scout']).toBeUndefined()
    expect(inheritedSettings.subagents.agentOverrides['ccg-planner']).toBeUndefined()
    expect(inheritedSettings.subagents.agentOverrides['ccg-frontend-builder']).toEqual({ model: 'demo/frontend' })
    expect(inheritedSettings.subagents.agentOverrides['ccg-backend-builder']).toEqual({
      model: 'demo/backend',
      fallbackModels: ['demo/fallback'],
      tools: ['Read'],
    })
    expect(inheritedSettings.subagents.agentOverrides['ccg-reviewer']).toEqual({ model: 'demo/review' })
    expect(inheritedSettings.subagents.agentOverrides['ccg-test-runner']).toEqual({ model: 'demo/review' })
    expect(inheritedSettings.subagents.agentOverrides['user-agent']).toEqual({ disabled: false })
  })

  it('appends new providers, skips conflicts, and reports managed files', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('providers')
    const modelsPath = join(piHome, 'models.json')
    await fs.ensureDir(piHome)
    await fs.writeJson(modelsPath, {
      unrelated: 'keep',
      providers: {
        existing: {
          api: 'openai-completions',
          baseUrl: 'https://existing.example/v1',
          models: [{ id: 'existing-model' }],
        },
      },
    }, { spaces: 2 })

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      installProjectAssets: true,
      providers: {
        existing: {
          api: 'openai-completions',
          baseUrl: 'https://replacement.example/v1',
          models: [{ id: 'replacement-model' }],
        },
        added: {
          api: 'openai-completions',
          baseUrl: 'https://added.example/v1',
          models: [{ id: 'added-model' }],
        },
      },
      force: false,
    })

    expect(result.success).toBe(true)
    expect(result.addedProviders).toEqual(['added'])
    expect(result.skippedProviders).toEqual(['existing'])
    const models = await fs.readJson(modelsPath)
    expect(models.unrelated).toBe('keep')
    expect(models.providers.existing.baseUrl).toBe('https://existing.example/v1')
    expect(models.providers.added.baseUrl).toBe('https://added.example/v1')
    expect(result.managedFiles?.some(entry => entry.path === modelsPath && entry.kind === 'merged')).toBe(true)
    expect(result.managedFiles?.some(entry => entry.path === join(projectDir, 'AGENTS.md') && entry.kind === 'block')).toBe(true)
  })

  it('rejects templates containing legacy forbidden tokens without writing them', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('forbidden', { badAgent: true })

    const result = await installPiWorkflow({ piHome, projectDir, templateDir, force: true })

    expect(result.success).toBe(false)
    expect(result.errors.some(error => error.includes('codeagent-wrapper'))).toBe(true)
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-frontend-builder.md'))).toBe(false)
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-backend-builder.md'))).toBe(true)
  })

  it('fully substitutes Pi template variables in every written file', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('variables')

    const result = await installPiWorkflow({
      piHome,
      projectDir,
      templateDir,
      frontendModel: 'front-model',
      backendModel: 'back-model',
      reviewModel: 'review-model',
      caps: {
        devAgentCap: 2,
        globalConcurrencyLimit: 3,
        maxSpawnsPerSession: 9,
        maxSubagentDepth: 1,
      },
      force: true,
    })

    expect(result.success).toBe(true)
    const writtenFiles = [
      ...await collectFiles(piHome),
      ...await collectFiles(projectDir),
    ]
    expect(writtenFiles.length).toBeGreaterThan(0)
    for (const file of writtenFiles) {
      expect(await fs.readFile(file, 'utf-8')).not.toContain('{{')
    }
  })

  it('records missing template errors while continuing to process other files', async () => {
    const { piHome, projectDir, templateDir } = await createSandbox('missing-source', { omitPrompt: 'ccg-board.md' })

    const result = await installPiWorkflow({ piHome, projectDir, templateDir, force: true })

    expect(result.success).toBe(false)
    expect(result.errors.some(error => error.includes('prompts/ccg-board.md'))).toBe(true)
    expect(await fs.pathExists(join(piHome, 'agents', 'ccg-backend-builder.md'))).toBe(true)
    expect(await fs.pathExists(join(projectDir, '.pi', 'chains', 'ccg-plan.chain.md'))).toBe(true)
    expect(await fs.pathExists(join(projectDir, '.pi', 'prompts', 'ccg-board.md'))).toBe(false)
    expect(await fs.pathExists(join(projectDir, '.pi', 'prompts', 'ccg.md'))).toBe(true)
  })
})
