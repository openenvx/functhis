# Architecture

Local process only. No hosted runner.

```text
Agent (Cursor, Claude, Codex, OpenCode)
        │  stdio MCP
        ▼
  fn serve  ── meta-tools (fn_search, fn_call, …)
        │
        ├── TraceRecorder + RunManager     .functhis/runs/, events.jsonl
        ├── LearningWorker (async)         detect → compile → verify → promote
        ├── GraphService (SQLite)          TypeScript symbols + MCP tools
        ├── UpstreamManager                stdio MCP children
        └── Sandbox                        forked child + capability broker
                    │
                    └── packages/<name>/function.ts
```

## Gateway

`src/mcp/gateway.ts` loads `upstreams.json`, connects stdio servers, indexes MCP tools into the graph, optionally indexes the TypeScript repo (skipped without `tsconfig.json`), and registers:

- Meta-tools — search, describe, call, select/recall, stats, learning control
- Graph tools — `fn_index`, `fn_search_context`, `fn_subgraph`
- Package tools — execute, save, install, inspect, plus one tool per active package

Large `fn_call` results persist as evidence and return a [pointer envelope](MCP.md).

## Sandbox

`fn_execute_code` and package runs transpile guest TypeScript (`esbuild` / `ts-morph` path in `src/sandbox/`) and `fork` a child with `--permission` and an empty `env`. The child may only call tools on its allowlist via IPC to `CapabilityBroker` on the host. Broker enforces deny-unknown / deny-write policy and records calls.

System capabilities (`system.read_file`, `system.write_file`, `system.exec`) also go through the broker.

## Learning

After each successful gateway run finalize, `LearningWorker` enqueues the trace (`src/learning/`). Repeated sequences (see [SETTINGS.md](SETTINGS.md)) compile a brief + skeleton, replay-verify, apply write policy, stage, then promote or quarantine. Outcomes are never “waiting for approval.”

## Graph

SQLite under the config dir. Repo indexer (`src/graph/index-repo.ts`) walks TypeScript via `tsconfig.json`. MCP catalog, saved packages, and runs are additional node kinds. Search returns a compact subgraph (~6 KiB budget).

## Observation limit

Only traffic through `fn serve` is recorded. HTTP/SSE MCP servers are not imported. Client tools that still call upstreams directly are unobservable.

## Related

- [PACKAGES.md](PACKAGES.md) — on-disk package contract
- [SETTINGS.md](SETTINGS.md) — learning and retention
- [MCP.md](MCP.md) — envelope fields
