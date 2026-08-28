# Functhis Roadmap

Local OSS only — no Cloud, accounts, or hosted runner.

## Product loop

```text
observe → inspect → compile → verify → save → reuse → measure
```

**The local product loop is complete.** Observe through measure works end to end with graph-backed discovery, detect, verify, and labeled stats.

Functhis only observes MCP calls routed through its gateway — not shell, native file tools, or MCP servers the client calls directly.

---

## Shipped

| Capability | Surface |
| --- | --- |
| Trace recording | Automatic on `fn_call`, sandbox, and package runs |
| Inspect + dataflow | `fn_inspect`, `fn traces list\|inspect` |
| Compile | `fn_compile_trace`, `fn traces compile` |
| Detect | `fn_candidates`, `fn traces candidates\|compile-group` |
| Verify | `fn_test_function`, replay / live, output schema enforcement |
| Save + reuse | `fn_save_function` (dry-run / approveWrites), hot-register read-only packages |
| Measure | `fn_stats` with live vs replay verification counts and labeled estimates |
| Retention | `.functhis/settings.json` (default 200 runs / 30 days) |
| Graph search | `fn_search_context` across code, tools, functions, and runs |
| Graph queries | `toolId`, `query`+`toolId`, `requiredTools`, `schemaDrift` |
| Write safety | `review-required` packages, no hot-register until approved |

**Package layout:**

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
  tests/
    replay.fixture.json
```

Share by committing `packages/` or `fn_install_function --approve` from a path.

---

## Later / deferred

- System-tool tracking (`system.read_file`, etc.)
- Hosted package catalog (optional; local gateway does not depend on it)

---

## Out of scope

Cloud, HTTP gateway, team SaaS, marketplace, visual workflow builder, remote registry, telemetry, hosted execution, billing.

---

See [STATUS.md](STATUS.md) for the current capability checklist.
