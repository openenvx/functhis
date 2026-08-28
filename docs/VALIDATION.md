# Validation gates

Stay on the local Skill + CLI + package path. See [FUNCTHIS_ROADMAP.md](../FUNCTHIS_ROADMAP.md). Do not start Cloud, a hosted runner, or a team registry until later phases are used for real.

## Continue as local open-source (default)

Stay local if any of:

- Fewer than ~20 external npm installs within ~4 weeks of launch
- No repeated multi-tool traces from outside the maintainer team
- Package test or secret-scrubbing regressions
- Users prefer the gateway without saving functions

## Reposition triggers

From [FUNCTHIS_ROADMAP.md](../FUNCTHIS_ROADMAP.md):

- **Compiler-first:** saved packages are valuable, MCP aggregation is not → emphasize `fn_save_function` / `fn_inspect_function` / git-owned packages
- **Gateway-first:** discovery is valuable, saved packages are optional → stay a local gateway unless users commit `packages/`

## Explicitly deferred

- Hosted runner, managed secrets, schedules, webhooks
- Team metadata, registry, SSO
- Cloud Code Mode
- Embeddings, desktop app, visual workflow editor

## Telemetry

Off by default. No account required for Skill or CLI.
