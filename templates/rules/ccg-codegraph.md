# 代码检索工具选择指南

## CodeGraph（最高优先级）

**会话首次需要检索代码时**，先检查项目根目录是否存在 `.codegraph/`：
- **存在** → 直接用 `codegraph_explore`，一次调用返回源码+调用链+影响范围
- **不存在** → 运行 `codegraph init` 建索引（通常几秒），建好后再用 `codegraph_explore`

建索引只需一次，后续自动增量同步。

### 何时用 codegraph_explore

| 场景 | 示例查询 |
|------|----------|
| 调用链追踪 | `handleSubmit callers` |
| 修改影响范围 | `UserService.create impact` |
| 架构流程理解 | `request router to database flow` |
| 读取符号源码+上下文 | 直接传文件名或函数名 |

### 反模式

- ❌ 先 grep 再用 CodeGraph 验证（直接 CodeGraph）
- ❌ 手动拼调用链（一次 explore 自动解析）
- ❌ 对返回的源码再 Read（已是同等内容）

## fast-context（语义补充）

`codegraph_explore` 不擅长的场景用 `fast_context_search`：
- 自然语言描述功能（"处理登录的逻辑在哪"）
- 不确定符号名，只知道功能描述
- 英文查询效果优于中文

## 优先级总结

```
codegraph_explore → 结构查询（调用链/影响/依赖）— 本地，最快最准
fast_context_search → 语义模糊搜索 — 远端 AI
grep → 精确文本匹配（已知字符串）
```
