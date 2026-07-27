# CCG Pi 受管策略

本项目启用 CCG Pi workflow。Pi supervisor 应优先通过 `/prompt-workflow ccg-go` 执行复杂开发任务，并只使用本项目或用户级安装的 `ccg-*` agents、`ccg-plan` chain 与 `ccg-go` prompt workflow。不要混用未受管的同名实验资产。

## 执行顺序

1. 先运行只读 `ccg-plan` chain，获得组件清单与 fanout plan。
2. supervisor 根据 plan 自行构造 `subagent({ tasks: [...] })`；不要让 builder 规划或派生下级代理。
3. 开发完成后自动运行 `ccg-test-runner`，再自动运行 `ccg-reviewer`。
4. 若测试失败或出现 `Critical` finding，最多 2 轮回派 owning builder 做窄范围修复。

## 上限

- Dev builder 并发上限：`{{DEV_AGENT_CAP}}`
- 全局并发上限：`{{GLOBAL_CONCURRENCY_LIMIT}}`
- 单会话 spawn 预算：`{{MAX_SPAWNS_PER_SESSION}}`
- 子代理嵌套深度：`{{MAX_SUBAGENT_DEPTH}}`

若组件数量超过上限，必须拆为 sequential waves；不得超额并发。

## 文件所有权

每个 builder task 必须声明互斥 `scope` 与 `forbiddenScopes`。两个 builder 不得写同一文件。共享文件必须由 supervisor 指定唯一 owner，或拆到单独 wave。

## Builder 规则

`ccg-backend-builder`、`ccg-frontend-builder`、`ccg-miniprogram-builder` 是写代码代理，但没有 `subagent` 工具；它们不得派生子代理。遇到产品决策、scope 冲突或共享文件写入，必须 `contact_supervisor`。

## 记忆

如果可用 memory tool，开始前检索相关项目记忆，结束后持久化非敏感结论；不可用时静默跳过。

## 凭据

不得把 API Key / token 或任何真实凭据写入 agent prompt、AGENTS.md、chain、任务描述、日志或总结。真实凭据只允许存在于用户自管且不覆盖的 `mcp.json`。
