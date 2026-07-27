// CCG for Pi CLI — dynamic supervisor with bounded intelligent subagents
export * from './types'
export { doctor, status } from './commands/doctor'
export { init } from './commands/init'
export { showMainMenu } from './commands/menu'
export { performUpdate, update } from './commands/update'
export { i18n, initI18n, changeLanguage } from './i18n'
export {
  installManagedAgentsBlock,
  installPiAgents,
  installPiChain,
  installPiPromptWorkflow,
  installPiProviders,
  installPiSettingsOverrides,
  installPiWorkflow,
  installProjectPiSettings,
  installSubagentExtensionConfig,
  uninstallPiWorkflow,
} from './utils/installer'
export type {
  PiInstallContext,
  PiInstallOptions,
  PiModelOverrides,
  PiUninstallOptions,
  PiUninstallResult,
} from './utils/installer'
export {
  appendPiProviders,
  computeEffectiveDevParallelism,
  computeRequiredSpawns,
  mergePiSettingsSubagents,
  mergeSubagentExtensionConfig,
} from './utils/pi-config'
export * from './utils/pi-paths'
export {
  getCurrentVersion,
  getLatestVersion,
  checkForUpdates,
  compareVersions,
} from './utils/version'
