import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { injectConfigVariables } from '../installer'

// Helper: find package root (mirrors the logic in installer.ts)
function findPackageRoot(): string {
  let dir = import.meta.dirname
  for (let i = 0; i < 10; i++) {
    try {
      readFileSync(join(dir, 'package.json'))
      return dir
    }
    catch {
      dir = join(dir, '..')
    }
  }
  throw new Error('Could not find package root')
}

const PACKAGE_ROOT = findPackageRoot()
const TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates', 'commands')

// ─────────────────────────────────────────────────────────────
// A. skip provider — the core bug fix
// ─────────────────────────────────────────────────────────────
describe('mcpProvider = "skip"', () => {
  const skipConfig = { mcpProvider: 'skip' }

  it('removes MCP tool from agent frontmatter tools declaration', () => {
    const input = 'tools: Read, Write, {{MCP_SEARCH_TOOL}}'
    const result = injectConfigVariables(input, skipConfig)
    expect(result).toBe('tools: Read, Write')
    expect(result).not.toContain('MCP_SEARCH_TOOL')
  })

  it('replaces code blocks containing MCP tool invocation (JS-style)', () => {
    const input = [
      '```',
      '{{MCP_SEARCH_TOOL}}({',
      '  query: "<semantic query>",',
      '  project_root_path: "/path/to/project"',
      '})',
      '```',
    ].join('\n')
    const result = injectConfigVariables(input, skipConfig)
    expect(result).toContain('> MCP 未配置。使用 `Glob` 定位文件 + `Grep` 搜索关键符号 + `Read` 读取文件内容。')
    expect(result).not.toContain('{{MCP_SEARCH_TOOL}}')
    expect(result).not.toContain('```')
  })

  it('replaces code blocks containing MCP tool invocation (JSON-style)', () => {
    const input = [
      '```',
      '{{MCP_SEARCH_TOOL}} {',
      '  "project_root_path": "{{项目路径}}",',
      '  "query": "可复用的 UI 组件"',
      '}',
      '```',
    ].join('\n')
    const result = injectConfigVariables(input, skipConfig)
    expect(result).toContain('> MCP 未配置')
    expect(result).not.toContain('{{MCP_SEARCH_TOOL}}')
  })

  it('replaces inline backtick references', () => {
    const input = '调用 `{{MCP_SEARCH_TOOL}}` 检索相关代码'
    const result = injectConfigVariables(input, skipConfig)
    expect(result).toBe('调用 `Glob + Grep`（MCP 未配置） 检索相关代码')
    expect(result).not.toContain('{{MCP_SEARCH_TOOL}}')
  })

  it('replaces bare (non-backtick, non-code-block) references as safety net', () => {
    const input = 'Use {{MCP_SEARCH_TOOL}} to search codebase.'
    const result = injectConfigVariables(input, skipConfig)
    expect(result).toBe('Use Glob + Grep to search codebase.')
    expect(result).not.toContain('{{MCP_SEARCH_TOOL}}')
  })

  it('removes {{MCP_SEARCH_PARAM}} references', () => {
    const input = 'param: {{MCP_SEARCH_PARAM}}'
    const result = injectConfigVariables(input, skipConfig)
    expect(result).toBe('param: ')
    expect(result).not.toContain('{{MCP_SEARCH_PARAM}}')
  })

  it('handles multiple patterns in a single template correctly', () => {
    // Simulates the planner.md template structure
    const input = [
      '---',
      'tools: Read, Write, {{MCP_SEARCH_TOOL}}',
      '---',
      '',
      '### Step 2',
      '',
      '```',
      '{{MCP_SEARCH_TOOL}} {',
      '  "project_root_path": "{{项目路径}}",',
      '  "query": "{{相关功能关键词}}"',
      '}',
      '```',
      '',
      '调用 `{{MCP_SEARCH_TOOL}}` 检索相关代码',
    ].join('\n')
    const result = injectConfigVariables(input, skipConfig)

    // frontmatter cleaned
    expect(result).toContain('tools: Read, Write')
    expect(result).not.toContain('tools: Read, Write,')

    // code block replaced
    expect(result).toContain('> MCP 未配置')
    expect(result).not.toContain('```\n{{MCP_SEARCH_TOOL}}')

    // inline backtick replaced
    expect(result).toContain('`Glob + Grep`（MCP 未配置）')

    // no MCP references remain
    expect(result).not.toContain('{{MCP_SEARCH_TOOL}}')
    expect(result).not.toContain('mcp__ace-tool__search_context')
  })

  it('does not inject mcp__ace-tool__search_context when skip is selected', () => {
    const input = '调用 `{{MCP_SEARCH_TOOL}}` 检索'
    const result = injectConfigVariables(input, skipConfig)
    expect(result).not.toContain('mcp__ace-tool')
    expect(result).not.toContain('mcp__contextweaver')
  })
})

// ─────────────────────────────────────────────────────────────
// B. contextweaver provider
// ─────────────────────────────────────────────────────────────
describe('mcpProvider = "contextweaver"', () => {
  const cwConfig = { mcpProvider: 'contextweaver' }

  it('replaces {{MCP_SEARCH_TOOL}} with contextweaver tool name', () => {
    const input = '调用 `{{MCP_SEARCH_TOOL}}` 检索'
    const result = injectConfigVariables(input, cwConfig)
    expect(result).toContain('mcp__contextweaver__codebase-retrieval')
    expect(result).not.toContain('{{MCP_SEARCH_TOOL}}')
  })

  it('replaces {{MCP_SEARCH_PARAM}} with information_request', () => {
    const input = '{{MCP_SEARCH_PARAM}}'
    const result = injectConfigVariables(input, cwConfig)
    expect(result).toBe('information_request')
  })
})

// ─────────────────────────────────────────────────────────────
// C. ace-tool provider (default)
// ─────────────────────────────────────────────────────────────
describe('mcpProvider = "ace-tool" (default)', () => {
  it('replaces {{MCP_SEARCH_TOOL}} with ace-tool tool name', () => {
    const input = '调用 `{{MCP_SEARCH_TOOL}}` 检索'
    const result = injectConfigVariables(input, { mcpProvider: 'ace-tool' })
    expect(result).toContain('mcp__ace-tool__search_context')
  })

  it('replaces {{MCP_SEARCH_PARAM}} with query', () => {
    const input = '{{MCP_SEARCH_PARAM}}'
    const result = injectConfigVariables(input, { mcpProvider: 'ace-tool' })
    expect(result).toBe('query')
  })

  it('defaults to ace-tool when mcpProvider is not specified', () => {
    const input = '{{MCP_SEARCH_TOOL}}'
    const result = injectConfigVariables(input, {})
    expect(result).toBe('mcp__ace-tool__search_context')
  })

  it('defaults to ace-tool when mcpProvider is undefined', () => {
    const input = '{{MCP_SEARCH_TOOL}}'
    const result = injectConfigVariables(input, { mcpProvider: undefined })
    expect(result).toBe('mcp__ace-tool__search_context')
  })
})

// ─────────────────────────────────────────────────────────────
// D. Integration test with real templates
// ─────────────────────────────────────────────────────────────
describe('integration: real templates with skip mode', () => {
  // Collect all .md files under templates/commands/ (including agents/)
  function collectTemplateFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectTemplateFiles(fullPath))
      }
      else if (entry.name.endsWith('.md')) {
        files.push(fullPath)
      }
    }
    return files
  }

  const legacyDir = join(PACKAGE_ROOT, 'templates', 'commands-legacy')
  const templateFiles = [
    ...collectTemplateFiles(TEMPLATES_DIR),
    ...(existsSync(legacyDir) ? collectTemplateFiles(legacyDir) : []),
  ]
  const filesWithMcpRef = templateFiles.filter((f) => {
    const content = readFileSync(f, 'utf-8')
    return content.includes('{{MCP_SEARCH_TOOL}}')
  })

  it('finds templates containing {{MCP_SEARCH_TOOL}}', () => {
    expect(filesWithMcpRef.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of filesWithMcpRef) {
    const relativePath = file.replace(PACKAGE_ROOT + '/', '')

    it(`${relativePath}: no MCP tool references remain after skip processing`, () => {
      const content = readFileSync(file, 'utf-8')
      const result = injectConfigVariables(content, { mcpProvider: 'skip' })

      // No raw template variables should remain
      expect(result).not.toContain('{{MCP_SEARCH_TOOL}}')
      expect(result).not.toContain('{{MCP_SEARCH_PARAM}}')

      // No ace-tool references should be injected
      expect(result).not.toContain('mcp__ace-tool__search_context')

      // No contextweaver references should be injected
      expect(result).not.toContain('mcp__contextweaver__codebase-retrieval')
    })
  }
})

// ─────────────────────────────────────────────────────────────
// E. GEMINI_MODEL_FLAG line-aware substitution (issue #130, v2.1.15)
// ─────────────────────────────────────────────────────────────
describe('GEMINI_MODEL_FLAG line-aware substitution', () => {
  const geminiFrontendCodexBackend = {
    routing: {
      frontend: { primary: 'gemini' },
      backend: { primary: 'codex' },
      geminiModel: 'gemini-3.1-pro-preview',
    },
  }

  it('keeps flag on lines with hard-coded gemini backend', () => {
    const input = '--backend gemini {{GEMINI_MODEL_FLAG}}- "/workdir"'
    const result = injectConfigVariables(input, geminiFrontendCodexBackend)
    expect(result).toBe('--backend gemini --gemini-model gemini-3.1-pro-preview - "/workdir"')
  })

  it('strips flag on lines with hard-coded codex backend (issue #130)', () => {
    // This is the exact bug: `backend.md` / `codex-exec.md` hard-code
    // `--backend codex` but were getting `--gemini-model` injected.
    const input = '--backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}- "/workdir"'
    const result = injectConfigVariables(input, geminiFrontendCodexBackend)
    expect(result).toBe('--backend codex - "/workdir"')
    expect(result).not.toContain('--gemini-model')
  })

  it('strips flag on lines with hard-coded claude backend', () => {
    const input = '--backend claude {{GEMINI_MODEL_FLAG}}- "/workdir"'
    const result = injectConfigVariables(input, geminiFrontendCodexBackend)
    expect(result).toBe('--backend claude - "/workdir"')
  })

  it('keeps flag on conditional lines (runtime AI choice)', () => {
    const input = '--backend <{{BACKEND_PRIMARY}}|{{FRONTEND_PRIMARY}}> {{GEMINI_MODEL_FLAG}}- "/workdir"'
    const result = injectConfigVariables(input, geminiFrontendCodexBackend)
    // Conditional lines keep the flag — AI picks a backend at runtime
    expect(result).toContain('--backend <codex|gemini>')
    expect(result).toContain('--gemini-model gemini-3.1-pro-preview')
  })

  it('handles frontend.md style (--backend {{FRONTEND_PRIMARY}})', () => {
    const input = '--backend {{FRONTEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}- "/workdir"'
    const result = injectConfigVariables(input, geminiFrontendCodexBackend)
    // FRONTEND_PRIMARY=gemini → flag kept
    expect(result).toBe('--backend gemini --gemini-model gemini-3.1-pro-preview - "/workdir"')
  })

  it('strips flag on frontend codex + backend gemini edge case', () => {
    const config = {
      routing: {
        frontend: { primary: 'codex' },
        backend: { primary: 'gemini' },
        geminiModel: 'gemini-3.1-pro-preview',
      },
    }
    const input = [
      '--backend {{FRONTEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}- "/w"', // codex → strip
      '--backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}- "/w"',  // gemini → keep
    ].join('\n')
    const result = injectConfigVariables(input, config)
    const lines = result.split('\n')
    expect(lines[0]).toBe('--backend codex - "/w"')
    expect(lines[0]).not.toContain('--gemini-model')
    expect(lines[1]).toBe('--backend gemini --gemini-model gemini-3.1-pro-preview - "/w"')
  })

  it('strips all flags when neither frontend nor backend uses gemini', () => {
    const config = {
      routing: {
        frontend: { primary: 'claude' },
        backend: { primary: 'codex' },
      },
    }
    const input = [
      '--backend codex {{GEMINI_MODEL_FLAG}}- "/w"',
      '--backend <codex|claude> {{GEMINI_MODEL_FLAG}}- "/w"',
    ].join('\n')
    const result = injectConfigVariables(input, config)
    expect(result).not.toContain('--gemini-model')
    expect(result).not.toContain('{{GEMINI_MODEL_FLAG}}')
  })

  it('uses default gemini-3.1-pro-preview when geminiModel not specified', () => {
    const input = '--backend gemini {{GEMINI_MODEL_FLAG}}- "/w"'
    const result = injectConfigVariables(input, {
      routing: { frontend: { primary: 'gemini' }, backend: { primary: 'codex' } },
    })
    expect(result).toContain('--gemini-model gemini-3.1-pro-preview')
  })

  it('respects custom gemini model name', () => {
    const input = '--backend gemini {{GEMINI_MODEL_FLAG}}- "/w"'
    const result = injectConfigVariables(input, {
      routing: {
        frontend: { primary: 'gemini' },
        backend: { primary: 'codex' },
        geminiModel: 'gemini-3-flash-preview',
      },
    })
    expect(result).toContain('--gemini-model gemini-3-flash-preview')
  })
})

// ─────────────────────────────────────────────────────────────
// F. Integration: no dead --gemini-model on hard-coded codex lines
// ─────────────────────────────────────────────────────────────
describe('integration: real templates with gemini+codex config', () => {
  const config = {
    routing: {
      frontend: { primary: 'gemini' },
      backend: { primary: 'codex' },
      geminiModel: 'gemini-3.1-pro-preview',
    },
  }

  // Templates where the bug manifested: they hard-code `--backend codex`
  // (via `--backend {{BACKEND_PRIMARY}}`) on lines that also contain
  // `{{GEMINI_MODEL_FLAG}}`.
  const expectedCleanTemplates = [
    'commands-legacy/backend.md',
    'commands-legacy/codex-exec.md',
  ]

  for (const rel of expectedCleanTemplates) {
    it(`${rel}: no --gemini-model on lines with hard-coded --backend codex`, () => {
      const content = readFileSync(join(PACKAGE_ROOT, 'templates', rel), 'utf-8')
      const result = injectConfigVariables(content, config)

      // Scan each line: if it contains `--backend codex` (non-conditional),
      // it must NOT contain `--gemini-model`.
      const offendingLines = result.split('\n').filter((line) => {
        const hardCodedCodex = /--backend\s+codex(?:\s|$)/.test(line)
        const hasGeminiFlag = line.includes('--gemini-model')
        return hardCodedCodex && hasGeminiFlag
      })
      expect(offendingLines).toEqual([])
    })
  }
})

// ─────────────────────────────────────────────────────────────
// F. GROK_MODEL_FLAG line-aware substitution (v3.2.0)
// ─────────────────────────────────────────────────────────────
describe('GROK_MODEL_FLAG line-aware substitution', () => {
  const grokBackendConfig = {
    routing: {
      frontend: { primary: 'antigravity' },
      backend: { primary: 'grok' },
      grokModel: 'grok-4.5',
    },
  }

  it('keeps flag on lines with hard-coded grok backend', () => {
    const input = '--backend grok {{GROK_MODEL_FLAG}}- "/workdir"'
    const result = injectConfigVariables(input, grokBackendConfig)
    expect(result).toBe('--backend grok --grok-model grok-4.5 - "/workdir"')
  })

  it('strips flag on lines with hard-coded non-grok backend', () => {
    const input = '--backend {{FRONTEND_PRIMARY}} {{GROK_MODEL_FLAG}}- "/workdir"'
    const result = injectConfigVariables(input, grokBackendConfig)
    expect(result).toBe('--backend antigravity - "/workdir"')
    expect(result).not.toContain('--grok-model')
  })

  it('keeps flag on runtime-variable lines ($MODEL)', () => {
    const input = '--backend $MODEL {{GROK_MODEL_FLAG}}- "$WORKDIR"'
    const result = injectConfigVariables(input, grokBackendConfig)
    expect(result).toContain('--grok-model grok-4.5')
  })

  it('supports grok-composer-2.5-fast model', () => {
    const config = {
      routing: {
        frontend: { primary: 'gemini' },
        backend: { primary: 'grok' },
        grokModel: 'grok-composer-2.5-fast',
      },
    }
    const input = '--backend grok {{GROK_MODEL_FLAG}}- "/w"'
    const result = injectConfigVariables(input, config)
    expect(result).toContain('--grok-model grok-composer-2.5-fast')
  })

  it('strips all flags when neither role uses grok', () => {
    const config = {
      routing: {
        frontend: { primary: 'antigravity' },
        backend: { primary: 'codex' },
      },
    }
    const input = [
      '--backend grok {{GROK_MODEL_FLAG}}- "/w"',
      '--backend $MODEL {{GROK_MODEL_FLAG}}- "/w"',
    ].join('\n')
    const result = injectConfigVariables(input, config)
    expect(result).not.toContain('--grok-model')
    expect(result).not.toContain('{{GROK_MODEL_FLAG}}')
  })

  it('gemini and grok flags coexist on $MODEL lines when both configured', () => {
    const config = {
      routing: {
        frontend: { primary: 'gemini' },
        backend: { primary: 'grok' },
        geminiModel: 'gemini-3.1-pro-preview',
        grokModel: 'grok-4.5',
      },
    }
    const input = '--backend $MODEL {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}- "$WORKDIR"'
    const result = injectConfigVariables(input, config)
    expect(result).toContain('--gemini-model gemini-3.1-pro-preview')
    expect(result).toContain('--grok-model grok-4.5')
  })
})
