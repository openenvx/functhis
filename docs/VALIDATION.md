# Validation gates

Functhis M0–M6 local product work is complete. **Do not build Cloud, HTTP transport, or new feature surfaces until these gates are evaluated.**

## Continue as open-source only (default)

Stay on the local Skill + CLI + Function path if any of:

- Fewer than ~20 external npm installs within ~4 weeks of launch
- No repeated multi-tool traces from outside the maintainer team
- Replay correctness or secret scrubbing regressions
- Users prefer existing gateway-only tools without crystallization

## Start Cloud discovery (not implementation)

Begin **design-partner interviews and a single-tenant prototype** only when **all** of:

- [ ] ~20 external installations
- [ ] 3 external traces captured and compiled
- [ ] 30 successful replays on a non-maintainer Function
- [ ] ~10 production-agent developer interviews
- [ ] One team willing to pay for hosted execution (secrets, schedules, audit)

Cloud discovery means interviews + BYOC experiment — **not** multi-tenant SaaS.

## Explicitly deferred

Until gates pass:

- Hosted runner, managed secrets, schedules, webhooks
- Cloud Code Mode (`search`/`execute` sandbox)
- Local HTTP/streamable-HTTP gateway
- Arbitrary model-supplied JavaScript execution
- Embeddings, desktop app, visual workflow editor
- Broad client auto-import matrix

## Reposition triggers

From [FUNCTHIS_ROADMAP.md](../FUNCTHIS_ROADMAP.md) section 14:

- **Compiler-first:** replay valuable, MCP aggregation not → emphasize `fn this` / `fn test` / git-owned Functions
- **Gateway-first:** discovery valuable, replay not → stop claiming crystallization as primary value

## Telemetry

Off by default. No account required for Skill or CLI. Opt-in diagnostics only if users request them.
