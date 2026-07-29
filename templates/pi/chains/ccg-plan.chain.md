---
name: ccg-plan
description: 只读扫描项目并生成通用 frontend/backend 动态 fanout 计划
---

## ccg-project-scout
phase: Context
label: 扫描项目组成
as: scout
output: context.md
progress: true

只读扫描当前项目，围绕用户任务 `{task}` 识别实际组件。UI 平台统一标记为 `builderKind=frontend`，API/service/database/worker/CLI/library/infra 等统一标记为 `builderKind=backend`；Web、管理后台、小程序、mobile 等只是开放的 `componentProfile`。不要写代码或运行命令。输出 5 行以内摘要与符合 `ccg.projectScout.v2` 的 fenced JSON，包含 evidence、ownedScopes、dependsOn、sharedScopes/sharedContracts、候选验证命令、并行风险和 openQuestions。

## ccg-planner
phase: Planning
label: 生成动态 fanout 与 ownership 计划
as: plan
reads: context.md
output: plan.md
progress: true

基于用户任务 `{task}` 与 scout 输出 `{outputs.scout}`，生成只读 `ccg.fanoutPlan.v2`。Pi 可多次实例化同一个通用 frontend/backend builder；不要把平台示例固化为 agent。输出互斥 scope/plannedFiles、forbiddenScopes、职责、componentProfile、contracts、shared owner、依赖 waves、acceptance、conflictChecks、测试/审查计划、requiresSupervisorDecision 与 openQuestions。任何重复职责、同文件多 writer、未分配 shared owner 或 contract 顺序冲突必须先拆 wave 或标记阻塞，不能留给 builder 抢占。
