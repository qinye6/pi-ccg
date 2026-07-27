import { describe, expect, it } from 'vitest'
import { compareVersions } from '../version'

describe('compareVersions', () => {
  // Basic comparisons
  it('returns 0 for identical versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('returns 1 when v1 > v2 (major)', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1)
  })

  it('returns -1 when v1 < v2 (major)', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
  })

  it('returns 1 when v1 > v2 (minor)', () => {
    expect(compareVersions('1.8.0', '1.7.0')).toBe(1)
  })

  it('returns -1 when v1 < v2 (minor)', () => {
    expect(compareVersions('1.7.0', '1.8.0')).toBe(-1)
  })

  it('returns 1 when v1 > v2 (patch)', () => {
    expect(compareVersions('1.7.67', '1.7.66')).toBe(1)
  })

  it('returns -1 when v1 < v2 (patch)', () => {
    expect(compareVersions('1.7.66', '1.7.67')).toBe(-1)
  })

  // Real-world CCG version scenarios
  it('handles the update bug scenario: 1.7.67 vs 1.7.61', () => {
    expect(compareVersions('1.7.67', '1.7.61')).toBe(1)
  })

  it('same version returns 0: 1.7.67 vs 1.7.67', () => {
    expect(compareVersions('1.7.67', '1.7.67')).toBe(0)
  })

  // Edge cases
  it('handles versions with different segment counts', () => {
    expect(compareVersions('1.7', '1.7.0')).toBe(0)
  })

  it('treats missing segments as 0', () => {
    expect(compareVersions('1.7', '1.7.1')).toBe(-1)
  })

  it('handles single-segment versions', () => {
    expect(compareVersions('2', '1')).toBe(1)
  })

  it('handles 0.0.0 vs actual version', () => {
    expect(compareVersions('0.0.0', '1.7.67')).toBe(-1)
  })

  it('handles large patch numbers', () => {
    expect(compareVersions('1.7.100', '1.7.99')).toBe(1)
  })
})
