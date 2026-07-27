import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'pathe'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { assertNoLegacyResidue, injectPiTemplateVariables } from '../installer-template'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PI_TEMPLATES = join(PACKAGE_ROOT, 'templates', 'pi')
const EXPECTED_PI_ASSETS = [
  'AGENTS.managed.md',
  'agents/ccg-backend-builder.md',
  'agents/ccg-frontend-builder.md',
  'agents/ccg-miniprogram-builder.md',
  'agents/ccg-planner.md',
  'agents/ccg-project-scout.md',
  'agents/ccg-reviewer.md',
  'agents/ccg-test-runner.md',
  'chains/ccg-plan.chain.md',
  'extensions/subagent-config.json',
  'mcp/nocturne.example.json',
  'project/settings.json',
  'prompts/ccg-go.md',
]

function collectFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

describe('Pi npm package contract', () => {
  it('publishes only the CLI, dist output, and Pi runtime templates', async () => {
    const manifest = await fs.readJson(join(PACKAGE_ROOT, 'package.json'))

    expect(manifest.files).toEqual([
      'bin/ccg.mjs',
      'dist',
      'templates/pi/',
    ])
    expect(manifest.name).toBe('pi-ccg')
    expect(manifest.version).toBe('3.2.4')
    expect(manifest.bin).toEqual({
      'pi-ccg': 'bin/ccg.mjs',
      'ccg': 'bin/ccg.mjs',
    })
    expect(manifest.publishConfig).toEqual({ access: 'public' })
    expect(manifest.description).toContain('Pi CLI')
    expect(manifest.keywords).toContain('pi-cli')
    expect(manifest.keywords).toContain('subagents')
    expect(manifest.keywords).not.toContain('codex')
    expect(manifest.keywords).not.toContain('gemini')
  })

  it('contains the exact Pi runtime asset set required by the installer', () => {
    const assets = collectFiles(PI_TEMPLATES)
      .map(file => relative(PI_TEMPLATES, file))
      .sort()

    expect(assets).toEqual([...EXPECTED_PI_ASSETS].sort())
  })

  it('renders every Pi template without legacy tokens or unresolved CCG variables', () => {
    for (const file of collectFiles(PI_TEMPLATES)) {
      const raw = readFileSync(file, 'utf-8')
      const rendered = injectPiTemplateVariables(raw, {
        piAgentHome: '/tmp/pi-agent',
        piProjectDir: '/tmp/project/.pi',
        devAgentCap: 3,
        globalConcurrencyLimit: 4,
        maxSpawnsPerSession: 20,
        maxSubagentDepth: 1,
        frontendModel: 'provider/frontend',
        backendModel: 'provider/backend',
        reviewModel: 'provider/review',
      })
      const unresolved = rendered.match(/\{\{[A-Z_]+\}\}/g) ?? []

      expect(assertNoLegacyResidue(rendered), relative(PACKAGE_ROOT, file)).toEqual([])
      expect(unresolved, relative(PACKAGE_ROOT, file)).toEqual([])
    }
  })

  it('does not expose legacy installer entry points from the package root', () => {
    const indexSource = readFileSync(join(PACKAGE_ROOT, 'src', 'index.ts'), 'utf-8')

    expect(indexSource).not.toMatch(/\binstallWorkflows\b/)
    expect(indexSource).not.toMatch(/\buninstallWorkflows\b/)
  })
})
