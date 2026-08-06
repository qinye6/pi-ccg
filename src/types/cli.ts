import type { CcgConfig, InitOptions, SupportedLang } from '../types'
import type { PiPersonaId } from '../utils/pi-personas'

export interface CliOptions extends InitOptions {
  projectAssets?: boolean
  extensions?: string
  optionalExtensions?: boolean
}

export interface StyleOptions {
  persona?: PiPersonaId | string
  installDir?: string
  projectDir?: string
}

export type { CcgConfig, SupportedLang }
