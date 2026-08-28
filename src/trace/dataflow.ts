import { REDACTED } from '../redaction/redact';
import type { ToolRisk } from '../upstream/types';
import type { ExecutionTrace, TraceCall } from './schema';

export type ArgumentClassification =
  | 'constant'
  | 'fromPrior'
  | 'input'
  | 'unknown';

export interface ClassifiedArgument {
  classification: ArgumentClassification;
  key: string;
  priorAddress?: string;
  priorPath?: string;
  valuePreview?: string;
}

export interface DataflowEdge {
  fromAddress: string;
  fromPath?: string;
  kind: 'explicit_ref' | 'structural_match';
  toAddress: string;
  toArgument: string;
}

export interface DataflowCallSummary {
  address: string;
  arguments: ClassifiedArgument[];
  durationMs: number;
  estimatedOutputTokens?: number;
  outputBytes?: number;
  parallelSafe: boolean;
  sideEffect?: ToolRisk;
  status: TraceCall['status'];
  toolFingerprint: string;
  toolId: string;
}

export interface DataflowAnalysis {
  calls: DataflowCallSummary[];
  capabilities: { sideEffect: ToolRisk; toolId: string }[];
  edges: DataflowEdge[];
  finalOutputAddress?: string;
  readOnly: boolean;
  toolSequence: string[];
  totalDurationMs: number;
  totalIntermediateBytes: number;
  totalIntermediateTokens: number;
}

const META_TOOL_IDS = new Set([
  'fn_execute_code',
  'fn_recall',
  'fn_select',
  'fn_search',
  'fn_describe',
  'fn_stats',
  'fn_inspect',
  'fn_compile_trace',
  'fn_test_function',
  'fn_save_function',
  'fn_install_function',
  'fn_inspect_function',
  'fn_index',
  'fn_search_context',
  'fn_subgraph',
]);

function isRedactedValue(value: unknown): boolean {
  if (value === REDACTED) {
    return true;
  }
  if (typeof value === 'string' && value.includes(REDACTED)) {
    return true;
  }
  return false;
}

function previewValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  const text = JSON.stringify(value);
  if (text.length <= 80) {
    return text;
  }
  return `${text.slice(0, 77)}…`;
}

function collectPaths(
  value: unknown,
  prefix = ''
): { path: string; value: unknown }[] {
  const results: { path: string; value: unknown }[] = [];

  if (value === null || value === undefined) {
    if (prefix) {
      results.push({ path: prefix, value });
    }
    return results;
  }

  if (Array.isArray(value)) {
    if (prefix) {
      results.push({ path: prefix, value });
    }
    for (let index = 0; index < value.length; index += 1) {
      const childPath = prefix ? `${prefix}[${index}]` : `[${index}]`;
      results.push(...collectPaths(value[index], childPath));
    }
    return results;
  }

  if (typeof value === 'object') {
    if (prefix) {
      results.push({ path: prefix, value });
    }
    for (const [key, entry] of Object.entries(value)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      results.push(...collectPaths(entry, childPath));
    }
    return results;
  }

  if (prefix) {
    results.push({ path: prefix, value });
  }
  return results;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (typeof a === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function findStructuralMatch(
  value: unknown,
  priorCalls: TraceCall[]
): { priorAddress: string; priorPath: string } | undefined {
  if (isRedactedValue(value)) {
    return undefined;
  }

  for (let index = priorCalls.length - 1; index >= 0; index -= 1) {
    const prior = priorCalls[index];
    if (prior.output === undefined || prior.status !== 'succeeded') {
      continue;
    }
    for (const { path, value: candidate } of collectPaths(prior.output)) {
      if (valuesEqual(value, candidate) && !isRedactedValue(candidate)) {
        return { priorAddress: prior.address, priorPath: path };
      }
    }
  }

  return undefined;
}

function classifyArgument(
  key: string,
  value: unknown,
  call: TraceCall,
  priorCalls: TraceCall[],
  inputKeys: Set<string>
): { classified: ClassifiedArgument; edge?: DataflowEdge } {
  if (typeof value === 'string' && call.refs?.includes(value)) {
    return {
      classified: {
        classification: 'fromPrior',
        key,
        priorAddress: value,
        valuePreview: previewValue(value),
      },
      edge: {
        fromAddress: value,
        kind: 'explicit_ref',
        toAddress: call.address,
        toArgument: key,
      },
    };
  }

  const structural = findStructuralMatch(value, priorCalls);
  if (structural) {
    return {
      classified: {
        classification: 'fromPrior',
        key,
        priorAddress: structural.priorAddress,
        priorPath: structural.priorPath,
        valuePreview: previewValue(value),
      },
      edge: {
        fromAddress: structural.priorAddress,
        fromPath: structural.priorPath,
        kind: 'structural_match',
        toAddress: call.address,
        toArgument: key,
      },
    };
  }

  if (inputKeys.has(key)) {
    return {
      classified: {
        classification: 'input',
        key,
        valuePreview: previewValue(value),
      },
    };
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return {
      classified: {
        classification: 'constant',
        key,
        valuePreview: previewValue(value),
      },
    };
  }

  return {
    classified: {
      classification: 'unknown',
      key,
      valuePreview: previewValue(value),
    },
  };
}

function inferInputKeys(trace: ExecutionTrace): Set<string> {
  const keys = new Set<string>();
  const firstCall = trace.calls.find(
    (call) => !META_TOOL_IDS.has(call.toolId) && call.status === 'succeeded'
  );
  if (!firstCall) {
    return keys;
  }

  for (const [key, value] of Object.entries(firstCall.arguments)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      keys.add(key);
    }
  }
  return keys;
}

function isUpstreamToolCall(call: TraceCall): boolean {
  return !META_TOOL_IDS.has(call.toolId) && !call.toolId.includes('sandbox:');
}

export function analyzeDataflow(trace: ExecutionTrace): DataflowAnalysis {
  const inputKeys = inferInputKeys(trace);
  const edges: DataflowEdge[] = [];
  const calls: DataflowCallSummary[] = [];
  const priorUpstreamCalls: TraceCall[] = [];
  let totalIntermediateBytes = 0;
  let totalIntermediateTokens = 0;
  let totalDurationMs = 0;

  for (const call of trace.calls) {
    if (!isUpstreamToolCall(call)) {
      continue;
    }

    const classifiedArgs: ClassifiedArgument[] = [];
    for (const [key, value] of Object.entries(call.arguments)) {
      const { classified, edge } = classifyArgument(
        key,
        value,
        call,
        priorUpstreamCalls,
        inputKeys
      );
      classifiedArgs.push(classified);
      if (edge) {
        edges.push(edge);
      }
    }

    const outputBytes = call.storedBytes ?? call.returnedBytes ?? 0;
    const estimatedOutputTokens = call.estimatedOutputTokens ?? 0;
    if (call.status === 'succeeded') {
      totalIntermediateBytes += outputBytes;
      totalIntermediateTokens += estimatedOutputTokens;
    }
    totalDurationMs += call.durationMs;

    const hasIncomingEdge = edges.some(
      (edge) => edge.toAddress === call.address
    );

    calls.push({
      address: call.address,
      arguments: classifiedArgs,
      durationMs: call.durationMs,
      estimatedOutputTokens: call.estimatedOutputTokens,
      outputBytes: outputBytes || undefined,
      parallelSafe: !hasIncomingEdge && priorUpstreamCalls.length > 0,
      sideEffect: call.sideEffect,
      status: call.status,
      toolFingerprint: call.toolFingerprint,
      toolId: call.toolId,
    });

    if (call.status === 'succeeded') {
      priorUpstreamCalls.push(call);
    }
  }

  const capabilities = calls.map((call) => ({
    sideEffect: call.sideEffect ?? ('unknown' as ToolRisk),
    toolId: call.toolId,
  }));

  const uniqueCapabilities = [
    ...new Map(capabilities.map((entry) => [entry.toolId, entry])).values(),
  ];

  const finalCall = [...trace.calls]
    .toReversed()
    .find(
      (call) =>
        call.status === 'succeeded' &&
        (isUpstreamToolCall(call) || call.toolId === 'fn_execute_code')
    );

  return {
    calls,
    capabilities: uniqueCapabilities,
    edges,
    finalOutputAddress: finalCall?.address,
    readOnly: uniqueCapabilities.every((entry) => entry.sideEffect === 'read'),
    toolSequence: calls.map((call) => call.toolId),
    totalDurationMs,
    totalIntermediateBytes,
    totalIntermediateTokens,
  };
}
