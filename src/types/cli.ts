import type { CcgConfig, InitOptions, SupportedLang } from '../types'

export interface CliOptions extends InitOptions {
  projectAssets?: boolean
  extensions?: string
  optionalExtensions?: boolean
}

export type { CcgConfig, SupportedLang }
