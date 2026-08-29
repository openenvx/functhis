# Changelog

## 0.1.0

First public version.

- Local stdio MCP gateway (`fn serve`) with search, describe, call, select/recall
- Pointer envelopes for large tool results
- Sandboxed TypeScript execution and git-owned packages
- Autonomous learning for repeated read-only flows (`packages/auto-*`)
- Client import from Cursor, Claude, and OpenCode (stdio only)
- TypeScript knowledge graph (requires `tsconfig.json`)
- Skill / plugin bootstrap (agent installs the CLI)

Publish: tag `v0.1.0` after `bun run verify-release`. See [CONTRIBUTING.md](CONTRIBUTING.md).
