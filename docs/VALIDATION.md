# Validation gates

Stay on the local Skill + CLI + package path. See [roadmap.md](../roadmap.md). Do not start Cloud, a hosted runner, or a team registry.

## Stay local (default)

Stay local if any of:

- Fewer than ~20 external npm installs within ~4 weeks of a public `0.1.0`
- No repeated multi-tool traces from outside the maintainer team
- Package test or secret-scrubbing regressions
- Users prefer the gateway without committing `packages/`

## Reposition (product, not a new cloud)

If usage splits, **docs and defaults** can lean one way without leaving local OSS:

- **Compiler-first:** saved packages are valuable, MCP aggregation is not → emphasize `fn_save_function` / git-owned packages
- **Gateway-first:** discovery is valuable, saved packages are optional → stay a local gateway unless users commit `packages/`

Neither path implies accounts, telemetry, or a hosted registry.

## Explicitly deferred

- Hosted runner, managed secrets, schedules, webhooks
- Team metadata, registry, SSO
- HTTP/SSE MCP proxy for all clients
- Embeddings, desktop app, visual workflow editor

## Telemetry

Off. No account required for Skill or CLI.
