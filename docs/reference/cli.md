# CLI reference

```bash
npx pi-ccg --help
npx --package pi-ccg ccg --help
```

| Command | Purpose |
|---|---|
| `ccg` | Open the Pi-only workflow menu |
| `ccg init` / `ccg i` | Run the thirteen-stage installation flow |
| `ccg style <name>` | Switch the persisted leader output style; use `default` to restore the default |
| `ccg update [--install-dir <path>]` | Reinstall managed assets without changing third-party packages |
| `ccg extensions [--install-dir <path>]` | Inspect and explicitly manage curated Pi extensions |
| `ccg doctor [--install-dir <path>] [--project-dir <path>]` | Check runtime, agents, models, caps, extensions, and MCP configuration presence |
| `ccg status [--install-dir <path>] [--project-dir <path>]` | Display readiness and extension ownership summary |
| `ccg uninstall` | Remove managed assets and CCG-owned packages only |

## Pi slash commands installed by CCG

| Pi command | Purpose |
|---|---|
| `/ccg <request>` | Main leader entry for plan → build → test → review → repair |
| `/ccg-board [taskId]` | Read-only task/component progress board |
| `/ccg-replay [taskId]` | Read-only event timeline and retrospective |
| `/ccg-resume <taskId>` | Validate and resume a durable leader checkpoint with fresh children |
| `/ccg-go <request>` | Compatibility entry equivalent to `/ccg` |

These are Pi prompt commands installed in the selected user or project prompt directory; they are distinct from the `ccg` npm CLI commands below. Claude's `/ccg:go` skill is a different host namespace—Pi uses `/ccg-go`. If Pi's `/` menu is missing the commands, use `ccg init` for an uninitialized installation or `ccg update` when metadata exists but assets are missing, then restart/reload Pi. `doctor`/`status` report command readiness and the board root without reading task contents. Uninstall removes only the five managed prompts and preserves user prompts and `.pi/ccg/tasks/`.


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
| `--planning-thinking <level>` | Thinking level for scout and planner |
| `--frontend-thinking <level>` | Thinking level for frontend builders |
| `--backend-thinking <level>` | Thinking level for backend builders |
| `--review-thinking <level>` | Thinking level for reviewer and test-runner |
| `--provider-file <path>` | Import non-secret provider definitions |
| `--persona <name>` | Select the leader output style during `init` |
| `--dev-agent-cap <n>` | Maximum builder count |
| `--global-concurrency-limit <n>` | Global concurrent subagent limit |
| `--max-spawns-per-session <n>` | Session spawn budget |
| `--max-subagent-depth <n>` | Maximum subagent depth |
| `--install-dir <path>` | Use a custom Pi home |
| `--force` | Replace managed files where supported |

`--install-dir` is also supported by `update`, `extensions`, `doctor`, `status`, and `uninstall`; `doctor` and `status` additionally accept `--project-dir` when validating project-level assets outside the current directory.

`--preserve-extensions` is an internal update handoff flag that preserves extension metadata and prevents package reconciliation.

The thinking flags accept `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Omit a flag to inherit Pi/model defaults without writing an override. Explicit values are persisted in CCG metadata and merged into `settings.json -> subagents.agentOverrides`; exact known model capabilities are validated, while unknown models produce a doctor warning instead of a guessed result.

The accepted persona names are `default`, `engineer-professional`, `nekomata-engineer`, `laowang-engineer`, `ojousama-engineer`, `abyss-cultivator`, `abyss-concise`, `abyss-command`, and `abyss-ritual`. The choice is persisted in CCG metadata and preserved by update. It affects only `/ccg` and `/ccg-go` leader prose; child contracts/JSON, tests, reviews, board, credentials, and user `SYSTEM.md` / `APPEND_SYSTEM.md` are outside the style boundary.

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
