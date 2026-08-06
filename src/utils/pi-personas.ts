import fs from 'fs-extra'
import { join } from 'pathe'

/** Stable, installable leader persona identifiers. */
export const PI_PERSONA_IDS = [
  'default',
  'engineer-professional',
  'nekomata-engineer',
  'laowang-engineer',
  'ojousama-engineer',
  'abyss-cultivator',
  'abyss-concise',
  'abyss-command',
  'abyss-ritual',
] as const

export const CCG_PERSONA_IDS = PI_PERSONA_IDS
export type PiPersonaId = typeof PI_PERSONA_IDS[number]
export type CcgPersonaId = PiPersonaId
export const DEFAULT_PI_PERSONA_ID: PiPersonaId = 'default'

export interface PiPersonaDefinition {
  readonly id: PiPersonaId
  readonly templateFile: `${PiPersonaId}.md`
  readonly labelZh: string
  readonly labelEn: string
  readonly descriptionZh: string
  readonly descriptionEn: string
}

export type CcgPersonaDefinition = PiPersonaDefinition

export const PI_PERSONA_CATALOG: readonly PiPersonaDefinition[] = [
  { id: 'default', templateFile: 'default.md', labelZh: '默认', labelEn: 'Default', descriptionZh: '中性、清晰的 CCG leader 风格', descriptionEn: 'Neutral, clear CCG leader prose' },
  { id: 'engineer-professional', templateFile: 'engineer-professional.md', labelZh: '专业工程师', labelEn: 'Professional Engineer', descriptionZh: '严谨、结构化、证据优先', descriptionEn: 'Precise, structured, and evidence-led' },
  { id: 'nekomata-engineer', templateFile: 'nekomata-engineer.md', labelZh: '猫娘工程师', labelEn: 'Nekomata Engineer', descriptionZh: '温暖俏皮但保持技术准确', descriptionEn: 'Warm and playful without losing precision' },
  { id: 'laowang-engineer', templateFile: 'laowang-engineer.md', labelZh: '老王工程师', labelEn: 'Laowang Engineer', descriptionZh: '接地气、直接、务实', descriptionEn: 'Plainspoken, direct, and practical' },
  { id: 'ojousama-engineer', templateFile: 'ojousama-engineer.md', labelZh: '大小姐工程师', labelEn: 'Ojousama Engineer', descriptionZh: '优雅、从容、礼貌', descriptionEn: 'Elegant, composed, and courteous' },
  { id: 'abyss-cultivator', templateFile: 'abyss-cultivator.md', labelZh: '深渊邪修', labelEn: 'Abyss Cultivator', descriptionZh: '克制的修行隐喻与工程纪律', descriptionEn: 'Disciplined engineering with restrained cultivation imagery' },
  { id: 'abyss-concise', templateFile: 'abyss-concise.md', labelZh: '冷刃简报', labelEn: 'Abyss Concise', descriptionZh: '先结论，极简证据与下一步', descriptionEn: 'Decision first, minimal evidence and next action' },
  { id: 'abyss-command', templateFile: 'abyss-command.md', labelZh: '铁律军令', labelEn: 'Abyss Command', descriptionZh: '状态、决策、责任人与动作', descriptionEn: 'Status, decision, owner, and action' },
  { id: 'abyss-ritual', templateFile: 'abyss-ritual.md', labelZh: '祭仪长卷', labelEn: 'Abyss Ritual', descriptionZh: '简短仪式感叙事但不遮蔽事实', descriptionEn: 'Brief ceremonial cadence without obscuring facts' },
]

export const CCG_PERSONA_CATALOG = PI_PERSONA_CATALOG
const PERSONA_SET = new Set<string>(PI_PERSONA_IDS)
const PERSONA_BY_ID = new Map(PI_PERSONA_CATALOG.map(definition => [definition.id, definition]))

export function isPiPersonaId(value: unknown): value is PiPersonaId {
  return typeof value === 'string' && PERSONA_SET.has(value)
}

/** Normalize untrusted metadata without ever treating it as a path. */
export function normalizePiPersonaId(value: unknown): PiPersonaId {
  if (typeof value !== 'string') return DEFAULT_PI_PERSONA_ID
  const normalized = value.trim()
  return isPiPersonaId(normalized) ? normalized : DEFAULT_PI_PERSONA_ID
}

export const normalizeCcgPersona = normalizePiPersonaId

export function getPiPersonaDefinition(value: unknown): PiPersonaDefinition {
  return PERSONA_BY_ID.get(normalizePiPersonaId(value)) ?? PI_PERSONA_CATALOG[0]
}

/** Return an allowlisted template location. The filename is catalog-derived. */
export function getPiPersonaTemplatePath(templateDir: string, value: unknown): string {
  return join(templateDir, 'personas', getPiPersonaDefinition(value).templateFile)
}

export const getCcgPersonaTemplatePath = getPiPersonaTemplatePath

/** Safe fallback used when a custom/template package omits the default persona file. */
export const DEFAULT_CCG_PERSONA_INSTRUCTIONS = `
## Leader persona

Use a clear, calm, constructive voice for user-facing leader prose. Keep responses concise and action-oriented. This guidance applies only to natural-language presentation by the CCG leader.

It must not alter child tasks, role contracts, JSON or schema, code blocks, commands, paths, tests, reviews, board/events/summary, credentials, authorization, or safety boundaries.
`.trim()

export async function readPiPersonaInstructions(templateDir: string, value: unknown): Promise<string> {
  const persona = normalizePiPersonaId(value)
  const path = getPiPersonaTemplatePath(templateDir, persona)
  try {
    return (await fs.readFile(path, 'utf-8')).trim()
  }
  catch (error) {
    if (persona === DEFAULT_PI_PERSONA_ID) return DEFAULT_CCG_PERSONA_INSTRUCTIONS
    throw new Error(`Pi persona template not found: ${path}: ${String(error)}`)
  }
}

/** Normalize a possibly partial metadata object before a caller uses its persona choice. */
export function normalizeCcgPersonaMetadata(value: unknown): PiPersonaId {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_PI_PERSONA_ID
  const record = value as Record<string, unknown>
  const choices = typeof record.lastChoices === 'object' && record.lastChoices !== null && !Array.isArray(record.lastChoices)
    ? record.lastChoices as Record<string, unknown>
    : undefined
  return normalizePiPersonaId(choices?.persona ?? record.persona)
}
