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

The eleven-stage installer configures language, environment, extensions, scope, providers, model routing, concurrency limits, entry mode, and the final summary. If no usable provider/model is available, the provider stage offers a custom-provider path that accepts only an API-key environment-variable reference. Exact verified model IDs can receive capability defaults; unknown model limits are never guessed. Recommended packages may be checked by default, and the missing required runtime is also checked by default, but no package or managed config operation runs until final confirmation.

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
| Optional | `npm:pi-simplify` | Code simplification assistance | Not selected |
| Optional | `npm:pi-rtk-optimizer` | Runtime/toolkit optimization | Not selected |
| Optional | `npm:pi-statusline` | Status-line UI | Not selected |
| Optional | `npm:@juicesharp/rpiv-todo` | Todo tracking | Not selected |
| Optional | `npm:@juicesharp/rpiv-ask-user-question` | Structured user questions | Not selected |
| Optional | `npm:@narumitw/pi-plan-mode` | Plan-mode workflow | Not selected |
| Optional | `npm:pi-web-access` | Web access and safe workflow default | Not selected |
| Optional | `npm:pi-hashline-edit-pro` | Hashline-aware editing | Not selected |
| Optional | `npm:pi-fff` | Productivity utilities | Not selected |

`pi-task` remains deferred: the unscoped npm package does not exist, and CCG will not choose among unrelated scoped packages on the user's behalf.

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

The manager restores previous selections, shows installed state, previews every `pi install`/`pi remove` and managed config operation, and asks for one final confirmation. Existing packages are marked `adopted` and are never removed by CCG. Packages installed by CCG are marked `ccg-installed` and may be removed when deselected or during uninstall. The required `pi-subagents` entry shares the same checkbox, but once installed or adopted it becomes read-only and is never added to a removal plan.

If `pi-web-access` is selected, the same confirmation may include creating or merging `workflow: "none"` at the fixed user-home path `~/.pi/web-search.json`. CCG changes only that field and only when it is absent: an existing workflow value is preserved, invalid/non-object JSON is rejected without overwrite, `--install-dir` does not redirect this path, and uninstall never deletes the file. The config is not written if the package installation fails.

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
