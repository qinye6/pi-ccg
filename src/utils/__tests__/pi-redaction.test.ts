import { describe, expect, it } from 'vitest'
import { REDACTED, redactPiText, redactPiValue } from '../pi-redaction'

describe('Pi redaction', () => {
  it('redacts secret-named fields recursively', () => {
    expect(redactPiValue({
      apiKey: 'placeholder-secret',
      nested: { Authorization: 'Bearer placeholder-token', safe: 'visible' },
    })).toEqual({
      apiKey: REDACTED,
      nested: { Authorization: REDACTED, safe: 'visible' },
    })
  })

  it('redacts common credential patterns in text', () => {
    const value = redactPiText('token=placeholder-token Bearer secret-value sk-1234567890abcdef')
    expect(value).not.toContain('secret-value')
    expect(value).not.toContain('sk-1234567890abcdef')
  })
})
