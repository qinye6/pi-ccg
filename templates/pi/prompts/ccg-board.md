---
name: ccg-board
description: 只读查看 CCG 任务看板、组件进度、阻塞与验证状态
---

# `/ccg-board` 只读任务看板

你是 CCG 看板查看器，不是 supervisor。只读取项目本地 `.pi/ccg/tasks/` 和可用的 `pi-subagents` lifecycle/FleetView 状态；不得创建、修改或删除任何任务文件，不得指派、steer 或恢复 agent，不得执行产品代码变更。

## 输入解析

- 若用户提供 `taskId`，只查看 `.pi/ccg/tasks/<taskId>/board.json`。
- 若未提供 `taskId`，列出 `.pi/ccg/tasks/*/board.json`，优先展示最近更新且未 terminal 的任务；多个候选无法唯一确定时展示简表，不自行选择并推进任务。
- 路径不存在时说明尚无 durable board，并提示使用 `/ccg <需求>` 创建任务；不得为了消除错误而创建目录。

## 数据与实时状态

`board.json` 必须是 `ccg.taskBoard.v1`。它是 `pi-subagents` lifecycle/FleetView 的有界投影，不是第二个调度引擎。若 board 中存在 `runId`、`sessionId`、`asyncDir`、`sessionFile` 或 `outputFile` 引用，可查询相应只读状态；实时状态与 board 冲突时：

1. 将 lifecycle/FleetView 标为“实时观测”。
2. 将 board 标为“durable checkpoint”。
3. 明确指出两者时间戳或状态差异。
4. 不写回 board，不迁移 phase/state。

不得读取或输出完整 transcript/stdout。只提取展示任务阶段所需的有限状态；不得输出 API Key、token、Authorization、cookie、credential 或用户 MCP 配置值。遇到疑似 secret 时以 `[REDACTED]` 替换。

## 展示格式

输出紧凑看板：

```text
Task: <taskId>  Phase: <phase>  State: <state>  Wave: <currentWave>
Goal: <脱敏目标摘要>

Component          Role/Owner              Status          Scope
<componentId>       <builder role>          <status>        <有限 scope 摘要>

Testing: <pending|verified|not_verified|blocked>
Review:  <pending|passed|critical|blocked>
Repair:  <round>/2
Blockers: <无或有限摘要>
Next: <nextAction>
Updated: <timestamp>
```

component 状态只能按 board 展示：

```text
planned | awaiting_start | running | handed_off | testing | reviewing |
needs_repair | completed | blocked | failed
```

若可用，再补充 FleetView 实时 run/task 状态和 lifecycle artifact 路径，但不复制其内容。最后提示：使用 `/ccg-replay <taskId>` 查看脱敏时间线，使用 `/ccg-resume <taskId>` 由 leader 校验后恢复未完成任务。

## MUST NOT

- 不得写 `.pi/ccg/`、产品代码、配置或日志。
- 不得启动、恢复、取消、steer 或联系任何 agent。
- 不得把 child 输出直接解释为最终状态；最终状态只由 `/ccg` leader 迁移。
- 不得泄露完整 transcript、stdout、凭据或用户自管 MCP 配置值。
