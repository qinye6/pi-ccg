# CLI reference

```bash
npx pi-ccg --help
npx --package pi-ccg ccg --help
```

| Command | Purpose |
|---|---|
| `ccg` | Open the Pi-only workflow menu |
| `ccg init` / `ccg i` | Run the eleven-stage installation flow |
| `ccg update [--install-dir <path>]` | Reinstall managed assets without changing third-party packages |
| `ccg extensions [--install-dir <path>]` | Inspect and explicitly manage curated Pi extensions |
| `ccg doctor [--install-dir <path>] [--project-dir <path>]` | Check runtime, agents, models, caps, extensions, and MCP configuration presence |
| `ccg status [--install-dir <path>] [--project-dir <path>]` | Display readiness and extension ownership summary |
| `ccg uninstall` | Remove managed assets and CCG-owned packages only |

## Common init options

| Option | Purpose |
|---|---|
| `--skip-prompt` | Run non-interactively |
| `--project-assets` / `--no-project-assets` | Enable or disable project assets |
| `--extensions <id,id>` | Explicitly select optional catalog entries |
| `--no-optional-extensions` | Select no optional extensions |
| `--install-required-package` | Authorize missing required `pi-subagents` installation |
| `--frontend-model <id>` | Model for dynamic frontend builders |
| `--backend-model <id>` | Model for dynamic backend builders |
| `--review-model <id>` | Model for reviewer and test-runner |
| `--provider-file <path>` | Import non-secret provider definitions |
| `--dev-agent-cap <n>` | Maximum builder count |
| `--global-concurrency-limit <n>` | Global concurrent subagent limit |
| `--max-spawns-per-session <n>` | Session spawn budget |
| `--max-subagent-depth <n>` | Maximum subagent depth |
| `--install-dir <path>` | Use a custom Pi home |
| `--force` | Replace managed files where supported |

`--install-dir` is also supported by `update`, `extensions`, `doctor`, `status`, and `uninstall`; `doctor` and `status` additionally accept `--project-dir` when validating project-level assets outside the current directory.

`--preserve-extensions` is an internal update handoff flag that preserves extension metadata and prevents package reconciliation.

## Extension IDs

```text
core-subagents       required; authorized with --install-required-package
mcp-adapter          recommended
memory-context       recommended
session-continuity   recommended
pr-review            optional
security-audit       experimental
```

Interactive management previews every package operation and requires confirmation. Existing packages are `adopted`; only `ccg-installed` packages may be removed by CCG.

Update never silently changes third-party packages or adds newly recommended packages. Use `ccg extensions` for package operations.
