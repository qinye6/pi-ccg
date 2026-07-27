# CLI reference

Both npm executable names point to the same CLI:

```bash
npx pi-ccg --help
npx --package pi-ccg ccg --help
```

After installation, the normal command is `ccg`.

| Command | Purpose |
|---|---|
| `ccg` | Open the Pi-only workflow menu |
| `ccg init` / `ccg i` | Run the ten-step installation and configuration flow |
| `ccg update` | Reinstall safely using saved CCG metadata |
| `ccg doctor` | Check Pi CLI, agents, model routing, caps, and optional memory |
| `ccg status` | Display the current CCG installation summary |
| `ccg uninstall` | Remove only CCG-managed assets |

## Common init options

| Option | Purpose |
|---|---|
| `--skip-prompt` | Run non-interactively |
| `--project-assets` | Install optional assets into the current project |
| `--frontend-model <id>` | Model for web and mini-program builders |
| `--backend-model <id>` | Model for the backend builder |
| `--review-model <id>` | Model for reviewer and test-runner |
| `--provider-file <path>` | Import provider definitions from a user-selected file |
| `--dev-agent-cap <n>` | Maximum builder count |
| `--global-concurrency-limit <n>` | Global concurrent subagent limit |
| `--max-spawns-per-session <n>` | Session spawn budget |
| `--max-subagent-depth <n>` | Maximum subagent depth |
| `--install-dir <path>` | Use a custom Pi home for installation or testing |
| `--force` | Replace CCG-managed files where supported |

Run `npx pi-ccg init --help` for the exact options in the installed version.
