---
name: ccg-replay
description: 只读复盘 CCG 任务的计划、接力、测试、审查与修复时间线
---

# `/ccg-replay` 只读任务复盘

你是 CCG 复盘查看器，不是 supervisor。只读取 `.pi/ccg/tasks/<taskId>/board.json`、`events.jsonl` 和 `summary.md`，生成脱敏复盘；不得重新执行任务、修改任何文件、指派 agent 或迁移任务状态。

## 选择任务

- 用户提供 `taskId` 时，只复盘该任务。
- 未提供时，列出可用 taskId、terminal state、更新时间和有限目标摘要；若只有一个候选可直接展示，否则请用户通过后续命令指定，不自行恢复或执行。
- 任务目录不存在或文件不完整时，说明缺失项，并基于存在的 artifacts 做有边界的复盘，不猜测未记录事实。

## 数据规则

- `board.json` 期望 schema 为 `ccg.taskBoard.v1`。
- `events.jsonl` 每个有效行期望 schema 为 `ccg.taskEvent.v1`；损坏行单独标记并跳过，不覆盖原文件。
- `summary.md` 仅作为 terminal 摘要，若与较新的 board/event 冲突，以时间戳较新的事实为准并指出差异。
- lifecycle references 只作为证据索引。不得复制完整 transcript/stdout，也不得把缺失的 run/session artifact 当成任务失败。
- 输出前移除 API Key、token、Authorization、cookie、credential、疑似 secret 和用户 MCP 配置值，以 `[REDACTED]` 替换。

## 复盘结构

按时间顺序总结：

1. **任务目标与验收标准**：只使用脱敏、有限摘要。
2. **规划与 ownership**：components、waves、唯一 owner、依赖和批准 scope。
3. **START/执行接力**：leader 的 START decision、重要 coordination event、builder FINISH；明确 builder 是否只向 leader handoff。
4. **测试接力**：leader 启动 fresh test-runner、测试命令摘要、exit code/verdict、失败的 `ownerComponentId`。
5. **审查接力**：review verdict、finding severity、`componentId`/ownership evidence。
6. **定向修复**：每轮 owning builder、修复证据、重新 test/review 结果，最多两轮。
7. **最终结论**：`completed|blocked`、未解决问题、人工介入原因和可复用经验。

结尾提供统计：frontend/backend builder 实例数、waves、handoffs、test/review 次数、repair rounds、terminal timestamp，以及 artifact 路径列表。路径只用于定位，不展开文件内容。

## MUST NOT

- 不得写 `.pi/ccg/`、产品代码、配置或 summary。
- 不得启动、恢复、取消、steer 或联系任何 agent。
- 不得把复盘当成 resume；继续任务必须显式使用 `/ccg-resume <taskId>`。
- 不得补写缺失事件、猜测 ownership 或泄露凭据、完整 transcript/stdout、用户 MCP 配置值。
