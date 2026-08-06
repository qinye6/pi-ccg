# CCG Pi 受管策略

本项目启用 CCG Pi workflow。Pi 是唯一 supervisor；固定模板为 scout、planner、通用 frontend/backend builder、test-runner、reviewer。Pi 根据实际组件动态实例化 `N` 个 frontend builder 与 `M` 个 backend builder，Web、管理后台、小程序、mobile 等只是 `componentProfile`，不是固定 agent。

## 执行顺序

1. 运行只读 `ccg-plan`，获得 `ccg.fanoutPlan.v2`。
2. supervisor 建立 coordination roster，检查重复职责、scope/file、shared owner 与 contract 冲突。
3. 按依赖和上限启动 async waves；同一通用 builder 模板可出现多次。
4. 每个 builder 在写代码前必须通过 `ccg.builderStart.v2` 请求批准；未批准不得 edit/write。
5. scope/shared file/contract 变化必须阻塞式联系 supervisor；supervisor 向受影响的运行中 builder 定向 relay。
6. builder 返回前发送 `ccg.builderFinish.v2`，并输出 `ccg.builderResult.v2`。
7. 所有开发 waves 完成后，由 supervisor 先校验 builder FINISH，再以 fresh context 运行 test-runner 与 reviewer；失败或 Critical 最多 2 轮按 componentId 定向修复。

## Leader 状态机、看板与 A2A

- supervisor 是唯一允许指派 agent、迁移任务状态和写 `.pi/ccg/` 的 leader。主阶段固定为 `intake → planning → building → testing → reviewing → repairing → completed|blocked`。
- 每个任务使用 `.pi/ccg/tasks/<taskId>/board.json`、`events.jsonl`、`summary.md` 保存 `ccg.taskBoard.v1` / `ccg.taskEvent.v1` 有界投影；实时事实仍以 `pi-subagents` lifecycle/FleetView 为准。
- child 不得修改 board/events/summary。builder FINISH 只能交给 leader；leader 校验后再启动 fresh test-runner/reviewer。test/review 失败先返回 leader，再由 leader 路由 owning builder。
- `/ccg-board` 与 `/ccg-replay` 只读；`/ccg-resume` 只恢复 leader checkpoint，后续 child 仍使用 `context: "fresh"`，不得复用旧 child conversation。
- board、event 和 summary 只保存有限摘要与 lifecycle references，不复制完整 transcript/stdout，不记录任何真实凭据或用户 MCP 配置值。

## 上限

- Dev builder 并发上限：`{{DEV_AGENT_CAP}}`
- 全局并发上限：`{{GLOBAL_CONCURRENCY_LIMIT}}`
- 单会话 spawn 预算：`{{MAX_SPAWNS_PER_SESSION}}`
- 子代理嵌套深度：`{{MAX_SUBAGENT_DEPTH}}`

组件数量可大于单 wave 并发，但必须拆顺序 waves，并为 test/review/repair 保留 spawn 预算。

## Ownership 与通信

- 两个 builder 不得写同一文件或重复实现同一职责。
- shared scope 必须有唯一 owner，或放入独立 wave。
- builder 不直接猜测 sibling intercom target；由 supervisor 持有 roster/ledger，通过 `subagent_supervisor` 审批 START，通过 `subagent(... action: "steer")` relay 相关进度、contract 与 FINISH 状态。
- `ccg-backend-builder` 和 `ccg-frontend-builder` 没有 `subagent` 工具，不得派生下级代理。

## 上下文、扩展与凭据

- `memory`/`pi-memctx` 可用时只检索和持久化非敏感项目边界、决策与验证命令；不可用时静默降级到 task-string context，且文件事实优先。
- `pi-session-continuity` 可用时用于 durable checkpoint/handoff；不可用时由 supervisor 把完整 handoff 内联给后续 run。
- `pi-mcp-adapter` 可用时先发现再按需调用 lazy MCP server，不得假定某个 MCP server 已配置；不可用时继续核心 plan/build/test/review 流程。
- `pi-pr-review` 与实验性 security audit 只能补充审查，不能替代内建 test-runner/reviewer gate。
- 静态规则保持在 task 前缀，运行期 plan/component/handoff 放在后部以减少上下文抖动；实际 provider cache hit 不保证。
- 不得把真实 API Key/token 写入 agent、prompt、AGENTS.md、chain、task、消息、日志或总结；真实 MCP 凭据只允许存在于用户自管且不覆盖的 `<project>/.pi/mcp.json`。
