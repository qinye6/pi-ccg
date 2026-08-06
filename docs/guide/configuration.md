# Configuration

## Model routing

```text
frontendModel → generic ccg-frontend-builder instances
backendModel  → generic ccg-backend-builder instances
reviewModel   → ccg-reviewer + ccg-test-runner
scout/planner → Pi subagents.defaultModel
```

A run may create `N` frontend and `M` backend instances from the planner's component/profile contract. Model and provider settings are merged into existing Pi files; unrelated user fields are preserved.

## Leader persona and output style

CCG supports nine selectable leader output styles: `default`, `engineer-professional`, `nekomata-engineer`, `laowang-engineer`, `ojousama-engineer`, `abyss-cultivator`, `abyss-concise`, `abyss-command`, and `abyss-ritual`. Interactive `ccg init` is a twelve-stage flow that presents the persona stage; non-interactive init accepts `--persona <name>`. `ccg style <name>` switches the selected style, and `ccg style default` restores the default.

The selected persona is persisted in CCG metadata and preserved by `ccg update`. It changes only the leader prose emitted by `/ccg` and `/ccg-go`. Child contracts and JSON, tests, reviews, board data, credentials, and coordination behavior are unaffected. CCG does not modify user-managed `SYSTEM.md` or `APPEND_SYSTEM.md`.

## Provider and model onboarding

The interactive provider stage offers an add-provider path when no usable provider/model exists. It accepts provider and model identifiers, base URL, Pi API protocol, optional capabilities, and an API-key **environment-variable name**. It never asks for or stores a real credential.

`~/.pi/agent/models.json` is inspected in three states: `missing`, `valid`, or `invalid`. Invalid JSON is reported and never overwritten. Valid data is merged by exact provider/model ID while preserving unknown fields, sibling models, headers, auth, pricing/cost, and nested compatibility settings. User values take precedence; an explicit merge may create `.ccg-bak`.

CCG fills capabilities only for exact IDs verified against Pi model data:

| Model | Context window | Maximum output tokens |
|---|---:|---:|
| `anthropic/claude-sonnet-5` | 1,000,000 | 128,000 |
| `anthropic/claude-fable-5` | 1,000,000 | 128,000 |
| `anthropic/claude-haiku-4-5-20251001` | 200,000 | 64,000 |
| `openai/gpt-5.6-sol` | 272,000 | 128,000 |
| `openai/gpt-5.6-terra` | 272,000 | 128,000 |
| `openai/gpt-5.6-luna` | 272,000 | 128,000 |
| `google/gemini-3.5-flash` | 1,048,576 | 65,536 |

Unknown models remain customizable, but CCG does not guess their limits. Built-in provider capabilities use exact-ID `modelOverrides`; custom-provider models are added to `models`.

## Pi extension catalog

CCG stores package definitions in one validated catalog and records only selection, detected version, timestamps, and ownership in `ccg-workflow.json`. UI text comes from shared bilingual i18n resources.

| ID | Package | Tier | Default |
|---|---|---|---|
| `core-subagents` | `npm:pi-subagents` | Required | Selected when missing |
| `mcp-adapter` | `npm:pi-mcp-adapter` | Recommended | Selected |
| `memory-context` | `npm:pi-memctx` | Recommended | Selected |
| `session-continuity` | `npm:pi-session-continuity` | Recommended | Selected |
| `pr-review` | `npm:pi-pr-review` | Optional | Off |
| `security-audit` | `npm:@vigolium/piolium` | Experimental | Off |
| `simplify` | `npm:pi-simplify` | Optional | Off |
| `rtk-optimizer` | `npm:pi-rtk-optimizer` | Optional | Off |
| `statusline` | `npm:pi-statusline` | Optional | Off |
| `todo` | `npm:@juicesharp/rpiv-todo` | Optional | Off |
| `ask-user-question` | `npm:@juicesharp/rpiv-ask-user-question` | Optional | Off |
| `plan-mode` | `npm:@narumitw/pi-plan-mode` | Optional | Off |
| `web-access` | `npm:pi-web-access` | Optional | Off |
| `hashline-edit-pro` | `npm:pi-hashline-edit-pro` | Optional | Off |
| `fff` | `npm:pi-fff` | Optional | Off |

`pi-task` is deferred because the unscoped npm name does not exist and available scoped packages are not interchangeable. CCG does not infer package identity.

Ownership is `ccg-installed`, `adopted`, or `missing`. Required `core-subagents` is never removed. Failed optional removals can be retried while the package remains installed; stale metadata is cleaned if it was removed externally. `ccg update` preserves metadata without package operations; `ccg extensions` is the lifecycle boundary.

## `pi-web-access` managed configuration

Selecting `web-access` may add one config operation to the same final confirmation as package changes. The target is always `~/.pi/web-search.json`, independent of `--install-dir`.

- Missing file: create `{ "workflow": "none" }`.
- Valid object without `workflow`: merge only that field.
- Existing `workflow`: preserve unchanged.
- Invalid JSON or non-object root: refuse overwrite.
- Failed package installation: do not write config.
- Uninstall: never delete this file.

## Context, memory and continuity

All children use fresh context. The supervisor inlines plan slices, ownership, prior-wave handoffs, and verification evidence. `pi-subagents` supplies role-local memory; optional `pi-memctx`, `pi-session-continuity`, and `pi-mcp-adapter` add on-demand knowledge, durable handoffs, and lazy MCP access. Reviewer and test-runner remain stateless.

Static role instructions remain in stable prefixes and runtime data is appended later. This is cache friendly, but actual cache behavior remains provider-dependent.

## Concurrency and coordination

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

The planner produces stable `componentId` values, profiles, ownership, dependency waves, validation commands, and repair routes. Pi waits for `START`, collects `FINISH` handoffs, and routes failures for at most two repair rounds.

## Durable board and resume boundaries

Project-local task history lives under `.pi/ccg/tasks/<taskId>/` as `board.json`, `events.jsonl`, and `summary.md`. Only the leader writes these files. Board data is a bounded lifecycle projection with redacted summaries and artifact references; it must not include full transcripts, credentials, authorization headers, cookies, or user-managed MCP values.

`/ccg-board` and `/ccg-replay` are read-only. `/ccg-resume` restores the leader checkpoint only, reconciles lifecycle artifacts, and starts any downstream child with `context: "fresh"`. Uninstall preserves the task history unless the user removes it separately.


CCG may write `<project>/.pi/mcp.json.example`, but never overwrites, deletes, or prints values from user-managed `<project>/.pi/mcp.json`. Real credentials must remain in user-managed configuration or environment variables and must never enter prompts, tasks, logs, examples, fixtures, or metadata. `doctor` and `status` report only redacted state.
