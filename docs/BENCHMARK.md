# Functhis benchmark (FnBench wrap suite)

This benchmark measures whether Functhis reduces **provider-reported input tokens** on large MCP tool outputs while preserving **exact answer quality**. It follows the protocol described in [Caveman's WRAP-BENCHMARK](https://github.com/JuliusBrussee/caveman/blob/main/docs/WRAP-BENCHMARK.md), adapted for Functhis (gateway + replay) and run through the **Cursor SDK** from this repository.

## What it measures

| Arm | What runs | Primary metric |
| --- | --- | --- |
| **Direct** | Cursor agent with fnbench MCP tools only | Cursor `inputTokens + cacheReadTokens + cacheWriteTokens` (baseline) |
| **Compiled** | Cursor agent with prebuilt Functions (`fixtures/benchmark/functions/`) | Same usage buckets (**steady-state after crystallize**) |
| **Functhis** *(optional)* | Cursor agent with `fn serve` only (`fn_search` → `fn_call` → `fn_select`) | Discovery / first-run overhead — not the default savings claim |
| **Replay** *(optional)* | `fn run` via compiled Function — **no model** | Wall-clock latency only |

Six cases, same shapes as Caveman wrap: log, JSON, CSV, test output, YAML, HTML. Each fixture returns **60–95 KB** of tool output with a planted needle. The agent must return an **exact JSON oracle**.

Claim label: `benchmark_counterfactual`. This is not a customer invoice or production traffic sample.

## Run from Cursor (recommended)

1. Create an API key at [Cursor Dashboard → API Keys](https://cursor.com/dashboard/api).
2. In the **Cursor terminal** at the repo root:

**Fastest** (~2 agent turns, one case — Direct + Compiled):

```sh
export CURSOR_API_KEY="cursor_..."
bun run benchmark:llm:quick
```

**Smoke** (all 6 cases, 1 rep each, ~12 agent turns):

```sh
export CURSOR_API_KEY="cursor_..."
export FUNCTHIS_LLM_RUNS=1
bun run benchmark:llm
```

3. Full protocol (3 reps per case):

```sh
export FUNCTHIS_LLM_RUNS=3
bun run benchmark:llm
```

4. Read the report: [benchmarks/llm-eval.md](../benchmarks/llm-eval.md).

If `CURSOR_API_KEY` is unset, the script attempts `Cursor.auth.login()` (browser).

Default model: `gpt-5.6-luna` (GPT-5.6 Luna). Override with `FUNCTHIS_LLM_MODEL`.

Spend appears on [Cursor usage](https://cursor.com/dashboard/usage) under the SDK tag.

**Why it felt slow:** each LLM arm used to cold-start a new Cursor agent per turn. The harness reuses **one agent per arm** and prints progress per case. A full 6×3×2 run can still take **30–60+ minutes** — use `--quick` or `FUNCTHIS_LLM_RUNS=1` first.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CURSOR_API_KEY` | — | Cursor API key (or use `FUNCTHIS_LLM_API_KEY`) |
| `FUNCTHIS_LLM_RUNS` | `1` | Repetitions per case per LLM arm |
| `FUNCTHIS_LLM_MODEL` | `gpt-5.6-luna` | Cursor model id |
| `FUNCTHIS_BENCHMARK_ARMS` | `direct,compiled` | Comma-separated arms (`functhis` / `replay` optional; `--dry-run` for replay-only) |
| `FUNCTHIS_BENCHMARK_CASES` | all six | Optional case id filter |

### Flags

| Flag | Effect |
| --- | --- |
| `--quick` | One case (`sre-log-needle`), 1 rep, Direct + Compiled (~2 min) |
| `--dry-run` | Replay arm only, no Cursor API |

### Optional arms

```sh
# Discovery overhead (usually more tokens than direct on one-shot tasks)
export FUNCTHIS_BENCHMARK_ARMS="direct,functhis,compiled"

# Offline runner only
bun run benchmark:llm -- --dry-run
```

## Dry run (no API key)

Validates replay Functions and fixture sizes without calling Cursor:

```sh
bun run benchmark:llm -- --dry-run
```

## Prebuilt Functions

The **Compiled** arm uses Functions in `fixtures/benchmark/functions/`. Refresh them after changing fnbench fixtures:

```sh
bun run benchmark:sync-functions
```

The LLM harness also refreshes fingerprints automatically when the Compiled arm runs.

## CI (offline)

Fixture size and replay oracle checks run in normal tests:

```sh
bun run test test/benchmark/fnbench-fixtures.test.ts
```

Schema-token estimates (fake catalog) remain in `bun run benchmark` → [benchmarks/m1-discovery.md](../benchmarks/m1-discovery.md).

## What we do not claim

- M1 schema-token reduction as full-task savings.
- Discovery arm (`fn_search` → `fn_select`) as steady-state savings.
- Replay is free (upstream/local compute still applies).
- Universal savings — result applies to this pinned suite and Cursor runtime only.
- This Cursor Agent chat tab is a controlled A/B (use the SDK script instead).

## Cases

| Case id                 | Shape       | Tool                      |
| ----------------------- | ----------- | ------------------------- |
| `sre-log-needle`        | log         | `get_sre_log`             |
| `deployment-json-drift` | json        | `get_deployment_manifest` |
| `fraud-csv-outlier`     | csv         | `get_fraud_ledger`        |
| `test-output-failure`   | test-output | `get_ci_log`              |
| `config-yaml-drift`     | yaml        | `get_cluster_config`      |
| `dashboard-html-alert`  | html        | `get_status_page`         |

Fixtures live in [fixtures/servers/fnbench.ts](../fixtures/servers/fnbench.ts). Harness: [scripts/benchmark-llm.ts](../scripts/benchmark-llm.ts).
