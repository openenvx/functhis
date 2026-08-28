# Functhis Roadmap

Local OSS only — no Cloud, accounts, or hosted runner.

## Product loop

```text
observe → detect → compile → verify → measure
```

**Today:** gateway + sandbox + manual save (`fn_save_function`).

**Not built:** pattern detection, trace compile, package fixtures/tests, per-function stats.

## Phases

| Phase | Goal |
| --- | --- |
| R1 Observe | Trace sandbox/package calls; sessionize runs; `fn_describe` for packages; hot-register after save |
| R2 Verify | Write fixtures on save; package test runner; graph `function` / `uses_tool` nodes |
| R3 Detect + compile | `fn_candidates`; compile repeated work into packages; user confirms |
| R4 Measure | Per-package stats labeled estimated / live |

## Package layout

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
  tests/           # R2: real fixtures
```

Share by committing `packages/` or `fn_install_function --approve` from a path.

## Keep building on

Gateway, pointer envelopes, traces, sandbox, packages, graph (supporting search), Skill/plugins.

## Out of scope

Cloud, HTTP gateway, team SaaS, marketplace, visual workflow builder.

See [STATUS.md](STATUS.md) for current capability checklist.
