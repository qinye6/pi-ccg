import { describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { join } from 'pathe'
import {
  PACKAGE_ROOT,
  assertNoLegacyResidue,
  injectPiTemplateVariables,
  removeManagedBlock,
  replacePiHomePathsInTemplate,
  upsertManagedBlock,
} from '../installer-template'
import {
  CCG_MANAGED_BLOCK_END,
  CCG_MANAGED_BLOCK_START,
  DEFAULT_PI_CAPS,
  getPiAgentHome,
} from '../pi-paths'

// ─────────────────────────────────────────────────────────────
// A. Pi 模板变量注入
// ─────────────────────────────────────────────────────────────
describe('injectPiTemplateVariables', () => {
  it('替换所有 Pi 占位符并处理多次出现', () => {
    const input = [
      'home={{PI_AGENT_HOME}}',
      'project={{PI_PROJECT_DIR}}',
      'dev={{DEV_AGENT_CAP}}',
      'global={{GLOBAL_CONCURRENCY_LIMIT}}',
      'spawns={{MAX_SPAWNS_PER_SESSION}}',
      'depth={{MAX_SUBAGENT_DEPTH}}',
      'frontend={{FRONTEND_MODEL}}',
      'backend={{BACKEND_MODEL}}',
      'review={{REVIEW_MODEL}}',
      'start={{CCG_MANAGED_BLOCK_START}}',
      'end={{CCG_MANAGED_BLOCK_END}}',
      'again={{PI_AGENT_HOME}}/{{FRONTEND_MODEL}}',
    ].join('\n')

    const result = injectPiTemplateVariables(input, {
      piAgentHome: '/tmp/pi-agent',
      piProjectDir: '.custom-pi',
      devAgentCap: 7,
      globalConcurrencyLimit: 8,
      maxSpawnsPerSession: 42,
      maxSubagentDepth: 3,
      frontendModel: 'pi-frontend',
      backendModel: 'pi-backend',
      reviewModel: 'pi-review',
    })

    expect(result).toBe([
      'home=/tmp/pi-agent',
      'project=.custom-pi',
      'dev=7',
      'global=8',
      'spawns=42',
      'depth=3',
      'frontend=pi-frontend',
      'backend=pi-backend',
      'review=pi-review',
      `start=${CCG_MANAGED_BLOCK_START}`,
      `end=${CCG_MANAGED_BLOCK_END}`,
      'again=/tmp/pi-agent/pi-frontend',
    ].join('\n'))
  })

  it('无 vars 时使用默认上限、.pi 与真实 Pi home，模型为空字符串', () => {
    const input = [
      '{{PI_AGENT_HOME}}',
      '{{PI_PROJECT_DIR}}',
      '{{DEV_AGENT_CAP}}',
      '{{GLOBAL_CONCURRENCY_LIMIT}}',
      '{{MAX_SPAWNS_PER_SESSION}}',
      '{{MAX_SUBAGENT_DEPTH}}',
      'models={{FRONTEND_MODEL}}|{{BACKEND_MODEL}}|{{REVIEW_MODEL}}',
    ].join('\n')

    const result = injectPiTemplateVariables(input)

    expect(result).toBe([
      getPiAgentHome(),
      '.pi',
      String(DEFAULT_PI_CAPS.devAgentCap),
      String(DEFAULT_PI_CAPS.globalConcurrencyLimit),
      String(DEFAULT_PI_CAPS.maxSpawnsPerSession),
      String(DEFAULT_PI_CAPS.maxSubagentDepth),
      'models=||',
    ].join('\n'))
  })
})

// ─────────────────────────────────────────────────────────────
// B. Pi home 路径替换
// ─────────────────────────────────────────────────────────────
describe('replacePiHomePathsInTemplate', () => {
  it('只替换 ~/.pi/agent 字面量，不改其他 ~ 用法', () => {
    const input = '~/.pi/agent/prompts\n~/保持不变\n~/.pi/agent/agents'
    const result = replacePiHomePathsInTemplate(input)

    expect(result).toBe(`${getPiAgentHome()}/prompts\n~/保持不变\n${getPiAgentHome()}/agents`)
  })
})

// ─────────────────────────────────────────────────────────────
// C. AGENTS.md 受管块 upsert
// ─────────────────────────────────────────────────────────────
describe('upsertManagedBlock', () => {
  it('existing 为 null 时创建完整受管块', () => {
    expect(upsertManagedBlock(null, '块内容')).toBe(`${CCG_MANAGED_BLOCK_START}\n块内容\n${CCG_MANAGED_BLOCK_END}\n`)
  })

  it('existing 为空字符串时创建完整受管块', () => {
    expect(upsertManagedBlock('', '块内容')).toBe(`${CCG_MANAGED_BLOCK_START}\n块内容\n${CCG_MANAGED_BLOCK_END}\n`)
  })

  it('同时存在首尾 marker 时只替换块内内容，块外字节保持不变', () => {
    const existing = `前置内容\n${CCG_MANAGED_BLOCK_START}\n旧内容\n${CCG_MANAGED_BLOCK_END}\n后置内容`
    const result = upsertManagedBlock(existing, '新内容')

    expect(result).toBe(`前置内容\n${CCG_MANAGED_BLOCK_START}\n新内容\n${CCG_MANAGED_BLOCK_END}\n后置内容`)
  })

  it('缺少 marker 时追加受管块', () => {
    const existing = '用户内容\n第二行'
    const result = upsertManagedBlock(existing, '块内容')

    expect(result).toBe(`${existing}\n\n${CCG_MANAGED_BLOCK_START}\n块内容\n${CCG_MANAGED_BLOCK_END}\n`)
  })
})

// ─────────────────────────────────────────────────────────────
// D. AGENTS.md 受管块移除
// ─────────────────────────────────────────────────────────────
describe('removeManagedBlock', () => {
  it('upsert 后再 remove 可还原原始内容', () => {
    const original = '用户内容\n第二行'
    const withBlock = upsertManagedBlock(original, '块内容')
    const result = removeManagedBlock(withBlock)

    expect(result).toEqual({ content: original, removed: true })
  })

  it('没有完整 marker 时返回 removed:false 且内容不变', () => {
    const existing = '用户内容\n没有受管块'
    const result = removeManagedBlock(existing)

    expect(result).toEqual({ content: existing, removed: false })
  })
})

// ─────────────────────────────────────────────────────────────
// E. legacy 残留检测
// ─────────────────────────────────────────────────────────────
describe('assertNoLegacyResidue', () => {
  const forbidden = [
    '.claude',
    'codeagent-wrapper',
    '{{FRONTEND_PRIMARY}}',
    '{{BACKEND_PRIMARY}}',
    '{{GEMINI_MODEL_FLAG}}',
    '{{GROK_MODEL_FLAG}}',
    '--backend codex',
    '--backend gemini',
  ]

  it('逐项返回发现的 legacy token', () => {
    const content = forbidden.join('\nPi 正文\n')

    expect(assertNoLegacyResidue(content)).toEqual(forbidden)
  })

  it('干净的 Pi 内容返回空数组', () => {
    const content = [
      `${CCG_MANAGED_BLOCK_START}`,
      'pi chain uses native agents',
      'model: pi-dev',
      `${CCG_MANAGED_BLOCK_END}`,
    ].join('\n')

    expect(assertNoLegacyResidue(content)).toEqual([])
  })
})

describe('Pi role boundaries', () => {
  it('keeps every child fresh and prevents role or board ownership escalation', async () => {
    const agentDir = join(PACKAGE_ROOT, 'templates', 'pi', 'agents')
    const readAgent = (name: string): Promise<string> => fs.readFile(join(agentDir, `${name}.md`), 'utf-8')
    const [scout, planner, backend, frontend, tester, reviewer] = await Promise.all([
      readAgent('ccg-project-scout'),
      readAgent('ccg-planner'),
      readAgent('ccg-backend-builder'),
      readAgent('ccg-frontend-builder'),
      readAgent('ccg-test-runner'),
      readAgent('ccg-reviewer'),
    ])

    for (const content of [scout, planner, backend, frontend, tester, reviewer]) {
      expect(content).toContain('defaultContext: fresh')
      expect(content).toContain('.pi/ccg/')
    }
    expect(scout).toContain('不实现、不测试、不派生或指派 agent')
    expect(planner).toContain('不写代码、不运行命令、不派生或指派 agent')
    for (const builder of [backend, frontend]) {
      expect(builder).toContain('不得直接启动 tester/reviewer')
      expect(builder).toContain('不得请求 `subagent`')
      expect(builder).toContain('局部自检不能替代 leader')
    }
    expect(tester).toContain('不编辑产品代码')
    expect(tester).toContain('不扩大 scope')
    expect(reviewer).toContain('不直接修复')
    expect(reviewer).toContain('交给 leader 路由')
  })
})

// ─────────────────────────────────────────────────────────────
describe('pi-subagents memory frontmatter', () => {
  it('enables project-scoped per-agent memory only where tool permissions make the scope safe', async () => {
    const agentDir = join(PACKAGE_ROOT, 'templates', 'pi', 'agents')
    const memoryAgents = [
      'ccg-project-scout',
      'ccg-planner',
      'ccg-backend-builder',
      'ccg-frontend-builder',
    ]

    for (const agent of memoryAgents) {
      const content = await fs.readFile(join(agentDir, `${agent}.md`), 'utf-8')
      expect(content).toContain(`memory: { scope: project, path: ${agent} }`)
    }

    for (const agent of ['ccg-reviewer', 'ccg-test-runner']) {
      const content = await fs.readFile(join(agentDir, `${agent}.md`), 'utf-8')
      expect(content).not.toContain('memory:')
      expect(content).toContain('completionGuard: false')
    }

    expect(await fs.pathExists(join(agentDir, 'ccg-miniprogram-builder.md'))).toBe(false)
  })
})
