import type { CcgInstallerMetadata } from '../../types'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import { style } from '../../commands/style'
import { installPiWorkflow } from '../installer'
import { PACKAGE_ROOT } from '../installer-template'
import {
  DEFAULT_CCG_PERSONA_INSTRUCTIONS,
  PI_PERSONA_IDS,
  getPiPersonaTemplatePath,
  isPiPersonaId,
  normalizeCcgPersonaMetadata,
  normalizePiPersonaId,
  readPiPersonaInstructions,
} from '../pi-personas'
import {
  CCG_PI_LEADER_PROMPT_NAMES,
  CCG_PI_MANAGED_PROMPT_NAMES,
  DEFAULT_PI_CAPS,
} from '../pi-paths'

const roots = new Set<string>()

function sandbox(name: string): { root: string, piHome: string, projectDir: string } {
  const root = join(tmpdir(), `ccg-persona-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  roots.add(root)
  return {
    root,
    piHome: join(root, 'pi-home'),
    projectDir: join(root, 'project'),
  }
}

async function writeMetadata(
  piHome: string,
  input: Pick<CcgInstallerMetadata, 'scope' | 'managedFiles'> & {
    persona?: CcgInstallerMetadata['lastChoices']['persona']
  },
): Promise<void> {
  const now = new Date().toISOString()
  await fs.ensureDir(piHome)
  await fs.writeJson(join(piHome, 'ccg-workflow.json'), {
    version: '3.2.7',
    language: 'en',
    createdAt: now,
    updatedAt: now,
    scope: input.scope,
    lastChoices: {
      persona: input.persona,
      caps: DEFAULT_PI_CAPS,
    },
    extensions: [],
    managedFiles: input.managedFiles,
  } satisfies CcgInstallerMetadata, { spaces: 2 })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([...roots].map(root => fs.remove(root)))
  roots.clear()
})

describe('Pi persona catalog', () => {
  it('exposes the exact stable allowlist and rejects untrusted IDs', () => {
    expect(PI_PERSONA_IDS).toEqual([
      'default',
      'engineer-professional',
      'nekomata-engineer',
      'laowang-engineer',
      'ojousama-engineer',
      'abyss-cultivator',
      'abyss-concise',
      'abyss-command',
      'abyss-ritual',
    ])
    expect(isPiPersonaId('nekomata-engineer')).toBe(true)
    expect(isPiPersonaId('../nekomata-engineer')).toBe(false)
    expect(isPiPersonaId(' nekomata-engineer ')).toBe(false)
    expect(normalizePiPersonaId('../../outside')).toBe('default')
    expect(getPiPersonaTemplatePath('/templates/pi', '../../outside'))
      .toBe('/templates/pi/personas/default.md')
  })

  it('normalizes partial and corrupted metadata to default', () => {
    expect(normalizeCcgPersonaMetadata(null)).toBe('default')
    expect(normalizeCcgPersonaMetadata({ lastChoices: {} })).toBe('default')
    expect(normalizeCcgPersonaMetadata({ lastChoices: { persona: 'abyss-command' } })).toBe('abyss-command')
    expect(normalizeCcgPersonaMetadata({ lastChoices: { persona: '../escape' } })).toBe('default')
  })

  it('uses the embedded default fallback but reports a missing selected template', async () => {
    const { root } = sandbox('missing-template')
    await expect(readPiPersonaInstructions(root, 'default'))
      .resolves.toBe(DEFAULT_CCG_PERSONA_INSTRUCTIONS)
    await expect(readPiPersonaInstructions(root, 'nekomata-engineer'))
      .rejects.toThrow('Pi persona template not found')
  })
})

describe('Pi leader persona rendering', () => {
  it('injects persona prose only into /ccg and /ccg-go', async () => {
    const { piHome, projectDir } = sandbox('leader-only')
    const result = await installPiWorkflow({
      piHome,
      projectDir,
      installProjectAssets: false,
      persona: 'nekomata-engineer',
      force: true,
    })

    expect(result.success).toBe(true)
    for (const promptFile of CCG_PI_MANAGED_PROMPT_NAMES) {
      const content = await fs.readFile(join(piHome, 'prompts', promptFile), 'utf-8')
      if (CCG_PI_LEADER_PROMPT_NAMES.includes(promptFile as typeof CCG_PI_LEADER_PROMPT_NAMES[number])) {
        expect(content).toContain('warm, lightly playful catlike tone')
      }
      else {
        expect(content).not.toContain('warm, lightly playful catlike tone')
      }
      expect(content).not.toContain('{{CCG_PERSONA_INSTRUCTIONS}}')
    }

    const chain = await fs.readFile(join(piHome, 'chains', 'ccg-plan.chain.md'), 'utf-8')
    const agent = await fs.readFile(join(piHome, 'agents', 'ccg-frontend-builder.md'), 'utf-8')
    expect(chain).not.toContain('catlike tone')
    expect(agent).not.toContain('catlike tone')
  })

  it('switches only managed leader prompts and restores the neutral default', async () => {
    const { piHome, projectDir } = sandbox('style-switch')
    const installed = await installPiWorkflow({
      piHome,
      projectDir,
      installProjectAssets: false,
      persona: 'nekomata-engineer',
      force: true,
    })
    expect(installed.success).toBe(true)
    await writeMetadata(piHome, {
      scope: 'user',
      persona: 'nekomata-engineer',
      managedFiles: installed.managedFiles ?? [],
    })

    const systemPath = join(piHome, 'SYSTEM.md')
    const appendPath = join(piHome, 'APPEND_SYSTEM.md')
    await fs.writeFile(systemPath, 'user system content', 'utf-8')
    await fs.writeFile(appendPath, 'user append content', 'utf-8')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await style('default', { installDir: piHome, projectDir })

    for (const promptFile of CCG_PI_LEADER_PROMPT_NAMES) {
      const content = await fs.readFile(join(piHome, 'prompts', promptFile), 'utf-8')
      expect(content).toContain('clear, calm, constructive voice')
      expect(content).not.toContain('catlike tone')
    }
    expect(await fs.readFile(systemPath, 'utf-8')).toBe('user system content')
    expect(await fs.readFile(appendPath, 'utf-8')).toBe('user append content')
    expect((await fs.readJson(join(piHome, 'ccg-workflow.json'))).lastChoices.persona).toBe('default')
  })

  it('refuses to overwrite user prompts that only imitate the command name', async () => {
    const { piHome, projectDir } = sandbox('ownership-refusal')
    const promptDir = join(piHome, 'prompts')
    await fs.ensureDir(promptDir)
    for (const promptFile of CCG_PI_LEADER_PROMPT_NAMES) {
      const name = promptFile.replace(/\.md$/, '')
      await fs.writeFile(join(promptDir, promptFile), `---\nname: ${name}\n---\nuser-owned prompt\n`, 'utf-8')
    }
    await writeMetadata(piHome, {
      scope: 'user',
      persona: 'default',
      managedFiles: [],
    })

    await expect(style('abyss-command', { installDir: piHome, projectDir }))
      .rejects.toThrow('not recognized as CCG-managed')
    expect(await fs.readFile(join(promptDir, 'ccg.md'), 'utf-8')).toContain('user-owned prompt')
  })

  it('ships every persona template inside the Pi package surface', async () => {
    for (const id of PI_PERSONA_IDS) {
      const path = getPiPersonaTemplatePath(join(PACKAGE_ROOT, 'templates', 'pi'), id)
      expect(await fs.pathExists(path), id).toBe(true)
      expect(await fs.readFile(path, 'utf-8'), id).toContain('## Leader persona')
    }
  })
})
