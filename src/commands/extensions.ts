import type { PiExtensionMetadataEntry } from '../types'
import ansis from 'ansis'
import inquirer from 'inquirer'
import { join } from 'pathe'
import { readCcgMetadata, updateCcgMetadata } from '../utils/config'
import {
  applyPiExtensionSelection,
  getPiExtension,
  PI_EXTENSION_CATALOG,
  recommendedPiExtensionIds,
  REQUIRED_PI_EXTENSION,
} from '../utils/pi-extensions'
import { getPiAgentHome } from '../utils/pi-paths'
import { inspectPiRuntime, runPiPackageCommand } from '../utils/pi-runtime'

export interface ExtensionsCommandOptions {
  installDir?: string
}

function optionalEntries(entries: readonly PiExtensionMetadataEntry[] | undefined): PiExtensionMetadataEntry[] {
  return (entries ?? []).filter(entry => entry.id !== REQUIRED_PI_EXTENSION.id && entry.selected)
}

function extensionChoiceName(id: string): string {
  const extension = getPiExtension(id)
  if (!extension) return id
  return `${extension.label} [${extension.tier}] — ${extension.description}`
}

export async function extensions(options: ExtensionsCommandOptions = {}): Promise<void> {
  const piHome = options.installDir ?? getPiAgentHome()
  const metadataPath = join(piHome, 'ccg-workflow.json')
  const metadata = await readCcgMetadata(metadataPath)
  const runtime = inspectPiRuntime(piHome)
  const installed = new Set(runtime.packages.map(item => item.packageSpec))

  console.log(ansis.cyan.bold('\n  CCG Pi Extensions\n'))
  console.log(ansis.yellow('  Pi packages execute with your full user permissions. Review package sources before installation.'))
  console.log(ansis.gray('  CCG never stores MCP/API credentials and never overwrites user-managed MCP configuration.\n'))

  for (const extension of PI_EXTENSION_CATALOG) {
    console.log(`  ${installed.has(extension.packageSpec) ? ansis.green('✓') : ansis.gray('○')} ${extension.label.padEnd(24)} ${ansis.gray(`${extension.packageSpec} [${extension.tier}]`)}`)
  }

  if (!runtime.piAvailable) {
    console.log(ansis.red('\n  Pi CLI is not available; install Pi before managing extensions.\n'))
    return
  }

  const previous = optionalEntries(metadata?.extensions)
  const defaults = metadata?.extensions
    ? previous.map(entry => entry.id)
    : recommendedPiExtensionIds()
  const { selectedIds } = await inquirer.prompt<{ selectedIds: string[] }>([{
    type: 'checkbox',
    name: 'selectedIds',
    message: 'Select optional extensions:',
    choices: PI_EXTENSION_CATALOG
      .filter(extension => extension.tier !== 'required')
      .map(extension => ({
        name: extensionChoiceName(extension.id),
        value: extension.id,
        checked: defaults.includes(extension.id),
      })),
  }])

  const requiredInstalled = installed.has(REQUIRED_PI_EXTENSION.packageSpec)
  let installRequiredPackage = false
  if (!requiredInstalled) {
    const answer = await inquirer.prompt<{ install: boolean }>([{
      type: 'confirm',
      name: 'install',
      message: `Install required package with: pi install ${REQUIRED_PI_EXTENSION.packageSpec}?`,
      default: true,
    }])
    installRequiredPackage = answer.install
  }

  const priorById = new Map((metadata?.extensions ?? []).map(entry => [entry.id, entry]))
  const deselectedOwned = previous.filter(entry => !selectedIds.includes(entry.id) && entry.ownership === 'ccg-installed')
  const operations = [
    ...(!requiredInstalled && installRequiredPackage ? [`install ${REQUIRED_PI_EXTENSION.packageSpec}`] : []),
    ...selectedIds.flatMap((id) => {
      const extension = getPiExtension(id)
      return extension && !installed.has(extension.packageSpec)
        ? [`install ${extension.packageSpec}`]
        : []
    }),
    ...deselectedOwned.map(entry => `remove ${entry.packageSpec}`),
  ]

  if (operations.length > 0) {
    console.log(ansis.cyan('\n  Planned package operations:'))
    for (const operation of operations) console.log(`  - pi ${operation}`)
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: 'Run these third-party package operations?',
      default: false,
    }])
    if (!confirm) {
      console.log(ansis.yellow('  Extension changes cancelled.'))
      return
    }
  }

  const errors: string[] = []
  const failedRemovals: PiExtensionMetadataEntry[] = []
  for (const entry of deselectedOwned) {
    const result = await runPiPackageCommand('remove', entry.packageSpec, { piHome })
    if (!result.success) {
      errors.push(`${result.command}: ${result.stderr || `exit ${result.exitCode ?? 'unknown'}`}`)
      failedRemovals.push({ ...entry, selected: false, updatedAt: new Date().toISOString() })
    }
  }

  const result = await applyPiExtensionSelection({
    selectedIds,
    installRequiredPackage,
    piHome,
    previous: [...priorById.values()],
  })
  errors.push(...result.errors)
  await updateCcgMetadata({ extensions: [...result.entries, ...failedRemovals] }, metadataPath)

  if (errors.length > 0) {
    console.log(ansis.yellow('\n  Extension configuration saved with errors:'))
    for (const error of errors) console.log(ansis.red(`  - ${error}`))
    return
  }
  console.log(ansis.green('\n  ✓ Extension configuration updated.'))
}
