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
- Repo + MCP knowledge graph (`fn_index`, `fn_search_context`)
- Skill / plugin install with no account

**Artifact:**

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
```

---

## Next

| Phase | Work |
| --- | --- |
| R1 Observe | Trace sandbox/package calls; sessionize runs; `fn_describe` packages; hot-register after save |
| R2 Verify | Package fixtures on save; package test runner; graph `function` nodes |
| R3 Detect | `fn_candidates`; compile repeated traces → package |
| R4 Measure | Per-package stats (estimated / live) |

Today Functhis is **gateway + sandbox + save file**. Pattern detection and trace compile are not built yet.
