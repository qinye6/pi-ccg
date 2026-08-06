import type { StyleOptions } from '../types/cli'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { join } from 'pathe'
import { i18n, initI18n } from '../i18n'
import { readCcgMetadata, updateCcgMetadata } from '../utils/config'
import { renderPiLeaderPersonaPrompts } from '../utils/installer'
import {
  DEFAULT_PI_PERSONA_ID,
  PI_PERSONA_IDS,
  getPiPersonaDefinition,
  isPiPersonaId,
  normalizePiPersonaId,
  type PiPersonaId,
} from '../utils/pi-personas'
import {
  CCG_PI_LEADER_PROMPT_NAMES,
  DEFAULT_PI_CAPS,
  getCcgMetadataPath,
  getPiAgentHome,
  getProjectPiPromptsDir,
} from '../utils/pi-paths'

function personaChoice(id: PiPersonaId): string {
  const definition = getPiPersonaDefinition(id)
  return i18n.language === 'en'
    ? `${definition.labelEn} — ${definition.descriptionEn}`
    : `${definition.labelZh} — ${definition.descriptionZh}`
}

async function selectPersona(current: PiPersonaId): Promise<PiPersonaId> {
  const { persona } = await inquirer.prompt<{ persona: PiPersonaId }>([{
    type: 'list',
    name: 'persona',
    message: i18n.language === 'en' ? 'Select CCG leader style:' : '选择 CCG leader 风格:',
    choices: PI_PERSONA_IDS.map(id => ({ name: personaChoice(id), value: id })),
    default: current,
  }])
  return persona
}

async function assertManagedLeaderPrompts(
  promptDir: string,
  managedPaths: Set<string>,
): Promise<void> {
  for (const promptFile of CCG_PI_LEADER_PROMPT_NAMES) {
    const path = join(promptDir, promptFile)
    if (!(await fs.pathExists(path))) {
      throw new Error(`CCG managed prompt is missing: ${path}; run \`ccg update\` first`)
    }
    if (managedPaths.has(path)) continue

    const content = await fs.readFile(path, 'utf-8')
    const expectedName = promptFile.replace(/\.md$/, '')
    const expectedHeading = promptFile === 'ccg.md'
      ? '# `/ccg` 主控 playbook'
      : '# `/prompt-workflow ccg-go` 主控 playbook'
    const recognized = content.startsWith('---')
      && content.includes(`\nname: ${expectedName}\n`)
      && content.includes(expectedHeading)
      && content.includes('你是唯一 Pi supervisor')
    if (!recognized) {
      throw new Error(`Refusing to overwrite a prompt not recognized as CCG-managed: ${path}`)
    }
  }
}

export async function style(personaArg?: string, options: StyleOptions = {}): Promise<void> {
  const piHome = options.installDir ?? getPiAgentHome()
  const metadataPath = getCcgMetadataPath(piHome)
  const metadata = await readCcgMetadata(metadataPath)
  if (!metadata) throw new Error(`CCG metadata not found: ${metadataPath}; run \`ccg init\` first`)

  await initI18n(metadata.language)
  const requested = personaArg ?? options.persona
  if (requested !== undefined && !isPiPersonaId(requested)) {
    throw new Error(`Unknown persona: ${String(requested)}. Available: ${PI_PERSONA_IDS.join(', ')}`)
  }
  const savedPersona = metadata.lastChoices?.persona
  const current = normalizePiPersonaId(savedPersona)
  const persona = requested === undefined ? await selectPersona(current) : normalizePiPersonaId(requested)
  if (isPiPersonaId(savedPersona) && persona === current) {
    console.log(ansis.gray(`CCG leader style is already set to: ${persona}`))
    return
  }

  const caps = {
    ...DEFAULT_PI_CAPS,
    ...(metadata.lastChoices?.caps ?? {}),
  }
  const projectDir = options.projectDir ?? process.cwd()
  const installProjectAssets = metadata.scope !== 'user'
  const promptDir = installProjectAssets ? getProjectPiPromptsDir(projectDir) : join(piHome, 'prompts')
  const managedPaths = new Set((metadata.managedFiles ?? []).map(entry => entry.path))
  await assertManagedLeaderPrompts(promptDir, managedPaths)

  const result = await renderPiLeaderPersonaPrompts({
    persona,
    piHome,
    projectDir,
    installProjectAssets,
    caps,
    frontendModel: metadata.lastChoices?.frontendModel,
    backendModel: metadata.lastChoices?.backendModel,
    reviewModel: metadata.lastChoices?.reviewModel,
  })
  if (!result.success) throw new Error(result.errors.join('; '))

  const nextManagedFiles = [...(metadata.managedFiles ?? [])]
  for (const entry of result.managedFiles ?? []) {
    if (!nextManagedFiles.some(existing => existing.path === entry.path)) nextManagedFiles.push(entry)
  }
  await updateCcgMetadata({
    lastChoices: { persona, caps },
    managedFiles: nextManagedFiles,
  }, metadataPath)

  const suffix = persona === DEFAULT_PI_PERSONA_ID ? ' (neutral default restored)' : ''
  console.log(ansis.green(`✓ CCG leader style set to: ${persona}${suffix}`))
}
