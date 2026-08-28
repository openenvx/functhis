# Functhis status

**What Functhis is:** a local MCP gateway that turns agent tool work into reusable TypeScript packages.

**What it is not:** Cloud, accounts, hosted runner, n8n, Caveman.

---

## Done

- MCP gateway (`fn serve`) with search, describe, call, recall, select
- Pointer envelopes for large results
- Sandboxed TypeScript (`fn_execute_code`)
- Packages (`fn_save_function`, `fn_install_function`, `fn_inspect_function`)
- Trace recording for upstream `fn_call` (`fn_inspect`, `fn_stats`)
- Trace recording for sandbox and package calls (sessionized runs)
- Trace inspect with dataflow (`fn_inspect`, `fn traces`)
- Trace compile brief + skeleton (`fn_compile_trace`, `fn traces compile`)
- Repeated-trace detection (`fn_candidates`, `fn traces candidates`, `fn traces compile-group`)
- Function verification with replay mode (`fn_test_function`, `fn functions test`)
- Output schema validation during verify
- Replay fixtures on trace-based save (`packages/<name>/tests/replay.fixture.json`)
- Per-function stats with live vs replay verification counts and labeled estimates
- Bounded trace retention (`.functhis/settings.json`)
- Graph nodes for `run`, `function`, and `uses_tool`
- Cross-kind graph search (`fn_search_context` — code, tools, functions, runs)
- Graph queries: functions/runs by tool, symbol+tool subgraph, duplicates, schema drift impact
- Write-capable save safety (`dryRun`, `approveWrites`, `review-required` packages)
- `fn_describe` for saved packages and upstream tools
- Hot-register read-only packages after save/install
- Auto `client` metadata from MCP `clientInfo`
- Repo + MCP knowledge graph (`fn_index`, `fn_search_context`)
- Skill / plugin install with no account

**Workflow:**

```text
observe → inspect → compile → verify → save → reuse → measure
```

**Artifact:**

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
  tests/
```

---

## Deferred

- System-tool tracking for non-gateway native tools
- Optional hosted package catalog (not required for local use)

See [roadmap.md](roadmap.md) for scope boundaries.
