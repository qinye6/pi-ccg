---
name: ccg-resume
description: 从 durable board 安全恢复未完成 CCG 任务，并以 fresh context 继续接力
---

# `/ccg-resume` 安全恢复 playbook

你是唯一 Pi supervisor。此命令只恢复 leader 的 durable checkpoint，不恢复或复用旧 child conversation。所有新 child 必须使用 `context: "fresh"`，并只接收其职责所需的 task slice、最新 contract、相关 handoff 和 acceptance。

## Phase 1 — 只读恢复检查

要求用户提供 `taskId`，读取：

```text
.pi/ccg/tasks/<taskId>/board.json
.pi/ccg/tasks/<taskId>/events.jsonl
.pi/ccg/tasks/<taskId>/summary.md
```

`board.json` 必须是 `ccg.taskBoard.v1`。校验 taskId、phase/state、components、ownership、currentWave、handoffs、test/review verdict、repairRound、nextAction、timestamps 和 lifecycle artifact references。`events.jsonl` 仅接受 `ccg.taskEvent.v1` 有效行；损坏或未知 schema 不得静默忽略，应阻塞自动恢复并说明原因。

读取前后都不得输出 API Key、token、Authorization、cookie、credential、疑似 secret 或用户 MCP 配置值。发现 board/event 含疑似 secret 时停止恢复，要求人工清理；不得把敏感内容内联进新 task。

## Phase 2 — 与 lifecycle 对账

board 是 durable projection，不是第二个调度引擎。对存在的 `runId`、`sessionId`、`asyncDir`、`sessionFile`、`outputFile` 引用查询只读 lifecycle/FleetView 状态：

- 仍在运行的旧 child：不要重复 spawn；先判断是否可安全等待或由 leader 接管其最终 handoff。
- 已 terminal 且有结构化结果：校验 schema、ownership 和时间戳后投影到 leader 恢复上下文。
- artifact 缺失：记录为 unavailable，不猜测成功或失败；根据最后一个已验证 event 决定安全恢复点。
- board 与实时状态冲突：优先 lifecycle 事实，但只有 leader 校验后才能写回 board 和迁移状态。

## Phase 3 — 确定恢复点

主阶段只能是：

```text
intake → planning → building → testing → reviewing → repairing → completed|blocked
```

- `completed`：不重新执行，提示使用 `/ccg-replay <taskId>`。
- `blocked`：只有 blocker 已明确解除且不需要新的产品决策时才继续；否则请求最小人工输入。
- `planning`：重新运行只读 planner，并内联已确认需求与现有非敏感事实；不得假装旧 plan 完整。
- `building`：只重派未完成或证据无效的 owning builder；已验证 FINISH 的组件不得重复实现。
- `testing`：由 leader 启动 fresh `ccg-test-runner`，只内联测试所需摘要、plan、roster、contracts、builder results 和 testPlan。
- `reviewing`：由 leader 启动 fresh `ccg-reviewer`，只内联审查所需事实。
- `repairing`：按 failure/finding 的 `ownerComponentId`/`componentId` 回派 owning builder；累计修复轮数不得超过 2。

恢复前重新验证 ownership 无重叠、contract producer/consumer 顺序、并发 caps、spawn budget 和剩余 repair budget。无法安全确定 owner、环境/权限阻塞或两轮修复已耗尽时转为 `blocked` 并请求人工介入。

## Phase 4 — Leader-only A2A 继续执行

- builder START 必须由 leader 批准；builder FINISH 只能交给 leader。
- builder 不得直接启动 tester/reviewer、联系 sibling 或写 `.pi/ccg/`。
- test/review 结果先返回 leader；leader 校验后按 ownership 路由修复。
- tester/reviewer 不修改产品代码，不执行写入式命令，不扩大 scope。
- child 输出不直接迁移 board；leader 追加 `ccg.taskEvent.v1` 并原子更新 `ccg.taskBoard.v1`。

每次 board/event 写入只保留有限摘要与 lifecycle references，不复制完整 transcript/stdout。结束或再次阻塞时更新 `summary.md`，供 `/ccg-replay` 使用。

## 人工介入边界

需求已确认后由 leader 全权继续。只有产品决策无法从事实确定、ownership 无法安全化解、环境/权限阻塞、artifact 冲突无法验证，或两轮定向修复后仍失败时才请求人工介入。

## MUST NOT

- 不得使用 `context: "fork"` 或复用旧 child conversation。
- 不得重新执行已由有效 FINISH/test/review 证据确认的阶段。
- 不得让多个 writer 修改同一文件或让 agent 越过批准 ownership。
- 不得超过 caps、spawn budget 或两轮修复上限。
- 不得把真实凭据、完整 transcript/stdout 或用户 MCP 配置值写入 prompt、task、board、event、summary、消息或日志。
