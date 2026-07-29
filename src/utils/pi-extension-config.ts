import fs from 'fs-extra'
import { getPiWebSearchConfigPath } from './pi-paths'
import { writeJsonAtomic } from './pi-config'

type JsonRecord = Record<string, unknown>

export type PiJsonInspection<T extends JsonRecord = JsonRecord>
  = | { status: 'missing', path: string }
    | { status: 'invalid', path: string, error: string }
    | { status: 'valid', path: string, value: T }

export type PiExtensionConfigOperation = {
  extensionId: 'web-access'
  action: 'create' | 'merge'
  path: string
  field: 'workflow'
  value: 'none'
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function inspectPiWebSearchConfig(
  configPath = getPiWebSearchConfigPath(),
): Promise<PiJsonInspection> {
  if (!(await fs.pathExists(configPath))) return { status: 'missing', path: configPath }

  try {
    const value = await fs.readJson(configPath) as unknown
    if (!isRecord(value)) {
      return { status: 'invalid', path: configPath, error: 'JSON root must be an object' }
    }
    return { status: 'valid', path: configPath, value }
  }
  catch {
    return { status: 'invalid', path: configPath, error: 'invalid JSON' }
  }
}

export function planPiWebSearchConfigOperation(
  inspection: PiJsonInspection,
): PiExtensionConfigOperation | null {
  if (inspection.status === 'invalid') return null
  if (inspection.status === 'valid' && inspection.value.workflow !== undefined) return null
  return {
    extensionId: 'web-access',
    action: inspection.status === 'missing' ? 'create' : 'merge',
    path: inspection.path,
    field: 'workflow',
    value: 'none',
  }
}

export async function applyPiExtensionConfigOperation(
  operation: PiExtensionConfigOperation,
): Promise<{ changed: boolean }> {
  const inspection = await inspectPiWebSearchConfig(operation.path)
  if (inspection.status === 'invalid') {
    throw new Error(`Refusing to overwrite invalid JSON: ${operation.path}`)
  }
  if (inspection.status === 'valid' && inspection.value.workflow !== undefined) {
    return { changed: false }
  }

  await writeJsonAtomic(operation.path, {
    ...(inspection.status === 'valid' ? inspection.value : {}),
    workflow: 'none',
  })
  return { changed: true }
}
