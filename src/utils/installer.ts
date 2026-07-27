import type { CcgInstallerMetadata, InstallResult, ManagedFileEntry, PiCapsConfig } from '../types'
import type { PiProvider, PiSubagentsSettings } from './pi-config'
import { homedir } from 'node:os'
import ansis from 'ansis'
import fs from 'fs-extra'
import { basename, dirname, isAbsolute, join, relative } from 'pathe'
import { getLegacyCommandIds, getWorkflowById } from './installer-data'
import {
  PACKAGE_ROOT,
  assertNoLegacyResidue,
  injectConfigVariables,
  injectPiTemplateVariables,
  replaceHomePathsInTemplate,
  replacePiHomePathsInTemplate,
  removeManagedBlock,
  upsertManagedBlock,
} from './installer-template'
import { readCcgConfig, readCcgMetadata, updateCcgMetadata } from './config'
import { appendPiProviders, mergePiSettingsSubagents, mergeSubagentExtensionConfig } from './pi-config'
import {
  DEFAULT_PI_CAPS,
  getPiAgentHome,
  getProjectAgentsMdPath,
  getProjectMcpExamplePath,
  getProjectPiChainsDir,
  getProjectPiPromptsDir,
  getProjectPiSettingsPath,
} from './pi-paths'
import { installSkillCommands } from './skill-registry'
import { version as packageVersion } from '../../package.json'

// ═══════════════════════════════════════════════════════
// Re-exports — all consumers import from './installer'
// These re-exports preserve backward compatibility.
// ═══════════════════════════════════════════════════════

export {
  getAllCommandIds,
  getCoreCommandIds,
  getLegacyCommandIds,
  getWorkflowById,
  getWorkflowConfigs,
  getWorkflowPreset,
  WORKFLOW_PRESETS,
} from './installer-data'
export type { WorkflowPreset } from './installer-data'

export { injectConfigVariables } from './installer-template'

export {
  installAceTool,
  installAceToolRs,
  installContextWeaver,
  installFastContext,
  installMcpServer,
  syncMcpToCodex,
  syncMcpToGemini,
  uninstallAceTool,
  uninstallContextWeaver,
  uninstallFastContext,
  uninstallMcpServer,
} from './installer-mcp'
export type { ContextWeaverConfig } from './installer-mcp'

export {
  removeFastContextPrompt,
  writeFastContextPrompt,
} from './installer-prompt'

export {
  collectInvocableSkills,
  collectSkills,
  parseFrontmatter,
} from './skill-registry'
export type { SkillMeta } from './skill-registry'

// ═══════════════════════════════════════════════════════
// Binary version tracking
// ═══════════════════════════════════════════════════════

/**
 * Expected codeagent-wrapper binary version.
 * Must match the `version` constant in codeagent-wrapper/main.go.
 * When this differs from the installed binary, update triggers re-download.
 */
const EXPECTED_BINARY_VERSION = '5.12.0'

// ═══════════════════════════════════════════════════════
// Install context — shared across sub-functions
// ═══════════════════════════════════════════════════════

interface InstallConfig {
  routing: {
    mode: string
    frontend: { models: string[], primary: string }
    backend: { models: string[], primary: string }
    review: { models: string[] }
    geminiModel?: string
    grokModel?: string
  }
  liteMode: boolean
  mcpProvider: string
  skipImpeccable?: boolean
}

interface InstallContext {
  installDir: string
  force: boolean
  config: InstallConfig
  templateDir: string
  result: InstallResult
}

export interface PiModelOverrides {
  frontendModel?: string
  backendModel?: string
  reviewModel?: string
}

export interface PiInstallOptions extends PiModelOverrides {
  piHome?: string
  projectDir?: string
  installProjectAssets?: boolean
  caps?: Partial<PiCapsConfig>
  force?: boolean
  providers?: Record<string, PiProvider>
  forceProviderUpdate?: boolean
  templateDir?: string
}

export interface PiInstallContext extends PiModelOverrides {
  piHome: string
  projectDir: string
  installProjectAssets: boolean
  caps: PiCapsConfig
  templateDir: string
  force: boolean
  managedFiles: ManagedFileEntry[]
  result: InstallResult
}

// ═══════════════════════════════════════════════════════
// Binary download
// ═══════════════════════════════════════════════════════

const GITHUB_REPO = 'fengshao1227/pi-ccg'
const RELEASE_TAG = 'preset'

/** Download sources: R2 CDN first (China-friendly) → GitHub fallback (global) */
const BINARY_SOURCES = [
  { name: 'Cloudflare CDN', url: 'https://github.20031227.xyz/preset', timeoutMs: 30_000 },
  { name: 'GitHub Release', url: `https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}`, timeoutMs: 120_000 },
]

/**
 * Download binary from a single URL with retry.
 * Uses curl for proxy support (reads HTTPS_PROXY / ALL_PROXY env vars automatically).
 * Falls back to Node.js fetch if curl is unavailable.
 */
async function downloadFromUrl(url: string, destPath: string, timeoutMs: number, maxAttempts = 2): Promise<boolean> {
  const timeoutSec = Math.ceil(timeoutMs / 1000)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Prefer curl — auto-reads HTTPS_PROXY / ALL_PROXY for proxy support
      const { execSync } = await import('node:child_process')
      execSync(
        `curl -fsSL --max-time ${timeoutSec} -o "${destPath}" "${url}"`,
        { stdio: 'pipe', timeout: timeoutMs + 5000 },
      )

      if (process.platform !== 'win32') {
        await fs.chmod(destPath, 0o755)
      }
      return true
    }
    catch {
      // curl failed — try Node.js fetch as fallback (no proxy support)
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
        if (!response.ok) {
          clearTimeout(timer)
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, attempt * 2000))
            continue
          }
          return false
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        clearTimeout(timer)

        await fs.writeFile(destPath, buffer)
        if (process.platform !== 'win32') {
          await fs.chmod(destPath, 0o755)
        }
        return true
      }
      catch {
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, attempt * 2000))
          continue
        }
        return false
      }
    }
  }
  return false
}

/**
 * Download codeagent-wrapper binary with dual-source fallback.
 * Strategy: R2 mirror (60s) → GitHub Release (120s). Uses curl for proxy support.
 */
async function downloadBinaryFromRelease(binaryName: string, destPath: string): Promise<boolean> {
  for (const source of BINARY_SOURCES) {
    const url = `${source.url}/${binaryName}`
    const ok = await downloadFromUrl(url, destPath, source.timeoutMs)
    if (ok) return true
  }
  return false
}

// ═══════════════════════════════════════════════════════
// Shared file-copy helper
// ═══════════════════════════════════════════════════════

/**
 * Copy .md templates from srcDir → destDir with optional variable injection.
 * Returns list of installed file stems (filename without .md).
 */
async function copyMdTemplates(
  ctx: InstallContext,
  srcDir: string,
  destDir: string,
  options: { inject?: boolean } = {},
): Promise<string[]> {
  const installed: string[] = []
  if (!(await fs.pathExists(srcDir))) {
    // Log warning — helps diagnose "0 commands installed" issues
    console.error(`[CCG] Template source directory not found: ${srcDir}`)
    return installed
  }

  await fs.ensureDir(destDir)
  const files = await fs.readdir(srcDir)
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const destFile = join(destDir, file)
    if (ctx.force || !(await fs.pathExists(destFile))) {
      let content = await fs.readFile(join(srcDir, file), 'utf-8')
      if (options.inject) content = injectConfigVariables(content, ctx.config)
      content = replaceHomePathsInTemplate(content, ctx.installDir)
      await fs.writeFile(destFile, content, 'utf-8')
      installed.push(file.replace('.md', ''))
    }
  }
  return installed
}

// ═══════════════════════════════════════════════════════
// Install sub-steps
// ═══════════════════════════════════════════════════════

/**
 * Install slash command .md files from templates/commands/
 */
async function installCommandFiles(ctx: InstallContext, workflowIds: string[]): Promise<void> {
  const commandsDir = join(ctx.installDir, 'commands', 'ccg')
  const legacyIds = new Set(getLegacyCommandIds())

  for (const workflowId of workflowIds) {
    const workflow = getWorkflowById(workflowId)
    if (!workflow) {
      ctx.result.errors.push(`Unknown workflow: ${workflowId}`)
      continue
    }

    for (const cmd of workflow.commands) {
      // Route to correct source directory: core → commands/, legacy → commands-legacy/
      const srcSubdir = legacyIds.has(workflowId) ? 'commands-legacy' : 'commands'
      const srcFile = join(ctx.templateDir, srcSubdir, `${cmd}.md`)
      const destFile = join(commandsDir, `${cmd}.md`)

      try {
        if (await fs.pathExists(srcFile)) {
          if (ctx.force || !(await fs.pathExists(destFile))) {
            let content = await fs.readFile(srcFile, 'utf-8')
            content = injectConfigVariables(content, ctx.config)
            content = replaceHomePathsInTemplate(content, ctx.installDir)
            await fs.writeFile(destFile, content, 'utf-8')
          }
          ctx.result.installedCommands.push(cmd)
        }
        else {
          const placeholder = `---
description: "${workflow.descriptionEn}"
---

# /ccg:${cmd}

${workflow.description}

> This command is part of CCG multi-model collaboration system.
`
          await fs.writeFile(destFile, placeholder, 'utf-8')
          ctx.result.installedCommands.push(cmd)
        }
      }
      catch (error) {
        ctx.result.errors.push(`Failed to install ${cmd}: ${error}`)
        ctx.result.success = false
      }
    }
  }
}

/**
 * Install agent .md files from templates/commands/agents/
 */
async function installAgentFiles(ctx: InstallContext): Promise<void> {
  try {
    await copyMdTemplates(
      ctx,
      join(ctx.templateDir, 'commands', 'agents'),
      join(ctx.installDir, 'agents', 'ccg'),
      { inject: true },
    )
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install agents: ${error}`)
    ctx.result.success = false
  }
}

/**
 * Install expert prompt .md files from templates/prompts/{codex,gemini,claude}/
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
async function installPromptFiles(ctx: InstallContext): Promise<void> {
  const promptsTemplateDir = join(ctx.templateDir, 'prompts')
  const promptsDir = join(ctx.installDir, '.ccg', 'prompts')
  if (!(await fs.pathExists(promptsTemplateDir))) {
    ctx.result.errors.push(`Prompts template directory not found: ${promptsTemplateDir}`)
    return
  }

  for (const model of ['codex', 'gemini', 'claude', 'antigravity', 'grok']) {
    try {
      const installed = await copyMdTemplates(
        ctx,
        join(promptsTemplateDir, model),
        join(promptsDir, model),
      )
      for (const name of installed) {
        ctx.result.installedPrompts.push(`${model}/${name}`)
      }
    }
    catch (error) {
      ctx.result.errors.push(`Failed to install ${model} prompts: ${error}`)
      ctx.result.success = false
    }
  }
}

/**
 * Recursively collect skill names (directories containing SKILL.md, excludes root).
 * Used by both install (count) and uninstall (list names).
 */
async function collectSkillNames(dir: string, depth = 0): Promise<string[]> {
  const names: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        names.push(...await collectSkillNames(join(dir, entry.name), depth + 1))
      }
      else if (entry.name === 'SKILL.md' && depth > 0) {
        names.push(basename(dir))
      }
    }
  }
  catch (error) {
    // Only suppress ENOENT (dir not found); log other errors that indicate real problems
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.error(`[CCG] Failed to read skills directory ${dir}: ${code || error}`)
    }
  }
  return names
}

/**
 * Remove a directory and collect .md file stems. Returns [] if dir doesn't exist.
 */
async function removeDirCollectMdNames(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return []
  const files = await fs.readdir(dir)
  const names = files.filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
  await fs.remove(dir)
  return names
}

/**
 * Install skill files from templates/skills/ → ~/.claude/skills/ccg/
 * Includes v1.7.73 legacy layout migration.
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
async function installSkillFiles(ctx: InstallContext): Promise<void> {
  const skillsTemplateDir = join(ctx.templateDir, 'skills')
  const skillsDestDir = join(ctx.installDir, 'skills', 'ccg')

  // Report error instead of silently returning when template dir is missing
  if (!(await fs.pathExists(skillsTemplateDir))) {
    ctx.result.errors.push(`Skills template directory not found: ${skillsTemplateDir}`)
    return
  }

  try {
    // Migration: move old v1.7.73 layout into skills/ccg/ namespace
    const oldSkillsRoot = join(ctx.installDir, 'skills')
    const ccgLegacyItems = ['tools', 'orchestration', 'SKILL.md', 'run_skill.js']
    const needsMigration = !await fs.pathExists(skillsDestDir)
      && await fs.pathExists(join(oldSkillsRoot, 'tools'))
    if (needsMigration) {
      await fs.ensureDir(skillsDestDir)
      for (const item of ccgLegacyItems) {
        const oldPath = join(oldSkillsRoot, item)
        const newPath = join(skillsDestDir, item)
        if (await fs.pathExists(oldPath)) {
          try {
            await fs.move(oldPath, newPath, { overwrite: true })
          }
          catch (moveErr) {
            // Windows: file locking can cause move to fail — log but continue
            ctx.result.errors.push(`Skills migration: failed to move ${item}: ${moveErr}`)
          }
        }
      }
    }

    // Recursive copy: preserves full directory tree
    // Always overwrite to ensure fresh install gets all files
    await fs.copy(skillsTemplateDir, skillsDestDir, {
      overwrite: true,
      errorOnExist: false,
    })

    // Remove security domain files — contains red team/pentest reference content
    // that triggers antivirus/corporate security tool false positives.
    // Users who need it can manually copy from templates/skills/domains/security/.
    const securityDir = join(skillsDestDir, 'domains', 'security')
    if (await fs.pathExists(securityDir)) {
      await fs.remove(securityDir)
    }

    // Post-copy: apply template variable replacement to .md files
    const replacePathsInDir = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await replacePathsInDir(fullPath)
        }
        else if (entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8')
          const processed = replaceHomePathsInTemplate(content, ctx.installDir)
          if (processed !== content) {
            await fs.writeFile(fullPath, processed, 'utf-8')
          }
        }
      }
    }
    await replacePathsInDir(skillsDestDir)

    // Post-copy validation: verify at least one SKILL.md was actually copied
    const installedSkills = await collectSkillNames(skillsDestDir)
    ctx.result.installedSkills = installedSkills.length

    if (installedSkills.length === 0) {
      ctx.result.errors.push(
        `Skills copy completed but no SKILL.md found in ${skillsDestDir}. `
        + `Possible cause: file locking (antivirus), permission denied, or path too long. `
        + `Try running as administrator or disabling antivirus real-time scanning temporarily.`,
      )
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install skills: ${error}`)
    ctx.result.success = false
  }
}

/**
 * Auto-generate slash commands for user-invocable skills via Skill Registry.
 *
 * Scans templates/skills/ for SKILL.md files with `user-invocable: true` frontmatter,
 * then generates ~/.claude/commands/ccg/{name}.md for each — SKIPPING any name that
 * already exists in installer-data.ts to avoid conflicts with complex multi-model commands.
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
async function installSkillGeneratedCommands(ctx: InstallContext): Promise<void> {
  const skillsTemplateDir = join(ctx.templateDir, 'skills')
  const skillsInstallDir = join(ctx.installDir, 'skills', 'ccg')
  const commandsDir = join(ctx.installDir, 'commands', 'ccg')

  if (!(await fs.pathExists(skillsTemplateDir))) return

  try {
    // Collect names of commands already installed by installer-data.ts
    const existingCommandNames = new Set<string>()
    const existingFiles = await fs.readdir(commandsDir).catch(() => [] as string[])
    for (const f of existingFiles) {
      if (f.endsWith('.md')) {
        existingCommandNames.add(basename(f, '.md'))
      }
    }

    const skipCategories: import('./skill-registry').SkillCategory[] = []
    if (ctx.config.skipImpeccable) {
      skipCategories.push('impeccable')
    }

    const generated = await installSkillCommands(
      skillsTemplateDir,
      skillsInstallDir,
      commandsDir,
      existingCommandNames,
      skipCategories,
    )

    if (generated.length > 0) {
      ctx.result.installedCommands.push(...generated)
      ctx.result.installedSkillCommands = generated.length
    }
  }
  catch (error) {
    // Non-fatal: skill command generation failure shouldn't block installation
    ctx.result.errors.push(`Skill Registry command generation warning: ${error}`)
  }
}

/**
 * Install Codex-mode files: AGENTS.md + .codex/config.toml + .codex/agents/*.toml
 * These enable Codex CLI as an alternative lead orchestrator (Codex-led multi-model mode).
 * Files are installed to ~/.codex/ (global) and user copies AGENTS.md to project root.
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
export async function installCodexMode(): Promise<{ success: boolean, message: string }> {
  const codexTemplateDir = join(PACKAGE_ROOT, 'templates', 'codex')
  if (!(await fs.pathExists(codexTemplateDir))) {
    return { success: false, message: 'Codex template directory not found' }
  }

  try {
    const codexHome = join(homedir(), '.codex')
    await fs.ensureDir(join(codexHome, 'agents'))

    // Read CCG config once — reused for template variable injection across
    // AGENTS.md + hooks/ccg-workflow.py so model routing (frontend/backend)
    // stays consistent with what the user configured (issue: codex mode still
    // referenced gemini after the antigravity default switch).
    const config = await readCcgConfig()
    const injectOpts = {
      routing: config?.routing as any,
      liteMode: config?.performance?.liteMode || false,
      mcpProvider: config?.mcp?.provider || 'skip',
    }

    const configSrc = join(codexTemplateDir, 'config.toml')
    const configDest = join(codexHome, 'config.toml')
    if (await fs.pathExists(configSrc) && !(await fs.pathExists(configDest))) {
      await fs.copy(configSrc, configDest)
    }

    const agentsSrc = join(codexTemplateDir, 'agents')
    if (await fs.pathExists(agentsSrc)) {
      await fs.copy(agentsSrc, join(codexHome, 'agents'), { overwrite: true })
    }

    const agentsMdSrc = join(codexTemplateDir, 'AGENTS.md')
    if (await fs.pathExists(agentsMdSrc)) {
      // Always inject — injectConfigVariables falls back to sane defaults
      // (antigravity/codex) when no config, so placeholders never leak.
      let content = await fs.readFile(agentsMdSrc, 'utf-8')
      content = injectConfigVariables(content, injectOpts)
      content = replaceHomePathsInTemplate(content, join(homedir(), '.claude'))
      await fs.writeFile(join(codexHome, 'AGENTS.md'), content, 'utf-8')
    }

    // hooks/ — inject template variables into ccg-workflow.py so the guidance
    // it emits references the user's actual frontend model, not hardcoded gemini.
    const hooksSrc = join(codexTemplateDir, 'hooks')
    if (await fs.pathExists(hooksSrc)) {
      const hooksDest = join(codexHome, 'hooks')
      await fs.ensureDir(hooksDest)
      for (const file of await fs.readdir(hooksSrc)) {
        const srcFile = join(hooksSrc, file)
        const destFile = join(hooksDest, file)
        if (file.endsWith('.py')) {
          let content = await fs.readFile(srcFile, 'utf-8')
          content = injectConfigVariables(content, injectOpts)
          await fs.writeFile(destFile, content, 'utf-8')
        }
        else {
          await fs.copy(srcFile, destFile, { overwrite: true })
        }
      }
    }

    // hooks.json — resolve the `~/.codex/...` hook command to an absolute path.
    // Codex does not reliably expand `~` when spawning the hook command, so a
    // relative/tilde path made it look for `.codex/hooks/` in the project dir.
    const hooksJsonSrc = join(codexTemplateDir, 'hooks.json')
    if (await fs.pathExists(hooksJsonSrc)) {
      let content = await fs.readFile(hooksJsonSrc, 'utf-8')
      const absHome = homedir().replace(/\\/g, '/')
      content = content.replace(/~\//g, `${absHome}/`)
      await fs.writeFile(join(codexHome, 'hooks.json'), content, 'utf-8')
    }

    // Write version marker so external tools can check which CCG version installed Codex mode
    await fs.writeFile(join(codexHome, '.ccg-version'), packageVersion, 'utf-8')

    return {
      success: true,
      message: `Codex mode installed:\n  ~/.codex/AGENTS.md\n  ~/.codex/config.toml\n  ~/.codex/hooks.json\n  ~/.codex/hooks/ccg-workflow.py\n  ~/.codex/agents/ccg-implement.toml\n  ~/.codex/agents/ccg-review.toml\n  ~/.codex/agents/ccg-research.toml\n  ~/.codex/.ccg-version (${packageVersion})`,
    }
  }
  catch (error) {
    return { success: false, message: `Failed to install Codex mode: ${error}` }
  }
}

/**
 * Uninstall CCG Codex mode — only removes files installed by CCG, preserves user files.
 */
export async function uninstallCodexMode(): Promise<{ success: boolean, removed: string[], skipped: string[] }> {
  const codexHome = join(homedir(), '.codex')
  const removed: string[] = []
  const skipped: string[] = []

  // CCG-managed files (exact paths)
  const ccgFiles = [
    join(codexHome, 'agents', 'ccg-implement.toml'),
    join(codexHome, 'agents', 'ccg-review.toml'),
    join(codexHome, 'agents', 'ccg-research.toml'),
    join(codexHome, 'hooks', 'ccg-workflow.py'),
    join(codexHome, 'hooks.json'),
    join(codexHome, '.ccg-version'),
  ]

  // AGENTS.md — only remove if it contains CCG marker
  const agentsMd = join(codexHome, 'AGENTS.md')

  try {
    for (const file of ccgFiles) {
      if (await fs.pathExists(file)) {
        await fs.remove(file)
        removed.push(file.replace(homedir(), '~'))
      }
    }

    if (await fs.pathExists(agentsMd)) {
      const content = await fs.readFile(agentsMd, 'utf-8')
      if (content.includes('<!-- CCG:START')) {
        await fs.remove(agentsMd)
        removed.push('~/.codex/AGENTS.md')
      }
      else {
        skipped.push('~/.codex/AGENTS.md (not managed by CCG)')
      }
    }

    // config.toml — never delete (user may have custom settings)
    skipped.push('~/.codex/config.toml (preserved — may contain user settings)')

    // Clean up empty dirs
    for (const dir of ['agents', 'hooks']) {
      const dirPath = join(codexHome, dir)
      if (await fs.pathExists(dirPath)) {
        const files = await fs.readdir(dirPath)
        if (files.length === 0) {
          await fs.remove(dirPath)
          removed.push(`~/.codex/${dir}/ (empty, removed)`)
        }
      }
    }

    return { success: true, removed, skipped }
  }
  catch (error) {
    return { success: false, removed, skipped: [...skipped, `Error: ${error}`] }
  }
}

async function _installCodexFilesInternal(ctx: InstallContext): Promise<void> {
  const codexTemplateDir = join(ctx.templateDir, 'codex')
  if (!(await fs.pathExists(codexTemplateDir))) return

  try {
    const codexHome = join(homedir(), '.codex')
    await fs.ensureDir(join(codexHome, 'agents'))

    // .codex/config.toml (merge, don't overwrite user's existing config)
    const configSrc = join(codexTemplateDir, 'config.toml')
    const configDest = join(codexHome, 'config.toml')
    if (await fs.pathExists(configSrc)) {
      if (!(await fs.pathExists(configDest))) {
        await fs.copy(configSrc, configDest)
      }
    }

    // .codex/agents/*.toml
    const agentsSrc = join(codexTemplateDir, 'agents')
    if (await fs.pathExists(agentsSrc)) {
      await fs.copy(agentsSrc, join(codexHome, 'agents'), { overwrite: true })
    }

    // AGENTS.md → ~/.codex/AGENTS.md (global fallback)
    const agentsMdSrc = join(codexTemplateDir, 'AGENTS.md')
    if (await fs.pathExists(agentsMdSrc)) {
      await fs.copy(agentsMdSrc, join(codexHome, 'AGENTS.md'), { overwrite: true })
    }
  }
  catch (error) {
    // Non-fatal: Codex mode is optional
    ctx.result.errors.push(`Codex files install warning: ${error}`)
  }
}

/**
 * Install rule .md files from templates/rules/ → ~/.claude/rules/
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
async function installRuleFiles(ctx: InstallContext): Promise<void> {
  try {
    const installed = await copyMdTemplates(
      ctx,
      join(ctx.templateDir, 'rules'),
      join(ctx.installDir, 'rules'),
    )
    if (installed.length > 0) ctx.result.installedRules = true
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install rules: ${error}`)
  }
}

/** Resolve platform-specific binary name. Returns null for unsupported platforms. */
function getBinaryName(): string | null {
  const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' }
  const os = osMap[process.platform]
  if (!os) return null
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const ext = process.platform === 'win32' ? '.exe' : ''
  return `codeagent-wrapper-${os}-${arch}${ext}`
}

/**
 * Check if codeagent-wrapper binary exists and is functional.
 * Returns true if the binary passes `--version` check.
 */
export async function verifyBinary(installDir: string): Promise<boolean> {
  const binDir = join(installDir, 'bin')
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(binDir, wrapperName)

  if (!(await fs.pathExists(wrapperPath))) return false

  try {
    const { execSync } = await import('node:child_process')
    execSync(`"${wrapperPath}" --version`, { stdio: 'pipe' })
    return true
  }
  catch {
    return false
  }
}

/**
 * Check if installed binary version matches expected version.
 * Returns true if version matches, false if outdated or unreadable.
 */
export async function verifyBinaryVersion(installDir: string): Promise<boolean> {
  const binDir = join(installDir, 'bin')
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(binDir, wrapperName)

  try {
    const { execSync } = await import('node:child_process')
    const output = execSync(`"${wrapperPath}" --version`, { stdio: 'pipe' }).toString().trim()
    const version = output.replace(/^.*version\s*/, '')
    return version === EXPECTED_BINARY_VERSION
  }
  catch {
    return false
  }
}

/**
 * Show prominent red-box warning when codeagent-wrapper binary download failed.
 * Used by both init and update flows to provide manual fix instructions.
 */
export function showBinaryDownloadWarning(binDir: string): void {
  const binaryExt = process.platform === 'win32' ? '.exe' : ''
  const platformLabel = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-amd64')
    : process.platform === 'linux'
      ? (process.arch === 'arm64' ? 'linux-arm64' : 'linux-amd64')
      : (process.arch === 'arm64' ? 'windows-arm64' : 'windows-amd64')
  const binaryFileName = `codeagent-wrapper-${platformLabel}${binaryExt}`
  const destFileName = `codeagent-wrapper${binaryExt}`
  const releaseUrl = `https://github.com/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}`

  console.log()
  console.log(ansis.red.bold(`  ╔════════════════════════════════════════════════════════════╗`))
  console.log(ansis.red.bold(`  ║  ⚠  codeagent-wrapper 下载失败                            ║`))
  console.log(ansis.red.bold(`  ║     Binary download failed (network issue)                 ║`))
  console.log(ansis.red.bold(`  ╚════════════════════════════════════════════════════════════╝`))
  console.log()
  console.log(ansis.yellow(`  多模型协作命令 (/ccg:workflow, /ccg:plan 等) 需要此文件才能工作。`))
  console.log(ansis.yellow(`  Multi-model commands require this binary to work.`))
  console.log()
  console.log(ansis.cyan(`  手动修复 / Manual fix:`))
  console.log()
  console.log(ansis.white(`    1. 下载 / Download:`))
  console.log(ansis.cyan(`       ${releaseUrl}`))
  console.log(ansis.gray(`       → 找到 ${ansis.white(binaryFileName)} 并下载`))
  console.log()
  console.log(ansis.white(`    2. 放到 / Place at:`))
  const displayPath = process.platform === 'win32'
    ? `${binDir.replace(/\//g, '\\')}\\${destFileName}`
    : `${binDir}/${destFileName}`
  console.log(ansis.cyan(`       ${displayPath}`))
  console.log()
  if (process.platform !== 'win32') {
    console.log(ansis.white(`    3. 加权限 / Make executable:`))
    console.log(ansis.cyan(`       chmod +x "${binDir}/${destFileName}"`))
    console.log()
  }
  console.log(ansis.white(`    或重新安装 / Or re-install:`))
  console.log(ansis.cyan(`       npx pi-ccg@latest`))
  console.log()
}

/**
 * Download and install codeagent-wrapper binary for current platform.
 * Skips download if binary already exists and passes `--version` check.
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
async function installBinaryFile(ctx: InstallContext): Promise<void> {
  try {
    const binDir = join(ctx.installDir, 'bin')
    await fs.ensureDir(binDir)

    const binaryName = getBinaryName()
    if (!binaryName) {
      ctx.result.errors.push(`Unsupported platform: ${process.platform}`)
      ctx.result.success = false
      return
    }

    const destBinary = join(binDir, process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper')

    // Check if binary exists, is functional, AND version matches
    if (await fs.pathExists(destBinary)) {
      try {
        const { execSync } = await import('node:child_process')
        const versionOutput = execSync(`"${destBinary}" --version`, { stdio: 'pipe' }).toString().trim()
        const installedVersion = versionOutput.replace(/^.*version\s*/, '')

        // Compare with expected version from package
        const expectedVersion = EXPECTED_BINARY_VERSION
        if (installedVersion === expectedVersion) {
          // Binary exists, works, and version matches — skip download
          ctx.result.binPath = binDir
          ctx.result.binInstalled = true
          return
        }
        // Version mismatch — fall through to re-download
      }
      catch {
        // Binary exists but broken — fall through to re-download
      }
    }

    const installed = await downloadBinaryFromRelease(binaryName, destBinary)

    if (installed) {
      try {
        const { execSync } = await import('node:child_process')
        execSync(`"${destBinary}" --version`, { stdio: 'pipe' })
        ctx.result.binPath = binDir
        ctx.result.binInstalled = true
      }
      catch (verifyError) {
        ctx.result.errors.push(`Binary verification failed (non-blocking): ${verifyError}`)
      }
    }
    else {
      ctx.result.errors.push(`Failed to download binary: ${binaryName} from GitHub Release (after 3 attempts). Check network or visit https://github.com/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}`)
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install codeagent-wrapper (non-blocking): ${error}`)
  }
}

// ═══════════════════════════════════════════════════════
// CCG 3.0 Engine installation
// ═══════════════════════════════════════════════════════

/**
 * Install the unified /ccg entry point command.
 * Installed to ~/.claude/commands/ccg.md (NOT commands/ccg/) for clean /ccg invocation.
 */
async function installCcgEntryCommand(ctx: InstallContext): Promise<void> {
  const srcFile = join(ctx.templateDir, 'commands', 'ccg.md')
  const destFile = join(ctx.installDir, 'commands', 'ccg.md')

  try {
    if (await fs.pathExists(srcFile)) {
      if (ctx.force || !(await fs.pathExists(destFile))) {
        let content = await fs.readFile(srcFile, 'utf-8')
        content = injectConfigVariables(content, ctx.config)
        content = replaceHomePathsInTemplate(content, ctx.installDir)
        await fs.writeFile(destFile, content, 'utf-8')
      }
      ctx.result.installedCommands.push('ccg (unified entry)')
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install /ccg entry: ${error}`)
  }
}

/**
 * Install engine files from templates/engine/ → ~/.claude/.ccg/engine/
 * Includes model-router.md, phase-guide.md, and strategy files.
 * All .md files receive variable injection + path replacement.
 */
async function installEngineFiles(ctx: InstallContext): Promise<void> {
  const engineSrcDir = join(ctx.templateDir, 'engine')
  if (!(await fs.pathExists(engineSrcDir))) return

  const engineDestDir = join(ctx.installDir, '.ccg', 'engine')

  try {
    // Copy top-level engine .md files (model-router.md, phase-guide.md)
    await copyMdTemplates(ctx, engineSrcDir, engineDestDir, { inject: true })

    // Copy strategy files
    const strategiesSrc = join(engineSrcDir, 'strategies')
    const strategiesDest = join(engineDestDir, 'strategies')
    if (await fs.pathExists(strategiesSrc)) {
      await copyMdTemplates(ctx, strategiesSrc, strategiesDest, { inject: true })
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install engine files: ${error}`)
  }
}

// ═══════════════════════════════════════════════════════
// CCG 3.0 Hook installation
// ═══════════════════════════════════════════════════════

const HOOK_FILES = ['task-utils.js', 'workflow-state.js', 'session-start.js', 'subagent-context.js', 'skill-router.js']

/**
 * Install CCG hook scripts to ~/.claude/hooks/ccg/
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
async function installHookScripts(ctx: InstallContext): Promise<void> {
  const hooksSrcDir = join(ctx.templateDir, 'hooks')
  if (!(await fs.pathExists(hooksSrcDir))) return

  const hooksDestDir = join(ctx.installDir, 'hooks', 'ccg')
  await fs.ensureDir(hooksDestDir)

  try {
    for (const file of HOOK_FILES) {
      const src = join(hooksSrcDir, file)
      const dest = join(hooksDestDir, file)
      if (await fs.pathExists(src)) {
        await fs.copy(src, dest, { overwrite: true })
      }
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install hook scripts: ${error}`)
  }
}

/**
 * Register CCG hooks in ~/.claude/settings.json.
 * Merges with existing hooks — does not overwrite user's other hooks.
 * @deprecated Pi 化后仅 legacy 分支使用，plan step 9 移除。
 */
async function registerHooksInSettings(ctx: InstallContext): Promise<void> {
  const settingsPath = join(ctx.installDir, 'settings.json')
  const hooksDir = join(ctx.installDir, 'hooks', 'ccg')

  try {
    let settings: Record<string, unknown> = {}
    if (await fs.pathExists(settingsPath)) {
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'))
      }
      catch {
        settings = {}
      }
    }

    const hooks = (settings.hooks || {}) as Record<string, unknown[]>

    const ccgHookDefs = {
      UserPromptSubmit: {
        hooks: [
          { type: 'command', command: `node ${join(hooksDir, 'workflow-state.js')}`, timeout: 10000 },
          { type: 'command', command: `node ${join(hooksDir, 'skill-router.js')}`, timeout: 5000 },
        ],
      },
      SessionStart: {
        matcher: 'startup|clear|compact',
        hooks: [{ type: 'command', command: `node ${join(hooksDir, 'session-start.js')}`, timeout: 15000 }],
      },
      PreToolUse: {
        matcher: 'Bash|Agent',
        hooks: [{ type: 'command', command: `node ${join(hooksDir, 'subagent-context.js')}`, timeout: 15000 }],
      },
    }

    for (const [event, def] of Object.entries(ccgHookDefs)) {
      const eventHooks = (hooks[event] || []) as Record<string, unknown>[]
      const ccgCommand = (def.hooks[0] as Record<string, unknown>).command as string
      const existingIdx = eventHooks.findIndex((h) => {
        const hHooks = (h.hooks || []) as Record<string, unknown>[]
        return hHooks.some(hh => typeof hh.command === 'string' && hh.command.includes('hooks/ccg/'))
      })

      if (existingIdx >= 0) {
        eventHooks[existingIdx] = def
      }
      else {
        eventHooks.push(def)
      }
      hooks[event] = eventHooks
    }

    settings.hooks = hooks
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
  }
  catch (error) {
    ctx.result.errors.push(`Failed to register hooks in settings.json: ${error}`)
  }
}

// ═══════════════════════════════════════════════════════
// Pi workflow installation
// ═══════════════════════════════════════════════════════

function piAgentsDir(ctx: PiInstallContext): string {
  return join(ctx.piHome, 'agents')
}

function piChainsDir(ctx: PiInstallContext): string {
  return join(ctx.piHome, 'chains')
}

function piPromptsDir(ctx: PiInstallContext): string {
  return join(ctx.piHome, 'prompts')
}

function piSettingsPath(ctx: PiInstallContext): string {
  return join(ctx.piHome, 'settings.json')
}

function piModelsPath(ctx: PiInstallContext): string {
  return join(ctx.piHome, 'models.json')
}

function piSubagentExtensionConfigPath(ctx: PiInstallContext): string {
  return join(ctx.piHome, 'extensions', 'subagent', 'config.json')
}

function piTemplateVars(ctx: PiInstallContext): Parameters<typeof injectPiTemplateVariables>[1] {
  return {
    piAgentHome: ctx.piHome,
    piProjectDir: '.pi',
    devAgentCap: ctx.caps.devAgentCap,
    globalConcurrencyLimit: ctx.caps.globalConcurrencyLimit,
    maxSpawnsPerSession: ctx.caps.maxSpawnsPerSession,
    maxSubagentDepth: ctx.caps.maxSubagentDepth,
    frontendModel: ctx.frontendModel,
    backendModel: ctx.backendModel,
    reviewModel: ctx.reviewModel,
  }
}

function pushManagedFile(ctx: PiInstallContext, entry: ManagedFileEntry): void {
  ctx.managedFiles.push(entry)
  ctx.result.managedFiles = ctx.managedFiles
}

function pushProjectFile(ctx: PiInstallContext, filePath: string): void {
  ctx.result.installedProjectFiles ??= []
  if (!ctx.result.installedProjectFiles.includes(filePath)) {
    ctx.result.installedProjectFiles.push(filePath)
  }
}

function recordPiError(ctx: PiInstallContext, message: string): void {
  ctx.result.errors.push(message)
  ctx.result.success = false
}

function recordLegacyResidueError(ctx: PiInstallContext, filePath: string, residues: string[]): void {
  recordPiError(
    ctx,
    `Pi install rejected ${filePath}: forbidden legacy token(s) found after template injection: ${residues.join(', ')}`,
  )
}

function assertPiContentIsClean(ctx: PiInstallContext, filePath: string, content: string): boolean {
  const residues = assertNoLegacyResidue(content)
  if (residues.length > 0) {
    recordLegacyResidueError(ctx, filePath, residues)
    return false
  }
  return true
}

function renderPiTemplateContent(ctx: PiInstallContext, raw: string): string {
  let content = injectPiTemplateVariables(raw, piTemplateVars(ctx))
  content = replacePiHomePathsInTemplate(content)

  // replacePiHomePathsInTemplate() resolves literal ~/.pi/agent with the real home.
  // Tests inject piHome, so normalize that resolved default back to the scoped target.
  const defaultPiHome = getPiAgentHome()
  if (ctx.piHome !== defaultPiHome) {
    content = content.split(defaultPiHome).join(ctx.piHome)
  }

  return content
}

async function readRenderedPiTemplate(ctx: PiInstallContext, srcFile: string, destFile: string): Promise<string | null> {
  if (!(await fs.pathExists(srcFile))) {
    recordPiError(ctx, `Pi template source file not found: ${srcFile}`)
    return null
  }

  try {
    const raw = await fs.readFile(srcFile, 'utf-8')
    const content = renderPiTemplateContent(ctx, raw)
    if (!assertPiContentIsClean(ctx, destFile, content)) {
      return null
    }
    return content
  }
  catch (error) {
    recordPiError(ctx, `Failed to read Pi template ${srcFile}: ${error}`)
    return null
  }
}

type PiTemplateWriteResult = 'written' | 'skipped' | 'failed'

async function writeRenderedPiTemplate(
  ctx: PiInstallContext,
  srcFile: string,
  destFile: string,
  options: {
    managedKind?: ManagedFileEntry['kind']
    installName?: string
    resultKey?: 'installedPiAgents' | 'installedPiChains' | 'installedPiPrompts'
    projectFile?: boolean
    force?: boolean
  } = {},
): Promise<PiTemplateWriteResult> {
  const content = await readRenderedPiTemplate(ctx, srcFile, destFile)
  if (content === null) return 'failed'

  const shouldOverwrite = options.force ?? ctx.force
  if (!shouldOverwrite && await fs.pathExists(destFile)) {
    return 'skipped'
  }

  try {
    await fs.ensureDir(dirname(destFile))
    await fs.writeFile(destFile, content, 'utf-8')

    if (options.resultKey && options.installName) {
      const installed = ctx.result[options.resultKey] ?? []
      installed.push(options.installName)
      ctx.result[options.resultKey] = installed
    }

    pushManagedFile(ctx, { path: destFile, kind: options.managedKind ?? 'created' })
    if (options.projectFile) pushProjectFile(ctx, destFile)
    return 'written'
  }
  catch (error) {
    recordPiError(ctx, `Failed to write Pi file ${destFile}: ${error}`)
    return 'failed'
  }
}

/** Copy templates/pi/agents/*.md → <piHome>/agents/. */
export async function installPiAgents(ctx: PiInstallContext): Promise<void> {
  const agentsSrcDir = join(ctx.templateDir, 'agents')
  const agentsDestDir = piAgentsDir(ctx)

  if (!(await fs.pathExists(agentsSrcDir))) {
    recordPiError(ctx, `Pi agents template directory not found: ${agentsSrcDir}`)
    return
  }

  try {
    await fs.ensureDir(agentsDestDir)
    const files = await fs.readdir(agentsSrcDir)
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      await writeRenderedPiTemplate(
        ctx,
        join(agentsSrcDir, file),
        join(agentsDestDir, file),
        {
          installName: basename(file, '.md'),
          resultKey: 'installedPiAgents',
        },
      )
    }
  }
  catch (error) {
    recordPiError(ctx, `Failed to install Pi agents: ${error}`)
  }
}

/** Copy ccg-plan.chain.md to project .pi/chains/ or user-level piHome/chains/. */
export async function installPiChain(ctx: PiInstallContext): Promise<void> {
  const srcFile = join(ctx.templateDir, 'chains', 'ccg-plan.chain.md')
  const destDir = ctx.installProjectAssets ? getProjectPiChainsDir(ctx.projectDir) : piChainsDir(ctx)
  const destFile = join(destDir, 'ccg-plan.chain.md')

  await writeRenderedPiTemplate(ctx, srcFile, destFile, {
    installName: 'ccg-plan.chain',
    resultKey: 'installedPiChains',
    projectFile: ctx.installProjectAssets,
  })
}

/** Copy ccg-go.md to project .pi/prompts/ or user-level piHome/prompts/. */
export async function installPiPromptWorkflow(ctx: PiInstallContext): Promise<void> {
  const srcFile = join(ctx.templateDir, 'prompts', 'ccg-go.md')
  const destDir = ctx.installProjectAssets ? getProjectPiPromptsDir(ctx.projectDir) : piPromptsDir(ctx)
  const destFile = join(destDir, 'ccg-go.md')

  await writeRenderedPiTemplate(ctx, srcFile, destFile, {
    installName: 'ccg-go',
    resultKey: 'installedPiPrompts',
    projectFile: ctx.installProjectAssets,
  })
}

/** Upsert the CCG managed block into project AGENTS.md. */
export async function installManagedAgentsBlock(ctx: PiInstallContext): Promise<void> {
  if (!ctx.installProjectAssets) return

  const srcFile = join(ctx.templateDir, 'AGENTS.managed.md')
  const agentsMdPath = getProjectAgentsMdPath(ctx.projectDir)
  const blockBody = await readRenderedPiTemplate(ctx, srcFile, agentsMdPath)
  if (blockBody === null) return

  try {
    const existed = await fs.pathExists(agentsMdPath)
    const existing = existed ? await fs.readFile(agentsMdPath, 'utf-8') : null
    const nextContent = upsertManagedBlock(existing, blockBody.trimEnd())

    if (!assertPiContentIsClean(ctx, agentsMdPath, nextContent)) return
    if (existing === nextContent) return

    await fs.ensureDir(dirname(agentsMdPath))
    const backupPath = existed ? `${agentsMdPath}.bak` : undefined
    if (backupPath) {
      await fs.copy(agentsMdPath, backupPath)
    }

    await fs.writeFile(agentsMdPath, nextContent, 'utf-8')
    pushManagedFile(ctx, { path: agentsMdPath, kind: 'block', backupPath })
    pushProjectFile(ctx, agentsMdPath)
  }
  catch (error) {
    recordPiError(ctx, `Failed to install managed AGENTS.md block: ${error}`)
  }
}

/** Install project-level .pi/settings.json and .pi/mcp.json.example. */
export async function installProjectPiSettings(ctx: PiInstallContext): Promise<void> {
  if (!ctx.installProjectAssets) return

  const settingsSrc = join(ctx.templateDir, 'project', 'settings.json')
  const settingsDest = getProjectPiSettingsPath(ctx.projectDir)

  // 项目 settings.json 永不覆盖用户仓库中的现有配置，即使 force=true。
  if (!(await fs.pathExists(settingsDest))) {
    await writeRenderedPiTemplate(ctx, settingsSrc, settingsDest, {
      projectFile: true,
    })
  }
  else if (!(await fs.pathExists(settingsSrc))) {
    recordPiError(ctx, `Pi template source file not found: ${settingsSrc}`)
  }

  const mcpSrc = join(ctx.templateDir, 'mcp', 'nocturne.example.json')
  const mcpDest = getProjectMcpExamplePath(ctx.projectDir)
  await writeRenderedPiTemplate(ctx, mcpSrc, mcpDest, {
    projectFile: true,
  })
}

/** Merge pi-subagents extension caps into <piHome>/extensions/subagent/config.json. */
export async function installSubagentExtensionConfig(ctx: PiInstallContext): Promise<void> {
  const srcFile = join(ctx.templateDir, 'extensions', 'subagent-config.json')
  const destFile = piSubagentExtensionConfigPath(ctx)
  const content = await readRenderedPiTemplate(ctx, srcFile, destFile)
  if (content === null) return

  try {
    JSON.parse(content) as unknown
  }
  catch (error) {
    recordPiError(ctx, `Pi subagent extension template is not valid JSON: ${srcFile}: ${error}`)
    return
  }

  if (await fs.pathExists(destFile)) {
    const existing = await fs.readFile(destFile, 'utf-8')
    if (!assertPiContentIsClean(ctx, destFile, existing)) return
  }

  try {
    await mergeSubagentExtensionConfig(ctx.caps, destFile)
    pushManagedFile(ctx, { path: destFile, kind: 'merged' })
  }
  catch (error) {
    recordPiError(ctx, `Failed to merge Pi subagent extension config: ${error}`)
  }
}

/** Merge model-specific subagent overrides into <piHome>/settings.json. */
export async function installPiSettingsOverrides(
  ctx: PiInstallContext,
  overrides: PiModelOverrides,
): Promise<void> {
  const agentOverrides: NonNullable<PiSubagentsSettings['agentOverrides']> = {}
  const addOverride = (agentName: string, model?: string): void => {
    const normalized = model?.trim()
    if (normalized) {
      agentOverrides[agentName] = { model: normalized }
    }
  }

  addOverride('ccg-backend-builder', overrides.backendModel)
  addOverride('ccg-frontend-builder', overrides.frontendModel)
  addOverride('ccg-miniprogram-builder', overrides.frontendModel)
  addOverride('ccg-reviewer', overrides.reviewModel)
  addOverride('ccg-test-runner', overrides.reviewModel)

  if (Object.keys(agentOverrides).length === 0) return

  const settingsPath = piSettingsPath(ctx)
  const patch: PiSubagentsSettings = { agentOverrides }

  if (!assertPiContentIsClean(ctx, settingsPath, JSON.stringify(patch))) return
  if (await fs.pathExists(settingsPath)) {
    const existing = await fs.readFile(settingsPath, 'utf-8')
    if (!assertPiContentIsClean(ctx, settingsPath, existing)) return
  }

  try {
    const mergeResult = await mergePiSettingsSubagents(patch, settingsPath)
    if (mergeResult.changed) {
      pushManagedFile(ctx, {
        path: settingsPath,
        kind: 'merged',
        backupPath: mergeResult.backupPath ?? undefined,
      })
    }
  }
  catch (error) {
    recordPiError(ctx, `Failed to merge Pi settings overrides: ${error}`)
  }
}

/** Append Pi model providers into <piHome>/models.json. */
export async function installPiProviders(
  ctx: PiInstallContext,
  providers: Record<string, PiProvider> = {},
  force = false,
): Promise<void> {
  if (Object.keys(providers).length === 0) return

  const modelsPath = piModelsPath(ctx)
  if (!assertPiContentIsClean(ctx, modelsPath, JSON.stringify(providers))) return
  if (await fs.pathExists(modelsPath)) {
    const existing = await fs.readFile(modelsPath, 'utf-8')
    if (!assertPiContentIsClean(ctx, modelsPath, existing)) return
  }

  try {
    const providerResult = await appendPiProviders(providers, { force, modelsPath })
    ctx.result.addedProviders ??= []
    ctx.result.skippedProviders ??= []
    ctx.result.addedProviders.push(...providerResult.added)
    ctx.result.skippedProviders.push(...providerResult.skipped)

    if (providerResult.added.length > 0) {
      pushManagedFile(ctx, { path: modelsPath, kind: 'merged' })
    }
  }
  catch (error) {
    recordPiError(ctx, `Failed to append Pi providers: ${error}`)
  }
}

async function hasMarkdownFile(dir: string): Promise<boolean> {
  if (!(await fs.pathExists(dir))) return false
  const entries = await fs.readdir(dir)
  return entries.some(entry => entry.endsWith('.md'))
}

function normalizePiCaps(caps?: Partial<PiCapsConfig>): PiCapsConfig {
  return {
    devAgentCap: caps?.devAgentCap ?? DEFAULT_PI_CAPS.devAgentCap,
    globalConcurrencyLimit: caps?.globalConcurrencyLimit ?? DEFAULT_PI_CAPS.globalConcurrencyLimit,
    maxSpawnsPerSession: caps?.maxSpawnsPerSession ?? DEFAULT_PI_CAPS.maxSpawnsPerSession,
    maxSubagentDepth: caps?.maxSubagentDepth ?? DEFAULT_PI_CAPS.maxSubagentDepth,
  }
}

export async function installPiWorkflow(options: PiInstallOptions = {}): Promise<InstallResult> {
  const piHome = options.piHome ?? getPiAgentHome()
  const projectDir = options.projectDir ?? process.cwd()
  const managedFiles: ManagedFileEntry[] = []
  const result: InstallResult = {
    success: true,
    installedCommands: [],
    installedPrompts: [],
    installedPiAgents: [],
    installedPiChains: [],
    installedPiPrompts: [],
    installedProjectFiles: [],
    managedFiles,
    errors: [],
    configPath: join(piHome, 'settings.json'),
    piHome,
    projectDir,
    addedProviders: [],
    skippedProviders: [],
  }

  const ctx: PiInstallContext = {
    piHome,
    projectDir,
    installProjectAssets: options.installProjectAssets ?? true,
    caps: normalizePiCaps(options.caps),
    templateDir: options.templateDir ?? join(PACKAGE_ROOT, 'templates', 'pi'),
    force: options.force ?? false,
    frontendModel: options.frontendModel,
    backendModel: options.backendModel,
    reviewModel: options.reviewModel,
    managedFiles,
    result,
  }

  await fs.ensureDir(piAgentsDir(ctx))
  await fs.ensureDir(join(ctx.piHome, 'extensions', 'subagent'))
  if (!ctx.installProjectAssets) {
    await fs.ensureDir(piChainsDir(ctx))
    await fs.ensureDir(piPromptsDir(ctx))
  }
  else {
    await fs.ensureDir(getProjectPiChainsDir(ctx.projectDir))
    await fs.ensureDir(getProjectPiPromptsDir(ctx.projectDir))
  }

  await installPiAgents(ctx)
  await installPiChain(ctx)
  await installPiPromptWorkflow(ctx)
  await installProjectPiSettings(ctx)
  await installManagedAgentsBlock(ctx)
  await installSubagentExtensionConfig(ctx)
  await installPiSettingsOverrides(ctx, {
    frontendModel: options.frontendModel,
    backendModel: options.backendModel,
    reviewModel: options.reviewModel,
  })
  await installPiProviders(ctx, options.providers, options.forceProviderUpdate ?? false)

  const agentsInstalled = await hasMarkdownFile(piAgentsDir(ctx))
  if (!agentsInstalled && ctx.result.errors.length === 0) {
    recordPiError(ctx, `No Pi agents were installed. Template dir: ${ctx.templateDir}`)
  }

  return ctx.result
}

// ═══════════════════════════════════════════════════════
// Public API: install / uninstall
// ═══════════════════════════════════════════════════════

export async function installWorkflows(
  workflowIds: string[],
  installDir: string,
  force = false,
  config?: {
    routing?: {
      mode?: string
      frontend?: { models?: string[], primary?: string }
      backend?: { models?: string[], primary?: string }
      review?: { models?: string[] }
      grokModel?: string
    }
    liteMode?: boolean
    mcpProvider?: string
    skipImpeccable?: boolean
    pi?: PiInstallOptions
  },
): Promise<InstallResult> {
  if (config?.pi) {
    return installPiWorkflow({
      ...config.pi,
      force: config.pi.force ?? force,
    })
  }

  const ctx: InstallContext = {
    installDir,
    force,
    config: {
      routing: config?.routing as InstallConfig['routing'] || {
        mode: 'smart',
        frontend: { models: ['antigravity'], primary: 'antigravity' },
        backend: { models: ['codex'], primary: 'codex' },
        review: { models: ['codex', 'antigravity'] },
      },
      liteMode: config?.liteMode || false,
      mcpProvider: config?.mcpProvider || 'fast-context',
      skipImpeccable: config?.skipImpeccable || false,
    },
    templateDir: join(PACKAGE_ROOT, 'templates'),
    result: {
      success: true,
      installedCommands: [],
      installedPrompts: [],
      errors: [],
      configPath: '',
    },
  }

  // ── Pre-flight: validate template directory exists ──
  // This is the #1 root cause of "silent install failure" on Windows:
  // if PACKAGE_ROOT resolved wrong, templateDir doesn't exist and every
  // sub-step silently returns empty results while reporting success.
  if (!(await fs.pathExists(ctx.templateDir))) {
    const errorMsg = `Template directory not found: ${ctx.templateDir} (PACKAGE_ROOT=${PACKAGE_ROOT}). `
      + `This usually means the npm package is incomplete or the cache is corrupted. `
      + `Try: npm cache clean --force && npx pi-ccg@latest`
    ctx.result.errors.push(errorMsg)
    ctx.result.success = false
    return ctx.result
  }

  // Ensure base directories
  await fs.ensureDir(join(installDir, 'commands', 'ccg'))
  await fs.ensureDir(join(installDir, '.ccg'))
  await fs.ensureDir(join(installDir, '.ccg', 'prompts'))
  await fs.ensureDir(join(installDir, '.ccg', 'engine', 'strategies'))

  // Execute each install step
  await installCommandFiles(ctx, workflowIds)
  await installEngineFiles(ctx)
  await installHookScripts(ctx)
  await registerHooksInSettings(ctx)
  await installAgentFiles(ctx)
  await installPromptFiles(ctx)
  await installSkillFiles(ctx)
  await installSkillGeneratedCommands(ctx)
  await installRuleFiles(ctx)
  await installBinaryFile(ctx)

  // ── Post-flight: validate installation produced results ──
  // Catch the case where all sub-steps silently returned empty
  if (ctx.result.installedCommands.length === 0 && ctx.result.errors.length === 0) {
    ctx.result.errors.push(
      `No commands were installed (expected ${workflowIds.length}). `
      + `Template dir: ${ctx.templateDir}. `
      + `This may indicate a corrupted package or file permission issue.`,
    )
    ctx.result.success = false
  }

  ctx.result.configPath = join(installDir, 'commands', 'ccg')
  return ctx.result
}

// ═══════════════════════════════════════════════════════
// Pi managed uninstall
// ═══════════════════════════════════════════════════════

const CCG_PI_AGENT_NAMES = [
  'ccg-project-scout',
  'ccg-planner',
  'ccg-backend-builder',
  'ccg-frontend-builder',
  'ccg-miniprogram-builder',
  'ccg-test-runner',
  'ccg-reviewer',
] as const

export interface PiUninstallOptions {
  piHome?: string
  projectDir?: string
  metadataPath?: string
}

export interface PiUninstallResult {
  success: boolean
  removed: string[]
  preserved: string[]
  errors: string[]
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function removeFileIfPresent(path: string, result: PiUninstallResult): Promise<void> {
  if (!(await fs.pathExists(path))) return
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) {
      result.preserved.push(path)
      return
    }
    await fs.remove(path)
    result.removed.push(path)
  }
  catch (error) {
    result.errors.push(`Failed to remove ${path}: ${error}`)
    result.success = false
  }
}

async function removeCcgPiOverrides(settingsPath: string, result: PiUninstallResult): Promise<void> {
  if (!(await fs.pathExists(settingsPath))) return
  try {
    const settings = await fs.readJson(settingsPath) as Record<string, unknown>
    const subagents = isJsonRecord(settings.subagents) ? { ...settings.subagents } : null
    const overrides = subagents && isJsonRecord(subagents.agentOverrides)
      ? { ...subagents.agentOverrides }
      : null
    if (!subagents || !overrides) {
      result.preserved.push(settingsPath)
      return
    }

    let changed = false
    for (const agent of CCG_PI_AGENT_NAMES) {
      if (Object.prototype.hasOwnProperty.call(overrides, agent)) {
        delete overrides[agent]
        changed = true
      }
    }
    if (!changed) {
      result.preserved.push(settingsPath)
      return
    }

    if (Object.keys(overrides).length === 0) delete subagents.agentOverrides
    else subagents.agentOverrides = overrides
    if (Object.keys(subagents).length === 0) delete settings.subagents
    else settings.subagents = subagents
    await fs.writeJson(settingsPath, settings, { spaces: 2 })
    result.removed.push(`${settingsPath}#subagents.agentOverrides.ccg-*`)
    result.preserved.push(`${settingsPath}#unrelated-settings`)
  }
  catch (error) {
    result.errors.push(`Failed to clean CCG model overrides from ${settingsPath}: ${error}`)
    result.success = false
  }
}

async function removeCcgCapKeys(configPath: string, result: PiUninstallResult): Promise<void> {
  if (!(await fs.pathExists(configPath))) return
  try {
    const config = await fs.readJson(configPath) as Record<string, unknown>
    let changed = false
    for (const key of ['globalConcurrencyLimit', 'maxSubagentSpawnsPerSession', 'maxSubagentDepth']) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        delete config[key]
        changed = true
      }
    }

    if (isJsonRecord(config.parallel)) {
      const parallel = { ...config.parallel }
      for (const key of ['concurrency', 'maxTasks']) {
        if (Object.prototype.hasOwnProperty.call(parallel, key)) {
          delete parallel[key]
          changed = true
        }
      }
      if (Object.keys(parallel).length === 0) delete config.parallel
      else config.parallel = parallel
    }

    if (changed) {
      await fs.writeJson(configPath, config, { spaces: 2 })
      result.removed.push(`${configPath}#ccg-cap-keys`)
    }
    result.preserved.push(`${configPath}#unrelated-extension-config`)
  }
  catch (error) {
    result.errors.push(`Failed to clean CCG cap keys from ${configPath}: ${error}`)
    result.success = false
  }
}

async function removeProjectAgentsBlock(projectDir: string, result: PiUninstallResult): Promise<void> {
  const agentsMdPath = getProjectAgentsMdPath(projectDir)
  if (!(await fs.pathExists(agentsMdPath))) return
  try {
    const existing = await fs.readFile(agentsMdPath, 'utf-8')
    const next = removeManagedBlock(existing)
    if (!next.removed) {
      result.preserved.push(agentsMdPath)
      return
    }
    if (next.content.length === 0) await fs.remove(agentsMdPath)
    else await fs.writeFile(agentsMdPath, next.content, 'utf-8')
    result.removed.push(`${agentsMdPath}#CCG-managed-block`)
    if (next.content.length > 0) result.preserved.push(`${agentsMdPath}#outside-managed-block`)
  }
  catch (error) {
    result.errors.push(`Failed to remove CCG managed AGENTS.md block: ${error}`)
    result.success = false
  }
}

/** Remove only CCG-managed Pi assets while preserving user providers, credentials and unrelated settings. */
export async function uninstallPiWorkflow(options: PiUninstallOptions = {}): Promise<PiUninstallResult> {
  const piHome = options.piHome ?? getPiAgentHome()
  const projectDir = options.projectDir ?? process.cwd()
  const metadataPath = options.metadataPath ?? join(piHome, 'ccg-workflow.json')
  const result: PiUninstallResult = { success: true, removed: [], preserved: [], errors: [] }

  let metadata: CcgInstallerMetadata | null = null
  if (await fs.pathExists(metadataPath)) {
    try {
      metadata = await fs.readJson(metadataPath) as CcgInstallerMetadata
    }
    catch (error) {
      result.errors.push(`Failed to read CCG metadata; using conservative fallback: ${error}`)
    }
  }

  for (const agent of CCG_PI_AGENT_NAMES) {
    await removeFileIfPresent(join(piHome, 'agents', `${agent}.md`), result)
  }
  await removeFileIfPresent(join(piHome, 'chains', 'ccg-plan.chain.md'), result)
  await removeFileIfPresent(join(piHome, 'prompts', 'ccg-go.md'), result)
  await removeFileIfPresent(join(getProjectPiChainsDir(projectDir), 'ccg-plan.chain.md'), result)
  await removeFileIfPresent(join(getProjectPiPromptsDir(projectDir), 'ccg-go.md'), result)
  await removeFileIfPresent(getProjectMcpExamplePath(projectDir), result)

  const manifestCreated = new Set(
    (metadata?.managedFiles ?? [])
      .filter(entry => entry.kind === 'created')
      .map(entry => entry.path),
  )
  const projectSettingsPath = getProjectPiSettingsPath(projectDir)
  if (manifestCreated.has(projectSettingsPath)) await removeFileIfPresent(projectSettingsPath, result)
  else if (await fs.pathExists(projectSettingsPath)) result.preserved.push(projectSettingsPath)

  await removeProjectAgentsBlock(projectDir, result)
  await removeCcgPiOverrides(join(piHome, 'settings.json'), result)
  await removeCcgCapKeys(join(piHome, 'extensions', 'subagent', 'config.json'), result)

  if (await fs.pathExists(join(piHome, 'models.json'))) {
    result.preserved.push(`${join(piHome, 'models.json')}#providers-and-credentials`)
  }
  const userMcpPath = join(projectDir, '.pi', 'mcp.json')
  if (await fs.pathExists(userMcpPath)) result.preserved.push(userMcpPath)
  await removeFileIfPresent(metadataPath, result)

  result.removed = [...new Set(result.removed)]
  result.preserved = [...new Set(result.preserved)]
  return result
}

// ═══════════════════════════════════════════════════════
// Uninstall
// ═══════════════════════════════════════════════════════

export interface UninstallResult {
  success: boolean
  removedCommands: string[]
  removedPrompts: string[]
  removedAgents: string[]
  removedSkills: string[]
  removedRules: boolean
  removedHooks: boolean
  removedBin: boolean
  errors: string[]
}

/**
 * Uninstall workflows by removing their command files.
 * @param options.preserveBinary — when true, skip binary removal (used during update)
 */
export async function uninstallWorkflows(installDir: string, options?: { preserveBinary?: boolean }): Promise<UninstallResult> {
  const result: UninstallResult = {
    success: true,
    removedCommands: [],
    removedPrompts: [],
    removedAgents: [],
    removedSkills: [],
    removedRules: false,
    removedHooks: false,
    removedBin: false,
    errors: [],
  }

  const commandsDir = join(installDir, 'commands', 'ccg')
  const agentsDir = join(installDir, 'agents', 'ccg')
  const skillsDir = join(installDir, 'skills', 'ccg')
  const rulesDir = join(installDir, 'rules')
  const binDir = join(installDir, 'bin')
  const ccgConfigDir = join(installDir, '.ccg')

  // Remove CCG commands directory
  try {
    result.removedCommands = await removeDirCollectMdNames(commandsDir)
  }
  catch (error) {
    result.errors.push(`Failed to remove commands directory: ${error}`)
    result.success = false
  }

  // Remove CCG agents directory
  try {
    result.removedAgents = await removeDirCollectMdNames(agentsDir)
  }
  catch (error) {
    result.errors.push(`Failed to remove agents directory: ${error}`)
    result.success = false
  }

  // Remove CCG skills directory only (skills/ccg/) — preserves user's own skills
  if (await fs.pathExists(skillsDir)) {
    try {
      result.removedSkills = await collectSkillNames(skillsDir)
      await fs.remove(skillsDir)
    }
    catch (error) {
      result.errors.push(`Failed to remove skills: ${error}`)
      result.success = false
    }
  }

  // Remove CCG rules files
  if (await fs.pathExists(rulesDir)) {
    try {
      for (const ruleFile of ['ccg-skills.md', 'ccg-grok-search.md', 'ccg-skill-routing.md', 'ccg-codegraph.md']) {
        const rulePath = join(rulesDir, ruleFile)
        if (await fs.pathExists(rulePath)) {
          await fs.remove(rulePath)
          result.removedRules = true
        }
      }
    }
    catch (error) {
      result.errors.push(`Failed to remove rules: ${error}`)
    }
  }

  // Remove codeagent-wrapper binary (skip during update to avoid unnecessary re-download)
  if (!options?.preserveBinary && await fs.pathExists(binDir)) {
    try {
      const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
      const wrapperPath = join(binDir, wrapperName)
      if (await fs.pathExists(wrapperPath)) {
        await fs.remove(wrapperPath)
        result.removedBin = true
      }
    }
    catch (error) {
      result.errors.push(`Failed to remove binary: ${error}`)
      result.success = false
    }
  }

  // Remove .ccg config directory (engine, prompts, strategies all live here)
  if (await fs.pathExists(ccgConfigDir)) {
    try {
      await fs.remove(ccgConfigDir)
      result.removedPrompts.push('ALL_PROMPTS_AND_CONFIGS')
    }
    catch (error) {
      result.errors.push(`Failed to remove .ccg directory: ${error}`)
    }
  }

  // Remove CCG hook scripts directory (hooks/ccg/) — added by the v3.0 engine.
  // Older uninstall logic predates the hook engine and left these behind.
  const hooksCcgDir = join(installDir, 'hooks', 'ccg')
  if (await fs.pathExists(hooksCcgDir)) {
    try {
      await fs.remove(hooksCcgDir)
      result.removedHooks = true
    }
    catch (error) {
      result.errors.push(`Failed to remove hooks directory: ${error}`)
      result.success = false
    }
  }

  // Deregister CCG hooks from settings.json — preserve the user's own hooks.
  // CCG hook entries are identified by a command path that points at hooks/ccg/.
  const settingsPath = join(installDir, 'settings.json')
  if (await fs.pathExists(settingsPath)) {
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<string, any>
      const hooks = settings.hooks as Record<string, any[]> | undefined
      if (hooks && typeof hooks === 'object') {
        const isCcgEntry = (h: any): boolean => {
          const hHooks = (h?.hooks || []) as any[]
          return hHooks.some(hh => typeof hh?.command === 'string' && /hooks[\\/]ccg[\\/]/.test(hh.command))
        }
        let modified = false
        for (const event of Object.keys(hooks)) {
          const arr = Array.isArray(hooks[event]) ? hooks[event] : []
          const filtered = arr.filter(h => !isCcgEntry(h))
          if (filtered.length !== arr.length) {
            modified = true
            if (filtered.length === 0) delete hooks[event]
            else hooks[event] = filtered
          }
        }
        if (modified) {
          if (Object.keys(hooks).length === 0) delete settings.hooks
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
          result.removedHooks = true
        }
      }
    }
    catch (error) {
      result.errors.push(`Failed to deregister hooks from settings.json: ${error}`)
    }
  }

  return result
}
