# pi-ccg — CCG for Pi CLI

[![npm](https://img.shields.io/npm/v/pi-ccg)](https://www.npmjs.com/package/pi-ccg)
[![CI](https://github.com/qinye6/pi-ccg/actions/workflows/ci.yml/badge.svg)](https://github.com/qinye6/pi-ccg/actions/workflows/ci.yml)
[![文档](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://qinye6.github.io/pi-ccg/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

CCG 将 Pi CLI 改造成一个有边界的多智能体开发 supervisor。Pi 是唯一主控：它负责识别项目组件、规划文件归属、按需派生通用 builder、自动测试与审查，并把失败按组件定向回派给对应的 builder 实例。

[English](./README.md)

> 当前包版本：`3.2.5` · Node.js `>=20`

## 工作流程

一次标准执行包含：

1. `ccg-project-scout` 只读扫描项目结构与候选组件。
2. `ccg-planner` 输出组件契约：`componentId`、文件 ownership、依赖、执行 waves、组件 profile 和测试命令。
3. Pi supervisor relay 该契约、执行 ownership barrier，并在任何可写 builder 启动前等待 supervisor `START` approval。
4. Pi 根据计划动态从通用 role template 派生 `N` 个 frontend builder 实例和 `M` 个 backend builder 实例，按组件/profile 与 wave 分组执行。
5. 每个 builder 只实现自己负责的范围，并以 `FINISH` handoff 返回 `componentId`、变更文件、假设与验证结果。
6. `ccg-test-runner` 执行适用的测试、typecheck、lint 与 build。
7. `ccg-reviewer` 独立审查正确性、质量和安全问题。
8. 测试失败或出现 `Critical` finding 时，Pi 根据 `componentId` 回派给 owning builder 实例，最多进行两轮窄范围修复。

builder 实例数量由项目实际计划决定，但绝不能超过用户配置的并发与派生上限。

## 六个 Pi role templates

CCG 安装六个固定 role template。Pi 可以在同一 builder template 上派生多个子实例，用于不同组件。

| Role template | 职责 |
|---|---|
| `ccg-project-scout` | 只读发现项目结构与组件 |
| `ccg-planner` | 组件计划、文件边界、ownership、依赖、waves、测试计划 |
| `ccg-backend-builder` | 通用后端、服务、API、数据与基础设施实现 |
| `ccg-frontend-builder` | 通用前端实现，包括 Web UI、管理后台、小程序、移动 Web 或其他 frontend profile |
| `ccg-test-runner` | 执行测试、typecheck、lint、build |
| `ccg-reviewer` | 独立正确性、质量与安全审查 |

scout、planner 和所有 builder 实例使用必需 `pi-subagents` 包提供的 per-agent persistent memory。这是 `pi-subagents` 的 `memory` frontmatter 能力，独立于 Pi core parent/session/project memory，且不是第二个扩展。reviewer 与 test-runner 保持无状态，确保验收不依赖实现上下文。

### 动态拆分示例

如果项目包含后端服务、Web 管理后台和微信小程序，Pi 可以自动派生：

- 一个 `ccg-backend-builder` 实例处理后端组件；
- 一个带 Web/Admin `componentProfile` 的 `ccg-frontend-builder` 实例；
- 一个带 Mini-program/WeChat `componentProfile` 的 `ccg-frontend-builder` 实例。

`ccg-miniprogram-builder` 已退休，不属于当前 active runtime。小程序/微信工作仅作为 frontend `componentProfile`，由通用 frontend builder 实例处理。

## 协调契约

Pi supervisor 负责 child-parent 协调：

- `START` approval：规划完成后，Pi 展示或 relay 实施契约；在 supervisor 发出 `START` 前，不启动可写 builder 工作。该 approval 由 Pi supervisor coordination 中介，不一定是直接用户提示。
- Contract relay：每个子任务都在 task string 内收到相关 plan slice、依赖、文件 ownership 边界、前序 wave 输出和必需 `componentId`。
- Ownership barrier：builder 不得修改其他组件拥有的文件；跨组件变更必须上报 supervisor，而不是顺手修改。
- Wave execution：Pi 按依赖 wave 组织 builder 实例，并把有效开发并发限制在配置上限内。
- `FINISH` handoff：每个 builder 返回变更内容、已验证事项、剩余风险以及完成的 `componentId`。
- 定向修复：测试/审查失败必须携带 `componentId`；Pi 只把窄范围修复任务发送给 owning builder 实例，最多两轮。

## 并发与预算上限

有效开发并发：

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)
```

标准执行的派生预算：

```text
requiredSpawns = 2 + (N_frontend + M_backend) + 1 + 1
```

其中 `2` 是 scout + planner，`N_frontend + M_backend` 是动态 builder 实例数量，后两个 `1` 分别是 test-runner 和 reviewer。默认值：

```text
devAgentCap = 4
globalConcurrencyLimit = 4
maxSpawnsPerSession = 24
maxSubagentDepth = 1
```

## 安装

前置条件：

- Node.js `>=20`
- Pi CLI

运行十一阶段交互安装器：

```bash
npx pi-ccg init
```

安装器会检测必需的 `npm:pi-subagents`，缺失时先询问是否安装；同时展示精选扩展目录。推荐项可默认勾选，但执行任何第三方 package 操作前都必须由用户明确确认。

| 分级 | Package | 能力 |
|---|---|---|
| 必需 | `npm:pi-subagents` | 编排、supervisor coordination、per-agent memory |
| 推荐 | `npm:pi-mcp-adapter` | lazy MCP、紧凑 proxy、metadata cache、输出保护 |
| 推荐 | `npm:pi-memctx` | 本地知识包、检索和按需上下文注入 |
| 推荐 | `npm:pi-session-continuity` | durable checkpoint、handoff、会话恢复 |
| 可选 | `npm:pi-pr-review` | 并行 GitHub PR 审查与结构化 findings |
| 实验性 | `npm:@vigolium/piolium` | 多阶段安全审计，默认不选 |

非交互示例：

```bash
npx pi-ccg init \
  --skip-prompt \
  --project-assets \
  --install-required-package \
  --extensions mcp-adapter,memory-context,session-continuity \
  --frontend-model provider/frontend-model \
  --backend-model provider/backend-model \
  --review-model provider/review-model \
  --dev-agent-cap 4 \
  --global-concurrency-limit 4 \
  --max-spawns-per-session 24 \
  --max-subagent-depth 1
```

fresh non-interactive install 不会静默安装 optional packages；只有 `--extensions` 显式选择时才安装。`--no-optional-extensions` 表示仅安装核心工作流。

模型分开配置：

- Frontend model → 通用 `ccg-frontend-builder` 实例
- Backend model → 通用 `ccg-backend-builder` 实例
- Review model → `ccg-reviewer`、`ccg-test-runner`
- scout/planner 默认继承 Pi 的 `subagents.defaultModel`

`--provider-file <path>` 只能用于不含真实凭据的 provider 定义。凭据不得进入 provider file、prompt、template、task、log 或 metadata。

## CLI 命令

```text
ccg              打开 Pi workflow 交互菜单
ccg init         安装 CCG assets 与用户选择的扩展
ccg update [--install-dir <path>]  仅重装受管资产，不执行 package 操作
ccg extensions [--install-dir <path>]  明确管理精选 Pi 扩展
ccg doctor [--install-dir <path>] [--project-dir <path>]  检查 runtime、agents、caps、models、extensions 与 MCP 配置存在性
ccg status [--install-dir <path>] [--project-dir <path>]  显示 readiness 与 extension ownership 汇总
ccg uninstall    仅移除受管资产和 CCG-owned packages
```

主要 init 参数：

```text
--extensions <id,id>
--no-optional-extensions
--install-required-package
--frontend-model <provider/model>
--backend-model <provider/model>
--review-model <provider/model>
--provider-file <path>
--dev-agent-cap <number>
--global-concurrency-limit <number>
--max-spawns-per-session <number>
--max-subagent-depth <number>
--project-assets | --no-project-assets
--install-dir <path>
--skip-prompt
--force
```

## 安装路径

用户级资产：

```text
~/.pi/agent/agents/
~/.pi/agent/chains/
~/.pi/agent/prompts/
~/.pi/agent/settings.json
~/.pi/agent/models.json
~/.pi/agent/extensions/subagent/config.json
~/.pi/agent/ccg-workflow.json
```

可选项目级资产：

```text
<project>/AGENTS.md                  # 仅 CCG managed block
<project>/.pi/chains/ccg-plan.chain.md
<project>/.pi/prompts/ccg-go.md
<project>/.pi/settings.json
<project>/.pi/mcp.json.example
```

CCG 只修改 `AGENTS.md` 中以下 marker 之间的受管块：

```text
<!-- CCG:PI-START -->
<!-- CCG:PI-END -->
```

块外用户内容必须保留。卸载只删除受管文件、受管配置键和受管块。

## 集成、memory 与 continuity

Pi CLI 是 host runtime。`pi-subagents` 是必需 package，提供 orchestration、原生 supervisor coordination 和 per-agent persistent `memory` frontmatter。

推荐 profile 增加：`pi-mcp-adapter` 的 lazy MCP/proxy，`pi-memctx` 的本地知识检索与按需注入，以及 `pi-session-continuity` 的 durable checkpoint/handoff。`pi-pr-review` 为可选；`@vigolium/piolium` 为实验性且默认不选。通过 `ccg extensions` 管理这些 packages。预先存在的 package 标记为 `adopted`；CCG 只删除自己安装并记录为 `ccg-installed` 的 package。

CCG 保持静态 prompt 前缀稳定，把运行期 plan/handoff 放在 task string 后部；lazy MCP metadata 与按需 memory 可减少上下文抖动。但实际 prompt-cache 命中仍由 provider 决定，不承诺固定命中率。

CCG 可以写入 `<project>/.pi/mcp.json.example`，但永不覆盖、读取其中 credential values 或删除用户的 `<project>/.pi/mcp.json`。update 保留扩展选择，不执行 package 操作，也不会静默加入新推荐项。

## 凭据铁律

真实 API Key/token 绝不能进入 agent prompt、`AGENTS.md`、chain、task description、log、summary、示例或 CCG metadata。MCP 凭据只允许存在于用户自管且不受覆盖的 `<project>/.pi/mcp.json`；CCG 不覆盖、不删除该文件。

## 发布资产边界

npm 包仅发布：

```text
bin/ccg.mjs
dist/
templates/pi/
```

`templates/pi/` 是当前唯一安装面。旧 Claude/Codex/Gemini command、prompt、hook、skill 和 wrapper 仅作为仓库历史源码保留：Pi CLI 主路径不安装它们，package root 不公开 legacy installer 入口，npm 包也不发布这些 runtime assets。

## 开发验证

```bash
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run --json
node bin/ccg.mjs --help
```

本项目采用 [MIT License](./LICENSE)。
