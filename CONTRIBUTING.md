# Contributing to Functhis

Thank you for helping improve Functhis.

## Development setup

Requirements: Node.js 22+, Bun.

```sh
git clone https://github.com/openenvx/functhis.git
cd functhis
bun install
bun run build
bun run test
```

## Before opening a PR

```sh
bun run check-types
bun run lint
bun run build
bun run test
```

Use `bun run fix` to auto-format when needed.

If you edit files under `skills/`, sync the plugin copy:

```sh
bun run sync-plugin-skills
```

CI fails if `plugins/functhis/skills/` drifts from `skills/` (`test/skills-sync.test.ts`).

## Layout

| Path | Role |
| --- | --- |
| `src/` | CLI, gateway, sandbox, learning, graph |
| `fixtures/servers/` | Fake MCP servers for tests |
| `skills/` | Canonical agent skills (copy into `plugins/functhis/skills/`) |
| `plugins/functhis/` | Cursor / Claude / Codex plugin wrapper |
| `examples/` | Readable package layout (not live GitHub) |
| `docs/` | Contracts and architecture |

Add upstream fixtures under `fixtures/servers/` and wire them in `test/helpers.ts` (`testUpstreamConfig`) rather than hitting real networks.

Package on-disk format: [docs/PACKAGES.md](docs/PACKAGES.md). Settings: [docs/SETTINGS.md](docs/SETTINGS.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project boundaries

- Local open source first: no Cloud, accounts, or telemetry in core PRs
- Saved packages run in the sandbox with an explicit upstream tool allowlist
- No arbitrary model-supplied code execution outside the sandbox
- Prefer tests with fake MCP servers under `fixtures/servers/`

## Pull requests

- Keep changes focused
- Add or update tests for behavior changes
- Update [CHANGELOG.md](CHANGELOG.md) when the public CLI or gateway contract changes

## Release (maintainers)

1. Version in `package.json` (first public: `0.1.0`)
2. Update `CHANGELOG.md`
3. `bun run verify-release`
4. Tag `v0.1.0` and push the tag — [`.github/workflows/publish.yml`](.github/workflows/publish.yml) runs `npm publish --provenance --access public` (`NPM_TOKEN`)
5. Confirm `npm view functhis version`

Do not publish from a dirty tree. Git installs use `prepack` → `tsc` so `npm install -g github:openenvx/functhis` produces `dist/`.

## Security

See [SECURITY.md](SECURITY.md). Do not include credentials in issues or PRs.
