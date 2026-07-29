import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  readCcgMetadata: vi.fn(),
  updateCcgMetadata: vi.fn(),
  inspectPiRuntime: vi.fn(),
  runPiPackageCommand: vi.fn(),
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
  },
}))

vi.mock('../config', () => ({
  readCcgMetadata: mocks.readCcgMetadata,
  updateCcgMetadata: mocks.updateCcgMetadata,
}))

vi.mock('../pi-runtime', () => ({
  inspectPiRuntime: mocks.inspectPiRuntime,
  runPiPackageCommand: mocks.runPiPackageCommand,
}))

const { extensions } = await import('../../commands/extensions')

describe('ccg extensions command', () => {
  beforeEach(() => {
    mocks.prompt.mockReset()
    mocks.readCcgMetadata.mockReset()
    mocks.updateCcgMetadata.mockReset()
    mocks.inspectPiRuntime.mockReset()
    mocks.runPiPackageCommand.mockReset()
    mocks.updateCcgMetadata.mockResolvedValue(undefined)
  })

  it('shows the required runtime in the same checkbox and preserves missing ownership when deselected', async () => {
    let capturedChoices: Array<Record<string, unknown>> = []
    mocks.readCcgMetadata.mockResolvedValue({
      language: 'en',
      extensions: [],
    })
    mocks.inspectPiRuntime.mockReturnValue({
      piAvailable: true,
      piVersion: 'pi 1.0.0',
      piSubagentsAvailable: false,
      packages: [],
      packageListError: null,
    })
    mocks.prompt.mockImplementation(async (questions: Array<Record<string, unknown>>) => {
      const question = questions[0]
      if (question.name === 'selectedIds') {
        capturedChoices = question.choices as Array<Record<string, unknown>>
        return { selectedIds: [] }
      }
      throw new Error(`Unexpected prompt: ${String(question.name)}`)
    })

    await extensions({ installDir: '/tmp/custom-pi-home' })

    expect(mocks.inspectPiRuntime).toHaveBeenCalledWith('/tmp/custom-pi-home')
    const requiredChoice = capturedChoices.find(choice => choice.value === 'core-subagents')
    expect(requiredChoice).toMatchObject({ checked: true })
    expect(requiredChoice?.disabled).toBeUndefined()
    expect(mocks.runPiPackageCommand).not.toHaveBeenCalled()
    expect(mocks.updateCcgMetadata).toHaveBeenCalledWith({
      extensions: [
        expect.objectContaining({
          id: 'core-subagents',
          packageSpec: 'npm:pi-subagents',
          ownership: 'missing',
        }),
      ],
    }, '/tmp/custom-pi-home/ccg-workflow.json')
  })

  it('shows installed required runtime as checked read-only and never puts it into a removal plan', async () => {
    let capturedChoices: Array<Record<string, unknown>> = []
    mocks.readCcgMetadata.mockResolvedValue({
      language: 'en',
      extensions: [
        {
          id: 'core-subagents',
          packageSpec: 'npm:pi-subagents',
          selected: true,
          ownership: 'ccg-installed',
          installedAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'mcp-adapter',
          packageSpec: 'npm:pi-mcp-adapter',
          selected: true,
          ownership: 'ccg-installed',
          installedAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    })
    mocks.inspectPiRuntime.mockReturnValue({
      piAvailable: true,
      piVersion: 'pi 1.0.0',
      piSubagentsAvailable: true,
      packages: [
        { packageSpec: 'npm:pi-subagents', version: '0.37.0' },
        { packageSpec: 'npm:pi-mcp-adapter', version: '0.20.0' },
      ],
      packageListError: null,
    })
    mocks.runPiPackageCommand.mockResolvedValue({
      success: true,
      command: 'pi remove npm:pi-mcp-adapter',
      packageSpec: 'npm:pi-mcp-adapter',
      stdout: '',
      stderr: '',
      exitCode: 0,
    })
    mocks.prompt.mockImplementation(async (questions: Array<Record<string, unknown>>) => {
      const question = questions[0]
      if (question.name === 'selectedIds') {
        capturedChoices = question.choices as Array<Record<string, unknown>>
        return { selectedIds: ['core-subagents'] }
      }
      if (question.name === 'confirm') return { confirm: true }
      throw new Error(`Unexpected prompt: ${String(question.name)}`)
    })

    await extensions({ installDir: '/tmp/custom-pi-home' })

    const requiredChoice = capturedChoices.find(choice => choice.value === 'core-subagents')
    expect(requiredChoice).toMatchObject({ checked: true, disabled: 'read-only' })
    expect(mocks.runPiPackageCommand).toHaveBeenCalledWith('remove', 'npm:pi-mcp-adapter', { piHome: '/tmp/custom-pi-home' })
    expect(mocks.runPiPackageCommand).not.toHaveBeenCalledWith('remove', 'npm:pi-subagents', expect.anything())
    expect(mocks.runPiPackageCommand).not.toHaveBeenCalledWith('install', 'npm:pi-subagents', expect.anything())
  })

  it('does not perform package operations when the final confirmation is refused', async () => {
    mocks.readCcgMetadata.mockResolvedValue({
      language: 'en',
      extensions: [],
    })
    mocks.inspectPiRuntime.mockReturnValue({
      piAvailable: true,
      piVersion: 'pi 1.0.0',
      piSubagentsAvailable: false,
      packages: [],
      packageListError: null,
    })
    mocks.prompt.mockImplementation(async (questions: Array<Record<string, unknown>>) => {
      const question = questions[0]
      if (question.name === 'selectedIds') return { selectedIds: ['core-subagents'] }
      if (question.name === 'confirm') return { confirm: false }
      throw new Error(`Unexpected prompt: ${String(question.name)}`)
    })

    await extensions({ installDir: '/tmp/custom-pi-home' })

    expect(mocks.runPiPackageCommand).not.toHaveBeenCalled()
    expect(mocks.updateCcgMetadata).not.toHaveBeenCalled()
  })
})
