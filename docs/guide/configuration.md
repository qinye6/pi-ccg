# Configuration

## Model routing

```text
frontendModel → generic ccg-frontend-builder instances
backendModel  → generic ccg-backend-builder instances
reviewModel   → ccg-reviewer + ccg-test-runner
scout/planner → Pi subagents.defaultModel
```

A run may create `N` frontend and `M` backend instances from the planner's component/profile contract. Model and provider settings are merged into existing Pi files; unrelated user fields are preserved.

## Pi extension catalog

CCG stores package definitions in one validated catalog and records only selection, detected version, timestamps, and ownership in `ccg-workflow.json`. Display names, tier labels, descriptions, warnings, and summaries are localized through shared i18n resources instead of duplicated per-language catalogs.

| ID | Package | Tier | Capability |
|---|---|---|---|
| `core-subagents` | `npm:pi-subagents` | Required | Orchestration, supervisor coordination, per-agent memory |
| `mcp-adapter` | `npm:pi-mcp-adapter` | Recommended | Lazy MCP, compact proxy, metadata caching, output guards |
| `memory-context` | `npm:pi-memctx` | Recommended | Local knowledge packs and on-demand context injection |
| `session-continuity` | `npm:pi-session-continuity` | Recommended | Durable checkpoints, handoffs, recovery |
| `pr-review` | `npm:pi-pr-review` | Optional | Parallel GitHub PR review and structured findings |
| `security-audit` | `npm:@vigolium/piolium` | Experimental | Multi-phase security audit; explicit opt-in only |

Ownership values:

- `ccg-installed`: CCG installed the package and may remove it.
- `adopted`: it already existed; CCG reports but never removes it.
- `missing`: selected or required but not detected.

`core-subagents` is always represented in metadata because the workflow requires it. If the user declines installation, ownership remains `missing`; if it already exists, the UI shows it as checked and read-only; if CCG installed it, ownership is `ccg-installed` but the required runtime still never enters a removal plan.

`ccg update` preserves this metadata without changing packages. `ccg extensions` is the package-management boundary.

## Context, memory and continuity

All CCG children use fresh context. The supervisor inlines the relevant plan slice, ownership contract, prior-wave handoff, and verification evidence into each task.

- `pi-subagents` supplies role-local persistent memory for scout, planner, and builders.
- `pi-memctx`, when selected, supplies searchable local Markdown knowledge and on-demand injection.
- `pi-session-continuity`, when selected, supplies durable checkpoints and handoffs.
- Reviewer and test-runner remain stateless.

If optional tools are unavailable, the core workflow continues with explicit task-string handoffs.

## Cache-friendly prompt structure

Static role instructions and coordination rules remain in stable prompt prefixes. Runtime plans, component data, handoffs, and findings are appended later. `pi-mcp-adapter` reduces always-present MCP schema/context with lazy servers and one proxy; `pi-memctx` injects only relevant knowledge.

These practices reduce context churn and are prompt-cache friendly. Actual cache eligibility and hit rates remain provider-dependent; CCG does not guarantee a fixed hit rate.

## Concurrency limits

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)

requiredSpawns = 2 + (N_frontend + M_backend) + 1 + 1
```

Defaults: `devAgentCap=4`, `globalConcurrencyLimit=4`, `maxSpawnsPerSession=24`, `maxSubagentDepth=1`.

## Coordination contract

The planner produces stable `componentId` values, component profiles, owned files, dependency waves, validation commands, and repair routes. Pi waits for `START` before writes, collects `FINISH` handoffs, and routes failures by `componentId` for at most two repair rounds.

## Installation and credential boundaries

User-level assets live under `~/.pi/agent/`; optional project assets live under `<project>/.pi/` plus a managed `AGENTS.md` block. CCG may write `<project>/.pi/mcp.json.example`, but never overwrites or deletes user-managed `<project>/.pi/mcp.json`.

Real MCP credentials must remain in the user's unmanaged configuration. Diagnostics report only whether a configuration path exists; values must never enter prompts, tasks, logs, examples, or CCG metadata.
