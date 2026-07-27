# pi-ccg — CCG for Pi CLI

[![npm](https://img.shields.io/npm/v/pi-ccg)](https://www.npmjs.com/package/pi-ccg)
[![CI](https://github.com/qinye6/pi-ccg/actions/workflows/ci.yml/badge.svg)](https://github.com/qinye6/pi-ccg/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://qinye6.github.io/pi-ccg/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

CCG turns Pi CLI into a bounded multi-agent development supervisor. Pi remains the only controller: it inspects the project, plans component ownership, launches the necessary intelligent builders, runs tests and review, and routes failures back to the builder that owns the affected component.

[简体中文](./README.zh-CN.md)

> Current package version: `3.2.4` · Node.js `>=20`

## What It Does

A normal run follows this pipeline:

1. `ccg-project-scout` detects project structure and components.
2. `ccg-planner` produces a component plan and ownership map.
3. Pi constructs a bounded `subagent({ tasks: [...] })` fanout.
4. Component builders implement their assigned scopes.
5. `ccg-test-runner` executes the applicable test commands.
6. `ccg-reviewer` performs an independent review.
7. Failed tests or `Critical` findings are routed by `componentId` to the owning builder, for at most two targeted repair rounds.

Pi chooses the number of builders from the actual project, but it may never exceed the configured caps.

### Example fanout

For a repository containing a backend, a web administration console, and a WeChat mini-program, Pi can launch:

- `ccg-backend-builder`
- `ccg-frontend-builder`
- `ccg-miniprogram-builder`

After development, Pi automatically launches `ccg-test-runner` and `ccg-reviewer`. It does not create one fixed agent per model, and builders cannot spawn their own child agents.

## Included Pi agents

| Agent | Responsibility |
|---|---|
| `ccg-project-scout` | Read-only project and component discovery |
| `ccg-planner` | Component plan, file boundaries, ownership, test plan |
| `ccg-backend-builder` | Backend and service implementation |
| `ccg-frontend-builder` | Web frontend and administration UI implementation |
| `ccg-miniprogram-builder` | WeChat mini-program implementation |
| `ccg-test-runner` | Test, typecheck, lint, and build execution |
| `ccg-reviewer` | Independent correctness, quality, and security review |

The scout, planner, and builders use Pi native project memory. Reviewer and test-runner remain stateless. External memory adapters are optional and report-only; their absence does not make installation, update, or doctor fail.

## Bounded concurrency

The effective development fanout is:

```text
effectiveDevParallelism = min(
  devAgentCap,
  globalConcurrencyLimit,
  parallel.concurrency,
  parallel.maxTasks
)
```

A standard run reserves this spawn budget:

```text
requiredSpawns = 2 + N + 1 + 1
```

`2` is scout plus planner, `N` is the selected builder count, followed by test-runner and reviewer. Defaults are:

```text
devAgentCap = 4
globalConcurrencyLimit = 4
maxSpawnsPerSession = 24
maxSubagentDepth = 1
```

## Installation

Prerequisites:

- Node.js `>=20`
- Pi CLI
- Pi's subagent extension/package enabled

Run the interactive installer:

```bash
npx pi-ccg init
```

A non-interactive example:

```bash
npx pi-ccg init \
  --skip-prompt \
  --project-assets \
  --frontend-model provider/frontend-model \
  --backend-model provider/backend-model \
  --review-model provider/review-model \
  --dev-agent-cap 4 \
  --global-concurrency-limit 4 \
  --max-spawns-per-session 24 \
  --max-subagent-depth 1
```

Model settings are independent:

- Frontend model → `ccg-frontend-builder`, `ccg-miniprogram-builder`
- Backend model → `ccg-backend-builder`
- Review model → `ccg-reviewer`, `ccg-test-runner`
- Scout and planner inherit Pi's configured default subagent model

Use `--provider-file <path>` only for non-secret provider definitions. Do not place credentials in provider files, prompts, templates, tasks, or logs.

## CLI

```text
ccg              Interactive Pi workflow menu
ccg init         Install or configure managed Pi assets
ccg update       Safely reinstall managed assets from saved metadata
ccg doctor       Check Pi CLI, agents, caps, models, and optional adapters
ccg status       Show the current installation summary
ccg uninstall    Remove only CCG-managed Pi assets
```

Useful init flags:

```text
--frontend-model <provider/model>
--backend-model <provider/model>
--review-model <provider/model>
--provider-file <path>
--dev-agent-cap <number>
--global-concurrency-limit <number>
--max-spawns-per-session <number>
--max-subagent-depth <number>
--project-assets | --no-project-assets
--install-dir <path>
--skip-prompt
--force
```

## Installed paths

User-level assets:

```text
~/.pi/agent/agents/
~/.pi/agent/chains/
~/.pi/agent/prompts/
~/.pi/agent/settings.json
~/.pi/agent/models.json
~/.pi/agent/extensions/subagent/config.json
~/.pi/agent/ccg-workflow.json
```

Optional project-level assets:

```text
<project>/AGENTS.md                  # CCG managed block only
<project>/.pi/chains/ccg-plan.chain.md
<project>/.pi/prompts/ccg-go.md
<project>/.pi/settings.json
<project>/.pi/mcp.json.example
```

CCG only changes the block between:

```text
<!-- CCG:PI-START -->
<!-- CCG:PI-END -->
```

Content outside that block is preserved. Uninstall removes only managed files, managed configuration keys, and the managed block.

## Credential safety

Real API keys and tokens must never be written into agent prompts, `AGENTS.md`, chains, task descriptions, logs, summaries, examples, or CCG-managed metadata. MCP credentials may exist only in the user's own, unmanaged `<project>/.pi/mcp.json`; CCG does not overwrite or remove that file.

## Runtime assets

The npm package publishes only:

```text
bin/ccg.mjs
dist/
templates/pi/
```

`templates/pi/` is the only active installation surface. Older Claude/Codex/Gemini command, prompt, hook, skill, and wrapper sources remain historical repository material; the Pi CLI path does not install them, the package root does not export the legacy installer entry points, and npm does not publish those runtime assets.

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run --json
node bin/ccg.mjs --help
```

CCG is licensed under the [MIT License](./LICENSE).
