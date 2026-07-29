# Installation

## Requirements

- Node.js 20 or newer
- npm/npx
- Pi CLI

The active workflow requires `npm:pi-subagents`. The interactive installer detects it with `pi list --no-approve`, shows it in the same checkbox list as the curated extensions, and checks it by default when missing. You may deselect it to install workflow assets only, but runtime ownership will remain `missing` until the package is installed. You may also install it directly:

```bash
pi install npm:pi-subagents
```

## Interactive installation

```bash
npx pi-ccg init
```

The eleven-stage installer configures language, environment, extensions, scope, providers, model routing, concurrency limits, entry mode, and the final summary. The extension stage displays every third-party package, tier, purpose, and execution warning. Recommended packages may be checked by default, and the missing required runtime is also checked by default, but nothing is installed until the user confirms the summary and the package-operation confirmation.

After installation:

```bash
ccg
```

The npm package also exposes `pi-ccg` as an executable alias.

## Curated extension profile

| Tier | Package | Purpose | Interactive default |
|---|---|---|---|
| Required | `npm:pi-subagents` | Dynamic subagents, supervisor coordination, per-agent memory | Checked by default when missing; read-only when already installed |
| Recommended | `npm:pi-mcp-adapter` | Lazy MCP servers, compact proxy tool, metadata caching, output guards | Selected |
| Recommended | `npm:pi-memctx` | Local knowledge packs, search, persistence, on-demand context injection | Selected |
| Recommended | `npm:pi-session-continuity` | Durable checkpoints, handoffs, session recovery | Selected |
| Optional | `npm:pi-pr-review` | Parallel GitHub PR review with structured findings | Not selected |
| Experimental | `npm:@vigolium/piolium` | Multi-phase security audit with resumable state | Not selected |

All packages execute with the current user's permissions. Review upstream documentation before installation, especially for experimental packages.

## Non-interactive installation

Fresh non-interactive installs do not install optional packages unless explicitly listed:

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

Use `--no-optional-extensions` for an explicit core-only installation. The required runtime package still needs `--install-required-package` before CCG will execute `pi install npm:pi-subagents` non-interactively. Package identifiers come from the validated CCG catalog, not arbitrary shell input. Never put API keys in command arguments, provider files, templates, or metadata.

## Extension management

```bash
ccg extensions
```

The manager restores previous selections, shows installed state, previews every `pi install`/`pi remove`, and asks for confirmation. Existing packages are marked `adopted` and are never removed by CCG. Packages installed by CCG are marked `ccg-installed` and may be removed when deselected or during uninstall. The required `pi-subagents` entry shares the same checkbox, but once installed or adopted it becomes read-only and is never added to a removal plan.

## Update and removal

```bash
ccg update
ccg extensions
ccg doctor
ccg status
ccg uninstall
```

Update restores saved workflow and extension choices while reinstalling only CCG-managed assets. It does not run third-party package operations or automatically add newly recommended extensions. Use `ccg extensions` for package changes.

## Publishing

The publish workflow uses npm Trusted Publishing with GitHub OIDC. It keeps `permissions: contents: read` and `id-token: write`, runs `pnpm typecheck`, `pnpm build`, `pnpm test`, and `npm pack --dry-run --json`, then publishes with `npm publish --access public --provenance` without repository-level npm tokens.

For a custom Pi home:

```bash
ccg update --install-dir /path/to/custom/pi-home
ccg extensions --install-dir /path/to/custom/pi-home
```

Uninstall removes managed files, blocks, and only packages recorded as `ccg-installed`. Adopted packages, providers, unrelated settings, and user-managed MCP configuration are preserved. If package removal fails, ownership metadata remains so removal can be retried safely.
