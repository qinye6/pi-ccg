import { cac } from 'cac'
import { describe, expect, it } from 'vitest'
import { setupCommands } from '../../cli-setup'

async function configuredCli() {
  const cli = cac('ccg')
  await setupCommands(cli)
  return cli
}

describe('Pi CLI command registration', () => {
  it('registers only the Pi operational command surface', async () => {
    const cli = await configuredCli()
    const names = cli.commands.map(command => command.name)

    expect(names).toEqual(['', 'init', 'update', 'doctor', 'status', 'uninstall'])
    expect(names).not.toContain('config mcp')
    expect(names).not.toContain('diagnose-mcp')
    expect(names).not.toContain('fix-mcp')
    expect(names).not.toContain('codex-mode')
  })

  it('parses Pi model, cap and project asset flags', async () => {
    const cli = await configuredCli()
    cli.parse([
      'node',
      'ccg',
      'init',
      '--frontend-model',
      'demo/frontend',
      '--backend-model',
      'demo/backend',
      '--review-model',
      'demo/review',
      '--dev-agent-cap',
      '3',
      '--global-concurrency-limit',
      '4',
      '--max-spawns-per-session',
      '20',
      '--max-subagent-depth',
      '1',
      '--project-assets',
    ], { run: false })

    expect(cli.matchedCommand?.name).toBe('init')
    expect(cli.options).toMatchObject({
      frontendModel: 'demo/frontend',
      backendModel: 'demo/backend',
      reviewModel: 'demo/review',
      devAgentCap: 3,
      globalConcurrencyLimit: 4,
      maxSpawnsPerSession: 20,
      maxSubagentDepth: 1,
      projectAssets: true,
    })
  })

  it('maps --no-project-assets to a false projectAssets option', async () => {
    const cli = await configuredCli()
    cli.parse(['node', 'ccg', 'init', '--no-project-assets'], { run: false })

    expect(cli.options.projectAssets).toBe(false)
  })
})
