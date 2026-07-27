# Security boundary

## Credentials

Real API keys and tokens must not appear in agents, prompts, chains, `AGENTS.md`, tasks, logs, summaries, examples, package metadata, or CCG-managed configuration.

The supported project credential location is the user-managed file:

```text
<project>/.pi/mcp.json
```

`pi-ccg` does not overwrite, remove, publish, or log this file. The generated `.pi/mcp.json.example` contains placeholders only.

## Managed files

- `AGENTS.md` changes are limited to the `<!-- CCG:PI-START -->` and `<!-- CCG:PI-END -->` block.
- Existing project `.pi/settings.json` is preserved.
- User settings and model files are merged without removing unrelated fields.
- A same-name provider is skipped by default; explicit replacement creates a backup first.
- Uninstall removes only files recorded as CCG-managed.

## Package boundary

The public package allowlist contains only:

```text
bin/ccg.mjs
dist/
templates/pi/
```

Normal npm metadata and top-level documentation may be added automatically by npm. Historical wrapper binaries, Claude hooks, and legacy runtime templates must not be published.

Report vulnerabilities through the repository's private security advisory form.
