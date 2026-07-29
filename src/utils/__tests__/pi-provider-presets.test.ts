import { describe, expect, it } from 'vitest'
import {
  buildPiProviderPresetOverride,
  findPiProviderModelPreset,
  PI_PROVIDER_MODEL_PRESETS,
} from '../pi-provider-presets'

describe('Pi provider presets', () => {
  it('stores exact capability presets with provenance', () => {
    expect(PI_PROVIDER_MODEL_PRESETS.length).toBeGreaterThan(0)
    for (const preset of PI_PROVIDER_MODEL_PRESETS) {
      expect(preset.providerId).toBeTruthy()
      expect(preset.model.id).toBeTruthy()
      expect(preset.model.contextWindow).toBeGreaterThan(0)
      expect(preset.model.maxTokens).toBeGreaterThan(0)
      expect(preset.sourceUrl).toMatch(/^https:\/\//)
      expect(preset.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('never guesses unknown models', () => {
    expect(findPiProviderModelPreset('openai', 'unknown-model')).toBeUndefined()
    expect(buildPiProviderPresetOverride('openai', 'unknown-model')).toBeNull()
  })

  it('builds modelOverrides for built-in providers', () => {
    expect(buildPiProviderPresetOverride('anthropic', 'claude-sonnet-5')).toEqual({
      anthropic: {
        modelOverrides: {
          'claude-sonnet-5': expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
        },
      },
    })
  })
})
