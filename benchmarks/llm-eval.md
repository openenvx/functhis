# Functhis LLM eval (FnBench wrap suite)

Label: `benchmark_counterfactual`. Provider usage from Cursor SDK (`inputTokens + cacheRead + cacheWrite`).

**Note:** SDK turn tokens often look flat between Direct and Compiled — fixed agent + MCP schema cost (~20k+) dominates one-shot tasks. See **Payload-level** below for tool-body savings.

Model: gpt-5.6-luna
Runs per case per LLM arm: 1
Generated: 2026-08-27T12:22:04.013Z

## Aggregate (held-quality pairs only for savings)

| Metric | Direct | Compiled (prebuilt) |
|---|---:|---:|
| Provider input tokens (sum) | 0 | 0 |
| Reduction vs direct | baseline | 0.0% |

## Per-case results

| Case | Shape | Direct input | Compiled input | Reduction | Direct Q | Compiled Q | Replay ms | Replay Q |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| sre-log-needle | log | 0 | 0 | n/a% | 0/1 | 0/1 | 45.7 | 1/1 |
| deployment-json-drift | json | 0 | 0 | n/a% | 0/1 | 0/1 | 45.2 | 1/1 |
| fraud-csv-outlier | csv | 0 | 0 | n/a% | 0/1 | 0/1 | 51.0 | 1/1 |
| test-output-failure | test-output | 0 | 0 | n/a% | 0/1 | 0/1 | 47.5 | 1/1 |
| config-yaml-drift | yaml | 0 | 0 | n/a% | 0/1 | 0/1 | 55.1 | 1/1 |
| dashboard-html-alert | html | 0 | 0 | n/a% | 0/1 | 0/1 | 59.9 | 1/1 |
## Payload-level (offline — what actually differs)

Cursor SDK `inputTokens` includes agent scaffolding, MCP schemas, and prompts — not just tool bodies. This table measures **tool output bytes** on the same fnbench fixtures.

| Case | Direct tool bytes | Gateway envelope bytes | Compiled output bytes | Compiled reduction |
|---|---:|---:|---:|---:|
| sre-log-needle | 70692 | 285 | 68 | 99.9% |
| deployment-json-drift | 66003 | 314 | 71 | 99.9% |
| fraud-csv-outlier | 75062 | 303 | 45 | 99.9% |
| test-output-failure | 70173 | 435 | 75 | 99.9% |
| config-yaml-drift | 71378 | 321 | 43 | 99.9% |
| dashboard-html-alert | 71716 | 379 | 54 | 99.9% |
| **sum** | **425024** | **2037** | **356** | **99.9%** |

Gateway envelope reduction vs raw tool: **99.5%** (Functhis discovery path).
Compiled reduction is where crystallize pays off; SDK turn totals may look flat when fixed costs dominate a one-shot task.


## Method

- Six immutable MCP fixtures (60–95 KB each), Caveman wrap shapes.
- Direct arm: fnbench MCP tools only (baseline).
- Compiled arm: prebuilt Functions in `fixtures/benchmark/functions/` (steady-state after crystallize).
- Optional Functhis discovery arm: `FUNCTHIS_BENCHMARK_ARMS=direct,functhis,compiled`.
- Replay arm: Function runner, zero model tokens.
- Exact JSON oracle on assistant final text.

See [docs/BENCHMARK.md](../docs/BENCHMARK.md).
