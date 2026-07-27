import { homedir } from 'node:os'
import fs from 'fs-extra'
import { dirname, join } from 'pathe'

// ═══════════════════════════════════════════════════════
// Fast Context global prompt injection
// ═══════════════════════════════════════════════════════

const FAST_CONTEXT_PROMPT_PRIMARY = `# fast-context MCP 工具使用指南

## 核心原则

**任何需要理解代码上下文、探索性搜索、或自然语言定位代码的场景，优先使用 \`mcp__fast-context__fast_context_search\`**`

const FAST_CONTEXT_PROMPT_AUXILIARY = `# fast-context MCP 工具使用指南（辅助模式）

## 核心原则

**主检索工具为 ace-tool（\`mcp__ace-tool__search_context\`）。当 ace-tool 无法满足语义搜索需求时，使用 \`mcp__fast-context__fast_context_search\` 作为补充。**

适合使用 fast-context 的场景：
- 用自然语言描述要找的逻辑（如"部署流程"、"事件处理"）
- 跨模块、跨层级的调用链路追踪
- 中文语义搜索（工具支持中英文双语查询）`

const FAST_CONTEXT_PROMPT = `# fast-context MCP 工具使用指南

## 核心原则

**任何需要理解代码上下文、探索性搜索、或自然语言定位代码的场景，优先使用 \`mcp__fast-context__fast_context_search\`**

## 使用场景

### 必须用 fast_context_search
- 探索性搜索（不确定代码在哪个文件/目录）
- 用自然语言描述要找的逻辑（如"部署流程"、"事件处理"）
- 理解业务逻辑和调用链路
- 跨模块、跨层级查询（如从 router 追到 service 到 model）
- 新任务开始前的代码调研和架构理解
- 中文语义搜索（工具支持中英文双语查询）

### 根据需求选择工具
- **语义搜索 / 不确定位置** → \`mcp__fast-context__fast_context_search\`（返回文件+行号范围+grep关键词建议）
- **精确关键词搜索** → Grep
- **已知文件路径，查看内容** → Read
- **按文件名模式查找** → Glob
- **编辑已有文件** → Edit

### fast_context_search 参数调优
- \`tree_depth=1, max_turns=1\` — 快速粗查，适合小项目或初步定位
- \`tree_depth=3, max_turns=3\`（默认）— 平衡精度与速度，适合大多数场景
- \`max_turns=5\` — 深度搜索，适合复杂调用链追踪
- \`project_path\` — 指定搜索的项目根目录，默认为当前工作目录

### 禁止行为
- ❌ 猜测代码位置（"应该在 service/firmware 里"）
- ❌ 跳过搜索直接回答（"根据框架惯例，应该是..."）
- ❌ 遇到搜索就启动子代理（fast-context + Grep 组合优先）

### 子代理使用条件
仅当需要读取 10+ 文件交叉比对、或多轮搜索会撑爆上下文时，才启动子代理。
`

const FC_MARKER_START = '<!-- CCG-FAST-CONTEXT-START -->'
const FC_MARKER_END = '<!-- CCG-FAST-CONTEXT-END -->'

/**
 * Write fast-context search guidance to:
 * 1. ~/.claude/rules/ccg-fast-context.md (Claude Code — auto-loaded via rules/)
 * 2. ~/.codex/AGENTS.md (Codex CLI — auto-loaded as global instructions)
 * 3. ~/.gemini/GEMINI.md (Gemini CLI — auto-loaded as global instructions)
 */
export async function writeFastContextPrompt(auxiliaryMode = false): Promise<void> {
  const promptContent = auxiliaryMode ? FAST_CONTEXT_PROMPT_AUXILIARY : FAST_CONTEXT_PROMPT_PRIMARY
  const markerStart = FC_MARKER_START
  const markerEnd = FC_MARKER_END
  const markedBlock = `\n${markerStart}\n${promptContent}\n${markerEnd}\n`
  const markerRegex = new RegExp(
    `\\n?${markerStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${markerEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
  )

  // Helper: append or replace marked block in a file
  async function injectIntoFile(filePath: string): Promise<void> {
    const dir = dirname(filePath)
    await fs.ensureDir(dir)
    if (await fs.pathExists(filePath)) {
      let content = await fs.readFile(filePath, 'utf-8')
      if (content.includes(markerStart)) {
        content = content.replace(markerRegex, markedBlock)
      }
      else {
        content += markedBlock
      }
      await fs.writeFile(filePath, content, 'utf-8')
    }
    else {
      await fs.writeFile(filePath, markedBlock.trim() + '\n', 'utf-8')
    }
  }

  // 1. Claude Code rules (standalone file, not appended)
  const rulesDir = join(homedir(), '.claude', 'rules')
  await fs.ensureDir(rulesDir)
  await fs.writeFile(join(rulesDir, 'ccg-fast-context.md'), promptContent, 'utf-8')

  // 2. Codex CLI global instructions (~/.codex/AGENTS.md)
  await injectIntoFile(join(homedir(), '.codex', 'AGENTS.md'))

  // 3. Gemini CLI global instructions (~/.gemini/GEMINI.md)
  await injectIntoFile(join(homedir(), '.gemini', 'GEMINI.md'))
}

/**
 * Remove fast-context prompts from all locations
 */
export async function removeFastContextPrompt(): Promise<void> {
  const markerRegex = new RegExp(
    `\\n?${FC_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${FC_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
  )

  // Helper: remove marked block from a file
  async function removeFromFile(filePath: string): Promise<void> {
    if (await fs.pathExists(filePath)) {
      let content = await fs.readFile(filePath, 'utf-8')
      if (content.includes(FC_MARKER_START)) {
        content = content.replace(markerRegex, '')
        await fs.writeFile(filePath, content, 'utf-8')
      }
    }
  }

  // 1. Remove Claude Code rules file
  const rulePath = join(homedir(), '.claude', 'rules', 'ccg-fast-context.md')
  if (await fs.pathExists(rulePath)) {
    await fs.remove(rulePath)
  }

  // 2. Remove from Codex AGENTS.md
  await removeFromFile(join(homedir(), '.codex', 'AGENTS.md'))

  // 3. Remove from Gemini GEMINI.md
  await removeFromFile(join(homedir(), '.gemini', 'GEMINI.md'))
}
