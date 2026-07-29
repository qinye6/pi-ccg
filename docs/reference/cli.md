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
| `--install-required-package` | Authorize missing required `pi-subagents` installation in non-interactive mode |
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
simplify             optional; default off
rtk-optimizer        optional; default off
statusline           optional; default off
todo                 optional; default off
ask-user-question    optional; default off
plan-mode            optional; default off
web-access           optional; default off
hashline-edit-pro    optional; default off
fff                  optional; default off
```

Interactive `init` and `ccg extensions` both show `core-subagents` in the same checkbox list as the rest of the catalog. When missing, it is checked by default and can be deselected to keep workflow assets while recording runtime ownership as `missing`. When already installed or adopted, it stays checked and read-only, is never reinstalled, and is never added to a removal plan.

Interactive management previews every package and managed config operation and requires one final confirmation. Existing packages are `adopted`; only `ccg-installed` optional packages may be removed by CCG. A failed removal remains recorded for retry while the package is installed; if it has already been removed outside CCG, the next reconciliation drops stale metadata without issuing another remove command.

For `web-access`, the preview may include a safe `~/.pi/web-search.json` create/merge that sets only an absent `workflow` field to `none`. Existing values and invalid JSON are preserved, and uninstall never removes this file.

Update never silently changes third-party packages or adds newly recommended packages. Use `ccg extensions` for package operations.
