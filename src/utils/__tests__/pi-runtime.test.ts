import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}))

vi.mock('node:child_process', () => childProcess)

const {
  inspectPiRuntime,
  parsePiPackageList,
  PI_SUBAGENTS_INSTALL_COMMAND,
  PI_SUBAGENTS_PACKAGE,
  runPiPackageCommand,
} = await import('../pi-runtime')

beforeEach(() => {
  childProcess.spawn.mockReset()
  childProcess.spawnSync.mockReset()
})

function mockPackageCommand(options: {
  stdout?: string
  stderr?: string
  exitCode?: number
} = {}): void {
  const process = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
  }
  process.stdout = new PassThrough()
  process.stderr = new PassThrough()
  childProcess.spawn.mockReturnValueOnce(process)
  queueMicrotask(() => {
    if (options.stdout) process.stdout.write(options.stdout)
    if (options.stderr) process.stderr.write(options.stderr)
    process.stdout.end()
    process.stderr.end()
    process.emit('close', options.exitCode ?? 0)
  })
}

describe('parsePiPackageList', () => {
  it('parses unscoped, scoped, versioned, and ANSI package entries', () => {
    expect(parsePiPackageList([
      'Packages:',
      '  npm:pi-subagents@0.37.0',
      '  [32mnpm:@vigolium/piolium@0.0.13[0m',
      '  npm:pi-mcp-adapter',
    ].join('\n'))).toEqual([
      { packageSpec: 'npm:pi-subagents', version: '0.37.0' },
      { packageSpec: 'npm:@vigolium/piolium', version: '0.0.13' },
      { packageSpec: 'npm:pi-mcp-adapter', version: null },
    ])
  })

  it('deduplicates repeated package entries', () => {
    expect(parsePiPackageList('npm:pi-subagents@0.36.0 npm:pi-subagents@0.37.0')).toEqual([
      { packageSpec: 'npm:pi-subagents', version: '0.37.0' },
    ])
  })
})

describe('inspectPiRuntime', () => {
  it('detects Pi CLI and all installed packages', () => {
    childProcess.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'pi 1.2.3\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'Packages:\n  npm:pi-subagents@0.37.0\n  npm:pi-memctx@0.13.1\n', stderr: '' })

    expect(inspectPiRuntime('/tmp/pi-home')).toEqual({
      piAvailable: true,
      piVersion: 'pi 1.2.3',
      piSubagentsAvailable: true,
      packages: [
        { packageSpec: 'npm:pi-subagents', version: '0.37.0' },
        { packageSpec: 'npm:pi-memctx', version: '0.13.1' },
      ],
      packageListError: null,
    })
    expect(childProcess.spawnSync).toHaveBeenNthCalledWith(2, 'pi', ['list', '--no-approve'], expect.objectContaining({
      env: expect.objectContaining({ PI_CODING_AGENT_DIR: '/tmp/pi-home' }),
    }))
  })

  it('reports the required package as missing without treating Pi CLI as unavailable', () => {
    childProcess.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'pi 1.2.3\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'Packages:\n  npm:other-package\n', stderr: '' })

    expect(inspectPiRuntime()).toMatchObject({
      piAvailable: true,
      piSubagentsAvailable: false,
      packages: [{ packageSpec: 'npm:other-package', version: null }],
      packageListError: null,
    })
  })

  it('does not accept packages whose names only contain pi-subagents', () => {
    childProcess.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'pi 1.2.3\n', stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: 'Packages:\n  npm:not-pi-subagents@1.0.0\n  npm:pi-subagents-helper@1.0.0\n',
        stderr: '',
      })

    expect(inspectPiRuntime()).toMatchObject({
      piAvailable: true,
      piSubagentsAvailable: false,
      packageListError: null,
    })
  })

  it('does not list packages when Pi CLI is unavailable', () => {
    childProcess.spawnSync.mockReturnValueOnce({ status: 127, stdout: '', stderr: 'not found' })

    expect(inspectPiRuntime()).toEqual({
      piAvailable: false,
      piVersion: null,
      piSubagentsAvailable: false,
      packages: [],
      packageListError: 'not found',
    })
    expect(childProcess.spawnSync).toHaveBeenCalledTimes(1)
  })

  it('reports a package-list error while preserving Pi availability', () => {
    childProcess.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'pi 1.2.3\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'registry unavailable' })

    expect(inspectPiRuntime()).toEqual({
      piAvailable: true,
      piVersion: 'pi 1.2.3',
      piSubagentsAvailable: false,
      packages: [],
      packageListError: 'registry unavailable',
    })
  })

  it('exposes the canonical package and install command', () => {
    expect(PI_SUBAGENTS_PACKAGE).toBe('npm:pi-subagents')
    expect(PI_SUBAGENTS_INSTALL_COMMAND).toBe('pi install npm:pi-subagents')
  })
})

describe('runPiPackageCommand', () => {
  it('spawns Pi with an argument array and custom home', async () => {
    mockPackageCommand({ stdout: 'installed\n' })

    await expect(runPiPackageCommand('install', 'npm:pi-memctx', { piHome: '/tmp/pi-home' })).resolves.toEqual({
      success: true,
      command: 'pi install npm:pi-memctx',
      packageSpec: 'npm:pi-memctx',
      stdout: 'installed',
      stderr: '',
      exitCode: 0,
    })
    expect(childProcess.spawn).toHaveBeenCalledWith('pi', ['install', 'npm:pi-memctx'], expect.objectContaining({
      env: expect.objectContaining({ PI_CODING_AGENT_DIR: '/tmp/pi-home' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
  })

  it('propagates package-command failures', async () => {
    mockPackageCommand({ stderr: 'install failed\n', exitCode: 2 })

    await expect(runPiPackageCommand('install', 'npm:pi-memctx')).resolves.toMatchObject({
      success: false,
      stderr: 'install failed',
      exitCode: 2,
    })
  })

  it('rejects shell metacharacters before spawning', () => {
    expect(() => runPiPackageCommand('install', 'npm:pi-memctx;rm -rf /')).toThrow('Invalid Pi package spec')
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })
})
