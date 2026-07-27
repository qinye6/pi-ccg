# src — CCG for Pi CLI

> [根目录](../CLAUDE.md) > **src**

**Last Updated**: 2026-07-27 (v3.2.4)

## 模块职责

`src/` 实现 Pi-only CCG CLI。Pi CLI 是唯一主控；TypeScript CLI 只负责安装、配置、更新、诊断和安全卸载 Pi agents、chain、prompt、并发上限与 model override。

启动链：

```text
npx pi-ccg → bin/ccg.mjs → dist/cli.mjs → src/cli.ts → setupCommands()
```

## CLI 命令面

| 命令 | 实现 | 作用 |
|---|---|---|
| `ccg` | `commands/menu.ts` | Pi workflow 交互菜单 |
| `ccg init` / `ccg i` | `commands/init.ts` | 十步 Pi 安装/配置向导 |
| `ccg update` | `commands/update.ts` | 从 metadata 恢复选择并安全重装 |
| `ccg doctor` | `commands/doctor.ts` | 检查 Pi CLI、agents、caps、models、memory |
| `ccg status` | `commands/doctor.ts` | 显示安装概况 |
| `ccg uninstall` | `uninstallPiWorkflow()` | 只移除 CCG managed assets |

`init` 十步状态机：

```text
language → environment → scope → provider → frontend model
→ backend model → review model → limits → entry → summary
```

主要 options：`--frontend-model`、`--backend-model`、`--review-model`、`--provider-file`、四个 cap 参数、`--project-assets/--no-project-assets`、`--install-dir`、`--skip-prompt`、`--force`。

## Pi 安装器

当前入口：

```typescript
installPiWorkflow(options)
uninstallPiWorkflow(options)
```

核心子步骤：

```text
installPiAgents
installPiChain
installPiPromptWorkflow
installManagedAgentsBlock
installProjectPiSettings
installSubagentExtensionConfig
installPiSettingsOverrides
installPiProviders
```

安装目标：

```text
~/.pi/agent/agents/
~/.pi/agent/chains/
~/.pi/agent/prompts/
~/.pi/agent/settings.json
~/.pi/agent/models.json
~/.pi/agent/extensions/subagent/config.json
~/.pi/agent/ccg-workflow.json

<project>/AGENTS.md
<project>/.pi/chains/
<project>/.pi/prompts/
<project>/.pi/settings.json
<project>/.pi/mcp.json.example
```

### 安全写入规则

- `AGENTS.md` 只更新 `<!-- CCG:PI-START -->` 到 `<!-- CCG:PI-END -->` 之间的块。
- 项目已有 `.pi/settings.json` 永不覆盖。
- 用户 `.pi/mcp.json` 永不覆盖、永不删除。
- `models.json` 同名 provider 默认跳过；仅显式 `force` 覆盖，并先创建 `.ccg-bak`。
- `settings.json` 与 subagent config 深度合并，保留非 CCG 字段。
- 模板写入结果区分 `written`、`skipped`、`failed`。
- 模板写入前拒绝 `.claude`、`codeagent-wrapper` 和旧模型 placeholder 残留。

## 模型与并发映射

```text
frontendModel → ccg-frontend-builder, ccg-miniprogram-builder
backendModel  → ccg-backend-builder
reviewModel   → ccg-reviewer, ccg-test-runner
```

scout/planner 继承 `subagents.defaultModel`。

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)

requiredSpawns = 2 + N + 1 + 1
```

默认 caps：`4 / 4 / 24 / 1`。

## 关键模块

| 文件 | 作用 |
|---|---|
| `commands/init.ts` | 十步向导、metadata 写入 |
| `commands/update.ts` | metadata 驱动更新 |
| `commands/doctor.ts` | required/optional 健康检查 |
| `commands/menu.ts` | Pi-only 菜单 |
| `cli-setup.ts` | 六个 CLI command 注册 |
| `utils/installer.ts` | Pi 安装/卸载；legacy 实现仅内部历史兼容 |
| `utils/pi-paths.ts` | Pi 路径、agent 名、默认 caps |
| `utils/pi-config.ts` | settings/provider/cap 合并与公式 |
| `utils/installer-template.ts` | Pi 模板注入、legacy residue 检测、managed block |
| `types/index.ts` | Pi metadata、caps、result 类型及历史类型 |

## Legacy 边界

旧 `installWorkflows()` / `uninstallWorkflows()` 源码暂时保留在 `installer.ts`，用于历史迁移参考和内部兼容，但：

- CLI 不调用；
- `src/index.ts` 不公开；
- npm package 不发布其 commands/hooks/prompts/skills/runtime assets；
- 当前测试不得下载 `codeagent-wrapper` 或访问 binary CDN。

## 测试

`src/utils/__tests__/` 的 Pi 主线覆盖：

- CLI command/flag contract；
- 十步 init 与 custom Pi home metadata；
- update preservation；
- 七个 agents 与项目资产安装；
- provider/settings/cap merge；
- AGENTS managed block；
- uninstall preservation 与幂等；
- template residue/placeholder；
- npm `files` 白名单与 package public surface。

完整验证：

```bash
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run --json
node bin/ccg.mjs --help
```

## 凭据规则

真实 API Key/token 不得写入 prompt、AGENTS.md、chain、task、log、summary、fixture 或 metadata。测试只用占位符。MCP 凭据仅允许存在于用户自管的 `<project>/.pi/mcp.json`。
