# src — CCG for Pi CLI

> [根目录](../CLAUDE.md) > **src**

**Last Updated**: 2026-07-29 (v3.2.6)

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
| `ccg init` / `ccg i` | `commands/init.ts` | 十一阶段 Pi 安装/配置与扩展选择向导 |
| `ccg update [--install-dir <path>]` | `commands/update.ts` | 从 metadata 恢复选择并安全重装；不执行 package 操作 |
| `ccg extensions [--install-dir <path>]` | `commands/extensions.ts` | 管理扩展 catalog、选择与 package lifecycle |
| `ccg doctor [--install-dir <path>] [--project-dir <path>]` | `commands/doctor.ts` | 检查 Pi CLI、必需 runtime、agents、caps、models、extensions、MCP 配置存在性 |
| `ccg status [--install-dir <path>] [--project-dir <path>]` | `commands/doctor.ts` | 显示安装与 extension ownership 概况 |
| `ccg uninstall` | `uninstallPiWorkflow()` | 移除 CCG assets 与 CCG-owned packages，保留 adopted packages |

`init` 十一阶段状态机：

```text
language → environment → extensions → scope → provider → frontend model
→ backend model → review model → limits → entry → summary
```

主要 options：`--extensions`、`--no-optional-extensions`、`--install-required-package`、`--frontend-model`、`--backend-model`、`--review-model`、`--provider-file`、四个 cap 参数、`--project-assets/--no-project-assets`、`--install-dir`、`--skip-prompt`、`--force`。`--preserve-extensions` 仅供 update 保留 metadata 且禁止 package reconciliation。

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
- `models.json` 使用 missing/valid/invalid 三态检查；invalid JSON 拒绝覆盖。
- provider/model 按 exact ID merge；`modelOverrides` 递归深合并并保留 pricing、nested compat、headers、siblings 与未知字段。
- 只有 exact verified model preset 才自动补全 `contextWindow` / `maxTokens`；unknown model 不猜测。
- custom provider onboarding 只接受 API key 环境变量引用，不要求、不读取、不存储真实 key。
- `settings.json`、`models.json`、subagent config 与 `ccg-workflow.json` metadata 使用同目录临时文件、`fsync` 和 atomic rename 写入；逻辑合并保留非 CCG 字段。
- 模板写入结果区分 `written`、`skipped`、`failed`。
- 模板写入前拒绝 `.claude`、`codeagent-wrapper` 和旧模型 placeholder 残留。

## 模型、并发与动态 builder 映射

```text
frontendModel → generic ccg-frontend-builder instances
backendModel  → generic ccg-backend-builder instances
reviewModel   → ccg-reviewer, ccg-test-runner
```

scout/planner 继承 Pi `subagents.defaultModel`。

Pi 根据 planner contract 动态派生 `N` 个 frontend builder 实例和 `M` 个 backend builder 实例。实例按 component/profile/wave 执行；`ccg-miniprogram-builder` 已退休，小程序/微信是 frontend `componentProfile`。

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)

requiredSpawns = 2 + (N_frontend + M_backend) + 1 + 1
```

默认 caps：`4 / 4 / 24 / 1`。

## Runtime coordination contract

- planner 产出 `componentId`、ownership、依赖 waves、component profile 和测试计划。
- supervisor relay contract 后必须等待 supervisor `START` approval，才能启动可写 builder。
- builder task string 必须内联相关 plan slice、前序 wave handoff 和边界约束。
- builder 只能改 ownership 范围内的文件，跨组件变更交由 supervisor 协调。
- builder 完成时输出 `FINISH` handoff。
- test/review failure 必须携带 `componentId`，定向修复最多两轮。

## 关键模块

| 文件 | 作用 |
|---|---|
| `commands/init.ts` | 十一阶段向导、扩展选择、metadata 写入 |
| `commands/extensions.ts` | catalog 状态、用户确认、安装/移除与 ownership |
| `commands/update.ts` | metadata 驱动 assets 更新；不执行第三方 package 操作 |
| `commands/doctor.ts` | required/selected/skipped 健康检查与脱敏状态 |
| `commands/menu.ts` | Pi-only 菜单 |
| `cli-setup.ts` | 七个 CLI command 注册 |
| `utils/installer.ts` | Pi assets 安装/卸载与 CCG-owned package 清理；legacy 实现仅内部历史兼容 |
| `utils/pi-extensions.ts` | 扩展 catalog、selection reconciliation、ownership |
| `utils/pi-runtime.ts` | Pi/package inventory 检测与安全参数数组 lifecycle 命令 |
| `utils/pi-paths.ts` | Pi 路径、agent 名、默认 caps |
| `utils/pi-config.ts` | settings/provider/cap 合并、atomic JSON 写入与公式 |
| `utils/installer-template.ts` | Pi 模板注入、legacy residue 检测、managed block |
| `types/index.ts` | Pi metadata、caps、result 类型及历史类型 |

## 扩展与 package lifecycle 边界

`pi-subagents` 是唯一 required package。精选 catalog 还包含推荐的 `pi-mcp-adapter`、`pi-memctx`、`pi-session-continuity`，可选的 `pi-pr-review`，默认不选的实验性 `@vigolium/piolium`，以及九个 default-off options：`pi-simplify`、`pi-rtk-optimizer`、`pi-statusline`、`@juicesharp/rpiv-todo`、`@juicesharp/rpiv-ask-user-question`、`@narumitw/pi-plan-mode`、`pi-web-access`、`pi-hashline-edit-pro`、`pi-fff`。`pi-task` identity 歧义，当前 deferred。

interactive init 可预选推荐项，但 package/config mutation 必须最终确认后才执行；non-interactive fresh install 只有显式 flags 才安装 optional packages。metadata ownership 为 `ccg-installed` / `adopted` / `missing`。update 只重装 assets 并保留 metadata；`ccg extensions` 独占 package lifecycle；uninstall 只删除 CCG-owned packages。failed removal 在 package 仍存在时重试，package 已被外部删除时清理 stale metadata。命令使用受校验 package spec 和参数数组，不拼接 shell。

`pi-web-access` 配置目标固定为 `~/.pi/web-search.json`，不受 `--install-dir` 影响。CCG 只在 `workflow` 字段缺失时 create/merge `workflow: "none"`；existing workflow、invalid JSON 和其他字段全部保留，package install 失败时不写配置，uninstall 永不删除该文件。

`pi-subagents` 提供 orchestration 与 per-agent memory；`pi-memctx`、`pi-session-continuity`、`pi-mcp-adapter` 分别补充按需 context、durable handoff、lazy MCP proxy。稳定 prompt 前缀加 task 尾部 runtime context 只提升 cache friendliness，实际 cache hit 由 provider 决定。

CCG 只写 `.pi/mcp.json.example`，不覆盖、删除或输出用户 `.pi/mcp.json` 的值。

## Legacy 边界

旧 `installWorkflows()` / `uninstallWorkflows()` 源码暂时保留在 `installer.ts`，用于历史迁移参考和内部兼容，但：

- CLI 不调用；
- `src/index.ts` 不公开；
- npm package 不发布其 commands/hooks/prompts/skills/runtime assets；
- 当前测试不得下载 `codeagent-wrapper` 或访问 binary CDN。

## 测试

`src/utils/__tests__/` 的 Pi 主线覆盖：

- CLI command/flag contract；
- 十一阶段 init、扩展选择与 custom Pi home metadata；
- update 对 partial legacy metadata 的兼容、扩展选择保留、公开 `--install-dir` 与 atomic metadata/config 写入；
- package inventory、catalog validation、安全 install/remove 参数、ownership 与失败重试；
- doctor required/selected/skipped 分级、MCP 路径存在性与输出脱敏；
- 六个 role templates、动态 builder 路由与项目资产安装；
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
