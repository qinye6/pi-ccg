# templates — Pi runtime templates

> [根目录](../CLAUDE.md) > **templates**

**Last Updated**: 2026-07-30 (v3.2.7)

## 当前发布面

`templates/pi/` 是 CCG 当前唯一安装和 npm 发布的模板目录。`package.json#files` 只包含 `templates/pi/`，不包含旧 commands、hooks、prompts、skills、rules 或 wrapper 资产。

## Pi assets（12 个）

```text
templates/pi/
├── AGENTS.managed.md
├── agents/
│   ├── ccg-project-scout.md
│   ├── ccg-planner.md
│   ├── ccg-backend-builder.md
│   ├── ccg-frontend-builder.md
│   ├── ccg-test-runner.md
│   └── ccg-reviewer.md
├── chains/
│   └── ccg-plan.chain.md
├── prompts/
│   └── ccg-go.md
├── extensions/
│   └── subagent-config.json
├── project/
│   └── settings.json
└── mcp/
    └── nocturne.example.json
```

`ccg-miniprogram-builder` 已退休，不属于当前 active runtime。小程序/微信只作为 frontend `componentProfile`，由通用 `ccg-frontend-builder` 实例处理。

## 安装目标

| 模板 | 目标 |
|---|---|
| `agents/*.md` | `~/.pi/agent/agents/` |
| `chains/ccg-plan.chain.md` | `<project>/.pi/chains/` 或 `~/.pi/agent/chains/` |
| `prompts/ccg-go.md` | `<project>/.pi/prompts/` 或 `~/.pi/agent/prompts/` |
| `AGENTS.managed.md` | `<project>/AGENTS.md` 的 CCG managed block |
| `extensions/subagent-config.json` | `~/.pi/agent/extensions/subagent/config.json` 合并 |
| `project/settings.json` | `<project>/.pi/settings.json`，仅不存在时创建 |
| `mcp/nocturne.example.json` | `<project>/.pi/mcp.json.example` |

## Agent 设计

- 当前 runtime 只有六个固定 role template：scout、planner、backend-builder、frontend-builder、test-runner、reviewer。
- 所有 agent 使用 `defaultContext: fresh`。
- supervisor 调用使用 `context: "fresh"`，跨 run context 由 task string 内联。
- `ccg-project-scout`、`ccg-planner` 和所有 backend/frontend builder 实例使用必需 `pi-subagents` package 提供的 per-agent persistent `memory` frontmatter。
- 该 memory 能力独立于 Pi core parent/session/project memory，由同一个必需 package 提供，不是第二个 extension。
- `ccg-reviewer`、`ccg-test-runner` 不启用 memory，并设置 `completionGuard: false`。
- Pi 根据 planner contract 动态派生 `N` 个 frontend builder 实例和 `M` 个 backend builder 实例，按 component/profile/wave 执行。
- builder 只实现分配的组件，不规划、不派生下级 agent。
- supervisor 必须在 builder 写入前完成 contract relay 并等待 supervisor `START` approval。
- builder 必须遵守 ownership barrier；跨组件修改需回报 supervisor，而不是擅自修改。
- builder 完成时必须输出 `FINISH` handoff，包含 `componentId`、变更文件、验证、假设与风险。
- test/review failure 必须携带 `componentId`，供 supervisor 回派 owning builder。
- 定向修复最多两轮。

## 模板变量

| 变量 | 含义 |
|---|---|
| `{{PI_AGENT_HOME}}` | Pi user agent home |
| `{{PI_PROJECT_DIR}}` | 项目 Pi 路径/项目目录 |
| `{{DEV_AGENT_CAP}}` | builder 数量上限 |
| `{{GLOBAL_CONCURRENCY_LIMIT}}` | 全局并发上限 |
| `{{MAX_SPAWNS_PER_SESSION}}` | 单会话 spawn 上限 |
| `{{MAX_SUBAGENT_DEPTH}}` | 最大嵌套深度 |
| `{{FRONTEND_MODEL}}` | generic frontend builder instances model |
| `{{BACKEND_MODEL}}` | generic backend builder instances model |
| `{{REVIEW_MODEL}}` | reviewer/test-runner model |
| managed block markers | `AGENTS.md` 受管区边界 |

安装后不允许残留未处理的大写 CCG placeholder，也不允许出现 `.claude`、`codeagent-wrapper` 或旧模型路由 placeholder。

## AGENTS.md managed block

```text
<!-- CCG:PI-START -->
...
<!-- CCG:PI-END -->
```

只能替换或删除该块；块外内容逐字保留。只有移除受管块后文件不含有效用户内容时，卸载器才可删除空文件。

## 凭据规则

模板、agent prompt、chain、task、log、summary 和示例中不得出现真实 API Key/token。`nocturne.example.json` 只能包含 placeholder/无凭据示例。真实 MCP 凭据仅允许存在于用户自管且不覆盖的 `<project>/.pi/mcp.json`。

## 扩展与上下文边界

`pi-subagents` 是唯一 required package。推荐扩展为 `pi-mcp-adapter`、`pi-memctx`、`pi-session-continuity`；`pi-pr-review` 可选；实验性 `@vigolium/piolium` 默认不选。catalog 还提供九个 default-off options：`pi-simplify`、`pi-rtk-optimizer`、`pi-statusline`、`@juicesharp/rpiv-todo`、`@juicesharp/rpiv-ask-user-question`、`@narumitw/pi-plan-mode`、`pi-web-access`、`pi-hashline-edit-pro`、`pi-fff`。`pi-task` identity 未核验，不属于 catalog。模板不得假定 optional tool 一定存在：可用时按需调用，不可用时以 task-string plan/handoff 和内建 reviewer 降级。

静态角色说明与 coordination rules 保持稳定，运行期 plan、component data、handoff、findings 放在 task string 后部。lazy MCP proxy 与按需 memory injection 用于降低上下文抖动，但 provider cache hit 不作承诺。

CCG 只写 `.pi/mcp.json.example`，不覆盖、不删除、不输出 `.pi/mcp.json` 的值。真实凭据不得进入模板、agent prompt、chain、task、消息、日志、summary 或 metadata。

## 历史目录

`templates/` 下除 `pi/` 外的目录属于 Claude/Codex/Gemini 时代历史源码。当前 Pi CLI：

- 不安装这些目录；
- 不通过 package root 暴露其 installer；
- 不在 npm package `files` 中发布；
- 不应为其新增 runtime 功能。
