import type { CAC } from 'cac'
import type { CliOptions } from './types'
import ansis from 'ansis'
import fs from 'fs-extra'
import { version } from '../package.json'
import { doctor, status } from './commands/doctor'
import { init } from './commands/init'
import { showMainMenu } from './commands/menu'
import { update } from './commands/update'
import { initI18n } from './i18n'
import { uninstallPiWorkflow } from './utils/installer'
import { getCcgMetadataPath } from './utils/pi-paths'

function customizeHelp(sections: any[]): any[] {
  sections.unshift({ title: '', body: ansis.cyan.bold(`CCG for Pi CLI v${version}`) })
  sections.push({
    title: ansis.yellow('Pi init options'),
    body: [
      `  ${ansis.green('--frontend-model')} <provider/model>`,
      `  ${ansis.green('--backend-model')} <provider/model>`,
      `  ${ansis.green('--review-model')} <provider/model>`,
      `  ${ansis.green('--provider-file')} <path>`,
      `  ${ansis.green('--dev-agent-cap')} <number>`,
      `  ${ansis.green('--global-concurrency-limit')} <number>`,
      `  ${ansis.green('--max-spawns-per-session')} <number>`,
      `  ${ansis.green('--max-subagent-depth')} <number>`,
      `  ${ansis.green('--project-assets / --no-project-assets')}`,
      `  ${ansis.green('--install-dir')} <path>`,
      `  ${ansis.green('--skip-prompt')}`,
      `  ${ansis.green('--force')}`,
    ].join('\n'),
  })
  return sections
}

function positiveNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

async function defaultLanguage(): Promise<'zh-CN' | 'en'> {
  try {
    const metadata = await fs.readJson(getCcgMetadataPath()) as Record<string, unknown>
    return metadata.language === 'en' ? 'en' : 'zh-CN'
  }
  catch {
    return 'zh-CN'
  }
}

export async function setupCommands(cli: CAC): Promise<void> {
  await initI18n(await defaultLanguage())

  cli
    .command('', 'Show interactive Pi workflow menu')
    .option('--lang, -l <lang>', 'Display language (zh-CN, en)')
    .action(async (options: CliOptions) => {
      if (options.lang) await initI18n(options.lang)
      await showMainMenu()
    })

  cli
    .command('init', 'Install or configure CCG for Pi CLI')
    .alias('i')
    .option('--lang, -l <lang>', 'Display language (zh-CN, en)')
    .option('--force, -f', 'Overwrite CCG-managed Pi templates')
    .option('--skip-prompt, -s', 'Run non-interactively')
    .option('--frontend-model <model>', 'Frontend and mini-program builder model')
    .option('--backend-model <model>', 'Backend builder model')
    .option('--review-model <model>', 'Reviewer and test-runner model')
    .option('--provider-file <path>', 'JSON provider definitions to append without exposing credentials')
    .option('--dev-agent-cap <number>', 'Maximum development builders')
    .option('--global-concurrency-limit <number>', 'Global Pi subagent concurrency limit')
    .option('--max-spawns-per-session <number>', 'Maximum subagent spawns per session')
    .option('--max-subagent-depth <number>', 'Maximum subagent nesting depth')
    .option('--project-assets', 'Install project AGENTS.md block, chain and prompt')
    .option('--no-project-assets', 'Install user-level Pi assets only')
    .option('--install-dir, -d <path>', 'Pi agent home (default ~/.pi/agent)')
    .option('--frontend, -F <model>', 'Deprecated alias for --frontend-model')
    .option('--backend, -B <model>', 'Deprecated alias for --backend-model')
    .action(async (options: CliOptions) => {
      if (options.lang) await initI18n(options.lang)
      await init({
        ...options,
        frontendModel: options.frontendModel ?? options.frontend,
        backendModel: options.backendModel ?? options.backend,
        installProjectAssets: options.projectAssets,
        devAgentCap: positiveNumber(options.devAgentCap),
        globalConcurrencyLimit: positiveNumber(options.globalConcurrencyLimit),
        maxSpawnsPerSession: positiveNumber(options.maxSpawnsPerSession),
        maxSubagentDepth: positiveNumber(options.maxSubagentDepth),
      })
    })

  cli.command('update', 'Safely update managed Pi assets').action(async () => { await update() })
  cli.command('doctor', 'Check CCG Pi installation health').action(async () => { await doctor() })
  cli.command('status', 'Show CCG Pi installation status').action(async () => { await status() })

  cli
    .command('uninstall', 'Remove only CCG-managed Pi assets')
    .option('--install-dir, -d <path>', 'Pi agent home (default ~/.pi/agent)')
    .option('--project-dir <path>', 'Project containing CCG managed Pi assets')
    .action(async (options: { installDir?: string, projectDir?: string }) => {
      const result = await uninstallPiWorkflow({
        piHome: options.installDir,
        projectDir: options.projectDir,
      })
      if (!result.success) {
        console.error(ansis.red('✗ Pi workflow uninstall failed'))
        for (const error of result.errors) console.error(ansis.gray(`  ${error}`))
        process.exitCode = 1
        return
      }
      console.log(ansis.green(`✓ Removed ${result.removed.length} CCG-managed Pi asset(s)`))
      if (result.preserved.length > 0) console.log(ansis.gray(`  Preserved ${result.preserved.length} user/shared config item(s)`))
    })

  cli.help(sections => customizeHelp(sections))
  cli.version(version)
}
