# templates — Pi runtime templates

> [根目录](../CLAUDE.md) > **templates**

**Last Updated**: 2026-07-27 (v3.2.4)

## 当前发布面

`templates/pi/` 是 CCG 当前唯一安装和 npm 发布的模板目录。`package.json#files` 只包含 `templates/pi/`，不包含旧 commands、hooks、prompts、skills、rules 或 wrapper 资产。

## Pi assets（13 个）

```text
templates/pi/
├── AGENTS.managed.md
├── agents/
│   ├── ccg-project-scout.md
│   ├── ccg-planner.md
│   ├── ccg-backend-builder.md
│   ├── ccg-frontend-builder.md
│   ├── ccg-miniprogram-builder.md
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

- 所有 agent 使用 `defaultContext: fresh`。
- supervisor 调用使用 `context: "fresh"`，跨 run context 由 task string 内联。
- `ccg-project-scout`、`ccg-planner` 和三个 builder 使用 Pi native project memory。
- `ccg-reviewer`、`ccg-test-runner` 不启用 memory，并设置 `completionGuard: false`。
- builder 只实现分配的组件，不规划、不派生下级 agent。
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
| `{{FRONTEND_MODEL}}` | frontend/miniprogram builder model |
| `{{BACKEND_MODEL}}` | backend builder model |
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

## 历史目录

`templates/` 下除 `pi/` 外的目录属于 Claude/Codex/Gemini 时代历史源码。当前 Pi CLI：

- 不安装这些目录；
- 不通过 package root 暴露其 installer；
- 不在 npm package `files` 中发布；
- 不应为其新增 runtime 功能。
