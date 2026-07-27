# Workflow architecture

A standard run follows this pipeline:

```text
ccg-project-scout
→ ccg-planner
→ Pi dynamic builder fanout
→ ccg-test-runner
→ ccg-reviewer
→ componentId-targeted repair (up to two rounds)
```

## Discovery and planning

The scout reads the project and reports components. The planner translates those components into a bounded implementation plan containing component IDs, file ownership, dependencies, and test commands.

## Dynamic builders

Pi creates only the builder tasks required by the plan. For example, a project with a backend, a web administration interface, and a WeChat mini-program can receive three builders:

- `ccg-backend-builder`
- `ccg-frontend-builder`
- `ccg-miniprogram-builder`

Builders use fresh context, receive the complete relevant plan in their task string, and cannot spawn child agents.

## Test, review, and repair

After implementation, test-runner executes applicable typecheck, test, lint, and build commands. Reviewer independently checks correctness, quality, and security.

A failed test or `Critical` finding must identify its `componentId`. Pi sends a narrow repair request only to that component's owning builder, then repeats verification. The loop is limited to two repair rounds.

## Memory

Scout, planner, and builders may use Pi native project memory. Test-runner and reviewer remain stateless so acceptance results do not depend on prior implementation context. External memory adapters are optional and report-only.
