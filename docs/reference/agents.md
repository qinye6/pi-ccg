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

All children use fresh context. Pi inlines plans, ownership, prior-wave handoffs, and verification results. Static instructions remain stable and runtime data is appended later to reduce prompt-prefix churn.

## Dynamic builders and coordination

The planner assigns a stable `componentId` and one owning builder to each component. A run may launch `N` frontend and `M` backend instances by profile and dependency wave. `ccg-miniprogram-builder` is retired.

1. Planner returns the contract.
2. Pi waits for supervisor `START` before builder writes.
3. Builders receive owned/forbidden files, dependencies, contracts, and validation requirements.
4. Builders escalate cross-component changes.
5. Builders return `FINISH` handoffs.
6. Test and review failures use `componentId` for targeted repair.
7. Repair is limited to two rounds.

## Optional extension behavior

- `pi-memctx` may inject relevant non-sensitive local knowledge; file facts remain authoritative.
- `pi-session-continuity` may persist checkpoints and handoffs; otherwise Pi uses task-string handoffs.
- `pi-mcp-adapter` exposes MCP lazily; agents must discover availability before use.
- `pi-pr-review` and `@vigolium/piolium` supplement but do not replace `ccg-reviewer` or required gates.

Optional tools fail gracefully. No agent may copy API keys, tokens, or MCP credentials into memory, tasks, messages, logs, handoffs, or summaries.

## Model routing

```text
frontendModel → generic ccg-frontend-builder instances
backendModel  → generic ccg-backend-builder instances
reviewModel   → ccg-reviewer + ccg-test-runner
scout/planner → Pi subagents.defaultModel
```
