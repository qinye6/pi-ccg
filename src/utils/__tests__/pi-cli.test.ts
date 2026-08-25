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

    expect(names).toEqual(['', 'init', 'style', 'update', 'extensions', 'doctor', 'status', 'uninstall'])
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
      '--planning-thinking',
      'medium',
      '--frontend-thinking',
      'low',
      '--backend-thinking',
      'high',
      '--review-thinking',
      'xhigh',
      '--persona',
      'nekomata-engineer',
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
      planningThinking: 'medium',
      frontendThinking: 'low',
      backendThinking: 'high',
      reviewThinking: 'xhigh',
      persona: 'nekomata-engineer',
      devAgentCap: 3,
      globalConcurrencyLimit: 4,
      maxSpawnsPerSession: 20,
      maxSubagentDepth: 1,
      projectAssets: true,
    })
  })

  it('parses explicit extension install flags', async () => {
    const cli = await configuredCli()
    cli.parse([
      'node',
      'ccg',
      'init',
      '--extensions',
      'mcp-adapter,memory-context',
      '--install-required-package',
    ], { run: false })

    expect(cli.options).toMatchObject({
      extensions: 'mcp-adapter,memory-context',
      installRequiredPackage: true,
    })
  })

  it('maps --no-optional-extensions to a false optionalExtensions option', async () => {
    const cli = await configuredCli()
    cli.parse(['node', 'ccg', 'init', '--no-optional-extensions'], { run: false })

    expect(cli.options.optionalExtensions).toBe(false)
  })

  it.each([
    ['style', 'nekomata-engineer'],
    ['style --persona', 'abyss-command'],
  ])('parses the %s persona form', async (form, persona) => {
    const cli = await configuredCli()
    const args = form === 'style'
      ? ['node', 'ccg', 'style', persona]
      : ['node', 'ccg', 'style', '--persona', persona]

    cli.parse(args, { run: false })

    expect(cli.matchedCommand?.name).toBe('style')
    if (form === 'style') expect(cli.args).toEqual([persona])
    else expect(cli.options.persona).toBe(persona)
  })

  it('parses a custom Pi home for update', async () => {
    const cli = await configuredCli()
    cli.parse(['node', 'ccg', 'update', '--install-dir', '/tmp/custom-pi-home'], { run: false })

    expect(cli.matchedCommand?.name).toBe('update')
    expect(cli.options.installDir).toBe('/tmp/custom-pi-home')
  })

  it.each(['doctor', 'status'])('parses custom Pi and project homes for %s', async (command) => {
    const cli = await configuredCli()
    cli.parse([
      'node',
      'ccg',
      command,
      '--install-dir',
      '/tmp/custom-pi-home',
      '--project-dir',
      '/tmp/custom-project',
    ], { run: false })

    expect(cli.matchedCommand?.name).toBe(command)
    expect(cli.options).toMatchObject({
      installDir: '/tmp/custom-pi-home',
      projectDir: '/tmp/custom-project',
    })
  })

  it('maps --no-project-assets to a false projectAssets option', async () => {
    const cli = await configuredCli()
    cli.parse(['node', 'ccg', 'init', '--no-project-assets'], { run: false })

    expect(cli.options.projectAssets).toBe(false)
  })
})
