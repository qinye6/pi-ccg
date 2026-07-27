---
name: ccg-plan
description: 只读扫描项目组成并生成 CCG 动态 fanout 计划
---

## ccg-project-scout
phase: Context
label: 扫描项目组成
as: scout
output: context.md
progress: true

只读扫描当前项目，围绕用户任务 `{task}` 识别后端、Web 前端、小程序、共享库与基础设施等组件。不要写代码，不要运行命令。请输出 5 行以内摘要，并给出 fenced `json` block，形状遵循 `ccg.projectScout.v1`：组件清单、证据、候选命令、共享范围、并行风险与 openQuestions。

## ccg-planner
phase: Planning
label: 生成动态 fanout 计划
as: plan
reads: context.md
output: plan.md
progress: true

基于用户任务 `{task}` 与 scout 输出 `{outputs.scout}`，生成只读规划结果。不要写代码，不要运行命令。请输出 8 行以内摘要，并给出 fenced `json` block，形状遵循 `ccg.fanoutPlan.v1`：组件到 builder agent 的映射、互斥文件 scope、顺序 waves、每个任务的 acceptance、测试计划、审查计划、requiresSupervisorDecision 与 openQuestions。
