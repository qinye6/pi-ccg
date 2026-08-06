# Agent reference

CCG installs six fixed Pi role templates and may instantiate multiple generic builders.

| Role template | Role | Memory |
|---|---|---|
| `ccg-project-scout` | Read-only discovery | `pi-subagents` per-agent memory |
| `ccg-planner` | Component contract, ownership, waves, test plan | `pi-subagents` per-agent memory |
| `ccg-backend-builder` | Backend, service, API, data, infrastructure | `pi-subagents` per-agent memory |
| `ccg-frontend-builder` | Web, admin, mini-program, mobile-web, other frontend profiles | `pi-subagents` per-agent memory |
| `ccg-test-runner` | Test, typecheck, lint, build | Stateless |
| `ccg-reviewer` | Correctness, quality, security review | Stateless |

All children use fresh context. Pi inlines only the role-specific plan slice, ownership, relevant prior-wave handoffs, contracts, and verification evidence. Static instructions remain stable and runtime data is appended later to reduce prompt-prefix churn. Old child conversations are never reused by resume.

Only the leader assigns agents, migrates `intake → planning → building → testing → reviewing → repairing → completed|blocked`, and writes `.pi/ccg/tasks/<taskId>/`. Scout/planner are read-only, builders implement only approved ownership, test-runner only runs non-writing validation, and reviewer only reports findings. No child writes the board.

## Dynamic builders and coordination

The planner assigns a stable `componentId` and one owning builder to each component. A run may launch `N` frontend and `M` backend instances by profile and dependency wave. `ccg-miniprogram-builder` is retired.

1. Planner returns the contract.
2. Pi waits for supervisor `START` before builder writes.
3. Builders receive owned/forbidden files, dependencies, contracts, and validation requirements.
4. Builders escalate cross-component changes.
5. Builders return `FINISH` only to the leader; they never start test/review or contact siblings directly.
6. The leader starts fresh test-runner and reviewer instances; both remain read-only for product code.
7. Test and review failures return to the leader and use `componentId` for targeted repair.
8. Repair is limited to two rounds.

## Optional extension behavior

- `pi-memctx` may inject relevant non-sensitive local knowledge; file facts remain authoritative.
- `pi-session-continuity` may persist checkpoints and handoffs; otherwise Pi uses task-string handoffs.
- `pi-mcp-adapter` exposes MCP lazily; agents must discover availability before use.
- `pi-pr-review` and `@vigolium/piolium` supplement but do not replace `ccg-reviewer` or required gates.
- Default-off productivity/UI/editing extensions (`pi-simplify`, `pi-rtk-optimizer`, `pi-statusline`, `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-ask-user-question`, `@narumitw/pi-plan-mode`, `pi-web-access`, `pi-hashline-edit-pro`, and `pi-fff`) remain optional agent tools and do not alter component ownership or repair routing.
- `pi-task` is not cataloged until an exact package identity is provided.

Optional tools fail gracefully. No agent may copy API keys, tokens, or MCP credentials into memory, tasks, messages, logs, handoffs, or summaries. Provider onboarding accepts environment-variable references only; verified capability presets are exact-ID matches and unknown model limits are never inferred.

## Model routing

```text
frontendModel → generic ccg-frontend-builder instances
backendModel  → generic ccg-backend-builder instances
reviewModel   → ccg-reviewer + ccg-test-runner
scout/planner → Pi subagents.defaultModel
```
