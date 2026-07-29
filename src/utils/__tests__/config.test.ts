import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import { dirname } from 'pathe'
import {
  createDefaultConfig,
  createDefaultMetadata,
  createDefaultRouting,
  readCcgMetadata,
  updateCcgMetadata,
  writeCcgMetadata,
} from '../config'
import { getCcgMetadataPath } from '../pi-paths'

const mockHome = vi.hoisted(() => ({
  path: `/tmp/ccg-workflow-config-test-${process.pid}`,
}))

vi.mock('node:os', () => ({
  homedir: () => mockHome.path,
}))

beforeEach(async () => {
  await fs.remove(mockHome.path)
})

afterEach(async () => {
  await fs.remove(mockHome.path)
})

async function metadataTempFiles(): Promise<string[]> {
  const metadataPath = getCcgMetadataPath()
  const metadataDir = dirname(metadataPath)
  if (!(await fs.pathExists(metadataDir))) return []
  return (await fs.readdir(metadataDir))
    .filter(name => name.includes('ccg-workflow.json.') && name.endsWith('.ccg-tmp'))
}

describe('createDefaultRouting', () => {
  it('returns antigravity as frontend primary', () => {
    const routing = createDefaultRouting()
    expect(routing.frontend.primary).toBe('antigravity')
    expect(routing.frontend.models).toEqual(['antigravity'])
  })

  it('returns codex as backend primary', () => {
    const routing = createDefaultRouting()
    expect(routing.backend.primary).toBe('codex')
    expect(routing.backend.models).toEqual(['codex'])
  })

  it('returns both models for review', () => {
    const routing = createDefaultRouting()
    expect(routing.review.models).toEqual(['codex', 'antigravity'])
    expect(routing.review.strategy).toBe('parallel')
  })

  it('defaults to smart mode', () => {
    const routing = createDefaultRouting()
    expect(routing.mode).toBe('smart')
  })
})

describe('createDefaultConfig', () => {
  const baseOptions = {
    language: 'zh-CN' as const,
    routing: createDefaultRouting(),
    installedWorkflows: ['workflow', 'plan'],
  }

  it('sets version from package.json', () => {
    const config = createDefaultConfig(baseOptions)
    // version should be a semver string
    expect(config.general.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('sets language correctly', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.general.language).toBe('zh-CN')
  })

  it('sets createdAt as ISO string', () => {
    const config = createDefaultConfig(baseOptions)
    // Should parse without error
    expect(() => new Date(config.general.createdAt)).not.toThrow()
    expect(new Date(config.general.createdAt).toISOString()).toBe(config.general.createdAt)
  })

  it('stores installed workflows', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.workflows.installed).toEqual(['workflow', 'plan'])
  })

  it('defaults mcpProvider to fast-context', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.mcp.provider).toBe('fast-context')
  })

  it('respects custom mcpProvider', () => {
    const config = createDefaultConfig({ ...baseOptions, mcpProvider: 'contextweaver' })
    expect(config.mcp.provider).toBe('contextweaver')
  })

  it('defaults liteMode to false', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.performance?.liteMode).toBe(false)
  })

  it('respects liteMode = true', () => {
    const config = createDefaultConfig({ ...baseOptions, liteMode: true })
    expect(config.performance?.liteMode).toBe(true)
  })

  it('sets paths with home directory', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.paths.commands).toContain('.claude')
    expect(config.paths.prompts).toContain('.ccg')
    expect(config.paths.backup).toContain('.ccg')
  })

  it('preserves routing config exactly', () => {
    const routing = createDefaultRouting()
    const config = createDefaultConfig({ ...baseOptions, routing })
    expect(config.routing).toEqual(routing)
  })
})

describe('Pi installer metadata', () => {
  it('returns null when metadata file is missing', async () => {
    await expect(readCcgMetadata()).resolves.toBeNull()
  })

  it('writes and reads metadata roundtrip', async () => {
    const meta = createDefaultMetadata({
      language: 'en',
      scope: 'user-project',
      lastChoices: {
        provider: 'openai',
        frontendModel: 'gpt-5-mini',
      },
    })
    meta.managedFiles = [
      { path: '/tmp/AGENTS.md', kind: 'block', backupPath: '/tmp/AGENTS.md.bak' },
    ]

    await writeCcgMetadata(meta)

    expect(await fs.pathExists(getCcgMetadataPath())).toBe(true)
    expect(await metadataTempFiles()).toEqual([])
    await expect(readCcgMetadata()).resolves.toEqual(meta)
  })

  it('creates default metadata with Pi caps and empty managed files', () => {
    const meta = createDefaultMetadata({ language: 'zh-CN' })

    expect(meta.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(meta.language).toBe('zh-CN')
    expect(meta.scope).toBe('user')
    expect(meta.lastChoices.caps).toEqual({
      devAgentCap: 4,
      globalConcurrencyLimit: 4,
      maxSpawnsPerSession: 24,
      maxSubagentDepth: 1,
    })
    expect(meta.extensions).toEqual([])
    expect(meta.managedFiles).toEqual([])
    expect(new Date(meta.createdAt).toISOString()).toBe(meta.createdAt)
    expect(new Date(meta.updatedAt).toISOString()).toBe(meta.updatedAt)
  })

  it('deep-merges lastChoices and bumps updatedAt', async () => {
    const meta = createDefaultMetadata({
      language: 'zh-CN',
      caps: {
        devAgentCap: 2,
      },
      lastChoices: {
        provider: 'anthropic',
        frontendModel: 'claude-sonnet-4',
      },
    })
    meta.updatedAt = '2026-01-01T00:00:00.000Z'
    await writeCcgMetadata(meta)

    const updated = await updateCcgMetadata({
      lastChoices: {
        backendModel: 'gpt-5',
        caps: {
          devAgentCap: 2,
          globalConcurrencyLimit: 4,
          maxSpawnsPerSession: 12,
          maxSubagentDepth: 1,
        },
      },
    })

    expect(await metadataTempFiles()).toEqual([])
    expect(updated.lastChoices).toEqual({
      provider: 'anthropic',
      frontendModel: 'claude-sonnet-4',
      backendModel: 'gpt-5',
      caps: {
        devAgentCap: 2,
        globalConcurrencyLimit: 4,
        maxSpawnsPerSession: 12,
        maxSubagentDepth: 1,
      },
    })
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date('2026-01-01T00:00:00.000Z').getTime(),
    )
  })
})
