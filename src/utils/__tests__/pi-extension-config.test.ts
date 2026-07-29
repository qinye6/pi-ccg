import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import {
  applyPiExtensionConfigOperation,
  inspectPiWebSearchConfig,
  planPiWebSearchConfigOperation,
} from '../pi-extension-config'

const roots: string[] = []
function configPath(name: string): string {
  const root = join(tmpdir(), `ccg-web-config-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  roots.push(root)
  return join(root, '.pi', 'web-search.json')
}

afterAll(async () => Promise.all(roots.map(root => fs.remove(root))))

describe('Pi web access config', () => {
  it('creates a missing file with the safe workflow', async () => {
    const path = configPath('missing')
    const inspection = await inspectPiWebSearchConfig(path)
    const operation = planPiWebSearchConfigOperation(inspection)
    expect(operation).toMatchObject({ action: 'create', field: 'workflow', value: 'none' })
    await applyPiExtensionConfigOperation(operation!)
    expect(await fs.readJson(path)).toEqual({ workflow: 'none' })
  })

  it('merges only workflow and preserves unknown fields', async () => {
    const path = configPath('merge')
    await fs.ensureDir(join(path, '..'))
    await fs.writeJson(path, { routing: { enabled: true }, browser: 'user-managed' })
    const operation = planPiWebSearchConfigOperation(await inspectPiWebSearchConfig(path))
    await applyPiExtensionConfigOperation(operation!)
    expect(await fs.readJson(path)).toEqual({
      routing: { enabled: true },
      browser: 'user-managed',
      workflow: 'none',
    })
  })

  it('preserves an existing workflow value', async () => {
    const path = configPath('custom')
    await fs.ensureDir(join(path, '..'))
    await fs.writeJson(path, { workflow: 'summary-review', other: true })
    expect(planPiWebSearchConfigOperation(await inspectPiWebSearchConfig(path))).toBeNull()
    expect(await fs.readJson(path)).toEqual({ workflow: 'summary-review', other: true })
  })

  it('refuses invalid JSON', async () => {
    const path = configPath('invalid')
    await fs.ensureDir(join(path, '..'))
    await fs.writeFile(path, '{ invalid')
    const inspection = await inspectPiWebSearchConfig(path)
    expect(inspection.status).toBe('invalid')
    expect(planPiWebSearchConfigOperation(inspection)).toBeNull()
  })
})
