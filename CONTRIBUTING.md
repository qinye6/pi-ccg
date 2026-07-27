# Contributing to pi-ccg

Thank you for improving the Pi CLI workflow.

## Development setup

Requirements:

- Node.js 20 or newer
- pnpm 10.17.1 or newer
- Pi CLI for end-to-end installation checks

```bash
git clone https://github.com/qinye6/pi-ccg.git
cd pi-ccg
pnpm install
```

## Project structure

```text
bin/                 npm executable shim
src/                 TypeScript CLI, installer, configuration, and tests
templates/pi/        Pi agents, chains, prompts, and project templates
docs/                VitePress documentation
```

The active runtime is Pi-only. Do not add new dependencies on historical Claude, Codex, Gemini wrapper, hook, or binary assets.

## Making changes

1. Create a focused branch.
2. Match the existing TypeScript style and preserve user-managed Pi configuration.
3. Add or update tests for behavior changes.
4. Keep `README.md`, `README.zh-CN.md`, VitePress docs, and module documentation synchronized when contracts change.
5. Run the full verification suite:

```bash
pnpm typecheck
pnpm build
pnpm test
npm pack --dry-run --json
node bin/ccg.mjs --help
pnpm docs:build
```

## Safety requirements

- Never place real API keys or tokens in source code, templates, tests, prompts, chains, tasks, logs, examples, or documentation.
- Never overwrite or delete a user's `<project>/.pi/mcp.json`.
- Preserve content outside the managed `<!-- CCG:PI-START -->` / `<!-- CCG:PI-END -->` block in `AGENTS.md`.
- Preserve unrelated fields in Pi settings and provider files.
- Keep the npm package allowlist limited to current Pi runtime assets.

## Pull requests

Describe:

- the user-visible behavior changed;
- the files and runtime surfaces affected;
- the commands used to verify the change;
- any compatibility, security, or migration considerations.

Do not include generated tarballs, local credentials, `.npmrc` authentication entries, or user Pi configuration.
