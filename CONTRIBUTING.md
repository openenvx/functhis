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

## Project boundaries

- Local open source first: no Cloud, accounts, or telemetry in core PRs
- Saved packages run in the sandbox with an explicit upstream tool allowlist
- No arbitrary model-supplied code execution outside the sandbox
- Prefer tests with fake MCP servers under `fixtures/servers/`

## Pull requests

- Keep changes focused
- Add or update tests for behavior changes

## Security

See [SECURITY.md](SECURITY.md). Do not include credentials in issues or PRs.
