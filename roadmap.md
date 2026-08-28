# Functhis Roadmap

Local OSS only — no Cloud, accounts, or hosted runner.

## Product loop

```text
observe → inspect → compile → verify → save → reuse → measure
```

**Phase 1 (vertical slice) is done.** The core loop works end to end. All integration tests pass, including compile → test (replay) → save → invoke.

Functhis only observes MCP calls routed through its gateway — not shell, native file tools, or MCP servers the client calls directly.

---

## Shipped today

| Capability | Surface |
| --- | --- |
| Trace recording | Automatic on `fn_call`, sandbox, and package runs |
| Inspect + dataflow | `fn_inspect`, `fn traces list\|inspect` |
| Compile | `fn_compile_trace`, `fn traces compile` |
| Verify | `fn_test_function`, `fn functions test` (replay / live) |
| Save + reuse | `fn_save_function`, hot-register, `<package-name>` |
| Measure | `fn_stats`, `fn stats --function\|--tool` |
| Retention | `.functhis/settings.json` (default 200 runs / 30 days) |
| Graph writes | `run`, `function`, `uses_tool` nodes on persist/save |

**Package layout:**

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
  tests/
```

Share by committing `packages/` or `fn_install_function --approve` from a path.

---

## What's left

### R3 — Detect (next big feature)

- `fn_candidates` for repeated trace patterns
- `fn traces compile-group <candidate-id>`
- Suggest only — **no silent codegen**
- Deterministic signals: normalized tool-id sequences, common subsequences, similar input shapes, schema fingerprints, shared dataflow structure, minimum occurrence threshold

### R4 — Measure polish

- Richer per-function stats: **live vs replayed vs estimated** (labeled honestly)
- Graph-backed queries, for example:
  - which functions use a given MCP tool
  - which functions are affected by tool schema drift
  - find an existing saved function before creating a duplicate

### Phase 2 — Graph integration

`fn_search_context` still searches only `file` / `symbol` — not `function` / `run` nodes (those are written, not searchable yet).

Planned queries from the product spec:

- find functions using a tool
- find duplicate functions before saving
- traces involving a repo symbol and an external tool
- show tools and code related to a domain concept

Optional trace metadata:

- auto-populate `client` from MCP `clientInfo`
- optional `sessionId` / `skillId` on traces (partially wired via `fn_call`)

### Phase 1 polish (smaller gaps)

| Item | Status |
| --- | --- |
| Output schema validation in `fn_test_function` | Field on manifest; not enforced during verify |
| Package fixtures on save (`packages/<name>/tests/`) | `tests/` dir created; no fixtures written |
| Integration test: large-payload envelope in compile flow | Covered elsewhere; not in compile e2e |
| Integration test: write-capable live test denied | Logic exists; no dedicated test |
| Auto `client` from MCP `clientInfo` | Schema supports `client`; gateway does not populate it |
| System-tool tracking (`system.read_file`, etc.) | Not built — intentionally deferred |
| Pre-existing lint in sandbox runner | `promise(avoid-new)` still fails `bun run check` |

### Write-function UX (later)

- Dry-run or explicit confirmation for write-capable functions
- `capabilities.writes: review-required` packages not hot-registered until approved

---

## Phases summary

| Phase | Goal | Status |
| --- | --- | --- |
| R1 Observe + compile | Trace record, inspect, compile, save | **Done** |
| R2 Verify | `fn_test_function`, replay broker, graph `function` / `run` nodes | **Done** |
| R3 Detect | `fn_candidates`; suggest repeated work; user confirms compile | Next |
| R4 Measure | Graph queries; live vs replayed labels | Planned |

---

## Out of scope

Cloud, HTTP gateway, team SaaS, marketplace, visual workflow builder, remote registry, telemetry, hosted execution, billing.

**Future possibilities (one sentence):** a hosted package catalog could make sharing easier; the local gateway does not depend on it.

---

See [STATUS.md](STATUS.md) for the current capability checklist.
