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
- Function verification with replay mode (`fn_test_function`, `fn functions test`)
- Per-function and per-tool stats (`fn_stats --function`, `fn stats --tool`)
- Bounded trace retention (`.functhis/settings.json`)
- Graph nodes for `run`, `function`, and `uses_tool`
- `fn_describe` for saved packages and upstream tools
- Hot-register packages after save/install (no gateway restart)
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
```

---

## Next

| Phase | Work |
| --- | --- |
| R3 Detect | `fn_candidates`; suggest repeated traces (no silent codegen) |
| R4 Measure | Richer per-package live vs replayed stats in graph queries |

Pattern detection is not built yet. See [roadmap.md](roadmap.md) for what's left.
