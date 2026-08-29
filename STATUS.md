# Functhis status

**What Functhis is:** a fully autonomous local MCP gateway that learns repeated tool flows and crystallizes them into reusable TypeScript packages — without user prompts in the normal path.

**What it is not:** Cloud, accounts, hosted runner, n8n, Caveman.

---

## Done

- MCP gateway (`fn serve`) with search, describe, call, recall, select
- Pointer envelopes for large results
- Sandboxed TypeScript (`fn_execute_code`) and sandbox-only package execution
- **Full autonomous learning** — state machine: observe → candidate → compile → verify → policy → stage → promote/quarantine
- Async learning worker (non-blocking finalize) with pause/resume API
- Durable event log (`.functhis/events.jsonl`) and per-session `RunManager`
- Learning state v2 (`.functhis/learning.json`) with jobs, crystallized packages, atomic saves
- Write policy (`learning.writePolicy`, `learning.allowedWriteTools`) with automatic quarantine
- Transactional package staging/promotion (`.staging/`, lifecycle in manifest)
- System capability broker (`system.read_file`, `system.write_file`, `system.exec`)
- Transient read retries on upstream calls
- Packages (`fn_save_function`, `fn_install_function`, `fn_inspect_function`) for manual overrides
- Trace recording for upstream `fn_call` (`fn_inspect`, `fn_stats`)
- Trace recording for sandbox, system capabilities, and package calls (sessionized runs)
- Trace inspect with dataflow (`fn_inspect`, `fn traces`)
- Trace compile brief + skeleton (`fn_compile_trace`, `fn traces compile`)
- Repeated-trace detection (`fn_candidates`, `fn traces candidates`, `fn traces compile-group`, `fn_compile_group`)
- Function verification with replay mode (`fn_test_function`, `fn functions test`)
- Output schema validation during verify
- Replay fixtures on trace-based save (`packages/<name>/tests/replay.fixture.json`)
- Per-function stats with live vs replay verification counts and labeled estimates
- Bounded trace retention (`.functhis/settings.json`)
- Graph nodes for `run`, `function`, and `uses_tool`
- Cross-kind graph search (`fn_search_context` — code, tools, functions, runs)
- Graph queries: functions/runs by tool, symbol+tool subgraph, duplicates, schema drift impact
- Write-capable packages visible in search with lifecycle/policy metadata
- `fn_describe` for saved packages and upstream tools
- Hot-register active read-only packages after promote/install
- Package tool list reconciliation from filesystem index
- Auto `client` metadata from MCP `clientInfo`
- Repo + MCP knowledge graph (`fn_index`, `fn_search_context`)
- Skill / plugin install with no account
- Learning control API: `fn_learning_status`, `fn_learning_pause`, `fn_learning_resume`

**Autonomous workflow:**

```text
observe → detect → compile → verify → policy → stage → promote → index → reuse
```

Outcomes: **`promoted`** or **`quarantined`** only.

**Artifact:**

```text
packages/auto-<flow>/
  function.ts
  functhis.json
  functhis.lock
  tests/
```

---

## Limits (current)

- Direct MCP bypasses (client calls upstream without Functhis proxy) are not observed — must be explicitly marked
- HTTP/SSE and remote MCP servers are skipped on import (stdio only); doctor warns, does not fail
- Repo graph indexes TypeScript only (`tsconfig.json`); other languages are not parsed
- `fn_learning_pause` is an emergency control, not part of normal workflow
- Write autonomous promotion requires pre-configured scoped policy; otherwise flows quarantine automatically

---

## Deferred

- Optional hosted package catalog (not required for local use)
- Full direct-MCP proxy for all clients

See [roadmap.md](roadmap.md) for scope boundaries.
