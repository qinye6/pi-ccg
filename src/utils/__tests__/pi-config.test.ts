import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import {
  appendPiProviders,
  assessPiThinkingLevel,
  computeEffectiveDevParallelism,
  computeRequiredSpawns,
  inspectPiModels,
  mergePiProviders,
  mergePiSettingsSubagents,
  mergeSubagentExtensionConfig,
  parsePiThinkingLevel,
  reconcilePiSettingsSubagents,
  type PiModelsFile,
  type PiSettingsFile,
} from '../pi-config'

const tempRoots: string[] = []

function tempRoot(name: string): string {
  const dir = join(tmpdir(), `ccg-pi-config-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  tempRoots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempRoots.map(dir => fs.remove(dir)))
})

describe('Pi thinking levels', () => {
  it('parses the supported provider-neutral levels and rejects unknown values', () => {
    for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(parsePiThinkingLevel(level)).toBe(level)
    }
    expect(parsePiThinkingLevel(undefined)).toBeUndefined()
    expect(() => parsePiThinkingLevel('HIGH', '--review-thinking')).toThrow(
      'Invalid --review-thinking level: HIGH',
    )
  })

  it('uses exact model metadata without guessing unknown capabilities', () => {
    expect(assessPiThinkingLevel(undefined, 'high').status).toBe('unknown')
    expect(assessPiThinkingLevel({ id: 'plain', reasoning: false }, 'off').status).toBe('supported')
    expect(assessPiThinkingLevel({ id: 'plain', reasoning: false }, 'high').status).toBe('unsupported')
    expect(assessPiThinkingLevel({ id: 'mapped', reasoning: true, thinkingLevelMap: { off: null } }, 'off').status).toBe('unsupported')
    expect(assessPiThinkingLevel({ id: 'mapped', reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' } }, 'xhigh').status).toBe('supported')
    expect(assessPiThinkingLevel({ id: 'mapped', reasoning: true }, 'xhigh').status).toBe('supported')
    expect(assessPiThinkingLevel({ id: 'mapped', reasoning: true }, 'max').status).toBe('unsupported')
  })
})

describe('mergePiSettingsSubagents', () => {
  it('merges only subagents and keeps existing override fields idempotently', async () => {
    const settingsPath = join(tempRoot('settings-merge'), 'settings.json')
    const original: PiSettingsFile = {
      defaultModel: '用户默认模型',
      packages: ['用户包'],
      customTopLevel: { enabled: true },
      subagents: {
        defaultModel: 'legacy-default',
        agentOverrides: {
          'ccg-backend-builder': {
            model: 'codex',
            tools: ['Read'],
            inheritSkills: true,
          },
          'user-agent': {
            disabled: false,
          },
        },
      },
    }
    await fs.ensureDir(join(settingsPath, '..'))
    await fs.writeJson(settingsPath, original, { spaces: 2 })

    const first = await mergePiSettingsSubagents({
      defaultModel: 'GPT-5.6-Sol',
      agentOverrides: {
        'ccg-backend-builder': {
          model: 'GPT-5.6-Sol',
          fallbackModels: ['GPT-5.6-Mini'],
        },
        'ccg-reviewer': {
          model: 'GPT-5.6-Review',
          acceptanceRole: 'reviewer',
        },
      },
    }, settingsPath)

    expect(first).toEqual({ changed: true, backupPath: `${settingsPath}.ccg-bak` })
    expect(await fs.readJson(`${settingsPath}.ccg-bak`)).toEqual(original)

    const merged = await fs.readJson(settingsPath) as PiSettingsFile
    expect(merged.defaultModel).toBe('用户默认模型')
    expect(merged.packages).toEqual(['用户包'])
    expect(merged.customTopLevel).toEqual({ enabled: true })
    expect(merged.subagents?.defaultModel).toBe('GPT-5.6-Sol')
    expect(merged.subagents?.agentOverrides?.['ccg-backend-builder']).toEqual({
      model: 'GPT-5.6-Sol',
      tools: ['Read'],
      inheritSkills: true,
      fallbackModels: ['GPT-5.6-Mini'],
    })
    expect(merged.subagents?.agentOverrides?.['user-agent']).toEqual({ disabled: false })
    expect(merged.subagents?.agentOverrides?.['ccg-reviewer']).toEqual({
      model: 'GPT-5.6-Review',
      acceptanceRole: 'reviewer',
    })

    const second = await mergePiSettingsSubagents({
      defaultModel: 'GPT-5.6-Sol',
      agentOverrides: {
        'ccg-backend-builder': {
          model: 'GPT-5.6-Sol',
          fallbackModels: ['GPT-5.6-Mini'],
        },
        'ccg-reviewer': {
          model: 'GPT-5.6-Review',
          acceptanceRole: 'reviewer',
        },
      },
    }, settingsPath)

    expect(second).toEqual({ changed: false, backupPath: null })
    const files = await fs.readdir(join(settingsPath, '..'))
    expect(files.filter(file => file.endsWith('.ccg-bak'))).toEqual(['settings.json.ccg-bak'])
  })

  it('creates missing settings file without backup', async () => {
    const settingsPath = join(tempRoot('settings-create'), 'settings.json')

    const result = await mergePiSettingsSubagents({
      defaultModel: 'GPT-5.6-Sol',
      agentOverrides: {
        'ccg-backend-builder': { model: 'GPT-5.6-Sol' },
      },
    }, settingsPath)

    expect(result).toEqual({ changed: true, backupPath: null })
    expect(await fs.pathExists(`${settingsPath}.ccg-bak`)).toBe(false)
    expect(await fs.readJson(settingsPath)).toEqual({
      subagents: {
        defaultModel: 'GPT-5.6-Sol',
        agentOverrides: {
          'ccg-backend-builder': { model: 'GPT-5.6-Sol' },
        },
      },
    })
  })
})

describe('reconcilePiSettingsSubagents', () => {
  it('merges active overrides, removes retired overrides, preserves unrelated settings, and is idempotent', async () => {
    const settingsPath = join(tempRoot('settings-reconcile'), 'settings.json')
    const original: PiSettingsFile = {
      userTopLevel: true,
      subagents: {
        defaultModel: 'demo/default',
        agentOverrides: {
          'ccg-backend-builder': {
            model: 'old/backend',
            tools: ['Read'],
          },
          'ccg-miniprogram-builder': {
            model: 'old/frontend',
            tools: ['Edit'],
          },
          'user-agent': {
            disabled: false,
          },
        },
      },
    }
    await fs.ensureDir(join(settingsPath, '..'))
    await fs.writeJson(settingsPath, original, { spaces: 2 })

    const activePatch = {
      agentOverrides: {
        'ccg-backend-builder': { model: 'new/backend' },
        'ccg-frontend-builder': { model: 'new/frontend' },
        'ccg-reviewer': { model: 'new/review' },
        'ccg-test-runner': { model: 'new/review' },
      },
    }

    const first = await reconcilePiSettingsSubagents(
      activePatch,
      ['ccg-miniprogram-builder'],
      settingsPath,
    )

    expect(first).toEqual({ changed: true, backupPath: `${settingsPath}.ccg-bak` })
    expect(await fs.readJson(`${settingsPath}.ccg-bak`)).toEqual(original)

    const reconciled = await fs.readJson(settingsPath) as PiSettingsFile
    expect(reconciled.userTopLevel).toBe(true)
    expect(reconciled.subagents?.defaultModel).toBe('demo/default')
    expect(reconciled.subagents?.agentOverrides?.['user-agent']).toEqual({ disabled: false })
    expect(reconciled.subagents?.agentOverrides?.['ccg-backend-builder']).toEqual({
      model: 'new/backend',
      tools: ['Read'],
    })
    expect(reconciled.subagents?.agentOverrides?.['ccg-frontend-builder']).toEqual({ model: 'new/frontend' })
    expect(reconciled.subagents?.agentOverrides?.['ccg-reviewer']).toEqual({ model: 'new/review' })
    expect(reconciled.subagents?.agentOverrides?.['ccg-test-runner']).toEqual({ model: 'new/review' })
    expect(reconciled.subagents?.agentOverrides?.['ccg-miniprogram-builder']).toBeUndefined()
    expect(reconciled.subagents?.agentOverrides?.['ccg-project-scout']).toBeUndefined()
    expect(reconciled.subagents?.agentOverrides?.['ccg-planner']).toBeUndefined()

    const second = await reconcilePiSettingsSubagents(
      activePatch,
      ['ccg-miniprogram-builder'],
      settingsPath,
    )

    expect(second).toEqual({ changed: false, backupPath: null })
    const files = await fs.readdir(join(settingsPath, '..'))
    expect(files.filter(file => file.endsWith('.ccg-bak'))).toEqual(['settings.json.ccg-bak'])
  })
})

describe('Pi models inspection and merge', () => {
  it('distinguishes missing, invalid, and valid files', async () => {
    const root = tempRoot('models-inspection')
    const modelsPath = join(root, 'models.json')
    expect((await inspectPiModels(modelsPath)).status).toBe('missing')

    await fs.ensureDir(root)
    await fs.writeFile(modelsPath, '{ invalid')
    expect((await inspectPiModels(modelsPath)).status).toBe('invalid')

    await fs.writeJson(modelsPath, {
      providers: { demo: { models: [{ id: 'one' }, 'two'] } },
    })
    expect(await inspectPiModels(modelsPath)).toMatchObject({
      status: 'valid',
      providers: ['demo'],
      models: ['demo/one', 'demo/two'],
    })
  })

  it('merges providers and models by exact ID while preserving user fields', async () => {
    const modelsPath = join(tempRoot('models-merge-aware'), 'models.json')
    await fs.ensureDir(join(modelsPath, '..'))
    await fs.writeJson(modelsPath, {
      customTopLevel: true,
      providers: {
        demo: {
          headers: { 'x-user': '$USER_HEADER' },
          models: [
            { id: 'existing', name: 'User name', contextWindow: 1000, custom: true },
            { id: 'sibling', contextWindow: 2000 },
          ],
        },
      },
    })

    const result = await mergePiProviders({
      demo: {
        modelOverrides: { existing: { maxTokens: 500 } },
        models: [{ id: 'existing', maxTokens: 300 }, { id: 'new', contextWindow: 4000 }],
      },
    }, { modelsPath, force: true })

    expect(result).toMatchObject({ changed: true, added: [], updated: ['demo'] })
    expect(result.backupPath).toBe(`${modelsPath}.ccg-bak`)
    const merged = await fs.readJson(modelsPath)
    expect(merged.customTopLevel).toBe(true)
    expect(merged.providers.demo.headers).toEqual({ 'x-user': '$USER_HEADER' })
    expect(merged.providers.demo.models).toEqual([
      { id: 'existing', name: 'User name', contextWindow: 1000, custom: true, maxTokens: 300 },
      { id: 'sibling', contextWindow: 2000 },
      { id: 'new', contextWindow: 4000 },
    ])
    expect(merged.providers.demo.modelOverrides).toEqual({ existing: { maxTokens: 500 } })
  })

  it('deep-merges exact model overrides without dropping pricing or unknown user fields', async () => {
    const modelsPath = join(tempRoot('model-overrides-merge'), 'models.json')
    await fs.ensureDir(join(modelsPath, '..'))
    await fs.writeJson(modelsPath, {
      providers: {
        anthropic: {
          modelOverrides: {
            'claude-sonnet-5': {
              cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
              customPricingSource: 'user-managed',
              compat: { userFlag: true },
            },
          },
        },
      },
    })

    await mergePiProviders({
      anthropic: {
        modelOverrides: {
          'claude-sonnet-5': {
            contextWindow: 1000000,
            maxTokens: 128000,
            compat: { forceAdaptiveThinking: true },
          },
        },
      },
    }, { modelsPath, force: true })

    const merged = await fs.readJson(modelsPath)
    expect(merged.providers.anthropic.modelOverrides['claude-sonnet-5']).toEqual({
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      customPricingSource: 'user-managed',
      contextWindow: 1000000,
      maxTokens: 128000,
      compat: { userFlag: true, forceAdaptiveThinking: true },
    })
  })

  it('refuses to overwrite invalid models JSON', async () => {
    const modelsPath = join(tempRoot('models-invalid'), 'models.json')
    await fs.ensureDir(join(modelsPath, '..'))
    await fs.writeFile(modelsPath, '{ invalid')
    await expect(mergePiProviders({ demo: { models: [{ id: 'one' }] } }, { modelsPath }))
      .rejects.toThrow('Refusing to overwrite invalid models.json')
    expect(await fs.readFile(modelsPath, 'utf8')).toBe('{ invalid')
  })
})

describe('appendPiProviders', () => {
  it('skips same-name providers, adds new providers, and force overwrites with backup', async () => {
    const modelsPath = join(tempRoot('models'), 'models.json')
    const original: PiModelsFile = {
      version: 1,
      providers: {
        qinye: {
          api: 'openai-completions',
          baseUrl: 'https://old.example.com/v1',
          models: ['old-model'],
        },
        custom: {
          api: 'openai-chat-completions',
          baseUrl: 'https://custom.example.com/v1',
          models: [],
        },
      },
    }
    await fs.ensureDir(join(modelsPath, '..'))
    await fs.writeJson(modelsPath, original, { spaces: 2 })

    const appendResult = await appendPiProviders({
      qinye: {
        api: 'openai-completions',
        baseUrl: 'https://new.example.com/v1',
        models: ['new-model'],
      },
      ccg: {
        api: 'openai-completions',
        baseUrl: 'https://ccg.example.com/v1',
        models: ['GPT-5.6-Sol'],
      },
    }, { modelsPath })

    expect(appendResult).toEqual({ added: ['ccg'], skipped: ['qinye'] })
    const appended = await fs.readJson(modelsPath) as PiModelsFile
    expect(appended.version).toBe(1)
    expect(appended.providers?.qinye).toEqual(original.providers?.qinye)
    expect(appended.providers?.custom).toEqual(original.providers?.custom)
    expect(appended.providers?.ccg).toEqual({
      api: 'openai-completions',
      baseUrl: 'https://ccg.example.com/v1',
      models: ['GPT-5.6-Sol'],
    })
    expect(await fs.pathExists(`${modelsPath}.ccg-bak`)).toBe(false)

    const forceResult = await appendPiProviders({
      qinye: {
        api: 'openai-completions',
        baseUrl: 'https://forced.example.com/v1',
        apiKey: '[密钥]',
        models: ['forced-model'],
      },
    }, { force: true, modelsPath })

    expect(forceResult).toEqual({ added: ['qinye'], skipped: [] })
    expect((await fs.readJson(`${modelsPath}.ccg-bak`) as PiModelsFile).providers?.qinye).toEqual(original.providers?.qinye)
    const forced = await fs.readJson(modelsPath) as PiModelsFile
    expect(forced.providers?.qinye).toEqual({
      api: 'openai-completions',
      baseUrl: 'https://forced.example.com/v1',
      apiKey: '[密钥]',
      models: ['forced-model'],
    })
    expect(forced.providers?.custom).toEqual(original.providers?.custom)
    expect(forced.providers?.ccg).toEqual(appended.providers?.ccg)
  })
})

describe('mergeSubagentExtensionConfig', () => {
  it('writes default caps and parallel limits', async () => {
    const configPath = join(tempRoot('ext-defaults'), 'config.json')

    const config = await mergeSubagentExtensionConfig({}, configPath)

    expect(config.globalConcurrencyLimit).toBe(4)
    expect(config.maxSubagentSpawnsPerSession).toBe(24)
    expect(config.maxSubagentDepth).toBe(1)
    expect(config.parallel).toEqual({ concurrency: 4, maxTasks: 4 })
    expect(await fs.readJson(configPath)).toEqual(config)
  })

  it('applies user caps and preserves unknown fields', async () => {
    const configPath = join(tempRoot('ext-overrides'), 'config.json')
    await fs.ensureDir(join(configPath, '..'))
    await fs.writeJson(configPath, {
      unknownTopLevel: '保留',
      parallel: {
        mode: '保留',
        concurrency: 9,
        maxTasks: 9,
      },
    }, { spaces: 2 })

    const config = await mergeSubagentExtensionConfig({
      devAgentCap: 2,
      globalConcurrencyLimit: 3,
      maxSpawnsPerSession: 12,
      maxSubagentDepth: 2,
    }, configPath)

    expect(config).toEqual({
      unknownTopLevel: '保留',
      globalConcurrencyLimit: 3,
      maxSubagentSpawnsPerSession: 12,
      maxSubagentDepth: 2,
      parallel: {
        mode: '保留',
        concurrency: 3,
        maxTasks: 2,
      },
    })
  })
})

describe('atomic Pi JSON writes', () => {
  it('commits complete JSON files without leaving same-directory temp files', async () => {
    const root = tempRoot('atomic-writes')
    const settingsPath = join(root, 'settings.json')
    const modelsPath = join(root, 'models.json')
    const configPath = join(root, 'subagent-config.json')

    await mergePiSettingsSubagents({
      agentOverrides: { 'ccg-backend-builder': { model: 'demo/backend' } },
    }, settingsPath)
    await appendPiProviders({
      demo: {
        api: 'openai-completions',
        baseUrl: 'https://example.invalid/v1',
        models: ['demo-model'],
      },
    }, { modelsPath })
    await mergeSubagentExtensionConfig({}, configPath)

    expect(await fs.readJson(settingsPath)).toBeTruthy()
    expect(await fs.readJson(modelsPath)).toBeTruthy()
    expect(await fs.readJson(configPath)).toBeTruthy()
    expect((await fs.readdir(root)).filter(file => file.endsWith('.ccg-tmp'))).toEqual([])
  })
})

describe('Pi parallelism formulas', () => {
  it('defaults allow a four-builder wave within max spawns 24', () => {
    const effective = computeEffectiveDevParallelism({
      devAgentCap: 4,
      globalConcurrencyLimit: 4,
      parallelConcurrency: 4,
      parallelMaxTasks: 4,
    })

    expect(effective).toBe(4)
    expect(computeRequiredSpawns(4)).toBe(8)
    expect(computeRequiredSpawns(4)).toBeLessThanOrEqual(24)
  })

  it('required spawn budget uses actual builder count, not effective concurrency', () => {
    expect(computeRequiredSpawns(0)).toBe(4)
    expect(computeRequiredSpawns(1)).toBe(5)
    expect(computeRequiredSpawns(7)).toBe(11)
  })

  it('effective parallelism picks the smallest cap', () => {
    expect(computeEffectiveDevParallelism({
      devAgentCap: 8,
      globalConcurrencyLimit: 6,
      parallelConcurrency: 3,
      parallelMaxTasks: 5,
    })).toBe(3)
  })
})
