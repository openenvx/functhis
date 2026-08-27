# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-27

### Added

- JMESPath `select` on Function plan steps to shape intermediate results
- Explicit `dependsOn` DAG with bounded parallel read steps
- Per-step retries for declared idempotent read tools
- Whole-run output byte budgets and cancellation propagation
- CLI `--approve-writes` for Functions with `writes: review-required`
- Stronger tool fingerprints (name, description, schema)
- `fn test` regression report for tool fingerprint drift
- Committed demo Function `lookup-user-issues` with 30-replay CI test
- Launch and validation gate docs (`docs/LAUNCH.md`, `docs/DEMO.md`, `docs/VALIDATION.md`)
- Tag-triggered npm publish workflow

## [0.1.0] - 2026-08-27

### Added

- Public npm package with `fn` / `functhis` binaries
- Dual-format agent Skill marketplace (Claude Code, Cursor, Codex)
- `functhis-setup` guided onboarding skill
- Config and client MCP backup-before-write in `fn setup`
- Tarball install smoke test in CI
- `SECURITY.md`, `CONTRIBUTING.md`, and install issue templates
- Extended `fn doctor` diagnostics (Node version, backups, package version)

### Changed

- README documents clean-machine install via `npm install -g functhis`

## [0.0.1] - Internal

- M1–M4: MCP gateway, traces, Function compile/replay, Function MCP expose
