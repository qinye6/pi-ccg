import type { CcgInstallerMetadata, InitOptions } from '../types'
import { spawn } from 'node:child_process'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { join } from 'pathe'
import { init } from './init'
import { REQUIRED_PI_EXTENSION, selectedExtensionMetadata } from '../utils/pi-extensions'
import { checkForUpdates } from '../utils/version'
import {
  CCG_MANAGED_BLOCK_START,
  CCG_PI_ACTIVE_AGENT_NAMES,
  getCcgMetadataPath,
  getPiAgentHome,
  getProjectAgentsMdPath,
  getProjectPiChainsDir,
  getProjectPiPromptsDir,
} from '../utils/pi-paths'

async function readMetadata(path = getCcgMetadataPath()): Promise<CcgInstallerMetadata | null> {
  if (!(await fs.pathExists(path))) return null
  try {
    return await fs.readJson(path) as CcgInstallerMetadata
  }
  catch {
    return null
  }
}

export function initOptionsFromMetadata(metadata: CcgInstallerMetadata | null): InitOptions {
  const extensionIds = selectedExtensionMetadata(metadata?.extensions)
    .filter(entry => entry.id !== REQUIRED_PI_EXTENSION.id)
    .map(entry => entry.id)

  return {
    lang: metadata?.language ?? 'zh-CN',
    skipPrompt: true,
    force: true,
    preserveExtensions: true,
    extensionIds,
    noOptionalExtensions: extensionIds.length === 0,
    installProjectAssets: metadata?.scope !== 'user',
    frontendModel: metadata?.lastChoices?.frontendModel,
    backendModel: metadata?.lastChoices?.backendModel,
    reviewModel: metadata?.lastChoices?.reviewModel,
    devAgentCap: metadata?.lastChoices?.caps?.devAgentCap,
    globalConcurrencyLimit: metadata?.lastChoices?.caps?.globalConcurrencyLimit,
    maxSpawnsPerSession: metadata?.lastChoices?.caps?.maxSpawnsPerSession,
    maxSubagentDepth: metadata?.lastChoices?.caps?.maxSubagentDepth,
  }
}

export function buildLatestInitArgs(options: InitOptions): string[] {
  const args = ['--yes', 'pi-ccg@latest', 'init', '--skip-prompt', '--force']
  const add = (flag: string, value: string | number | undefined): void => {
    if (value !== undefined && String(value).trim()) args.push(flag, String(value))
  }
  add('--lang', options.lang)
  add('--install-dir', options.installDir)
  add('--frontend-model', options.frontendModel)
  add('--backend-model', options.backendModel)
  add('--review-model', options.reviewModel)
  if (options.extensionIds && options.extensionIds.length > 0) add('--extensions', options.extensionIds.join(','))
  else args.push('--no-optional-extensions')
  if (options.preserveExtensions) args.push('--preserve-extensions')
  add('--dev-agent-cap', options.devAgentCap)
  add('--global-concurrency-limit', options.globalConcurrencyLimit)
  add('--max-spawns-per-session', options.maxSpawnsPerSession)
  add('--max-subagent-depth', options.maxSubagentDepth)
  args.push(options.installProjectAssets === false ? '--no-project-assets' : '--project-assets')
  return args
}

function runLatestInit(options: InitOptions, cwd: string): Promise<void> {
  const args = buildLatestInitArgs(options)

  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, CCG_UPDATE_MODE: 'true' },
    })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`latest installer exited with code ${code ?? 'unknown'}`)))
  })
}

async function verifyPiAssets(piHome: string, projectDir: string, projectAssets: boolean): Promise<string[]> {
  const missing: string[] = []
  for (const agent of CCG_PI_ACTIVE_AGENT_NAMES) {
    const path = join(piHome, 'agents', `${agent}.md`)
    if (!(await fs.pathExists(path))) missing.push(path)
  }

  if (projectAssets) {
    const chain = join(getProjectPiChainsDir(projectDir), 'ccg-plan.chain.md')
    const prompt = join(getProjectPiPromptsDir(projectDir), 'ccg-go.md')
    if (!(await fs.pathExists(chain))) missing.push(chain)
    if (!(await fs.pathExists(prompt))) missing.push(prompt)
    const agentsMd = getProjectAgentsMdPath(projectDir)
    const hasBlock = await fs.pathExists(agentsMd)
      && (await fs.readFile(agentsMd, 'utf-8')).includes(CCG_MANAGED_BLOCK_START)
    if (!hasBlock) missing.push(`${agentsMd}#CCG-managed-block`)
  }

  return missing
}

export interface PerformPiUpdateOptions {
  projectDir?: string
  piHome?: string
  metadataPath?: string
  useLatestPackage?: boolean
}

export async function performUpdate(options: PerformPiUpdateOptions = {}): Promise<{ success: boolean, errors: string[] }> {
  const projectDir = options.projectDir ?? process.cwd()
  const piHome = options.piHome ?? getPiAgentHome()
  const metadata = await readMetadata(options.metadataPath ?? join(piHome, 'ccg-workflow.json'))
  const initOptions = { ...initOptionsFromMetadata(metadata), installDir: piHome }
  const errors: string[] = []

  try {
    if (options.useLatestPackage) await runLatestInit(initOptions, projectDir)
    else {
      const previousCwd = process.cwd()
      try {
        process.chdir(projectDir)
        await init(initOptions)
      }
      finally {
        process.chdir(previousCwd)
      }
    }
  }
  catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return { success: false, errors }
  }

  const missing = await verifyPiAssets(piHome, projectDir, initOptions.installProjectAssets !== false)
  if (missing.length > 0) errors.push(`Missing Pi assets: ${missing.join(', ')}`)
  return { success: errors.length === 0, errors }
}

export interface UpdateCommandOptions {
  installDir?: string
}

export async function update(options: UpdateCommandOptions = {}): Promise<void> {
  console.log(ansis.cyan.bold('\n  CCG Pi Update\n'))
  const spinner = ora('检查 npm 最新版本...').start()

  let hasUpdate = false
  let currentVersion = 'unknown'
  let latestVersion: string | null = null
  try {
    const check = await checkForUpdates()
    hasUpdate = check.hasUpdate
    currentVersion = check.currentVersion
    latestVersion = check.latestVersion
    spinner.stop()
  }
  catch (error) {
    spinner.warn(`无法检查 npm 版本，将安全重装当前 Pi templates：${String(error)}`)
  }

  if (latestVersion) {
    console.log(`  当前版本: ${ansis.yellow(`v${currentVersion}`)}`)
    console.log(`  最新版本: ${ansis.green(`v${latestVersion}`)}`)
  }
  console.log(ansis.gray('  更新只重装 CCG managed Pi assets；用户 providers、凭据、mcp.json、扩展选择与无关 settings 保持不变。'))
  console.log(ansis.gray('  更新不会执行第三方 package 操作；请使用 `ccg extensions` 单独管理扩展。\n'))

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
    type: 'confirm',
    name: 'confirm',
    message: hasUpdate ? '使用最新版 npm 包更新 Pi workflow？' : '安全重装当前 Pi workflow？',
    default: true,
  }])
  if (!confirm) return

  const installSpinner = ora('安装并验证 Pi workflow...').start()
  const result = await performUpdate({
    useLatestPackage: hasUpdate,
    piHome: options.installDir,
  })
  if (!result.success) {
    installSpinner.fail('Pi workflow 更新失败')
    for (const error of result.errors) console.log(ansis.red(`  - ${error}`))
    return
  }

  installSpinner.succeed('Pi workflow 已更新并通过资产验证')
  console.log(ansis.gray('  Extension selection preserved; run `ccg extensions` to install, remove, or re-detect third-party packages.'))
}
