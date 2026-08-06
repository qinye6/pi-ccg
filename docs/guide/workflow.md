# Workflow architecture

```text
ccg-project-scout
→ ccg-planner
→ supervisor contract relay + START approval
→ Pi dynamic builder fanout by component/profile/wave
→ builder FINISH handoff
→ ccg-test-runner
→ ccg-reviewer
→ componentId-targeted repair (up to two rounds)
```

## Native Pi command surface

- `/ccg <request>` is the main entry: the leader confirms requirements, then autonomously plans, builds, tests, reviews, and performs targeted repairs.
- `/ccg-board [taskId]` is a read-only progress view.
- `/ccg-replay [taskId]` is a read-only retrospective timeline.
- `/ccg-resume <taskId>` restores only the leader checkpoint and always starts new children with fresh context.
- `/ccg-go` remains compatible with earlier installations.

## Leader persona and output style

The leader may use `default`, `engineer-professional`, `nekomata-engineer`, `laowang-engineer`, `ojousama-engineer`, or one of four abyss variants: `abyss-cultivator`, `abyss-concise`, `abyss-command`, and `abyss-ritual`. The twelve-stage `ccg init` flow offers this choice interactively; non-interactive setup uses `--persona <name>`. Use `ccg style <name>` to switch and `ccg style default` to restore the default.

Persona selection is metadata-backed and survives `ccg update`. It affects only leader prose for `/ccg` and `/ccg-go`; child contracts/JSON, tests, reviews, board, credentials, and the workflow coordination contract remain unchanged. User `SYSTEM.md` and `APPEND_SYSTEM.md` are untouched.

## Durable task board

The leader projects lifecycle state into `.pi/ccg/tasks/<taskId>/board.json`, `events.jsonl`, and `summary.md` using `ccg.taskBoard.v1` and `ccg.taskEvent.v1`. This is a bounded, redacted projection of `pi-subagents` lifecycle/FleetView, not a second scheduler. Children never write it; uninstall preserves it for replay.

The phase machine is `intake → planning → building → testing → reviewing → repairing → completed|blocked`. Only the leader assigns agents and migrates state. Human intervention is reserved for unresolved product decisions, unsafe ownership conflicts, environment/permission blockers, or failure after two repair rounds.


The scout reads without modifying files. The planner creates stable `componentId` values, frontend/backend classification, optional `componentProfile`, file ownership, dependencies, waves, builder count, concurrency constraints, and validation commands.

## Supervisor-mediated START

Pi is the only supervisor. It relays the contract and waits for `START` before write-capable builders begin. Every child uses fresh context, so Pi inlines the relevant plan, ownership summary, prior-wave handoffs, and verification evidence into each task.

## Dynamic builders

CCG installs generic `ccg-frontend-builder` and `ccg-backend-builder` templates. Pi creates only the `N` frontend and `M` backend instances required by the plan, grouped by component/profile and dependency wave. `ccg-miniprogram-builder` is retired; mini-program and WeChat work are frontend profiles.

## Ownership, handoff, test and repair

Each component has one owning builder. Cross-component changes are escalated to Pi. Each builder returns a `FINISH` handoff to the leader with its `componentId`, changed files, validation, assumptions, contract changes, and risks. Builders never start testers/reviewers or contact siblings directly.

The leader validates the handoff and starts a fresh test-runner, then a fresh reviewer. Both are read-only with respect to product code. Failures and `Critical` findings return to the leader with `componentId`; Pi sends narrow repairs only to the owning builder, for at most two rounds.

## Complete-workflow extensions

The core runtime requires `pi-subagents`. The installer also offers explicitly confirmed extensions:

- `pi-mcp-adapter`: lazy MCP through a compact proxy, reducing permanently exposed schemas and adding metadata caching/output guards.
- `pi-memctx`: searchable local Markdown knowledge and relevant context injection.
- `pi-session-continuity`: durable checkpoints and cross-session handoffs.
- `pi-pr-review`: optional parallel PR review with structured findings.
- `@vigolium/piolium`: experimental multi-phase security audit, disabled by default.
- Default-off productivity/UI/editing options: `pi-simplify`, `pi-rtk-optimizer`, `pi-statusline`, `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-ask-user-question`, `@narumitw/pi-plan-mode`, `pi-web-access`, `pi-hashline-edit-pro`, and `pi-fff`.

`pi-task` is deferred because its package identity is ambiguous. CCG does not choose an unrelated scoped package automatically. `pi-web-access` may add `workflow: "none"` only when the field is absent in `~/.pi/web-search.json`; the config operation shares the final confirmation with package changes and preserves existing or invalid user configuration.

Optional extensions augment but never replace the ownership, test, review, or repair contract. Without them, Pi falls back to explicit task-string context and standard CCG verification.

## Cache-friendly context management

Static role instructions remain at the front; run-specific plans, handoffs, component data, and findings are appended later. Lazy MCP metadata and on-demand memory injection reduce context churn. Actual prompt-cache behavior remains provider-dependent and no fixed hit rate is guaranteed.

## Provider/model readiness

During installation, Pi model discovery distinguishes missing, valid, and invalid `models.json`. The wizard can add a custom provider/model using an environment-variable credential reference. Exact verified model IDs receive known capability defaults; unknown model limits are never guessed. Exact-ID recursive merges preserve user pricing, compatibility data, and unknown fields. `doctor` and `status` report provider/model and web-access configuration state without exposing values.

## Credentials and MCP

CCG writes only `<project>/.pi/mcp.json.example`. Users keep real MCP servers and credentials in `<project>/.pi/mcp.json`, which CCG does not overwrite, inspect for values, or delete. Secrets must never enter prompts, tasks, handoffs, logs, summaries, examples, or metadata.
