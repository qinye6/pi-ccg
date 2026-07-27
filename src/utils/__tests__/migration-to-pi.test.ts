import type { CcgConfig } from '../../types'
import { describe, expect, it } from 'vitest'
import { readLegacyClaudeConfigForMigration, translateLegacyClaudeConfig } from '../migration'

describe('translateLegacyClaudeConfig', () => {
  it('produces backend, frontend, and reviewer overrides with model mapping', () => {
    const legacy = {
      routing: {
        frontend: {
          models: ['gemini'],
          primary: 'gemini',
          strategy: 'parallel',
        },
        backend: {
          models: ['codex'],
          primary: 'codex',
          strategy: 'parallel',
        },
        review: {
          models: ['grok', 'antigravity'],
          strategy: 'parallel',
        },
        mode: 'smart',
      },
    } as CcgConfig

    expect(translateLegacyClaudeConfig(legacy, {
      codex: 'GPT-5.6-Sol',
      gemini: 'GPT-5.6-Frontend',
      grok: 'GPT-5.6-Review',
    })).toEqual({
      agentOverrides: {
        'ccg-backend-builder': { model: 'GPT-5.6-Sol' },
        'ccg-frontend-builder': { model: 'GPT-5.6-Frontend' },
        'ccg-reviewer': { model: 'GPT-5.6-Review' },
      },
    })
  })

  it('falls back reviewer model to backend primary and passes unmapped names through', () => {
    const legacy = {
      routing: {
        backend: {
          models: ['antigravity'],
          primary: 'antigravity',
          strategy: 'parallel',
        },
        review: {
          models: [],
          strategy: 'parallel',
        },
        mode: 'smart',
      },
    } as unknown as CcgConfig

    expect(translateLegacyClaudeConfig(legacy)).toEqual({
      agentOverrides: {
        'ccg-backend-builder': { model: 'antigravity' },
        'ccg-reviewer': { model: 'antigravity' },
      },
    })
  })

  it('returns empty settings when routing has no migratable primary models', () => {
    const legacy = { routing: {} } as CcgConfig

    expect(translateLegacyClaudeConfig(legacy)).toEqual({})
  })
})

describe('readLegacyClaudeConfigForMigration', () => {
  it('returns CcgConfig or null without throwing when legacy path is absent or unreadable', async () => {
    const result = await readLegacyClaudeConfigForMigration()

    expect(result === null || typeof result === 'object').toBe(true)
  })
})
