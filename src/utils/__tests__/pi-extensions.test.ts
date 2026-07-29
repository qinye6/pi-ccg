import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  inspectPiRuntime: vi.fn(),
  runPiPackageCommand: vi.fn(),
}))

vi.mock('../pi-runtime', () => runtime)

const {
  applyPiExtensionSelection,
  normalizePiExtensionIds,
  PI_EXTENSION_CATALOG,
  recommendedPiExtensionIds,
  removeCcgInstalledExtensions,
  validatePiExtensionCatalog,
} = await import('../pi-extensions')

beforeEach(() => {
  runtime.inspectPiRuntime.mockReset()
  runtime.runPiPackageCommand.mockReset()
})

describe('Pi extension catalog', () => {
  it('has one required package and stable recommended defaults', () => {
    expect(PI_EXTENSION_CATALOG.filter(extension => extension.tier === 'required')).toHaveLength(1)
    expect(PI_EXTENSION_CATALOG[0]).toMatchObject({
      id: 'core-subagents',
      packageSpec: 'npm:pi-subagents',
      defaultSelected: true,
    })
    expect(recommendedPiExtensionIds()).toEqual([
      'mcp-adapter',
      'memory-context',
      'session-continuity',
    ])
  })

  it('validates unique safe package definitions with security notes', () => {
    expect(() => validatePiExtensionCatalog()).not.toThrow()
    expect(() => validatePiExtensionCatalog([
      PI_EXTENSION_CATALOG[0],
      { ...PI_EXTENSION_CATALOG[0] },
    ])).toThrow('Duplicate or empty Pi extension id')
    expect(() => validatePiExtensionCatalog([{
      ...PI_EXTENSION_CATALOG[0],
      id: 'unsafe',
      packageSpec: 'npm:pi-subagents;rm',
    }])).toThrow('Invalid Pi extension package')
  })

  it('normalizes by catalog order and rejects unknown IDs', () => {
    expect(normalizePiExtensionIds(['pr-review', 'mcp-adapter', 'pr-review'])).toEqual([
      'mcp-adapter',
      'pr-review',
    ])
    expect(() => normalizePiExtensionIds(['not-real'])).toThrow('Unknown Pi extension id')
  })
})

describe('applyPiExtensionSelection', () => {
  it('adopts packages that were installed outside CCG', async () => {
    runtime.inspectPiRuntime.mockReturnValue({
      piAvailable: true,
      packages: [
        { packageSpec: 'npm:pi-subagents', version: '0.37.0' },
        { packageSpec: 'npm:pi-memctx', version: '0.13.1' },
      ],
    })

    const result = await applyPiExtensionSelection({
      selectedIds: ['memory-context'],
      installRequiredPackage: false,
    })

    expect(result.errors).toEqual([])
    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'core-subagents', ownership: 'adopted', installedVersion: '0.37.0' }),
      expect.objectContaining({ id: 'memory-context', ownership: 'adopted', installedVersion: '0.13.1' }),
    ])
    expect(runtime.runPiPackageCommand).not.toHaveBeenCalled()
  })

  it('preserves CCG ownership across later detection', async () => {
    runtime.inspectPiRuntime.mockReturnValue({
      piAvailable: true,
      packages: [{ packageSpec: 'npm:pi-subagents', version: '0.37.0' }],
    })

    const result = await applyPiExtensionSelection({
      selectedIds: [],
      installRequiredPackage: false,
      previous: [{
        id: 'core-subagents',
        packageSpec: 'npm:pi-subagents',
        selected: true,
        ownership: 'ccg-installed',
        installedAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      }],
    })

    expect(result.entries[0]).toMatchObject({
      ownership: 'ccg-installed',
      installedAt: '2026-07-28T00:00:00.000Z',
    })
  })

  it('does not silently install the required package without authorization', async () => {
    runtime.inspectPiRuntime.mockReturnValue({ piAvailable: true, packages: [] })

    const result = await applyPiExtensionSelection({
      selectedIds: [],
      installRequiredPackage: false,
    })

    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'core-subagents', ownership: 'missing' }),
    ])
    expect(runtime.runPiPackageCommand).not.toHaveBeenCalled()
  })

  it('installs explicitly selected packages and records CCG ownership', async () => {
    runtime.inspectPiRuntime.mockReturnValue({ piAvailable: true, packages: [] })
    runtime.runPiPackageCommand.mockResolvedValue({
      success: true,
      command: 'pi install npm:package',
      packageSpec: 'npm:package',
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await applyPiExtensionSelection({
      selectedIds: ['mcp-adapter'],
      installRequiredPackage: true,
      piHome: '/tmp/pi-home',
    })

    expect(runtime.runPiPackageCommand).toHaveBeenNthCalledWith(1, 'install', 'npm:pi-subagents', { piHome: '/tmp/pi-home' })
    expect(runtime.runPiPackageCommand).toHaveBeenNthCalledWith(2, 'install', 'npm:pi-mcp-adapter', { piHome: '/tmp/pi-home' })
    expect(result.entries.map(entry => [entry.id, entry.ownership])).toEqual([
      ['core-subagents', 'ccg-installed'],
      ['mcp-adapter', 'ccg-installed'],
    ])
  })

  it('keeps failed packages as missing and returns the command error', async () => {
    runtime.inspectPiRuntime.mockReturnValue({
      piAvailable: true,
      packages: [{ packageSpec: 'npm:pi-subagents', version: '0.37.0' }],
    })
    runtime.runPiPackageCommand.mockResolvedValue({
      success: false,
      command: 'pi install npm:pi-memctx',
      packageSpec: 'npm:pi-memctx',
      stdout: '',
      stderr: 'registry unavailable',
      exitCode: 1,
    })

    const result = await applyPiExtensionSelection({
      selectedIds: ['memory-context'],
      installRequiredPackage: false,
    })

    expect(result.entries.find(entry => entry.id === 'memory-context')).toMatchObject({ ownership: 'missing' })
    expect(result.errors).toEqual(['pi install npm:pi-memctx: registry unavailable'])
  })
})

describe('removeCcgInstalledExtensions', () => {
  it('removes only CCG-owned packages and preserves adopted packages', async () => {
    runtime.runPiPackageCommand.mockResolvedValue({
      success: true,
      command: 'pi remove npm:pi-memctx',
      packageSpec: 'npm:pi-memctx',
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await removeCcgInstalledExtensions([
      {
        id: 'memory-context',
        packageSpec: 'npm:pi-memctx',
        selected: true,
        ownership: 'ccg-installed',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      {
        id: 'mcp-adapter',
        packageSpec: 'npm:pi-mcp-adapter',
        selected: true,
        ownership: 'adopted',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    ], '/tmp/pi-home')

    expect(runtime.runPiPackageCommand).toHaveBeenCalledOnce()
    expect(runtime.runPiPackageCommand).toHaveBeenCalledWith('remove', 'npm:pi-memctx', { piHome: '/tmp/pi-home' })
    expect(result).toEqual({
      removed: ['npm:pi-memctx'],
      preserved: ['npm:pi-mcp-adapter'],
      errors: [],
    })
  })
})
