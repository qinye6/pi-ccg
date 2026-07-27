# CCG for Pi CLI

**Last Updated**: 2026-07-27 (v3.2.4)

> 当前架构为 Pi-only。历史变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 项目定位

CCG 为 Pi CLI 提供动态、有上限的智能开发工作流。Pi 是唯一 supervisor，不再由 Claude 主控，也不再通过 Codex/Gemini wrapper 充当固定外部角色。

标准流程：

```text
ccg-project-scout
→ ccg-planner
→ Pi 动态 builder fanout
→ ccg-test-runner
→ ccg-reviewer
→ componentId 定向修复（最多 2 轮）
```

## 七个 Pi agents

| Agent | 责任 |
|---|---|
| `ccg-project-scout` | 只读项目/组件发现 |
| `ccg-planner` | 组件拆分、文件边界、ownership、测试计划 |
| `ccg-backend-builder` | 后端组件 |
| `ccg-frontend-builder` | Web 前端/管理后台 |
| `ccg-miniprogram-builder` | 微信小程序 |
| `ccg-test-runner` | 测试、typecheck、lint、build |
| `ccg-reviewer` | 独立正确性、质量、安全审查 |

模型映射：

```text
frontendModel → frontend-builder + miniprogram-builder
backendModel  → backend-builder
reviewModel   → reviewer + test-runner
scout/planner → subagents.defaultModel
```

## 动态 fanout 上限

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)

requiredSpawns = 2 + N + 1 + 1
```

默认：

```text
devAgentCap = 4
globalConcurrencyLimit = 4
maxSpawnsPerSession = 24
maxSubagentDepth = 1
```

所有 CCG agents 使用 `defaultContext: fresh`；supervisor 以 `context: "fresh"` 调用。跨 run 的 plan/build/test context 必须内联进 task string，不能依赖另一个 run 的相对 `reads`。

## CLI

```text
ccg
ccg init | ccg i
ccg update
ccg doctor
ccg status
ccg uninstall
```

`init` 是十步状态机：

```text
language → environment → scope → provider → frontend
→ backend → review → limits → entry → summary
```

## 入口与模块

| 路径 | 作用 |
|---|---|
| `bin/ccg.mjs` | npm executable |
| `src/cli.ts` | CAC CLI 入口 |
| `src/cli-setup.ts` | Pi-only command 注册 |
| `src/commands/init.ts` | 十步安装向导 |
| `src/commands/update.ts` | metadata 驱动更新 |
| `src/commands/doctor.ts` | doctor/status |
| `src/commands/menu.ts` | Pi-only 菜单 |
| `src/utils/installer.ts` | Pi install/uninstall |
| `src/utils/pi-paths.ts` | Pi 路径、agent 名、caps |
| `src/utils/pi-config.ts` | model/provider/cap merge |
| `src/utils/installer-template.ts` | Pi 模板注入、managed block |
| `templates/pi/` | 唯一当前 runtime 模板面 |

详见 [src/CLAUDE.md](./src/CLAUDE.md) 与 [templates/CLAUDE.md](./templates/CLAUDE.md)。

## 安装路径

用户级：

```text
~/.pi/agent/settings.json
~/.pi/agent/models.json
~/.pi/agent/agents/
~/.pi/agent/chains/
~/.pi/agent/prompts/
~/.pi/agent/extensions/subagent/config.json
~/.pi/agent/ccg-workflow.json
```

项目级：

```text
<project>/AGENTS.md
<project>/.pi/settings.json
<project>/.pi/chains/
<project>/.pi/prompts/
<project>/.pi/mcp.json.example
```

`AGENTS.md` 只管理 `<!-- CCG:PI-START -->` 与 `<!-- CCG:PI-END -->` 之间的块。块外用户内容必须保留。

## Memory

Pi native project memory 启用于 scout、planner、backend/frontend/miniprogram builders。reviewer 和 test-runner 不启用 memory。外部 memory adapter（例如 Nocturne-compatible MCP）为 optional/report-only，不得成为 init/update/doctor 的必需条件。

## 凭据安全

真实 API Key/token 不得写入 agent prompt、`AGENTS.md`、chain、task、log、summary、示例或 CCG metadata。读取用户配置时必须脱敏。真实 MCP 凭据只允许存在于用户自管且不受 CCG 覆盖/删除的 `<project>/.pi/mcp.json`。

## Legacy 边界

旧 Claude/Codex/Gemini installer 源码可暂时作为历史内部实现保留，但：

- Pi CLI 主路径不得调用；
- `src/index.ts` 不公开 `installWorkflows()` / `uninstallWorkflows()`；
- npm 不发布 legacy commands/hooks/prompts/skills/rules/wrapper assets；
- 测试不得访问 wrapper release/CDN。

当前 package 白名单：

```json
[
  "bin/ccg.mjs",
  "dist",
  "templates/pi/"
]
```

## 开发验证

```bash
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run --json
node bin/ccg.mjs --help
```

当前目录若不是 Git repository：实现任务中跳过 commit、push 和 worktree，不得伪造 Git 结果。

## 发版规则

只有用户明确要求发版时才执行 publish/push。每次发版必须完成：

1. 更新 `package.json` version。
2. 在 `CHANGELOG.md` 顶部添加 `## [x.y.z] - YYYY-MM-DD`。
3. 同步 `README.md`、`README.zh-CN.md`。
4. 同步根 `CLAUDE.md`、受影响的模块文档。
5. 依次通过：

   ```bash
   pnpm typecheck
   pnpm build
   pnpm test
   npm pack --dry-run --json
   ```

6. 明确获准后执行 `npm publish`。
7. 仅在 Git repository 中执行：

   ```bash
   git add -A
   git commit -m "chore: bump version to x.y.z"
   git push origin main
   ```

若修改历史 `codeagent-wrapper/` Go 源码，仍需同步其内部版本与 installer 期望版本；禁止手动覆盖 CI release 产物。但 Pi-only runtime 不应新增对 wrapper 的依赖。
