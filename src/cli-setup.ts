import type { CAC } from 'cac'
import type { CliOptions } from './types'
import ansis from 'ansis'
import fs from 'fs-extra'
import { version } from '../package.json'
import { doctor, status } from './commands/doctor'
import { extensions } from './commands/extensions'
import { init } from './commands/init'
import { showMainMenu } from './commands/menu'
import { style } from './commands/style'
import { update } from './commands/update'
import { initI18n } from './i18n'
import { uninstallPiWorkflow } from './utils/installer'
import { parsePiThinkingLevel } from './utils/pi-config'
import { getCcgMetadataPath } from './utils/pi-paths'

function customizeHelp(sections: any[]): any[] {
  sections.unshift({ title: '', body: ansis.cyan.bold(`CCG for Pi CLI v${version}`) })
  sections.push({
    title: ansis.yellow('Pi init options'),
    body: [
      `  ${ansis.green('--frontend-model')} <provider/model>`,
      `  ${ansis.green('--backend-model')} <provider/model>`,
      `  ${ansis.green('--review-model')} <provider/model>`,
      `  ${ansis.green('--planning-thinking')} <level>`,
      `  ${ansis.green('--frontend-thinking')} <level>`,
      `  ${ansis.green('--backend-thinking')} <level>`,
      `  ${ansis.green('--review-thinking')} <level>`,
      `  ${ansis.green('--persona')} <id>`,
      `  ${ansis.green('--provider-file')} <path>`,
      `  ${ansis.green('--extensions')} <id,id>`,
      `  ${ansis.green('--no-optional-extensions')}`,
      `  ${ansis.green('--install-required-package')}`,
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
    .option('--frontend-model <model>', 'Model for all dynamic frontend builder instances')
    .option('--backend-model <model>', 'Backend builder model')
    .option('--review-model <model>', 'Reviewer and test-runner model')
    .option('--planning-thinking <level>', 'Thinking level for scout and planner')
    .option('--frontend-thinking <level>', 'Thinking level for frontend builders')
    .option('--backend-thinking <level>', 'Thinking level for backend builders')
    .option('--review-thinking <level>', 'Thinking level for reviewer and test-runner')
    .option('--persona <id>', 'CCG leader persona/output style')
    .option('--provider-file <path>', 'JSON provider definitions to append without exposing credentials')
    .option('--extensions <id,id>', 'Explicit optional Pi extension IDs for non-interactive installs')
    .option('--no-optional-extensions', 'Do not install optional Pi extensions')
    .option('--install-required-package', 'Install missing required pi-subagents package')
    .option('--preserve-extensions', 'Preserve extension metadata without package operations (used by update)')
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
        planningThinking: parsePiThinkingLevel(options.planningThinking, '--planning-thinking'),
        frontendThinking: parsePiThinkingLevel(options.frontendThinking, '--frontend-thinking'),
        backendThinking: parsePiThinkingLevel(options.backendThinking, '--backend-thinking'),
        reviewThinking: parsePiThinkingLevel(options.reviewThinking, '--review-thinking'),
        installProjectAssets: options.projectAssets,
        extensionIds: options.extensions?.split(',').map(id => id.trim()).filter(Boolean),
        noOptionalExtensions: options.optionalExtensions === false,
        devAgentCap: positiveNumber(options.devAgentCap),
        globalConcurrencyLimit: positiveNumber(options.globalConcurrencyLimit),
        maxSpawnsPerSession: positiveNumber(options.maxSpawnsPerSession),
        maxSubagentDepth: positiveNumber(options.maxSubagentDepth),
      })
    })

  cli
    .command('style [persona]', 'Change only the CCG leader persona/output style')
    .option('--persona <id>', 'Persona ID (alternative to the positional argument)')
    .option('--install-dir, -d <path>', 'Pi agent home used by the existing installation')
    .option('--project-dir <path>', 'Project containing CCG managed Pi prompts')
    .action(async (
      persona: string | undefined,
      options: {
        persona?: string
        installDir?: string
        projectDir?: string
      },
    ) => {
      await style(persona, options)
    })

  cli
    .command('update', 'Safely update managed Pi assets')
    .option('--install-dir, -d <path>', 'Pi agent home used by the existing installation')
    .action(async (options: { installDir?: string }) => {
      await update({ installDir: options.installDir })
    })
  cli
    .command('extensions', 'View and manage optional Pi extensions')
    .option('--install-dir, -d <path>', 'Pi agent home (default ~/.pi/agent)')
    .action(async (options: { installDir?: string }) => {
      await extensions({ installDir: options.installDir })
    })
  cli
    .command('doctor', 'Check CCG Pi installation health')
    .option('--install-dir, -d <path>', 'Pi agent home (default ~/.pi/agent)')
    .option('--project-dir <path>', 'Project containing CCG managed Pi assets')
    .action(async (options: { installDir?: string, projectDir?: string }) => {
      await doctor(options)
    })
  cli
    .command('status', 'Show CCG Pi installation status')
    .option('--install-dir, -d <path>', 'Pi agent home (default ~/.pi/agent)')
    .option('--project-dir <path>', 'Project containing CCG managed Pi assets')
    .action(async (options: { installDir?: string, projectDir?: string }) => {
      await status(options)
    })

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
