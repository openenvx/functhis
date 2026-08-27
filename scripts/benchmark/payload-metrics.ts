import type { FnbenchCase } from '../../fixtures/benchmark/cases';
import {
  buildResultEnvelope,
  estimateTokensFromBytes,
  estimateUtf8Bytes,
} from '../../src/output';
import { runFunction } from '../../src/functions/runner';
import { loadConfig } from '../../src/storage/config';
import { UpstreamManager } from '../../src/upstream/manager';
import { buildBenchmarkFunctionDefinition } from './replay';

export interface PayloadMetricRow {
  caseId: string;
  compiledOutputBytes: number;
  compiledOutputTokens: number;
  directToolBytes: number;
  directToolTokens: number;
  gatewayEnvelopeBytes: number;
  gatewayEnvelopeTokens: number;
  payloadReductionPct: number;
}

function readToolPayload(
  result: Awaited<ReturnType<UpstreamManager['callTool']>>
): unknown {
  const text = result.content.find((entry) => entry.type === 'text')?.text;
  if (!text) {
    throw new Error('Tool returned no text content');
  }
  return JSON.parse(text) as unknown;
}

export async function measurePayloadMetrics(
  cases: FnbenchCase[],
  configPath: string
): Promise<PayloadMetricRow[]> {
  const config = await loadConfig(configPath);
  const manager = new UpstreamManager();
  const rows: PayloadMetricRow[] = [];

  try {
    await manager.connectAll(config.upstreams);

    for (const caseDef of cases) {
      const raw = await manager.callTool(caseDef.upstreamId, {});
      const parsed = readToolPayload(raw);
      const directToolBytes = estimateUtf8Bytes(parsed);

      const tool = manager.catalog.getTool(caseDef.upstreamId);
      if (!tool) {
        throw new Error(`Tool not found: ${caseDef.upstreamId}`);
      }

      const definition = buildBenchmarkFunctionDefinition(
        caseDef,
        tool.fingerprint
      );
      const compiled = await runFunction(definition, {}, manager);
      const compiledOutputBytes = estimateUtf8Bytes(compiled.output);

      const { returnedBytes: gatewayEnvelopeBytes } = buildResultEnvelope(
        parsed,
        { runId: 'benchmark-payload' }
      );

      const payloadReductionPct =
        directToolBytes > 0
          ? (1 - compiledOutputBytes / directToolBytes) * 100
          : 0;

      rows.push({
        caseId: caseDef.id,
        compiledOutputBytes,
        compiledOutputTokens: estimateTokensFromBytes(compiledOutputBytes),
        directToolBytes,
        directToolTokens: estimateTokensFromBytes(directToolBytes),
        gatewayEnvelopeBytes,
        gatewayEnvelopeTokens: estimateTokensFromBytes(gatewayEnvelopeBytes),
        payloadReductionPct,
      });
    }
  } finally {
    await manager.closeAll();
  }

  return rows;
}

export function formatPayloadMetricsSection(rows: PayloadMetricRow[]): string[] {
  if (rows.length === 0) {
    return [];
  }

  const directTotal = rows.reduce((sum, row) => sum + row.directToolBytes, 0);
  const compiledTotal = rows.reduce(
    (sum, row) => sum + row.compiledOutputBytes,
    0
  );
  const envelopeTotal = rows.reduce(
    (sum, row) => sum + row.gatewayEnvelopeBytes,
    0
  );
  const compiledReduction =
    directTotal > 0 ? (1 - compiledTotal / directTotal) * 100 : 0;
  const envelopeReduction =
    directTotal > 0 ? (1 - envelopeTotal / directTotal) * 100 : 0;

  const lines = [
    '## Payload-level (offline — what actually differs)',
    '',
    'Cursor SDK `inputTokens` includes agent scaffolding, MCP schemas, and prompts — not just tool bodies. This table measures **tool output bytes** on the same fnbench fixtures.',
    '',
    '| Case | Direct tool bytes | Gateway envelope bytes | Compiled output bytes | Compiled reduction |',
    '|---|---:|---:|---:|---:|',
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.caseId} | ${row.directToolBytes} | ${row.gatewayEnvelopeBytes} | ${row.compiledOutputBytes} | ${row.payloadReductionPct.toFixed(1)}% |`
    );
  }

  lines.push(
    `| **sum** | **${directTotal}** | **${envelopeTotal}** | **${compiledTotal}** | **${compiledReduction.toFixed(1)}%** |`,
    '',
    `Gateway envelope reduction vs raw tool: **${envelopeReduction.toFixed(1)}%** (Functhis discovery path).`,
    'Compiled reduction is where crystallize pays off; SDK turn totals may look flat when fixed costs dominate a one-shot task.',
    ''
  );

  return lines;
}
