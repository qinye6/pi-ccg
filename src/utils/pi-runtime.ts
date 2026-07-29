import { spawn, spawnSync } from 'node:child_process'

export const PI_SUBAGENTS_PACKAGE = 'npm:pi-subagents'
export const PI_SUBAGENTS_INSTALL_COMMAND = `pi install ${PI_SUBAGENTS_PACKAGE}`

export interface InstalledPiPackage {
  packageSpec: `npm:${string}`
  version: string | null
}

export interface PiRuntimeInspection {
  piAvailable: boolean
  piVersion: string | null
  piSubagentsAvailable: boolean
  packages: InstalledPiPackage[]
  packageListError: string | null
}

export interface PiPackageCommandResult {
  success: boolean
  command: string
  packageSpec: `npm:${string}`
  stdout: string
  stderr: string
  exitCode: number | null
}

function commandError(stderr: string | Buffer | null | undefined): string | null {
  const detail = stderr?.toString().trim()
  return detail || null
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function validatePackageSpec(packageSpec: string): asserts packageSpec is `npm:${string}` {
  if (!/^npm:(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageSpec)) {
    throw new Error(`Invalid Pi package spec: ${packageSpec}`)
  }
}

export function parsePiPackageList(packageOutput: string): InstalledPiPackage[] {
  const packages = new Map<string, InstalledPiPackage>()
  const pattern = /npm:((?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+)(?:@([^\s,;)\]]+))?/g
  for (const match of stripAnsi(packageOutput).matchAll(pattern)) {
    const packageSpec = `npm:${match[1]}` as const
    packages.set(packageSpec, {
      packageSpec,
      version: match[2]?.replace(/[.:]+$/, '') || null,
    })
  }
  return [...packages.values()]
}

function runtimeEnv(piHome?: string): NodeJS.ProcessEnv {
  return piHome
    ? { ...process.env, PI_CODING_AGENT_DIR: piHome }
    : { ...process.env }
}

export function inspectPiRuntime(piHome?: string): PiRuntimeInspection {
  const piVersionResult = spawnSync('pi', ['--version'], {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    env: runtimeEnv(piHome),
  })

  if (piVersionResult.status !== 0) {
    return {
      piAvailable: false,
      piVersion: null,
      piSubagentsAvailable: false,
      packages: [],
      packageListError: commandError(piVersionResult.stderr),
    }
  }

  const packageListResult = spawnSync('pi', ['list', '--no-approve'], {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    env: runtimeEnv(piHome),
  })
  const packageOutput = `${packageListResult.stdout ?? ''}\n${packageListResult.stderr ?? ''}`
  const packages = packageListResult.status === 0 ? parsePiPackageList(packageOutput) : []

  return {
    piAvailable: true,
    piVersion: piVersionResult.stdout.trim() || 'installed',
    piSubagentsAvailable: packages.some(item => item.packageSpec === PI_SUBAGENTS_PACKAGE),
    packages,
    packageListError: packageListResult.status === 0
      ? null
      : commandError(packageListResult.stderr) ?? 'pi list --no-approve failed',
  }
}

export function runPiPackageCommand(
  action: 'install' | 'remove' | 'update',
  packageSpec: string,
  options: { piHome?: string } = {},
): Promise<PiPackageCommandResult> {
  validatePackageSpec(packageSpec)
  const args = [action, packageSpec]

  return new Promise((resolve) => {
    const child = spawn('pi', args, {
      shell: process.platform === 'win32',
      env: runtimeEnv(options.piHome),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', (error) => {
      resolve({
        success: false,
        command: `pi ${action} ${packageSpec}`,
        packageSpec,
        stdout: stdout.trim(),
        stderr: error.message,
        exitCode: null,
      })
    })
    child.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        command: `pi ${action} ${packageSpec}`,
        packageSpec,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
      })
    })
  })
}
