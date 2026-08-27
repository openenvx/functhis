import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Agent } from '@cursor/sdk';
import type { SDKAgent, TokenUsage } from '@cursor/sdk';

import { FNBENCH_CASES } from '../fixtures/benchmark/cases';
import type { FnbenchCase } from '../fixtures/benchmark/cases';
import {
  COMPILED_SYSTEM_PROMPT,
  DIRECT_SYSTEM_PROMPT,
  fnbenchMcpServer,
  FUNCTHIS_SYSTEM_PROMPT,
  functhisMcpServer,
  getPackageRoot,
  withBenchmarkConfigDir,
} from './benchmark/config';
import { evaluateOracle } from './benchmark/oracle';
import {
  formatPayloadMetricsSection,
  measurePayloadMetrics,
} from './benchmark/payload-metrics';
import type { PayloadMetricRow } from './benchmark/payload-metrics';
import { runReplayCase } from './benchmark/replay';
import {
  getBenchmarkFunctionsDir,
  syncBenchmarkFunctions,
} from './benchmark/sync-functions';

type Arm = 'direct' | 'functhis' | 'compiled' | 'replay';

interface RunRecord {
  arm: Arm;
  caseId: string;
  rep: number;
  passed: boolean;
  latencyMs: number;
  primaryInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  error?: string;
  toolCalls?: string[];
}

interface CaseAggregate {
  caseId: string;
  shape: FnbenchCase['shape'];
  directInput: number;
  functhisInput: number;
  compiledInput: number;
  directQuality: number;
  functhisQuality: number;
  compiledQuality: number;
  replayLatencyMs: number;
  replayQuality: number;
}

function primaryInputTokens(usage: TokenUsage | undefined): number {
  if (!usage) {
    return 0;
  }
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

function parseArms(): Arm[] {
  if (process.argv.includes('--quick')) {
    return ['direct', 'compiled'];
  }
  const raw = process.env.FUNCTHIS_BENCHMARK_ARMS ?? 'direct,compiled';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is Arm =>
      ['direct', 'functhis', 'compiled', 'replay'].includes(value)
    );
}

function compiledCasePrompt(caseDef: FnbenchCase): string {
  return [
    `Call the Functhis Function \`${caseDef.id}\` exactly once with no arguments.`,
    `Reply with ONLY: ${JSON.stringify(caseDef.oracle)}.`,
    'No markdown, no explanation.',
  ].join(' ');
}

function systemPromptForArm(arm: 'direct' | 'functhis' | 'compiled'): string {
  if (arm === 'direct') {
    return DIRECT_SYSTEM_PROMPT;
  }
  if (arm === 'compiled') {
    return COMPILED_SYSTEM_PROMPT;
  }
  return FUNCTHIS_SYSTEM_PROMPT;
}

function parseCases(): FnbenchCase[] {
  if (process.argv.includes('--quick')) {
    return FNBENCH_CASES.filter((caseDef) => caseDef.id === 'sre-log-needle');
  }
  const filter = process.env.FUNCTHIS_BENCHMARK_CASES?.trim();
  if (!filter) {
    return FNBENCH_CASES;
  }
  const ids = new Set(filter.split(',').map((value) => value.trim()));
  return FNBENCH_CASES.filter((caseDef) => ids.has(caseDef.id));
}

function parseRuns(): number {
  if (process.argv.includes('--quick')) {
    return 1;
  }
  const value = Number(process.env.FUNCTHIS_LLM_RUNS ?? '1');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getApiKey(): string | undefined {
  return process.env.CURSOR_API_KEY ?? process.env.FUNCTHIS_LLM_API_KEY;
}

async function resolveApiKey(): Promise<string> {
  const existing = getApiKey();
  if (existing) {
    return existing;
  }
  const { Cursor } = await import('@cursor/sdk');
  const login = await Cursor.auth.login();
  return login.apiKey;
}

function extractAssistantText(result: {
  result?: string;
  messages?: { role?: string; content?: string }[];
}): string {
  if (result.result?.trim()) {
    return result.result;
  }
  const messages = result.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.content?.trim()) {
      return message.content;
    }
  }
  return '';
}

async function runLlmArm(options: {
  agent: SDKAgent;
  arm: 'direct' | 'functhis' | 'compiled';
  caseDef: FnbenchCase;
  rep: number;
}): Promise<RunRecord> {
  const startMs = performance.now();
  const systemPrefix = systemPromptForArm(options.arm);
  const taskPrompt =
    options.arm === 'compiled'
      ? compiledCasePrompt(options.caseDef)
      : options.caseDef.prompt;
  const prompt = `${systemPrefix}\n\n${taskPrompt}`;

  try {
    const run = await options.agent.send(prompt, { local: { force: true } });
    const result = await run.wait();

    const assistantText = extractAssistantText(
      result as {
        result?: string;
        messages?: { role?: string; content?: string }[];
      }
    );
    const evaluation = evaluateOracle(assistantText, options.caseDef.oracle);

    return {
      arm: options.arm,
      caseId: options.caseDef.id,
      error: evaluation.error,
      latencyMs: performance.now() - startMs,
      outputTokens: result.usage?.outputTokens,
      passed: evaluation.passed,
      primaryInputTokens: primaryInputTokens(result.usage),
      rep: options.rep,
      totalTokens: result.usage?.totalTokens,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      arm: options.arm,
      caseId: options.caseDef.id,
      error: message,
      latencyMs: performance.now() - startMs,
      passed: false,
      rep: options.rep,
    };
  }
}

async function createLlmAgent(options: {
  apiKey: string;
  arm: 'direct' | 'functhis' | 'compiled';
  configPath: string;
  functionsDir?: string;
  modelId: string;
  packageRoot: string;
}): Promise<SDKAgent> {
  const mcpServers =
    options.arm === 'direct'
      ? { fnbench: fnbenchMcpServer(options.packageRoot) }
      : {
          functhis: functhisMcpServer(
            options.packageRoot,
            options.configPath,
            options.functionsDir
          ),
        };

  return Agent.create({
    apiKey: options.apiKey,
    local: { cwd: options.packageRoot, settingSources: [] },
    mcpServers,
    model: { id: options.modelId },
    name: `functhis-bench-${options.arm}`,
    tools: ['mcp'],
  });
}

async function closeAgent(agent: SDKAgent): Promise<void> {
  await agent[Symbol.asyncDispose]();
}

function aggregateCases(
  records: RunRecord[],
  cases: FnbenchCase[]
): CaseAggregate[] {
  return cases.map((caseDef) => {
    const directRuns = records.filter(
      (record) => record.arm === 'direct' && record.caseId === caseDef.id
    );
    const functhisRuns = records.filter(
      (record) => record.arm === 'functhis' && record.caseId === caseDef.id
    );
    const compiledRuns = records.filter(
      (record) => record.arm === 'compiled' && record.caseId === caseDef.id
    );
    const replayRuns = records.filter(
      (record) => record.arm === 'replay' && record.caseId === caseDef.id
    );

    return {
      caseId: caseDef.id,
      compiledInput: compiledRuns.reduce(
        (sum, record) => sum + (record.primaryInputTokens ?? 0),
        0
      ),
      compiledQuality: compiledRuns.filter((record) => record.passed).length,
      directInput: directRuns.reduce(
        (sum, record) => sum + (record.primaryInputTokens ?? 0),
        0
      ),
      directQuality: directRuns.filter((record) => record.passed).length,
      functhisInput: functhisRuns.reduce(
        (sum, record) => sum + (record.primaryInputTokens ?? 0),
        0
      ),
      functhisQuality: functhisRuns.filter((record) => record.passed).length,
      replayLatencyMs: replayRuns.reduce(
        (sum, record) => sum + record.latencyMs,
        0
      ),
      replayQuality: replayRuns.filter((record) => record.passed).length,
      shape: caseDef.shape,
    };
  });
}

function formatReport(options: {
  aggregates: CaseAggregate[];
  arms: Arm[];
  modelId: string;
  payloadMetrics: PayloadMetricRow[];
  records: RunRecord[];
  runsPerArm: number;
}): string {
  const directTotal = options.aggregates.reduce(
    (sum, row) => sum + row.directInput,
    0
  );
  const functhisTotal = options.aggregates.reduce(
    (sum, row) => sum + row.functhisInput,
    0
  );
  const compiledTotal = options.aggregates.reduce(
    (sum, row) => sum + row.compiledInput,
    0
  );
  const includeDiscovery = options.arms.includes('functhis');
  const compiledReduction =
    directTotal > 0 ? (1 - compiledTotal / directTotal) * 100 : 0;

  const lines = [
    '# Functhis LLM eval (FnBench wrap suite)',
    '',
    'Label: `benchmark_counterfactual`. Provider usage from Cursor SDK (`inputTokens + cacheRead + cacheWrite`).',
    '',
    '**Note:** SDK turn tokens often look flat between Direct and Compiled — fixed agent + MCP schema cost (~20k+) dominates one-shot tasks. See **Payload-level** below for tool-body savings.',
    '',
    `Model: ${options.modelId}`,
    `Runs per case per LLM arm: ${options.runsPerArm}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Aggregate (held-quality pairs only for savings)',
    '',
  ];

  if (includeDiscovery) {
    const discoveryReduction =
      directTotal > 0 ? (1 - functhisTotal / directTotal) * 100 : 0;
    lines.push(
      '| Metric | Direct | Functhis (discovery) | Compiled (prebuilt) |',
      '|---|---:|---:|---:|',
      `| Provider input tokens (sum) | ${directTotal} | ${functhisTotal} | ${compiledTotal} |`,
      `| Reduction vs direct | baseline | ${discoveryReduction.toFixed(1)}% | ${compiledReduction.toFixed(1)}% |`
    );
  } else {
    lines.push(
      '| Metric | Direct | Compiled (prebuilt) |',
      '|---|---:|---:|',
      `| Provider input tokens (sum) | ${directTotal} | ${compiledTotal} |`,
      `| Reduction vs direct | baseline | ${compiledReduction.toFixed(1)}% |`
    );
  }

  lines.push('', '## Per-case results', '');

  if (includeDiscovery) {
    lines.push(
      '| Case | Shape | Direct input | Functhis input | Compiled input | Compiled reduction | Direct Q | Functhis Q | Compiled Q | Replay ms | Replay Q |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
    );
  } else {
    lines.push(
      '| Case | Shape | Direct input | Compiled input | Reduction | Direct Q | Compiled Q | Replay ms | Replay Q |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|'
    );
  }

  for (const row of options.aggregates) {
    const caseCompiledReduction =
      row.directInput > 0
        ? ((1 - row.compiledInput / row.directInput) * 100).toFixed(1)
        : 'n/a';
    if (includeDiscovery) {
      lines.push(
        `| ${row.caseId} | ${row.shape} | ${row.directInput} | ${row.functhisInput} | ${row.compiledInput} | ${caseCompiledReduction}% | ${row.directQuality}/${options.runsPerArm} | ${row.functhisQuality}/${options.runsPerArm} | ${row.compiledQuality}/${options.runsPerArm} | ${row.replayLatencyMs.toFixed(1)} | ${row.replayQuality}/${options.runsPerArm} |`
      );
    } else {
      lines.push(
        `| ${row.caseId} | ${row.shape} | ${row.directInput} | ${row.compiledInput} | ${caseCompiledReduction}% | ${row.directQuality}/${options.runsPerArm} | ${row.compiledQuality}/${options.runsPerArm} | ${row.replayLatencyMs.toFixed(1)} | ${row.replayQuality}/${options.runsPerArm} |`
      );
    }
  }

  const failures = options.records.filter((record) => !record.passed);
  if (failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of failures) {
      lines.push(
        `- ${failure.arm} ${failure.caseId} rep ${failure.rep}: ${failure.error ?? 'oracle mismatch'}`
      );
    }
  }

  lines.push(...formatPayloadMetricsSection(options.payloadMetrics));

  lines.push(
    '',
    '## Method',
    '',
    '- Six immutable MCP fixtures (60–95 KB each), Caveman wrap shapes.',
    '- Direct arm: fnbench MCP tools only (baseline).',
    '- Compiled arm: prebuilt Functions in `fixtures/benchmark/functions/` (steady-state after crystallize).',
    '- Optional Functhis discovery arm: `FUNCTHIS_BENCHMARK_ARMS=direct,functhis,compiled`.',
    '- Replay arm: Function runner, zero model tokens.',
    '- Exact JSON oracle on assistant final text.',
    '',
    'See [docs/BENCHMARK.md](../docs/BENCHMARK.md).'
  );

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const packageRoot = getPackageRoot();
  const arms = parseArms();
  const cases = parseCases();
  const runsPerArm = parseRuns();
  const modelId = process.env.FUNCTHIS_LLM_MODEL ?? 'gpt-5.6-luna';
  const dryRun = process.argv.includes('--dry-run');
  const quick = process.argv.includes('--quick');
  const records: RunRecord[] = [];
  const functionsDir = getBenchmarkFunctionsDir(packageRoot);
  let payloadMetrics: PayloadMetricRow[] = [];

  const llmRuns =
    (arms.includes('direct') ? 1 : 0) +
    (arms.includes('functhis') ? 1 : 0) +
    (arms.includes('compiled') ? 1 : 0);
  const plannedLlmCalls = cases.length * runsPerArm * llmRuns;
  const runReplay = dryRun || arms.includes('replay');
  const plannedReplay = runReplay ? cases.length * runsPerArm : 0;

  console.log(
    [
      `Benchmark plan: ${cases.length} case(s), ${runsPerArm} rep(s)/arm`,
      `arms=[${arms.join(', ')}]`,
      dryRun ? 'mode=dry-run' : quick ? 'mode=quick' : 'mode=full',
      !dryRun && plannedLlmCalls > 0
        ? `~${plannedLlmCalls} Cursor agent turn(s) (2 agents reused, not ${plannedLlmCalls} cold starts)`
        : '',
      plannedReplay > 0 ? `${plannedReplay} replay call(s)` : '',
    ]
      .filter(Boolean)
      .join(' · ')
  );

  await withBenchmarkConfigDir(async ({ configPath }) => {
    if (arms.includes('compiled') || arms.includes('replay')) {
      console.log(`[sync] refreshing prebuilt Functions in ${functionsDir}…`);
      await syncBenchmarkFunctions({ configPath, functionsDir });
    }

    console.log('[payload] measuring tool-body bytes (offline)…');
    payloadMetrics = await measurePayloadMetrics(cases, configPath);

    if (runReplay) {
      for (const caseDef of cases) {
        for (let rep = 1; rep <= runsPerArm; rep += 1) {
          process.stdout.write(
            `[replay] ${caseDef.id} rep ${rep}/${runsPerArm}… `
          );
          const replay = await runReplayCase(caseDef, configPath);
          console.log(
            replay.passed
              ? `ok (${replay.latencyMs.toFixed(0)}ms)`
              : `fail (${replay.error ?? 'oracle'})`
          );
          records.push({
            arm: 'replay',
            caseId: caseDef.id,
            error: replay.error,
            latencyMs: replay.latencyMs,
            passed: replay.passed,
            rep,
          });
        }
      }
    }

    if (dryRun) {
      console.log('Dry run: replay arm complete. Skipping Cursor SDK arms.');
      return;
    }

    if (
      arms.includes('direct') ||
      arms.includes('functhis') ||
      arms.includes('compiled')
    ) {
      const apiKey = await resolveApiKey();
      let directAgent: SDKAgent | undefined;
      let functhisAgent: SDKAgent | undefined;
      let compiledAgent: SDKAgent | undefined;

      try {
        if (arms.includes('direct')) {
          console.log('[direct] starting agent (one-time)…');
          directAgent = await createLlmAgent({
            apiKey,
            arm: 'direct',
            configPath,
            modelId,
            packageRoot,
          });
        }
        if (arms.includes('functhis')) {
          console.log('[functhis] starting agent (one-time)…');
          functhisAgent = await createLlmAgent({
            apiKey,
            arm: 'functhis',
            configPath,
            modelId,
            packageRoot,
          });
        }
        if (arms.includes('compiled')) {
          console.log('[compiled] starting agent (one-time)…');
          compiledAgent = await createLlmAgent({
            apiKey,
            arm: 'compiled',
            configPath,
            functionsDir,
            modelId,
            packageRoot,
          });
        }

        for (const caseDef of cases) {
          for (let rep = 1; rep <= runsPerArm; rep += 1) {
            if (directAgent) {
              process.stdout.write(
                `[direct] ${caseDef.id} rep ${rep}/${runsPerArm}… `
              );
              const record = await runLlmArm({
                agent: directAgent,
                arm: 'direct',
                caseDef,
                rep,
              });
              console.log(
                record.passed
                  ? `ok (${(record.latencyMs / 1000).toFixed(0)}s, ${record.primaryInputTokens ?? 0} in tok)`
                  : `fail (${record.error ?? 'oracle'})`
              );
              records.push(record);
            }
            if (functhisAgent) {
              process.stdout.write(
                `[functhis] ${caseDef.id} rep ${rep}/${runsPerArm}… `
              );
              const record = await runLlmArm({
                agent: functhisAgent,
                arm: 'functhis',
                caseDef,
                rep,
              });
              console.log(
                record.passed
                  ? `ok (${(record.latencyMs / 1000).toFixed(0)}s, ${record.primaryInputTokens ?? 0} in tok)`
                  : `fail (${record.error ?? 'oracle'})`
              );
              records.push(record);
            }
            if (compiledAgent) {
              process.stdout.write(
                `[compiled] ${caseDef.id} rep ${rep}/${runsPerArm}… `
              );
              const record = await runLlmArm({
                agent: compiledAgent,
                arm: 'compiled',
                caseDef,
                rep,
              });
              console.log(
                record.passed
                  ? `ok (${(record.latencyMs / 1000).toFixed(0)}s, ${record.primaryInputTokens ?? 0} in tok)`
                  : `fail (${record.error ?? 'oracle'})`
              );
              records.push(record);
            }
          }
        }
      } finally {
        if (directAgent) {
          await closeAgent(directAgent);
        }
        if (functhisAgent) {
          await closeAgent(functhisAgent);
        }
        if (compiledAgent) {
          await closeAgent(compiledAgent);
        }
      }
    }
  });

  const aggregates = aggregateCases(records, cases);
  const report = formatReport({
    aggregates,
    arms,
    modelId,
    payloadMetrics,
    records,
    runsPerArm,
  });
  const reportPath = join(packageRoot, 'benchmarks', 'llm-eval.md');
  await mkdir(join(packageRoot, 'benchmarks'), { recursive: true });
  await writeFile(reportPath, report, 'utf-8');
  console.log(`Wrote ${reportPath}`);
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
