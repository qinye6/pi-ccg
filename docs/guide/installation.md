# Installation

## Requirements

- Node.js 20 or newer
- npm/npx
- Pi CLI

## Interactive installation

Run the latest public package without installing it globally:

```bash
npx pi-ccg init
```

The installer configures Pi agents, chains, prompts, model routing, concurrency limits, and optional project assets. After installation, open the workflow menu with:

```bash
ccg
```

The npm package also exposes `pi-ccg` as an executable alias.

## Non-interactive installation

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

Use model identifiers configured in the user's Pi environment. Do not put API keys in command arguments or CCG templates.

## Update and removal

```bash
ccg update
ccg doctor
ccg status
ccg uninstall
```

Update restores the choices saved in CCG metadata and resolves `pi-ccg@latest`. Uninstall removes only CCG-managed files and managed blocks.
