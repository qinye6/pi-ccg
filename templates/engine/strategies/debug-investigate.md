# Strategy: Debug Investigate — 深度调试

> 适用于原因不明的复杂 bug，需要多模型并行诊断和交叉验证。

## 适用条件
- 复杂度 M 或以上
- 错误原因不明确
- 需要多角度诊断

## 前置加载

```
Read("~/.claude/.ccg/engine/model-router.md")
```

---

## 工作流状态机

[phase-state:1-collect]
当前阶段：信息收集
📍 Next: 收集完错误信息后启动双模型诊断
[/phase-state:1-collect]

[phase-state:2-diagnose]
当前阶段：双模型并行诊断
Gate: 错误信息已收集 ✓
📍 Next: 双模型诊断返回后进入交叉验证
[/phase-state:2-diagnose]

[phase-state:3-validate]
当前阶段：交叉验证
Gate: 双模型诊断已返回 ✓
📍 Next: 假设排序后请用户确认修复方向
[/phase-state:3-validate]

[phase-state:4-confirm]
当前阶段：用户确认（HARD STOP）
Gate: 假设已排序 ✓
📍 Next: 用户确认后进入修复
[/phase-state:4-confirm]

[phase-state:5-fix]
当前阶段：修复与验证
Gate: 用户已确认修复方向 ✓
📍 Next: 修复完成后报告结果
[/phase-state:5-fix]

---

## 阶段详情

### Phase 1: 信息收集 [required]

**Task 更新**：`currentPhase → "1-collect"`, `nextAction → "收集错误信息"`

1. 收集错误上下文：
   - 错误消息 / 堆栈跟踪
   - 复现步骤（如果有）
   - 最近的相关变更（`git log --oneline -10`）
   - 环境信息（如相关）

2. 搜索相关代码（Grep/MCP）
3. 读取可能相关的文件

### Phase 2: 双模型并行诊断 [required]

**Gate check**: 错误信息已收集

**并行调用**（`run_in_background: true`）：
- **backend 模型**：debugger 角色
  ```
  <TASK>
  需求：诊断以下问题
  上下文：[错误信息、堆栈、相关代码]
  </TASK>
  OUTPUT: 诊断假设（按可能性排序，每个假设含：根因分析、证据、修复建议）
  ```
- **frontend 模型**：debugger 角色（相同格式）

等待双模型返回。

**Task 更新**：`currentPhase → "2-diagnose"`, `nextAction → "等待双模型诊断返回"`

### Phase 3: 交叉验证

**Gate check**: 双模型诊断已返回

1. 对比两个模型的诊断结果
2. 找出共识点（两个模型都指出的问题 → 高可信度）
3. 找出分歧点（只有一个模型指出 → 需要验证）
4. 综合排序所有假设：

```
🔍 诊断结果

### 高可信度假设（双模型共识）
1. [假设] — [证据]
   修复方案: [具体方案]

### 待验证假设（单模型提出）
2. [假设] — [来源模型] — [证据]
   修复方案: [具体方案]

### 已排除
- [假设] — [排除理由]
```

### Phase 4: 用户确认 [required · HARD STOP]

**Gate check**: 假设已排序

展示诊断结果，请用户选择修复方向：
- 按假设 1 修复
- 按假设 2 修复
- 需要更多调查
- 其他方向

**Task 更新**：
```
更新 task.json:
  currentPhase → "4-confirm"
  gate → "user_approval_required"
  nextAction → "等待用户确认修复方向"
```

**必须等待用户明确确认**，不可自动选择。

用户确认后：`task.json: gate → null, currentPhase → "5-fix"`

### Phase 5: 修复与验证

**Gate check**: 用户已确认

1. 按确认的方向应用修复
2. 运行测试验证
3. 如果修复无效 → 回退，尝试下一个假设，或返回 Phase 4 重新确认
4. 输出结果：
   ```
   ✅ 调试完成
     根因: [确认的根因]
     修复: [应用的修复]
     验证: [测试结果]
     📍 Next: /ccg commit 提交修复
   ```

#### Spec Evolution（归档前必须执行）

参考 `phase-guide.md § 8 Spec Evolution Protocol` 执行：
1. 分析本次调试的根因和修复方案，提炼可复用的调试经验和防御性编码约定
2. 如有值得记录的经验（特别是非显而易见的坑）→ 草拟 Spec 条目，展示给用户确认后追加到 `.ccg/spec/{domain}/index.md`
3. 无值得提炼的经验 → 跳过

**Task 更新**：`status → "archived"`

**归档任务**：
```bash
mkdir -p .ccg/tasks/archive/$(date +%Y-%m) && mv .ccg/tasks/{task-name} .ccg/tasks/archive/$(date +%Y-%m)/
git add .ccg/tasks/ && git commit -m "chore: archive ccg task"
```

---

## 铁律

- **Phase 4 是 HARD STOP** — 不可自动决定修复方向
- **双模型诊断必须并行** — 独立诊断才有交叉验证价值
- **修复前必须有诊断** — 不可跳过 Phase 2-3 直接改代码
- **修复无效时必须回退** — 不可在错误方向上继续深入
