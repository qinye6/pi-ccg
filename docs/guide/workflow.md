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

## Discovery and planning

The scout reads without modifying files. The planner creates stable `componentId` values, frontend/backend classification, optional `componentProfile`, file ownership, dependencies, waves, builder count, concurrency constraints, and validation commands.

## Supervisor-mediated START

Pi is the only supervisor. It relays the contract and waits for `START` before write-capable builders begin. Every child uses fresh context, so Pi inlines the relevant plan, ownership summary, prior-wave handoffs, and verification evidence into each task.

## Dynamic builders

CCG installs generic `ccg-frontend-builder` and `ccg-backend-builder` templates. Pi creates only the `N` frontend and `M` backend instances required by the plan, grouped by component/profile and dependency wave. `ccg-miniprogram-builder` is retired; mini-program and WeChat work are frontend profiles.

## Ownership, handoff, test and repair

Each component has one owning builder. Cross-component changes are escalated to Pi. Each builder returns a `FINISH` handoff with its `componentId`, changed files, validation, assumptions, contract changes, and risks.

Test-runner executes applicable typecheck, test, lint, and build commands. Reviewer independently checks correctness, quality, and security. Failures and `Critical` findings identify `componentId`; Pi sends narrow repairs only to the owning builder, for at most two rounds.

## Complete-workflow extensions

The core runtime requires `pi-subagents`. The installer also offers explicitly confirmed extensions:

- `pi-mcp-adapter`: lazy MCP through a compact proxy, reducing permanently exposed schemas and adding metadata caching/output guards.
- `pi-memctx`: searchable local Markdown knowledge and relevant context injection.
- `pi-session-continuity`: durable checkpoints and cross-session handoffs.
- `pi-pr-review`: optional parallel PR review with structured findings.
- `@vigolium/piolium`: experimental multi-phase security audit, disabled by default.

Optional extensions augment but never replace the ownership, test, review, or repair contract. Without them, Pi falls back to explicit task-string context and standard CCG verification.

## Cache-friendly context management

Static role instructions remain at the front; run-specific plans, handoffs, component data, and findings are appended later. Lazy MCP metadata and on-demand memory injection reduce context churn. Actual prompt-cache behavior remains provider-dependent and no fixed hit rate is guaranteed.

## Credentials and MCP

CCG writes only `<project>/.pi/mcp.json.example`. Users keep real MCP servers and credentials in `<project>/.pi/mcp.json`, which CCG does not overwrite, inspect for values, or delete. Secrets must never enter prompts, tasks, handoffs, logs, summaries, examples, or metadata.
