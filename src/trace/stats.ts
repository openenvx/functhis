import { encode } from 'gpt-tokenizer';

import { DEFAULT_CONTEXT_BUDGET_BYTES } from '../output';
import { isPackageToolId } from '../packages/paths';
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
  packageCalls: number;
  upstreamCalls: number;
  storedResultBytes: number;
  returnedResultBytes: number;
  estimatedResultBytesSaved: number;
}

export interface FunctionStats {
  averageDurationMs: number;
  estimatedContextTokensAvoided: number;
  estimatedIntermediateBytesAvoided: number;
  functionName: string;
  schemaStatus: 'compatible' | 'unknown';
  underlyingCalls: number;
  used: number;
}

export interface ToolStats {
  callCount: number;
  estimatedIntermediateBytes: number;
  estimatedIntermediateTokens: number;
  toolId: string;
}

export interface GatewayStats extends StatsSummary {
  catalogToolCount: number;
  contextBudgetBytes: number;
  directSchemaTokensEstimate: number;
  discoverySchemaTokensEstimate: number;
  estimatedSchemaTokensSaved: number;
  functionStats?: FunctionStats;
  packageCount: number;
  toolStats?: ToolStats;
  labels: {
    resultBytes: 'estimated';
    schemaTokens: 'estimated';
  };
}

export interface ComputeStatsOptions {
  functionName?: string;
  packageNames?: Set<string>;
  toolId?: string;
}

export async function computeStats(
  configDir: string,
  options: ComputeStatsOptions = {}
): Promise<StatsSummary> {
  const traces = await listTraces(configDir);
  const packageNames =
    options.packageNames ??
    new Set(options.functionName ? [options.functionName] : []);
  const summary: StatsSummary = {
    callCount: 0,
    deniedCalls: 0,
    estimatedResultBytesSaved: 0,
    failedCalls: 0,
    packageCalls: 0,
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
      if (options.functionName && call.toolId !== options.functionName) {
        continue;
      }
      if (options.toolId && call.toolId !== options.toolId) {
        continue;
      }

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
      if (isPackageToolId(call.toolId) && packageNames.has(call.toolId)) {
        summary.packageCalls += 1;
      } else if (call.status === 'succeeded' || call.status === 'failed') {
        if (!call.toolId.startsWith('fn_')) {
          summary.upstreamCalls += 1;
        }
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

export async function computeFunctionStats(
  configDir: string,
  functionName: string,
  options: { underlyingCalls?: number } = {}
): Promise<FunctionStats> {
  const summary = await computeStats(configDir, {
    functionName,
    packageNames: new Set([functionName]),
  });
  const used = summary.packageCalls;
  const averageDurationMs =
    used > 0 ? Math.round(summary.totalDurationMs / used) : 0;
  const estimatedIntermediateBytesAvoided = summary.estimatedResultBytesSaved;
  const estimatedContextTokensAvoided = Math.ceil(
    estimatedIntermediateBytesAvoided / 4
  );

  return {
    averageDurationMs,
    estimatedContextTokensAvoided,
    estimatedIntermediateBytesAvoided,
    functionName,
    schemaStatus: 'compatible',
    underlyingCalls: options.underlyingCalls ?? 0,
    used,
  };
}

export async function computeToolStats(
  configDir: string,
  toolId: string
): Promise<ToolStats> {
  const traces = await listTraces(configDir);
  let callCount = 0;
  let estimatedIntermediateBytes = 0;
  let estimatedIntermediateTokens = 0;

  for (const trace of traces) {
    for (const call of trace.calls) {
      if (call.toolId !== toolId) {
        continue;
      }
      callCount += 1;
      estimatedIntermediateBytes += call.storedBytes ?? call.outputBytes ?? 0;
      estimatedIntermediateTokens +=
        call.estimatedOutputTokens ?? Math.ceil((call.storedBytes ?? 0) / 4);
    }
  }

  return {
    callCount,
    estimatedIntermediateBytes,
    estimatedIntermediateTokens,
    toolId,
  };
}

export async function computeGatewayStats(
  configDir: string,
  options: {
    catalogToolCount: number;
    functionName?: string;
    packageCount: number;
    packageNames?: Set<string>;
    toolId?: string;
    underlyingCalls?: number;
    catalogTools?: {
      name: string;
      description?: string;
      inputSchema: unknown;
    }[];
  }
): Promise<GatewayStats> {
  const summary = await computeStats(configDir, {
    functionName: options.functionName,
    packageNames: options.packageNames,
    toolId: options.toolId,
  });
  const directSchemaTokensEstimate = options.catalogTools
    ? encode(JSON.stringify(options.catalogTools)).length
    : estimateDirectSchemaTokens(
        options.catalogToolCount + options.packageCount
      );
  const discoverySchemaTokensEstimate = META_TOOL_SCHEMA_TOKENS_ESTIMATE;
  const estimatedSchemaTokensSaved = Math.max(
    0,
    directSchemaTokensEstimate - discoverySchemaTokensEstimate
  );

  const gatewayStats: GatewayStats = {
    ...summary,
    catalogToolCount: options.catalogToolCount,
    contextBudgetBytes: DEFAULT_CONTEXT_BUDGET_BYTES,
    directSchemaTokensEstimate,
    discoverySchemaTokensEstimate,
    estimatedSchemaTokensSaved,
    labels: {
      resultBytes: 'estimated',
      schemaTokens: 'estimated',
    },
    packageCount: options.packageCount,
  };

  if (options.functionName) {
    gatewayStats.functionStats = await computeFunctionStats(
      configDir,
      options.functionName,
      { underlyingCalls: options.underlyingCalls }
    );
  }

  if (options.toolId) {
    gatewayStats.toolStats = await computeToolStats(configDir, options.toolId);
  }

  return gatewayStats;
}
