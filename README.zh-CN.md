# pi-ccg — CCG for Pi CLI

[![npm](https://img.shields.io/npm/v/pi-ccg)](https://www.npmjs.com/package/pi-ccg)
[![CI](https://github.com/fengshao1227/pi-ccg/actions/workflows/ci.yml/badge.svg)](https://github.com/fengshao1227/pi-ccg/actions/workflows/ci.yml)
[![文档](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://fengshao1227.github.io/pi-ccg/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

CCG 将 Pi CLI 改造成一个有边界的多智能体开发主控。Pi 是唯一 supervisor：它负责识别项目组件、规划文件归属、按需派生智能 builder、自动测试与审查，并把失败按组件定向回派给原负责人。

[English](./README.md)

> 当前包版本：`3.2.4` · Node.js `>=20`

## 工作流程

一次标准执行包含：

1. `ccg-project-scout` 只读扫描项目结构与组件。
2. `ccg-planner` 输出组件计划、文件边界和 ownership。
3. Pi 根据计划动态构造受上限约束的 `subagent({ tasks: [...] })` fanout。
4. 各 builder 只修改自己负责的组件。
5. `ccg-test-runner` 执行适用的测试、typecheck、lint 与 build。
6. `ccg-reviewer` 独立审查正确性、质量和安全问题。
7. 测试失败或出现 `Critical` finding 时，Pi 根据 `componentId` 回派给 owning builder，最多进行两轮窄范围修复。

builder 数量由项目实际结构决定，但绝不能超过用户配置的并发与派生上限。

### 自动拆分示例

如果项目包含后端、Web 管理后台和微信小程序，Pi 可以自动派生：

- `ccg-backend-builder`
- `ccg-frontend-builder`
- `ccg-miniprogram-builder`

开发完成后，再自动派生 `ccg-test-runner` 和 `ccg-reviewer`。builder 不允许继续派生下级代理。

## 七个 Pi agents

| Agent | 职责 |
|---|---|
| `ccg-project-scout` | 只读发现项目结构与组件 |
| `ccg-planner` | 组件计划、文件边界、ownership、测试计划 |
| `ccg-backend-builder` | 后端与服务实现 |
| `ccg-frontend-builder` | Web 前端与管理后台实现 |
| `ccg-miniprogram-builder` | 微信小程序实现 |
| `ccg-test-runner` | 执行测试、typecheck、lint、build |
| `ccg-reviewer` | 独立正确性、质量与安全审查 |

scout、planner 和三个 builder 使用 Pi 原生 project memory；reviewer 与 test-runner 保持无状态。外部 memory adapter 仅为可选增强和报告项，缺失不会导致安装、更新或 doctor 失败。

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
requiredSpawns = 2 + N + 1 + 1
```

其中 `2` 是 scout + planner，`N` 是动态 builder 数量，后两个 `1` 分别是 test-runner 和 reviewer。默认值：

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
- 已启用 Pi subagent 扩展/包

交互安装：

```bash
npx pi-ccg init
```

非交互示例：

```bash
npx pi-ccg init \
  --skip-prompt \
  --project-assets \
  --frontend-model provider/frontend-model \
  --backend-model provider/backend-model \
  --review-model provider/review-model \
  --dev-agent-cap 4 \
  --global-concurrency-limit 4 \
  --max-spawns-per-session 24 \
  --max-subagent-depth 1
```

模型分开配置：

- Frontend model → `ccg-frontend-builder`、`ccg-miniprogram-builder`
- Backend model → `ccg-backend-builder`
- Review model → `ccg-reviewer`、`ccg-test-runner`
- scout/planner 默认继承 Pi 的 subagent default model

`--provider-file <path>` 只能用于不含真实凭据的 provider 定义。

## CLI 命令

```text
ccg              打开 Pi workflow 交互菜单
ccg init         安装或配置 CCG managed Pi assets
ccg update       根据 metadata 安全重装受管资产
ccg doctor       检查 Pi CLI、agents、上限、模型与可选 adapter
ccg status       显示安装概况
ccg uninstall    仅移除 CCG managed Pi assets
```

主要 init 参数：

```text
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
<project>/AGENTS.md
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
