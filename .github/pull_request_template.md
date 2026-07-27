## Summary

<!-- What does this PR do? Keep it to 1-3 bullet points. -->

-

## Type

- [ ] `feat` — New feature
- [ ] `fix` — Bug fix
- [ ] `docs` — Documentation only
- [ ] `refactor` — Code refactoring without behavior change
- [ ] `test` — Adding or updating tests
- [ ] `chore` — Build, CI, dependency, or release work

## Changes

| File | Change |
|---|---|
| `src/...` | ... |

## Verification

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes
- [ ] `npm pack --dry-run --json` succeeds when package contents change
- [ ] `pnpm docs:build` succeeds when docs change
- [ ] Manual verification is described below when applicable

## Safety checklist

- [ ] No real API keys, tokens, credentials, or private user configuration are included
- [ ] User-managed `.pi/mcp.json` remains untouched
- [ ] `AGENTS.md` content outside the CCG managed block is preserved
- [ ] Legacy runtime assets are not added to the npm package
- [ ] README, CHANGELOG, and docs are updated for user-visible changes
- [ ] The PR contains one focused concern

## Related issues

<!-- Fixes #123, Related to #456 -->
