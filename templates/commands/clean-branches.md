---
description: '清理 Git 分支：安全清理已合并或过期分支，默认 dry-run 模式'
---

# Clean-Branches - 清理 Git 分支

安全识别并清理已合并或长期未更新的分支。

## 使用方法

```bash
/clean-branches [options]
```

## 选项

| 选项 | 说明 |
|------|------|
| `--base <branch>` | 基准分支（默认 main/master） |
| `--stale <days>` | 清理超过 N 天未更新的分支 |
| `--remote` | 同时清理远程分支 |
| `--dry-run` | 只预览，不执行（**默认**） |
| `--yes` | 跳过确认直接删除 |
| `--force` | 强制删除未合并分支 |

---

## 执行工作流

### 🔍 阶段 1：预检

`[模式：准备]`

1. 同步远端：`git fetch --all --prune`
2. 读取保护分支配置
3. 确定基准分支

### 📋 阶段 2：分析识别

`[模式：分析]`

**已合并分支**：
- 已完全合并到 `--base` 的分支

**过期分支**（如指定 `--stale`）：
- 最后提交在 N 天前的分支

**排除**：
- 从待清理列表中移除保护分支

### 📊 阶段 3：报告预览

`[模式：报告]`

```markdown
## 将要删除的分支

### 已合并分支
- feature/old-feature (合并于 3 天前)
- bugfix/fixed-issue (合并于 7 天前)

### 过期分支
- experiment/old-test (最后更新 90 天前)
```

### ✅ 阶段 4：执行清理

`[模式：执行]`

仅在不带 `--dry-run` 且确认后执行：

```bash
# 本地分支
git branch -d <branch>

# 远程分支（如果 --remote）
git push origin --delete <branch>

# 强制删除（如果 --force）
git branch -D <branch>
```

---

## 保护分支配置

```bash
# 添加保护分支
git config --add branch.cleanup.protected develop
git config --add branch.cleanup.protected 'release/*'

# 查看保护分支
git config --get-all branch.cleanup.protected
```

---

## 示例

```bash
# 预览将清理的分支
/clean-branches --dry-run

# 清理已合并且超过 90 天未动的分支
/clean-branches --stale 90

# 清理已合并到 release/v2.1 的分支
/clean-branches --base release/v2.1 --remote --yes
```

## 最佳实践

1. **优先 dry-run** – 先预览再执行
2. **活用 --base** – 适配 release 工作流
3. **谨慎 --force** – 除非确定无用
4. **团队协作** – 清理远程分支前先通知
5. **定期运行** – 每月/季度一次保持清爽
