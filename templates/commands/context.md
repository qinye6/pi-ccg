---
description: '项目上下文管理：初始化 .context 目录、记录决策日志、压缩归档、查看历史'
---

# Context - 项目上下文管理

管理 `.context/` 目录结构，为 LLM 工具提供决策审计链。

## 使用方法

```bash
/context <subcommand> [options]
```

## 子命令

| 子命令 | 说明 |
|--------|------|
| `init` | 初始化 `.context/` 目录结构 |
| `log <message>` | （可选）手动追加备注到 session.log，commit 时会合并 |
| `show` | 查看当前分支的 session.log |
| `compress` | 压缩 session.log → uncommit.md（手动预览用） |
| `history` | 查看 history/commits.md |
| `squash <ids...>` | 合并多条 history 记录（配合 git squash） |

> **核心用法**：`init` 一次，之后只管开发。`/ccg:commit` 提交时自动从 git diff 分析决策并归档到 history/。`log` 仅在你想手动补充备注时使用。

---

## 执行工作流

### 子命令：init

`[模式：初始化]`

在当前项目根目录创建 `.context/` 结构：

1. 检测项目根目录（查找 `.git/`）
2. 若 `.context/` 已存在，跳过已有文件，仅补全缺失
3. 创建以下结构：

```
.context/
├── .gitignore
├── .gitattributes
├── prefs/
│   ├── coding-style.md
│   └── workflow.md
├── current/
│   └── branches/
│       └── .gitkeep
└── history/
    ├── commits.jsonl
    ├── commits.md
    └── archives/
        └── .gitkeep
```

4. **创建 `.context/.gitignore`**：

```gitignore
# Ephemeral workspace — never commit
current/

# Raw interaction logs — always local only
**/session.log
**/session.raw.log
**/*.session.log
**/*.raw.log

# Editor / temp
**/*.tmp
**/*.bak
**/*.swp
```

5. **创建 `.context/.gitattributes`**：

```
# JSONL append-only: 'union' merge reduces conflicts
history/commits.jsonl merge=union
history/archives/*.jsonl merge=union
```

6. **创建 `.context/prefs/coding-style.md`**（团队编码规范模板）：

```markdown
# Coding Style Guide

> 此文件定义团队编码规范，所有 LLM 工具在修改代码时必须遵守。
> 提交到 Git，团队共享。

## General
- Prefer small, reviewable changes; avoid unrelated refactors.
- Keep functions short (<50 lines); avoid deep nesting (≤3 levels).
- Name things explicitly; no single-letter variables except loop counters.
- Handle errors explicitly; never swallow errors silently.

## Language-Specific
<!-- 根据项目语言补充，例如：-->
<!-- ### TypeScript -->
<!-- - Use strict mode; prefer `interface` over `type` for object shapes. -->

## Git Commits
- Conventional Commits, imperative mood.
- Atomic commits: one logical change per commit.

## Testing
- Every feat/fix MUST include corresponding tests.
- Coverage must not decrease.
- Fix flow: write failing test FIRST, then fix code.

## Security
- Never log secrets (tokens/keys/cookies/JWT).
- Validate inputs at trust boundaries.
```

7. **创建 `.context/prefs/workflow.md`**（LLM 工作流规则）：

```markdown
# Development Workflow Rules

> 此文件定义 LLM 开发工作流的强制规则。
> 所有 LLM 工具在执行任务时必须遵守，不可跳过任何步骤。

## Full Flow (MUST follow, no exceptions)

### feat (新功能)
1. 理解需求，分析影响范围
2. 读取现有代码，理解模式
3. 编写实现代码
4. 编写对应测试
5. 运行测试，修复失败
6. 更新文档（若 API 变更）
7. 自查 lint / type-check

### fix (缺陷修复)
1. 复现问题，确认症状
2. 定位根因
3. 编写失败测试（先有红灯）
4. 修复代码
5. 验证测试通过（变绿灯）
6. 回归测试

### refactor (重构)
1. 确保现有测试通过
2. 小步重构，每步可验证
3. 重构后测试必须全部通过
4. 不改变外部行为

## Context Logging (决策记录)

当你做出以下决策时，MUST 追加到 `.context/current/branches/<当前分支>/session.log`：

1. **方案选择**：选 A 不选 B 时，记录原因
2. **Bug 发现与修复**：根因 + 修复方法 + 教训
3. **API/架构决策**：接口设计选择
4. **放弃的方案**：为什么放弃

追加格式：

## <ISO-8601 时间>
**Decision**: <你选择了什么>
**Alternatives**: <被排除的方案>
**Reason**: <为什么>
**Risk**: <潜在风险>
```

8. **创建 `.context/history/commits.jsonl`**（空文件）

9. **创建 `.context/history/commits.md`**（人类视图模板）：

```markdown
# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
```

10. **注入 CLAUDE.md 引用**（若项目存在 CLAUDE.md）：

检测项目根目录是否有 `CLAUDE.md`，若有则在末尾追加：

```markdown

## .context 项目上下文

> 项目使用 `.context/` 管理开发决策上下文。

- 编码规范：`.context/prefs/coding-style.md`
- 工作流规则：`.context/prefs/workflow.md`
- 决策历史：`.context/history/commits.md`

**规则**：修改代码前必读 prefs/，做决策时按 workflow.md 规则记录日志。
```

11. 输出初始化结果摘要

---

### 子命令：log

`[模式：记录]`

1. 获取当前 Git 分支名：`git branch --show-current`
2. 确保 `.context/current/branches/<branch>/` 目录存在
3. 将 `<message>` 以结构化格式追加到 `session.log`：

```markdown
## <ISO-8601 当前时间>
<message>
```

---

### 子命令：show

`[模式：查看]`

1. 获取当前分支名
2. 读取 `.context/current/branches/<branch>/session.log`
3. 若不存在，提示 "当前分支暂无决策日志"
4. 输出内容

---

### 子命令：compress

`[模式：压缩]`

将 `session.log` 压缩为结构化 `uncommit.md`，供提交前审查。

1. 读取 `.context/current/branches/<branch>/session.log`
2. 若为空，提示无内容可压缩
3. **脱敏**：扫描并替换潜在敏感信息（token/key/password → `[REDACTED]`）
4. **结构化提取**：从日志中提取 decisions / bugs / alternatives
5. **生成 uncommit.md**：

```markdown
# Pre-commit Summary: <branch-name>

| Time | Summary | Decision | Method | Result & Bug |
|------|---------|----------|--------|--------------|
| ... | ... | ... | ... | ... |
```

6. 输出压缩结果供用户审查
7. 提示用户：确认后可执行 `/ccg:commit` 提交

---

### 子命令：history

`[模式：查看]`

1. 读取 `.context/history/commits.md`
2. 若不存在，提示 "暂无历史记录，请先使用 /ccg:context init"
3. 输出内容
4. 若用户指定文件路径，从 `commits.jsonl` 检索 `changes.files` 包含该路径的条目

---

### 子命令：squash

`[模式：合并]`

配合 `git squash` 使用，合并多条 ContextEntry。

1. 接收 Context-Id 列表
2. 从 `commits.jsonl` 读取对应条目
3. 生成新的聚合 ContextEntry：
   - 新 `context_id`（UUIDv7）
   - `Context-Refs` = 所有被 squash 的 ids
   - 合并 decisions / bugs / changes
4. 追加到 `commits.jsonl`
5. 重生成 `commits.md`

---

## ContextEntry Schema (v1.0.0)

每条 JSONL 记录格式：

```json
{
  "schema_version": "1.0.0",
  "context_id": "<UUIDv7>",
  "created_at": "<ISO-8601>",
  "producer": {
    "tool": "<tool-name>",
    "llm": { "provider": "<provider>", "model": "<model>" }
  },
  "git": {
    "branch": "<branch>",
    "commit_sha": "<short-sha>",
    "trailers": { "Context-Id": "<uuid>" }
  },
  "summary": "<one-line summary>",
  "decisions": [{
    "title": "<decision title>",
    "rationale": "<why>",
    "tradeoffs": ["<tradeoff>"],
    "assumptions": ["<assumption>"],
    "rejected_alternatives": [{ "option": "<alt>", "reason": "<why rejected>" }],
    "side_effects": ["<side effect>"]
  }],
  "bugs": [{
    "symptom": "<what happened>",
    "root_cause": "<why>",
    "fix": "<how fixed>",
    "lesson": "<takeaway>"
  }],
  "changes": { "files": ["<path>"] },
  "tests": [{ "command": "<cmd>", "result": "<pass/fail>", "coverage": "<pct>" }],
  "privacy": { "classification": "internal", "redactions_applied": true }
}
```

---

## 关键规则

1. **prefs/ 提交到 Git** — 团队共享编码规范
2. **current/ 永不提交** — 原始日志仅本地
3. **history/ 提交到 Git** — 永久决策归档
4. **commits.jsonl 是 canonical** — commits.md 可重生成
5. **UUIDv7 为主键** — 不依赖 commit SHA（rebase-safe）
6. **merge=union** — JSONL append 冲突自动合并
7. **脱敏先于一切** — 任何写入 history 前必须脱敏
