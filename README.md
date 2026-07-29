# pi-ccg — CCG for Pi CLI

[![npm](https://img.shields.io/npm/v/pi-ccg)](https://www.npmjs.com/package/pi-ccg)
[![CI](https://github.com/qinye6/pi-ccg/actions/workflows/ci.yml/badge.svg)](https://github.com/qinye6/pi-ccg/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://qinye6.github.io/pi-ccg/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

CCG turns Pi CLI into a bounded multi-agent development supervisor. Pi remains the only controller: it inspects the project, plans component ownership, launches the necessary generic builders, runs tests and review, and routes failures back to the builder instance that owns the affected component.

[简体中文](./README.zh-CN.md)

> Current package version: `3.2.7` · Node.js `>=20`

## What It Does

A normal run follows this pipeline:

1. `ccg-project-scout` detects project structure and candidate components.
2. `ccg-planner` produces a component contract: `componentId`s, file ownership, dependencies, wave ordering, component profiles, and test commands.
3. The Pi supervisor relays that contract, enforces ownership barriers, and waits for supervisor `START` approval before write-capable builders run.
4. Pi dynamically instantiates `N` frontend builder instances and `M` backend builder instances from the generic builder role templates, grouped by component/profile and waves.
5. Each builder implements only its assigned scope and returns a `FINISH` handoff with its `componentId`, changed files, assumptions, and validation notes.
6. `ccg-test-runner` executes the applicable typecheck, test, lint, and build commands.
7. `ccg-reviewer` performs an independent correctness, quality, and security review.
8. Failed tests or `Critical` findings are routed by `componentId` to the owning builder instance, for at most two targeted repair rounds.

Pi chooses the number of builder instances from the actual project plan, but it may never exceed the configured caps.

## Six Pi role templates

CCG installs six fixed role templates. Pi can instantiate multiple children from the same builder template when the plan has multiple components.

| Role template | Responsibility |
|---|---|
| `ccg-project-scout` | Read-only project and component discovery |
| `ccg-planner` | Component plan, file boundaries, ownership, dependencies, waves, and test plan |
| `ccg-backend-builder` | Generic backend, service, API, data, and infrastructure implementation |
| `ccg-frontend-builder` | Generic frontend implementation for web UI, admin UI, mini-program, mobile-web, or other frontend profiles |
| `ccg-test-runner` | Test, typecheck, lint, and build execution |
| `ccg-reviewer` | Independent correctness, quality, and security review |

The scout, planner, and all builder instances use per-agent persistent memory supplied by the required `pi-subagents` package. This is the `memory` frontmatter capability from `pi-subagents`, independent of Pi core parent/session/project memory, and it is not a second extension. Reviewer and test-runner remain stateless so verification does not depend on the implementation context.

### Dynamic builder example

For a repository containing a backend service, a web administration console, and a WeChat mini-program, Pi can launch:

- one `ccg-backend-builder` instance for the backend component;
- one `ccg-frontend-builder` instance with a web/admin `componentProfile`;
- one `ccg-frontend-builder` instance with a mini-program/WeChat `componentProfile`.

`ccg-miniprogram-builder` is retired and is not part of the active runtime. Mini-program and WeChat work is modeled as a frontend `componentProfile` handled by generic frontend builder instances.

## Coordination contract

The Pi supervisor is responsible for child-parent coordination:

- `START` approval: after planning, Pi presents or relays the implementation contract and does not start write-capable builder work until the supervisor issues `START`. This approval is mediated by Pi supervisor coordination and is not necessarily a direct user prompt.
- Contract relay: every child task receives the relevant plan slice, dependencies, file ownership boundaries, prior wave outputs, and required `componentId` in its task string.
- Ownership barriers: builders must not modify files owned by another component; cross-component changes are escalated to the supervisor instead of edited opportunistically.
- Wave execution: Pi groups builder instances by dependency wave and keeps the effective development parallelism within configured caps.
- `FINISH` handoff: each builder returns what changed, what was validated, what remains risky, and which `componentId` it completed.
- Targeted repair: test/review failures must include `componentId`; Pi sends narrow repair tasks only to the owning builder instance and stops after two repair rounds.

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
requiredSpawns = 2 + (N_frontend + M_backend) + 1 + 1
```

`2` is scout plus planner, `N_frontend + M_backend` is the selected builder instance count, followed by test-runner and reviewer. Defaults are:

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

Run the eleven-stage interactive installer:

```bash
npx pi-ccg init
```

The installer shows `npm:pi-subagents` in the same extension checkbox list as the curated optional packages. When the required runtime is missing it is checked by default, can be deselected to install workflow assets only, and is still not executed until the final package-operation confirmation. If you leave it unchecked, CCG records the runtime as `missing`, keeps assets installed, and `ccg doctor` / `ccg status` report that runtime attention is still required.

| Tier | Package | Capability |
|---|---|---|
| Required | `npm:pi-subagents` | Orchestration, supervisor coordination, per-agent memory |
| Recommended | `npm:pi-mcp-adapter` | Lazy MCP servers, compact proxy, metadata caching, output guards |
| Recommended | `npm:pi-memctx` | Local knowledge packs and on-demand context injection |
| Recommended | `npm:pi-session-continuity` | Durable checkpoints, handoffs, and recovery |
| Optional | `npm:pi-pr-review` | Parallel GitHub PR review with structured findings |
| Experimental | `npm:@vigolium/piolium` | Multi-phase security audit; disabled by default |
| Optional | `npm:pi-simplify` | Code simplification assistance |
| Optional | `npm:pi-rtk-optimizer` | Runtime/toolkit optimization |
| Optional | `npm:pi-statusline` | Pi status-line UI |
| Optional | `npm:@juicesharp/rpiv-todo` | Todo tracking |
| Optional | `npm:@juicesharp/rpiv-ask-user-question` | Structured user questions |
| Optional | `npm:@narumitw/pi-plan-mode` | Plan-mode workflow |
| Optional | `npm:pi-web-access` | Web access with safely managed workflow default |
| Optional | `npm:pi-hashline-edit-pro` | Hashline-aware editing |
| Optional | `npm:pi-fff` | Productivity utilities |

All nine newly added entries are disabled by default. `pi-task` is intentionally not listed because the unscoped npm package does not exist and the available scoped packages are not equivalent; CCG does not guess package identity.

A non-interactive example:

```bash
npx pi-ccg init \
  --skip-prompt \
  --project-assets \
  --install-required-package \
  --extensions mcp-adapter,memory-context,session-continuity \
  --frontend-model provider/frontend-model \
  --backend-model provider/backend-model \
  --review-model provider/review-model \
  --dev-agent-cap 4 \
  --global-concurrency-limit 4 \
  --max-spawns-per-session 24 \
  --max-subagent-depth 1
```

Fresh non-interactive installs do not install optional packages unless `--extensions` explicitly selects them. The required `pi-subagents` package is still gated separately by `--install-required-package`; there are no silent installs in non-interactive mode. Use `--no-optional-extensions` for core-only installation.

Model settings are independent:

- Frontend model → generic `ccg-frontend-builder` instances
- Backend model → generic `ccg-backend-builder` instances
- Review model → `ccg-reviewer` and `ccg-test-runner`
- Scout and planner inherit Pi's configured `subagents.defaultModel`

Use `--provider-file <path>` only for non-secret provider definitions. Interactive onboarding can create a custom provider/model using an API-key environment-variable reference; it never requests or stores the real key. CCG recognizes only exact, verified model IDs when filling `contextWindow` and `maxTokens`; unknown models require explicit user values and are never guessed. Existing `models.json` data is inspected as missing/valid/invalid, invalid JSON is never overwritten, and exact provider/model merges preserve pricing, nested compatibility settings, sibling models, and unknown user fields.

Verified capability presets currently cover `anthropic/claude-sonnet-5`, `anthropic/claude-fable-5`, `anthropic/claude-haiku-4-5-20251001`, `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-luna`, and `google/gemini-3.5-flash`.

`ccg extensions` uses the same required-runtime checkbox semantics. If `pi-subagents` is already installed or adopted, it stays checked and read-only, is never reinstalled, and is never added to a removal plan.

## CLI

```text
ccg              Interactive Pi workflow menu
ccg init         Install or configure managed Pi assets and selected extensions
ccg update [--install-dir <path>]  Reinstall managed assets without changing packages
ccg extensions [--install-dir <path>]  Explicitly manage curated Pi extensions
ccg doctor [--install-dir <path>] [--project-dir <path>]  Check Pi, required runtime, agents, caps, models, extensions, and MCP presence
ccg status [--install-dir <path>] [--project-dir <path>]  Show readiness and extension ownership summary
ccg uninstall    Remove managed assets and CCG-owned packages only
```

Useful init flags:

```text
--extensions <id,id>
--no-optional-extensions
--install-required-package
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

## Integrations, memory, and continuity

Pi CLI is the host runtime. `pi-subagents` is required and supplies orchestration, native supervisor coordination, and per-agent persistent `memory` frontmatter.

The recommended profile adds `pi-mcp-adapter` for lazy MCP access, `pi-memctx` for searchable local knowledge and relevant context injection, and `pi-session-continuity` for durable checkpoints and handoffs. `pi-pr-review` is optional; `@vigolium/piolium` is experimental and disabled by default. The additional productivity/UI/editing entries are also default-off. Use `ccg extensions` to manage these packages. Packages that already existed are marked `adopted`; CCG removes only packages it installed and recorded as `ccg-installed`.

When `pi-web-access` is selected, the final operation confirmation may also create or merge `workflow: "none"` in `~/.pi/web-search.json`. CCG changes only an absent `workflow` field, preserves existing workflows and invalid JSON, does not redirect this path with `--install-dir`, and never removes the file during uninstall.

## Publishing

`.github/workflows/npm-publish.yml` is configured for npm Trusted Publishing with GitHub OIDC. It keeps `permissions: contents: read` and `id-token: write`, runs the validation chain (`pnpm typecheck`, `pnpm build`, `pnpm test`, `npm pack --dry-run --json`), and publishes with `npm publish --access public --provenance` without `NPM_TOKEN` or `NODE_AUTH_TOKEN`.

CCG keeps static prompt prefixes stable and appends runtime plans and handoffs later. Lazy MCP metadata and on-demand memory reduce context churn, but actual provider prompt-cache hits remain provider-dependent and are not guaranteed.

CCG may write `<project>/.pi/mcp.json.example`, but never overwrites, reads credential values from, or removes the user's `<project>/.pi/mcp.json`. Updates preserve extension choices without package operations or silently adding new recommendations.

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
