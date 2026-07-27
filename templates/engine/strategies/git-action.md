# Strategy: Git Action — Git 操作

> 适用于 Git 相关操作。委托给现有的专用命令，不重复实现。

## 适用条件
- 用户请求 commit / rollback / branch 管理 / worktree 等 Git 操作
- 任何复杂度级别

---

## 路由表

根据用户请求中的关键词，加载对应的现有命令文件并按其指令执行：

| 关键词 | 命令文件 | 说明 |
|--------|---------|------|
| commit, 提交 | `~/.claude/commands/ccg/commit.md` | 智能提交（conventional commit） |
| rollback, 回滚, revert, undo | `~/.claude/commands/ccg/rollback.md` | 交互式回滚 |
| clean branch, 清理分支 | `~/.claude/commands/ccg/clean-branches.md` | 清理已合并分支 |
| worktree | `~/.claude/commands/ccg/worktree.md` | Worktree 管理 |

## 执行方式

1. 匹配关键词确定目标命令
2. `Read("目标命令文件路径")` 加载完整指令
3. 将用户的 `$ARGUMENTS` 作为该命令的输入
4. 严格按照命令文件的指令执行

## 未匹配的 Git 操作

如果用户的 Git 请求不匹配上述任何命令（如 `push`, `merge`, `cherry-pick`, `stash` 等）：
- Claude 直接处理
- 遵循 Git 安全原则：
  - 破坏性操作（force push, reset --hard）前必须确认
  - 不自动 push 到远程（除非用户明确要求）
  - 优先创建新 commit 而非 amend

---

## 铁律

- **不重复实现** — 现有命令已经过充分测试，直接委托
- **保持一致性** — 用户通过 `/ccg commit` 和 `/ccg:commit` 应得到相同结果
