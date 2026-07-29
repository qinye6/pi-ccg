import type { PiModelConfig, PiProvider } from './pi-config'

export interface PiProviderModelPreset {
  providerId: string
  model: PiModelConfig
  sourceUrl: string
  verifiedAt: string
}

const verifiedAt = '2026-07-29'
const sourceUrl = 'https://github.com/earendil-works/pi/tree/main/packages/ai/src/models/data'

export const PI_PROVIDER_MODEL_PRESETS = [
  {
    providerId: 'anthropic',
    model: {
      id: 'claude-sonnet-5', name: 'Claude Sonnet 5', reasoning: true, input: ['text', 'image'],
      contextWindow: 1000000, maxTokens: 128000,
      thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
      compat: { forceAdaptiveThinking: true },
    },
    sourceUrl,
    verifiedAt,
  },
  {
    providerId: 'anthropic',
    model: {
      id: 'claude-fable-5', name: 'Claude Fable 5', reasoning: true, input: ['text', 'image'],
      contextWindow: 1000000, maxTokens: 128000,
      thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
      compat: { forceAdaptiveThinking: true },
    },
    sourceUrl,
    verifiedAt,
  },
  {
    providerId: 'anthropic',
    model: {
      id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', reasoning: true, input: ['text', 'image'],
      contextWindow: 200000, maxTokens: 64000,
    },
    sourceUrl,
    verifiedAt,
  },
  ...['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].map(id => ({
    providerId: 'openai',
    model: {
      id, name: id.replace('gpt-', 'GPT ').replaceAll('-', ' '), reasoning: true, input: ['text', 'image'] as ('text' | 'image')[],
      contextWindow: 272000, maxTokens: 128000,
      thinkingLevelMap: { off: 'none', xhigh: 'xhigh', max: 'max' },
      compat: { supportsToolSearch: true },
    },
    sourceUrl,
    verifiedAt,
  })),
  {
    providerId: 'google',
    model: {
      id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', reasoning: true, input: ['text', 'image'],
      contextWindow: 1048576, maxTokens: 65536,
      thinkingLevelMap: { off: null },
    },
    sourceUrl,
    verifiedAt,
  },
] as const satisfies readonly PiProviderModelPreset[]

export function findPiProviderModelPreset(providerId: string, modelId: string): PiProviderModelPreset | undefined {
  return PI_PROVIDER_MODEL_PRESETS.find(preset => preset.providerId === providerId && preset.model.id === modelId)
}

export function buildPiProviderPresetOverride(providerId: string, modelId: string): Record<string, PiProvider> | null {
  const preset = findPiProviderModelPreset(providerId, modelId)
  if (!preset) return null
  const { id, ...override } = preset.model
  return {
    [providerId]: {
      modelOverrides: { [id]: override },
    },
  }
}
