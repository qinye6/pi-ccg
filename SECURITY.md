# Security Policy

## Supported scope

Security reports are accepted for the current Pi-only release surface:

- the `pi-ccg` npm package and CLI;
- Pi agent, chain, prompt, and project templates under `templates/pi/`;
- installer, update, doctor, status, and uninstall behavior;
- managed Pi settings, provider configuration, concurrency limits, and `AGENTS.md` block handling;
- accidental credential exposure or unsafe package contents.

Historical Claude/Codex/Gemini wrapper, hook, binary, and legacy template implementations are not part of the active runtime. Reports showing that current Pi code unexpectedly invokes or publishes those assets are in scope.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting:

<https://github.com/qinye6/pi-ccg/security/advisories/new>

If private reporting is unavailable, open a minimal issue that contains no exploit details, credentials, or sensitive user data and request a private contact channel.

Include when possible:

- affected `pi-ccg` version;
- affected operating system and Node.js/Pi CLI versions;
- reproduction steps using placeholders instead of real credentials;
- impact and affected files;
- a suggested mitigation, if known.

## Credential boundary

Real API keys and tokens must never be written to CCG-managed prompts, chains, agents, `AGENTS.md`, tasks, logs, summaries, examples, tests, package metadata, or source control.

The only supported location for real project MCP credentials is the user's own:

```text
<project>/.pi/mcp.json
```

`pi-ccg` does not manage, overwrite, package, or remove this file. Examples use placeholders only.

## Response process

Maintainers will validate the report, determine affected versions, prepare a fix, and coordinate disclosure. Public details should be withheld until affected users have a reasonable opportunity to update.
