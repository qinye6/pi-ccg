import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import {
  appendPiProviders,
  computeEffectiveDevParallelism,
  computeRequiredSpawns,
  mergePiSettingsSubagents,
  mergeSubagentExtensionConfig,
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

describe('Pi parallelism formulas', () => {
  it('defaults produce effective=4 and requiredSpawns=8 within max spawns 24', () => {
    const effective = computeEffectiveDevParallelism({
      devAgentCap: 4,
      globalConcurrencyLimit: 4,
      parallelConcurrency: 4,
      parallelMaxTasks: 4,
    })

    expect(effective).toBe(4)
    expect(computeRequiredSpawns(effective)).toBe(8)
    expect(computeRequiredSpawns(effective)).toBeLessThanOrEqual(24)
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
