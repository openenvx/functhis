# Functhis Roadmap

Local OSS only — no Cloud, accounts, or hosted runner.

## Product loop

```text
observe → detect → compile → verify → policy → stage → promote → reuse → measure
```

**Functhis is fully autonomous by default.** The gateway records work, detects repeated flows, evaluates policy, and crystallizes packages without user prompts. Outcomes are `promoted` or `quarantined`. Agents should prefer learned packages from `fn_search`.

---

## Shipped

| Capability | Surface |
| --- | --- |
| Autonomous learning | Async worker, state machine, `.functhis/learning.json`, `learning` settings |
| Learning control | `fn_learning_status`, `fn_learning_pause`, `fn_learning_resume` |
| Durable observation | Per-session `RunManager`, `.functhis/events.jsonl`, atomic trace writes |
| Write policy | `learning.writePolicy`, `learning.allowedWriteTools`, auto-quarantine |
| System capabilities | `system.read_file`, `system.write_file`, `system.exec` via broker |
| Transactional packages | Staging dir, lifecycle in manifest, promote/quarantine |
| Trace recording | Automatic on `fn_call`, sandbox, system, and package runs |
| Inspect + dataflow | `fn_inspect`, `fn traces list\|inspect` |
| Compile | `fn_compile_trace`, `fn traces compile` |
| Detect | `fn_candidates`, `fn_compile_group`, `fn traces candidates\|compile-group` |
| Verify | `fn_test_function`, replay / live, output schema enforcement |
| Save + reuse | `fn_save_function` (manual override), hot-register active read-only packages |
| Measure | `fn_stats` with live vs replay verification counts and labeled estimates |
| Retention | `.functhis/settings.json` (default 200 runs / 30 days) |
| Graph search | `fn_search_context` across code, tools, functions, and runs |
| Graph queries | `toolId`, `query`+`toolId`, `requiredTools`, `schemaDrift` |
| Security | Sandbox-only package execution, transient read retries, no write retry without idempotency |

**Package layout:**

```text
packages/auto-<flow>/
  function.ts
  functhis.json
  functhis.lock
  tests/
    replay.fixture.json
```

Share by committing `packages/` or `fn_install_function --approve` from a path.

---

## Later / deferred

- Direct-MCP proxy for all clients (when intercept is possible)
- Hosted package catalog (optional; local gateway does not depend on it)

---

## Out of scope

Cloud, HTTP gateway, team SaaS, marketplace, visual workflow builder, remote registry, telemetry, hosted execution, billing.

---

See [STATUS.md](STATUS.md) for the current capability checklist.
