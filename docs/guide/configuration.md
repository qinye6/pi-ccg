# Configuration

## Model routing

The installer maps three user choices to the seven Pi agents:

```text
frontendModel → ccg-frontend-builder + ccg-miniprogram-builder
backendModel  → ccg-backend-builder
reviewModel   → ccg-reviewer + ccg-test-runner
scout/planner → subagents.defaultModel
```

Model and provider configuration is merged into existing Pi files. Unrelated user fields are preserved.

## Concurrency limits

Effective builder concurrency is calculated as:

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)
```

A normal run requires:

```text
requiredSpawns = 2 + N + 1 + 1
```

where `N` is the number of builders. The default caps are:

```text
devAgentCap = 4
globalConcurrencyLimit = 4
maxSpawnsPerSession = 24
maxSubagentDepth = 1
```

## Installation paths

User-level assets:

```text
~/.pi/agent/settings.json
~/.pi/agent/models.json
~/.pi/agent/agents/
~/.pi/agent/chains/
~/.pi/agent/prompts/
~/.pi/agent/extensions/subagent/config.json
~/.pi/agent/ccg-workflow.json
```

Optional project assets:

```text
<project>/AGENTS.md
<project>/.pi/settings.json
<project>/.pi/chains/
<project>/.pi/prompts/
<project>/.pi/mcp.json.example
```

`AGENTS.md` content outside the CCG marker block is preserved. Existing project `.pi/settings.json` and user-managed `.pi/mcp.json` files are not overwritten.
