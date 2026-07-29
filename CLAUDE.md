# CCG for Pi CLI

**Last Updated**: 2026-07-28 (v3.2.5)

> 当前架构为 Pi-only。历史变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 项目定位

CCG 为 Pi CLI 提供动态、有上限的智能开发工作流。Pi 是唯一 supervisor，不再由 Claude 主控，也不再通过 Codex/Gemini wrapper 充当固定外部角色。

标准流程：

```text
ccg-project-scout
→ ccg-planner
→ supervisor contract relay + START approval
→ Pi 动态 builder fanout（N frontend + M backend，按 component/profile/wave）
→ builder FINISH handoff
→ ccg-test-runner
→ ccg-reviewer
→ componentId 定向修复（最多 2 轮）
```

## 六个 Pi role templates

| Role template | 责任 |
|---|---|
| `ccg-project-scout` | 只读项目/组件发现 |
| `ccg-planner` | 组件拆分、文件边界、ownership、依赖、waves、测试计划 |
| `ccg-backend-builder` | 通用后端、服务、API、数据与基础设施组件 |
| `ccg-frontend-builder` | 通用前端组件；Web、管理后台、小程序/微信等通过 `componentProfile` 区分 |
| `ccg-test-runner` | 测试、typecheck、lint、build |
| `ccg-reviewer` | 独立正确性、质量、安全审查 |

`ccg-miniprogram-builder` 已退休，不属于当前 active runtime。小程序/微信只作为 frontend `componentProfile`，由通用 `ccg-frontend-builder` 实例处理。

模型映射：

```text
frontendModel → generic ccg-frontend-builder instances
backendModel  → generic ccg-backend-builder instances
reviewModel   → ccg-reviewer + ccg-test-runner
scout/planner → Pi subagents.defaultModel
```

## 动态 fanout 上限

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)

requiredSpawns = 2 + (N_frontend + M_backend) + 1 + 1
```

默认：

```text
devAgentCap = 4
globalConcurrencyLimit = 4
maxSpawnsPerSession = 24
maxSubagentDepth = 1
```

所有 CCG agents 使用 `defaultContext: fresh`；supervisor 以 `context: "fresh"` 调用。跨 run 的 plan/build/test context 必须内联进 task string，不能依赖另一个 run 的相对 `reads`。

## Supervisor 协调规则

- `ccg-planner` 输出稳定 `componentId`、component/profile、文件 ownership、依赖 waves、测试计划和修复路由。
- Pi supervisor 在 builder 写入前 relay contract，并等待 supervisor `START` approval。
- Pi 按 wave 派生 builder 实例；同一 wave 的有效并发不得超过 caps。
- 每个 builder 只修改自己 ownership 范围内的文件；跨组件变更必须回报 supervisor。
- 每个 builder 完成时必须返回 `FINISH` handoff，包含 `componentId`、变更文件、验证、假设和风险。
- test-runner/reviewer 的失败必须携带 `componentId`，供 Pi 定向回派 owning builder。
- componentId 定向修复最多两轮。

## CLI

```text
ccg
ccg init | ccg i
ccg update [--install-dir <path>]
ccg extensions [--install-dir <path>]
ccg doctor [--install-dir <path>] [--project-dir <path>]   # 检查 Pi CLI、必需 runtime、agents、caps、模型、扩展与 MCP 配置存在性
ccg status [--install-dir <path>] [--project-dir <path>]
ccg uninstall
```

`init` 是十一阶段状态机：

```text
language → environment → extensions → scope → provider → frontend
→ backend → review → limits → entry → summary
```

## 入口与模块

| 路径 | 作用 |
|---|---|
| `bin/ccg.mjs` | npm executable |
| `src/cli.ts` | CAC CLI 入口 |
| `src/cli-setup.ts` | Pi-only command 注册 |
| `src/commands/init.ts` | 十一阶段安装向导与扩展选择 |
| `src/commands/extensions.ts` | 扩展 catalog 状态、确认与 package lifecycle |
| `src/commands/update.ts` | metadata 驱动更新；不执行第三方 package 操作 |
| `src/commands/doctor.ts` | doctor/status |
| `src/commands/menu.ts` | Pi-only 菜单 |
| `src/utils/installer.ts` | Pi install/uninstall |
| `src/utils/pi-extensions.ts` | 扩展 catalog、selection、ownership |
| `src/utils/pi-runtime.ts` | Pi package inventory 与安全 lifecycle 命令 |
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

## 扩展、Memory 与上下文

Pi CLI 是 host runtime。`pi-subagents` 是必需 package，安装命令为：

```bash
pi install npm:pi-subagents
```

精选 catalog：推荐 `pi-mcp-adapter`、`pi-memctx`、`pi-session-continuity`；可选 `pi-pr-review`；实验性 `@vigolium/piolium` 默认不选。interactive init 可默认勾选推荐项，但 package 操作必须经用户确认；non-interactive fresh install 只有显式 flags 才安装 optional packages。`ccg extensions` 是 package lifecycle 边界。

Metadata ownership 为 `ccg-installed` / `adopted` / `missing`。update 只重装 CCG assets，保留选择且不执行 package 操作；uninstall 只删除 `ccg-installed` packages，保留 adopted packages。package spec 必须经 catalog/正则校验，并通过参数数组执行 `pi install/remove/update`。

`pi-subagents` 提供 orchestration、原生 supervisor coordination 与 per-agent memory；`pi-memctx` 补充按需知识注入；`pi-session-continuity` 补充 durable checkpoint/handoff；`pi-mcp-adapter` 以 lazy single proxy 降低常驻 MCP schema/context。静态 prompt 前缀保持稳定，运行期 plan/handoff 放在 task string 后部；这只提高 cache friendliness，实际 cache hit 由 provider 决定，不承诺命中率。

CCG 只写 `<project>/.pi/mcp.json.example`，从不覆盖、删除或在 doctor 中输出用户自管 `<project>/.pi/mcp.json` 的值。

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
