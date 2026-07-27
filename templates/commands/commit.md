---
description: '智能 Git 提交：分析改动生成 Conventional Commit 信息，支持拆分建议'
---

# Commit - 智能 Git 提交

分析当前改动，生成 Conventional Commits 风格的提交信息。

## 使用方法

```bash
/commit [options]
```

## 选项

| 选项 | 说明 |
|------|------|
| `--no-verify` | 跳过 Git 钩子 |
| `--all` | 暂存所有改动 |
| `--amend` | 修补上次提交 |
| `--signoff` | 附加签名 |
| `--emoji` | 包含 emoji 前缀 |
| `--scope <scope>` | 指定作用域 |
| `--type <type>` | 指定提交类型 |

---

## 执行工作流

### 🔍 阶段 1：仓库校验

`[模式：检查]`

1. 验证 Git 仓库状态
2. 检测 rebase/merge 冲突
3. 读取当前分支/HEAD 状态

### 📋 阶段 2：改动检测

`[模式：分析]`

1. 获取已暂存与未暂存改动
2. 若暂存区为空：
   - `--all` → 执行 `git add -A`
   - 否则提示选择

### ✂️ 阶段 3：拆分建议

`[模式：建议]`

按以下维度聚类：
- 关注点（源代码 vs 文档/测试）
- 文件模式（不同目录/包）
- 改动类型（新增 vs 删除）

若检测到多组独立变更（>300 行 / 跨多个顶级目录），建议拆分。

### ✍️ 阶段 4：生成提交信息

`[模式：生成]`

**格式**：`[emoji] <type>(<scope>): <subject>`

- 首行 ≤ 72 字符
- 祈使语气
- 消息体：动机、实现要点、影响范围

**语言**：根据最近 50 次提交判断中文/英文

### 📦 阶段 5：Context 自动归档（若 .context/ 存在）

`[模式：上下文归档]`

**前置判断**：
- 若 `.context/` 目录不存在 → 在提交成功后输出提示：`💡 建议执行 /ccg:context init 启用决策追踪`，不阻断
- 若 `.context/` 存在 → 执行以下步骤

**从 git diff 自动生成 ContextEntry**：

1. 获取当前分支名：`git branch --show-current`
2. 获取暂存区变更：`git diff --cached --stat` + `git diff --cached`（完整 diff）
3. **分析 diff 生成 ContextEntry**：
   - `summary`：从阶段 4 生成的 commit message 中取首行
   - `decisions`：分析 diff 中的关键变更（新增依赖、架构调整、接口变更、配置修改），推断决策理由
   - `bugs`：若 commit type 为 `fix`，从 diff 中提取 bug 症状、根因、修复方式
   - `changes.files`：从 `git diff --cached --name-only` 提取
   - `tests`：若变更包含测试文件，记录测试相关信息
4. **合并 session.log**（可选）：若 `.context/current/branches/<branch>/session.log` 存在且非空，将其中的手动记录合并到 decisions/bugs 中，然后清空 session.log
5. **脱敏**：扫描 token/key/password/secret 模式 → 替换为 `[REDACTED]`
6. **追加**：将 ContextEntry 作为一行追加到 `.context/history/commits.jsonl`
7. **重生成**：更新 `.context/history/commits.md` 人类视图
8. **暂存**：`git add .context/history/`
9. **Trailer**：在 commit message 中添加 `Context-Id: <uuid>` trailer

**ContextEntry 格式**参见 `/ccg:context` 命令中的 Schema 定义。

**失败降级**：若归档过程出错，不阻断提交。写入 minimal ContextEntry（仅 summary + files），继续正常提交。

### ✅ 阶段 6：执行提交

`[模式：执行]`

```bash
git commit [-S] [--no-verify] [-s] -F .git/COMMIT_EDITMSG
```

---

## Type 与 Emoji 映射

| Emoji | Type | 说明 |
|-------|------|------|
| ✨ | `feat` | 新增功能 |
| 🐛 | `fix` | 缺陷修复 |
| 📝 | `docs` | 文档更新 |
| 🎨 | `style` | 代码格式 |
| ♻️ | `refactor` | 重构 |
| ⚡️ | `perf` | 性能优化 |
| ✅ | `test` | 测试相关 |
| 🔧 | `chore` | 构建/工具 |
| 👷 | `ci` | CI/CD |
| ⏪️ | `revert` | 回滚 |

---

## 示例

```bash
# 基本提交
/commit

# 暂存所有并提交
/commit --all

# 带 emoji 提交
/commit --emoji

# 指定类型和作用域
/commit --scope ui --type feat --emoji

# 修补上次提交
/commit --amend --signoff
```

## 关键规则

1. **仅使用 Git** – 不调用包管理器
2. **尊重钩子** – 默认执行，`--no-verify` 可跳过
3. **不改源码** – 只读写 `.git/COMMIT_EDITMSG`
4. **原子提交** – 一次提交只做一件事
