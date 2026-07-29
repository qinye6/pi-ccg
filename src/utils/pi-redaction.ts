const SECRET_KEY = /(?:api[-_]?key|token|secret|password|authorization|cookie|credential|refresh|access)/i
const SECRET_VALUE = /(?:^|\b)(?:sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,}|bearer\s+\S+)/i

export const REDACTED = '[REDACTED]'

export function redactPiValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return REDACTED
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? REDACTED : value
  if (Array.isArray(value)) return value.map(item => redactPiValue(item))
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([entryKey, entryValue]) => [entryKey, redactPiValue(entryValue, entryKey)]),
  )
}

export function redactPiText(text: string): string {
  return text
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|gh[opusr]_)[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/((?:api[-_]?key|token|secret|password|authorization|cookie|credential)\s*[:=]\s*)\S+/gi, `$1${REDACTED}`)
}
