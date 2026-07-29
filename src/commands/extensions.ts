import type { PiExtensionMetadataEntry } from '../types'
import ansis from 'ansis'
import inquirer from 'inquirer'
import { join } from 'pathe'
import { i18n, initI18n } from '../i18n'
import { readCcgMetadata, updateCcgMetadata } from '../utils/config'
import {
  applyPiExtensionSelection,
  buildPiExtensionSelectionStates,
  getPiExtension,
  planPiExtensionExecution,
  presentPiExtensionChoice,
  presentPiExtensionLabel,
  presentPiExtensionOperation,
  presentPiExtensionSecuritySection,
  recommendedPiExtensionIds,
  REQUIRED_PI_EXTENSION,
  requiredPiExtensionState,
} from '../utils/pi-extensions'
import { getPiAgentHome } from '../utils/pi-paths'
import { applyPiExtensionConfigOperation, inspectPiWebSearchConfig } from '../utils/pi-extension-config'
import { inspectPiRuntime, runPiPackageCommand } from '../utils/pi-runtime'

export interface ExtensionsCommandOptions {
  installDir?: string
}

function optionalEntries(entries: readonly PiExtensionMetadataEntry[] | undefined): PiExtensionMetadataEntry[] {
  return (entries ?? []).filter(entry => entry.id !== REQUIRED_PI_EXTENSION.id && entry.selected)
}

function tx(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options) as string
}

export async function extensions(options: ExtensionsCommandOptions = {}): Promise<void> {
  const piHome = options.installDir ?? getPiAgentHome()
  const metadataPath = join(piHome, 'ccg-workflow.json')
  const metadata = await readCcgMetadata(metadataPath)
  await initI18n(metadata?.language === 'en' ? 'en' : 'zh-CN')
  const runtime = inspectPiRuntime(piHome)

  console.log(ansis.cyan.bold(`\n  ${tx('piExtensions.manage.title')}\n`))
  console.log(ansis.yellow(tx('piExtensions.warnings.execution')))
  console.log(ansis.gray(`${tx('piExtensions.warnings.credentials')}\n`))

  const previous = metadata?.extensions ?? []
  const defaults = metadata?.extensions
    ? optionalEntries(metadata.extensions).map(entry => entry.id)
    : recommendedPiExtensionIds()
  const initialStates = buildPiExtensionSelectionStates({
    previous,
    runtime,
    selectedIds: defaults,
    installRequiredPackage: !runtime.piSubagentsAvailable,
  })

  for (const state of initialStates) {
    const mark = state.checked ? ansis.green('✓') : ansis.gray('○')
    console.log(`  ${mark} ${presentPiExtensionChoice(state)} ${ansis.gray(state.extension.packageSpec)}`)
  }
  for (const line of presentPiExtensionSecuritySection(initialStates)) console.log(ansis.gray(line))

  if (!runtime.piAvailable) {
    console.log(ansis.red(`\n  ${tx('piExtensions.manage.unavailable')}\n`))
    return
  }

  const { selectedIds } = await inquirer.prompt<{ selectedIds: string[] }>([{
    type: 'checkbox',
    name: 'selectedIds',
    message: tx('piExtensions.manage.prompt'),
    choices: initialStates.map(state => ({
      name: presentPiExtensionChoice(state),
      value: state.extension.id,
      checked: state.checked,
      disabled: state.disabled ? tx('piExtensions.status.readOnly') : undefined,
    })),
  }])

  const postSelectionStates = buildPiExtensionSelectionStates({
    previous,
    runtime,
    selectedIds: selectedIds.filter(id => id !== REQUIRED_PI_EXTENSION.id),
    installRequiredPackage: selectedIds.includes(REQUIRED_PI_EXTENSION.id) && !runtime.piSubagentsAvailable,
  })
  const requiredState = requiredPiExtensionState(postSelectionStates)
  const executionPlan = planPiExtensionExecution({
    previous,
    states: postSelectionStates,
    webSearchConfig: await inspectPiWebSearchConfig(),
  })
  const operations = executionPlan.packages

  if (operations.length > 0 || executionPlan.configs.length > 0) {
    console.log(ansis.cyan(`\n  ${tx('piExtensions.operations.title')}`))
    for (const operation of operations) console.log(`  - ${presentPiExtensionOperation(operation)}`)
    for (const operation of executionPlan.configs) {
      console.log(`  - ${operation.action} ${operation.path}: ${operation.field}=${operation.value}`)
    }
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: tx('piExtensions.operations.confirm'),
      default: false,
    }])
    if (!confirm) {
      console.log(ansis.yellow(tx('piExtensions.operations.cancelled')))
      return
    }
  }

  const errors: string[] = []
  const failedRemovals: PiExtensionMetadataEntry[] = []
  for (const operation of operations.filter(item => item.action === 'remove')) {
    const entry = previous.find(item => item.id === operation.id)
    if (!entry) continue
    const result = await runPiPackageCommand('remove', entry.packageSpec, { piHome })
    if (!result.success) {
      errors.push(`${result.command}: ${result.stderr || `exit ${result.exitCode ?? 'unknown'}`}`)
      failedRemovals.push({ ...entry, selected: false, updatedAt: new Date().toISOString() })
    }
  }

  const result = await applyPiExtensionSelection({
    selectedIds: selectedIds.filter(id => id !== REQUIRED_PI_EXTENSION.id),
    installRequiredPackage: requiredState.installAuthorized,
    piHome,
    previous,
  })
  errors.push(...result.errors)
  const webAccessReady = result.entries.some(entry => entry.id === 'web-access' && entry.ownership !== 'missing')
  if (webAccessReady) {
    for (const operation of executionPlan.configs) {
      try {
        await applyPiExtensionConfigOperation(operation)
      }
      catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  await updateCcgMetadata({ extensions: [...result.entries, ...failedRemovals] }, metadataPath)

  if (errors.length > 0) {
    console.log(ansis.yellow(`\n  ${tx('piExtensions.manage.savedWithErrors')}`))
    for (const error of errors) console.log(ansis.red(`  - ${error}`))
    return
  }
  console.log(ansis.green(`\n  ${tx('piExtensions.manage.updated')}`))
  if (requiredState.status === 'runtime-unavailable') {
    console.log(ansis.yellow(tx('piExtensions.manage.runtimeWarning')))
  }
}
