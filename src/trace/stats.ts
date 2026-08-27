import { encode } from 'gpt-tokenizer';

import { DEFAULT_CONTEXT_BUDGET_BYTES } from '../output';
import { listTraces } from './store';

const META_TOOL_SCHEMA_TOKENS_ESTIMATE = 124;

export interface StatsSummary {
  runCount: number;
  callCount: number;
  succeededCalls: number;
  failedCalls: number;
  deniedCalls: number;
  timeoutCalls: number;
  truncatedCalls: number;
  totalDurationMs: number;
  functionCalls: number;
  upstreamCalls: number;
  storedResultBytes: number;
  returnedResultBytes: number;
  estimatedResultBytesSaved: number;
}

export interface GatewayStats extends StatsSummary {
  catalogToolCount: number;
  contextBudgetBytes: number;
  directSchemaTokensEstimate: number;
  discoverySchemaTokensEstimate: number;
  estimatedSchemaTokensSaved: number;
  functionCount: number;
  labels: {
    resultBytes: 'estimated';
    schemaTokens: 'estimated';
  };
}

export async function computeStats(configDir: string): Promise<StatsSummary> {
  const traces = await listTraces(configDir);
  const summary: StatsSummary = {
    callCount: 0,
    deniedCalls: 0,
    estimatedResultBytesSaved: 0,
    failedCalls: 0,
    functionCalls: 0,
    returnedResultBytes: 0,
    runCount: traces.length,
    storedResultBytes: 0,
    succeededCalls: 0,
    timeoutCalls: 0,
    totalDurationMs: 0,
    truncatedCalls: 0,
    upstreamCalls: 0,
  };

  for (const trace of traces) {
    for (const call of trace.calls) {
      summary.callCount += 1;
      summary.totalDurationMs += call.durationMs;
      if (call.status === 'succeeded') {
        summary.succeededCalls += 1;
      } else if (call.status === 'denied') {
        summary.deniedCalls += 1;
      } else if (call.status === 'timeout') {
        summary.timeoutCalls += 1;
      } else if (call.status === 'failed') {
        summary.failedCalls += 1;
      }
      if (call.truncated) {
        summary.truncatedCalls += 1;
      }
      if (call.storedBytes !== undefined) {
        summary.storedResultBytes += call.storedBytes;
      }
      if (call.returnedBytes !== undefined) {
        summary.returnedResultBytes += call.returnedBytes;
      }
      if (
        call.storedBytes !== undefined &&
        call.returnedBytes !== undefined &&
        call.storedBytes > call.returnedBytes
      ) {
        summary.estimatedResultBytesSaved +=
          call.storedBytes - call.returnedBytes;
      }
      if (call.toolFingerprint === 'function') {
        summary.functionCalls += 1;
      } else if (call.status === 'succeeded' || call.status === 'failed') {
        summary.upstreamCalls += 1;
      }
    }
  }

  return summary;
}

function estimateDirectSchemaTokens(catalogToolCount: number): number {
  const averageToolSchemaBytes = 64;
  return Math.max(
    catalogToolCount * averageToolSchemaBytes,
    catalogToolCount > 0
      ? encode(JSON.stringify({ tools: catalogToolCount })).length
      : 0
  );
}

export async function computeGatewayStats(
  configDir: string,
  options: {
    catalogToolCount: number;
    functionCount: number;
    catalogTools?: {
      name: string;
      description?: string;
      inputSchema: unknown;
    }[];
  }
): Promise<GatewayStats> {
  const summary = await computeStats(configDir);
  const directSchemaTokensEstimate = options.catalogTools
    ? encode(JSON.stringify(options.catalogTools)).length
    : estimateDirectSchemaTokens(
        options.catalogToolCount + options.functionCount
      );
  const discoverySchemaTokensEstimate = META_TOOL_SCHEMA_TOKENS_ESTIMATE;
  const estimatedSchemaTokensSaved = Math.max(
    0,
    directSchemaTokensEstimate - discoverySchemaTokensEstimate
  );

  return {
    ...summary,
    catalogToolCount: options.catalogToolCount,
    contextBudgetBytes: DEFAULT_CONTEXT_BUDGET_BYTES,
    directSchemaTokensEstimate,
    discoverySchemaTokensEstimate,
    estimatedSchemaTokensSaved,
    functionCount: options.functionCount,
    labels: {
      resultBytes: 'estimated',
      schemaTokens: 'estimated',
    },
  };
}
