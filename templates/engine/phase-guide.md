# CCG 通用阶段指导

> 本文件定义所有策略共享的阶段执行规范。策略文件可通过 Read 引用。

## 1. 阶段状态自检

每完成一个阶段，回顾对应的 `[phase-state:N]` 块：
1. 确认该阶段的 Gate 条件已满足
2. 输出 `📍 Next: [具体动作]` 告知用户下一步
3. 如有 `[required]` 标记的阶段未完成，不可跳过

## 2. Gate Check 执行规范

Gate 是阶段间的硬性检查点。执行方式：

- **数据 Gate**：检查前序阶段是否产出了必要数据（分析结果？计划文件？）
- **确认 Gate（HARD STOP）**：必须等待用户明确确认才能继续
- **质量 Gate**：检查产出物是否达到最低质量标准

Gate 失败时：说明缺失什么，给出补救建议，不可绕过。

## 3. Next-Action 格式

每个阶段完成后输出：

```
📍 Next: [一句话描述下一步具体动作]
```

示例：
- `📍 Next: 加载模型路由器，启动双模型并行分析`
- `📍 Next: 请确认以上修复方案是否正确`
- `📍 Next: 运行测试验证修复效果`

## 4. 策略升级规则

执行中发现复杂度超出当前策略能力时：

1. 明确告知用户：`当前策略为 [名称]，但发现 [原因]，建议升级到 [目标策略]`
2. 等待用户确认
3. 确认后：`Read ~/.claude/.ccg/engine/strategies/[target].md`
4. 从新策略的 Phase 1 开始（已完成的分析工作可复用）

**只能升级，不能降级**（除非用户明确要求）。

## 5. 错误恢复

| 场景 | 处理方式 |
|------|---------|
| 外部模型调用失败 | 按模型路由器重试规则处理 |
| 测试失败 | 分析失败原因，修复后重新运行 |
| 用户要求中止 | 立即停止，报告已完成的工作 |
| 意外文件冲突 | 报告冲突，等待用户决策 |

## 6. Team Dispatch 协议

当策略需要并行实施时，使用 Agent Teams：

### 前置条件
- 任务已拆分为文件级子任务（互不重叠）
- plan.md 已审批

### 标准流程
```
1. TeamCreate({ team_name: "{task-id}-team" })
2. 同一消息内并行 spawn 所有 Layer 1 Builder
3. 等待完成 → spawn Layer 2（如有）
4. spawn Reviewer 快检
5. Critical → spawn fix-dev（最多 2 轮）
6. shutdown 所有 teammates
```

### Builder Prompt 必含项
- `## 工作目录` — 绝对路径
- `## 文件范围约束（⛔ 硬性规则）` — 只能改的文件列表
- `## 实施步骤` — 具体操作
- `## 验收标准` — 怎样算完成

### Spec 注入
PreToolUse Hook 自动为 Team member 注入：
- context.jsonl 中列出的 spec 文件
- requirements.md 和 plan.md 摘要
- research/ 目录下的研究成果

Builder 不需要在 prompt 中手动粘贴 spec — Hook 自动处理。

### 降级方案
TeamCreate 失败（Agent Teams 未启用）→ Claude 自己按计划顺序实施。

## 7. 输出规范

- 中文交流，技术术语保留英文
- 代码块标明语言
- 变更摘要用 git diff 格式
- 研究结果用表格对比

## 8. Spec Evolution Protocol — Spec 反馈环

> 让 `.ccg/spec/` 从静态文档变为随项目开发自动进化的活知识库。

### 触发条件

任务归档前（status → "archived"），如果以下任一条件成立，**必须执行 Spec Evolution**：
- 本次开发中发现了可复用的编码模式或约定
- 外部模型审查提出了有价值的规范建议
- 修复了一个非显而易见的坑（未来可能再踩）
- 引入了新的第三方库/API/架构模式

### 执行步骤

1. **提炼经验**：分析 `git diff` + review.md（如有），提取可复用的经验教训
2. **分类归属**：判断经验属于哪个 Spec 域：
   - 后端相关 → `.ccg/spec/backend/index.md`
   - 前端相关 → `.ccg/spec/frontend/index.md`
   - 跨模块/通用 → `.ccg/spec/guides/index.md`
3. **草拟更新**：以追加方式写出建议新增的 Spec 条目（不覆盖现有内容）
4. **展示给用户**：
   ```
   📝 Spec Evolution — 本次开发经验提炼
   
   建议新增到 .ccg/spec/backend/index.md:
     - [规范条目]（来源：{task-name}，{日期}）
   
   确认写入？[Y/n]
   ```
5. **用户确认后写入**（⛔ 不可静默写入 Spec）
6. **无值得提炼的经验 → 跳过**（不要强行凑条目）

### 条目质量标准

好的 Spec 条目：
- ✅ 具体：引用真实文件路径和 API 签名
- ✅ 说明 Why：不只说"要这样做"，还说"因为…"
- ✅ 可验证：子 Agent 能根据条目判断对错

坏的 Spec 条目：
- ❌ 空泛："写好的代码" / "注意安全"
- ❌ 一次性：只对本次任务有价值，对未来无意义

## 9. Loop Detection & Recovery — 死循环检测

> workflow-state Hook 自动追踪每轮的 phase + nextAction。连续 3 轮无变化触发 Break-Loop Protocol。

### 机制

- Hook 在每轮用户消息时写入 `.ccg/tasks/{name}/.turns.json`（最近 10 轮滚动缓冲）
- 检测规则：连续 3 轮 `phase` + `nextAction` 完全相同 → 判定为死循环
- 触发后在 `<ccg-state>` 面包屑中注入 `⚠️ LOOP DETECTED` 警告

### Break-Loop Protocol（Claude 收到警告后必须执行）

1. **立即停止**当前重复动作
2. **根因分析**（5 Why）：
   - 是外部依赖阻塞？（网络/API/权限）→ 告知用户
   - 是策略不适配？→ 建议升级策略
   - 是信息不足？→ 向用户提问
   - 是实现路径走死？→ 换方案
3. **更新 task.json**：`nextAction` 必须变更为新的动作描述（打破循环）
4. **如果连续 2 次触发 Break-Loop**（即 6 轮无进展）→ 强制暂停，输出完整状态摘要请用户介入

## 10. Ralph Loop — 迭代审查协议

> 审查不是一次性动作。每轮 spawn 新 Agent（干净上下文），读取磁盘最新状态重新验证，循环自修复。

### 适用场景

策略中标注为 `[Ralph Loop]` 的审查阶段，使用迭代审查代替一次性审查。

### 标准流程

```
Round N (N=1,2,...,MAX_ROUNDS):
  1. 双模型并行审查（每次 spawn 新 Agent，干净上下文）
  2. 质量关卡（verify-security / verify-quality / verify-change）
  3. 综合审查报告，按 Critical / Warning / Info 分级
  4. 展示给用户，询问：
     - 有 Critical → "发现 N 个 Critical 问题，是否修复后再审？[Y/n]"
     - 无 Critical → "审查通过，是否需要再审一轮？[y/N]"
  5. 用户选择继续 →
     a. spawn fix-dev（新 Agent，干净上下文）修复 Critical 问题
     b. 进度追加到 .ccg/tasks/{name}/fix-log.jsonl
     c. 回到 Round N+1
  6. 用户选择停止 → 退出循环，进入下一阶段
```

### 关键规则

- **每轮审查必须是新 Agent** — 不复用上一轮的 Agent 上下文，避免"上下文污染越修越烂"
- **fix-dev 也是新 Agent** — 从磁盘读取最新代码状态，只修分配的问题
- **最多 3 轮**（MAX_ROUNDS=3）— 超过 3 轮说明问题根深，应该回退到规划阶段
- **用户始终有决定权** — 每轮结束后由用户决定是否继续，不自动循环
- **fix-log.jsonl 追踪进度** — 每轮结果追加一行 JSON，格式：
  ```jsonl
  {"round": 1, "critical": 2, "warning": 5, "fixed": ["file1:issue", "file2:issue"], "ts": "ISO"}
  {"round": 2, "critical": 0, "warning": 3, "fixed": ["file3:issue"], "ts": "ISO"}
  ```

### context.jsonl 角色标注

策展 context.jsonl 时，按角色标注 `roles` 字段：
```jsonl
{"file": ".ccg/spec/backend/index.md", "reason": "后端规范", "roles": ["implement", "review"]}
{"file": ".ccg/tasks/{name}/plan.md", "reason": "实施计划", "roles": ["implement"]}
{"file": ".ccg/tasks/{name}/research/lib-comparison.md", "reason": "库选型", "roles": ["research", "implement"]}
```

SubAgent-context Hook 自动按角色过滤：无 `roles` 字段 = 注入所有角色。
