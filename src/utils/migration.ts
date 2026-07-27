/**
 * Migration utilities for v1.4.0
 * Handles automatic migration from old directory structure to new one
 */

import type { CcgConfig } from '../types'
import type { PiSubagentsSettings } from './pi-config'
import fs from 'fs-extra'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { parse } from 'smol-toml'
import { getLegacyClaudeConfigPath } from './pi-paths'

export interface MigrationResult {
  success: boolean
  migratedFiles: string[]
  errors: string[]
  skipped: string[]
}

/**
 * Migrate from v1.3.x to v1.4.0
 *
 * Changes:
 * 1. ~/.ccg/ → ~/.claude/.ccg/
 * 2. ~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/
 */
export async function migrateToV1_4_0(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migratedFiles: [],
    errors: [],
    skipped: [],
  }

  const oldCcgDir = join(homedir(), '.ccg')
  const newCcgDir = join(homedir(), '.claude', '.ccg')
  const oldPromptsDir = join(homedir(), '.claude', 'prompts', 'ccg')
  const newPromptsDir = join(newCcgDir, 'prompts')

  try {
    // Ensure new config directory exists
    await fs.ensureDir(newCcgDir)

    // 1. Migrate ~/.ccg/ → ~/.claude/.ccg/
    if (await fs.pathExists(oldCcgDir)) {
      const files = await fs.readdir(oldCcgDir)
      for (const file of files) {
        const srcFile = join(oldCcgDir, file)
        const destFile = join(newCcgDir, file)

        try {
          // Skip if destination already exists (don't overwrite)
          if (await fs.pathExists(destFile)) {
            result.skipped.push(`~/.ccg/${file} (already exists in new location)`)
            continue
          }

          // Copy file or directory
          await fs.copy(srcFile, destFile)
          result.migratedFiles.push(`~/.ccg/${file} → ~/.claude/.ccg/${file}`)
        }
        catch (error) {
          result.errors.push(`Failed to migrate ${file}: ${error}`)
          result.success = false
        }
      }

      // Remove old directory (only if migration succeeded and it's empty)
      try {
        const remaining = await fs.readdir(oldCcgDir)
        if (remaining.length === 0) {
          await fs.remove(oldCcgDir)
          result.migratedFiles.push('Removed old ~/.ccg/ directory')
        }
        else {
          result.skipped.push(`~/.ccg/ (not empty, keeping for safety)`)
        }
      }
      catch (error) {
        // It's okay if we can't remove the old directory
        result.skipped.push(`~/.ccg/ (could not remove: ${error})`)
      }
    }
    else {
      result.skipped.push('~/.ccg/ (does not exist, nothing to migrate)')
    }

    // 2. Migrate ~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/
    if (await fs.pathExists(oldPromptsDir)) {
      try {
        // Skip if destination already exists
        if (await fs.pathExists(newPromptsDir)) {
          result.skipped.push('~/.claude/prompts/ccg/ (already exists in new location)')
        }
        else {
          await fs.copy(oldPromptsDir, newPromptsDir)
          result.migratedFiles.push('~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/')

          // Remove old directory
          await fs.remove(oldPromptsDir)
          result.migratedFiles.push('Removed old ~/.claude/prompts/ccg/ directory')

          // Try to remove parent directory if empty
          const promptsParentDir = join(homedir(), '.claude', 'prompts')
          const remaining = await fs.readdir(promptsParentDir)
          if (remaining.length === 0) {
            await fs.remove(promptsParentDir)
            result.migratedFiles.push('Removed empty ~/.claude/prompts/ directory')
          }
        }
      }
      catch (error) {
        result.errors.push(`Failed to migrate prompts: ${error}`)
        result.success = false
      }
    }
    else {
      result.skipped.push('~/.claude/prompts/ccg/ (does not exist, nothing to migrate)')
    }
  }
  catch (error) {
    result.errors.push(`Migration failed: ${error}`)
    result.success = false
  }

  return result
}

/**
 * Check if migration is needed
 */
export async function needsMigration(): Promise<boolean> {
  // If config.toml exists with a version >= 2.0.0, skip migration entirely.
  // This prevents V3 users from triggering v1.4.0 migration due to stale
  // directories or getCurrentVersion() returning 0.0.0 on Windows npx cache.
  try {
    const configPath = join(homedir(), '.claude', '.ccg', 'config.toml')
    if (await fs.pathExists(configPath)) {
      const content = await fs.readFile(configPath, 'utf-8')
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/)
      if (versionMatch) {
        const major = Number.parseInt(versionMatch[1].split('.')[0], 10)
        if (major >= 2) return false
      }
    }
  }
  catch {
    // Config read failed, fall through to directory checks
  }

  const oldCcgDir = join(homedir(), '.ccg')
  const oldPromptsDir = join(homedir(), '.claude', 'prompts', 'ccg')
  const oldConfigFile = join(homedir(), '.claude', 'commands', 'ccg', '_config.md')

  const hasOldCcgDir = await fs.pathExists(oldCcgDir)
  const hasOldPromptsDir = await fs.pathExists(oldPromptsDir)
  const hasOldConfigFile = await fs.pathExists(oldConfigFile)

  return hasOldCcgDir || hasOldPromptsDir || hasOldConfigFile
}

function mapLegacyModel(model: string | undefined, modelMap: Partial<Record<string, string>>): string | undefined {
  if (model === undefined) {
    return undefined
  }

  return modelMap[model] ?? model
}

/**
 * 将旧版 Claude CCG 路由翻译为 Pi subagents 覆盖配置。
 */
export function translateLegacyClaudeConfig(
  legacy: CcgConfig,
  modelMap: Partial<Record<string, string>> = {},
): PiSubagentsSettings {
  const routing = legacy.routing
  const agentOverrides: NonNullable<PiSubagentsSettings['agentOverrides']> = {}

  const backendModel = mapLegacyModel(routing?.backend?.primary, modelMap)
  if (backendModel !== undefined) {
    agentOverrides['ccg-backend-builder'] = { model: backendModel }
  }

  const frontendModel = mapLegacyModel(routing?.frontend?.primary, modelMap)
  if (frontendModel !== undefined) {
    agentOverrides['ccg-frontend-builder'] = { model: frontendModel }
  }

  const reviewPrimary = routing?.review?.models?.[0] ?? routing?.backend?.primary
  const reviewerModel = mapLegacyModel(reviewPrimary, modelMap)
  if (reviewerModel !== undefined) {
    agentOverrides['ccg-reviewer'] = { model: reviewerModel }
  }

  if (Object.keys(agentOverrides).length === 0) {
    return {}
  }

  return { agentOverrides }
}

/**
 * 读取旧版 ~/.claude/.ccg/config.toml，缺失或无效时保持静默返回 null。
 */
export async function readLegacyClaudeConfigForMigration(): Promise<CcgConfig | null> {
  try {
    const configPath = getLegacyClaudeConfigPath()
    if (await fs.pathExists(configPath)) {
      const content = await fs.readFile(configPath, 'utf-8')
      return parse(content) as unknown as CcgConfig
    }
  }
  catch {
    // 旧配置不存在或格式无效时不产生副作用
  }

  return null
}
