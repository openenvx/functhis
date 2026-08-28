import { estimateTokensFromBytes, estimateUtf8Bytes } from '../output';
import { CapabilityBroker } from '../sandbox/broker';
import { executeSandboxCode } from '../sandbox/runner';
import { transpileGuestSource } from '../sandbox/transpile';
import { analyzeDataflow } from '../trace/dataflow';
import { loadTrace } from '../trace/store';
import type { UpstreamManager } from '../upstream/manager';
import { inspectLockDrift } from './install';
import { isPackageToolId } from './paths';
import { loadPackage } from './save';
import { packageManifestSchema } from './schema';
import type { PackageManifest } from './schema';
import { validateJsonSchemaValue } from './validate-schema';

export type TestMode = 'live' | 'replay';

export interface TestFunctionOptions {
  allowedTools?: string[];
  approveWrites?: boolean;
  compiledFrom?: string;
  configDir: string;
  description?: string;
  input?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  mode?: TestMode;
  name?: string;
  outputSchema?: Record<string, unknown>;
  packageDir?: string;
  source?: string;
}

export interface VerificationReport {
  capabilities: { sideEffect: string; toolId: string }[];
  compiled: {
    agentVisibleCalls: number;
    durationMs: number;
    estimatedResultTokens: number;
    resultBytes: number;
  };
  functionName: string;
  labels: {
    compiledDuration: 'observed' | 'replayed';
    compiledResultBytes: 'observed' | 'replayed';
    compiledResultTokens: 'estimated';
    originalDuration: 'observed';
    originalIntermediateBytes: 'estimated';
    originalIntermediateTokens: 'estimated';
  };
  mode: TestMode;
  original: {
    agentVisibleCalls: number;
    durationMs: number;
    estimatedIntermediateTokens: number;
    intermediateBytes: number;
  };
  status: 'verified locally' | 'failed' | 'denied';
  warnings: string[];
}

function buildReplayMap(
  traceCalls: {
    output?: unknown;
    status: string;
    toolId: string;
  }[]
): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>();
  for (const call of traceCalls) {
    if (call.status !== 'succeeded' || call.output === undefined) {
      continue;
    }
    const queue = map.get(call.toolId) ?? [];
    queue.push(call.output);
    map.set(call.toolId, queue);
  }
  return map;
}

function createReplayHandler(
  replayMap: Map<string, unknown[]>
): (toolId: string) => unknown {
  const cursors = new Map<string, number>();
  return (toolId: string) => {
    const queue = replayMap.get(toolId);
    if (!queue || queue.length === 0) {
      throw new Error(`No recorded output to replay for ${toolId}`);
    }
    const index = cursors.get(toolId) ?? 0;
    const output = queue[index];
    cursors.set(toolId, index + 1);
    return output;
  };
}

export function formatVerificationReport(report: VerificationReport): string {
  const lines = [
    `Function: ${report.functionName}`,
    `Status: ${report.status}`,
    `Mode: ${report.mode}`,
    '',
    'Capabilities:',
    ...report.capabilities.map(
      (entry) => `- ${entry.toolId}: ${entry.sideEffect}`
    ),
    '',
    'Original trace:',
    `- ${report.original.agentVisibleCalls} agent-visible tool calls`,
    `- ${report.original.intermediateBytes} KB intermediate output (${report.labels.originalIntermediateBytes})`,
    `- ${report.original.estimatedIntermediateTokens} estimated intermediate tokens (${report.labels.originalIntermediateTokens})`,
    `- ${(report.original.durationMs / 1000).toFixed(1)} seconds (${report.labels.originalDuration})`,
    '',
    'Compiled function:',
    `- ${report.compiled.agentVisibleCalls} agent-visible call`,
    `- ${report.compiled.resultBytes} bytes final output (${report.labels.compiledResultBytes})`,
    `- ${report.compiled.estimatedResultTokens} estimated result tokens (${report.labels.compiledResultTokens})`,
    `- ${(report.compiled.durationMs / 1000).toFixed(1)} seconds (${report.labels.compiledDuration})`,
  ];

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n');
}

async function loadOriginalAnalysis(
  configDir: string,
  compiledFrom?: string
): Promise<VerificationReport['original']> {
  if (!compiledFrom) {
    return {
      agentVisibleCalls: 0,
      durationMs: 0,
      estimatedIntermediateTokens: 0,
      intermediateBytes: 0,
    };
  }

  const trace = await loadTrace(configDir, compiledFrom);
  const analysis = analyzeDataflow(trace);
  return {
    agentVisibleCalls: analysis.toolSequence.length,
    durationMs: analysis.totalDurationMs,
    estimatedIntermediateTokens: analysis.totalIntermediateTokens,
    intermediateBytes: Math.round(analysis.totalIntermediateBytes / 1024),
  };
}

export async function testFunction(
  manager: UpstreamManager,
  options: TestFunctionOptions
): Promise<VerificationReport> {
  const mode = options.mode ?? 'replay';
  const warnings: string[] = [];
  let manifest: PackageManifest;
  let source: string;
  let allowedTools: string[];
  let compiledFrom = options.compiledFrom;

  if (options.packageDir) {
    const loaded = await loadPackage(options.packageDir);
    manifest = loaded.manifest;
    source = loaded.source;
    allowedTools = manifest.capabilities.tools;
    compiledFrom ??= manifest.compiledFrom;
    const drift = inspectLockDrift(manager, loaded.lock);
    if (!drift.ok) {
      return {
        capabilities: allowedTools.map((toolId) => ({
          sideEffect: manager.catalog.getTool(toolId)?.risk ?? 'unknown',
          toolId,
        })),
        compiled: {
          agentVisibleCalls: 1,
          durationMs: 0,
          estimatedResultTokens: 0,
          resultBytes: 0,
        },
        functionName: manifest.name,
        labels: {
          compiledDuration: 'replayed',
          compiledResultBytes: 'replayed',
          compiledResultTokens: 'estimated',
          originalDuration: 'observed',
          originalIntermediateBytes: 'estimated',
          originalIntermediateTokens: 'estimated',
        },
        mode,
        original: await loadOriginalAnalysis(options.configDir, compiledFrom),
        status: 'denied',
        warnings: drift.issues.map((issue) => issue.message),
      };
    }
  } else {
    if (!options.source || !options.name || !options.allowedTools?.length) {
      throw new Error(
        'Provide packageDir or source + name + allowedTools for testing.'
      );
    }
    manifest = packageManifestSchema.parse({
      capabilities: {
        tools: options.allowedTools,
        writes: 'deny',
      },
      compiledFrom,
      description: options.description ?? `Test ${options.name}`,
      inputSchema: options.inputSchema ?? { properties: {}, type: 'object' },
      name: options.name,
      outputSchema: options.outputSchema,
      runtime: {
        maxCalls: 20,
        maxOutputBytes: 6 * 1024,
        timeoutMs: 30_000,
      },
    });
    source = options.source;
    allowedTools = options.allowedTools;
  }

  transpileGuestSource(source);

  const capabilities = allowedTools.map((toolId) => {
    const tool = manager.catalog.getTool(toolId);
    return {
      sideEffect: tool?.risk ?? 'unknown',
      toolId,
    };
  });

  const hasWriteOrUnknown = capabilities.some(
    (entry) => entry.sideEffect !== 'read'
  );
  if (mode === 'live' && hasWriteOrUnknown && !options.approveWrites) {
    return {
      capabilities,
      compiled: {
        agentVisibleCalls: 1,
        durationMs: 0,
        estimatedResultTokens: 0,
        resultBytes: 0,
      },
      functionName: manifest.name,
      labels: {
        compiledDuration: 'observed',
        compiledResultBytes: 'observed',
        compiledResultTokens: 'estimated',
        originalDuration: 'observed',
        originalIntermediateBytes: 'estimated',
        originalIntermediateTokens: 'estimated',
      },
      mode,
      original: await loadOriginalAnalysis(options.configDir, compiledFrom),
      status: 'denied',
      warnings: [
        'Live testing is denied for write or unknown capabilities without approveWrites.',
      ],
    };
  }

  const original = await loadOriginalAnalysis(options.configDir, compiledFrom);
  if (!compiledFrom && mode === 'replay') {
    original.agentVisibleCalls = allowedTools.length;
    warnings.push(
      'Replay mode without compiledFrom falls back to live upstream calls.'
    );
  }

  let replay: ((toolId: string, args: unknown) => Promise<unknown>) | undefined;
  if (mode === 'replay' && compiledFrom) {
    const trace = await loadTrace(options.configDir, compiledFrom);
    const replayMap = buildReplayMap(trace.calls);
    const getOutput = createReplayHandler(replayMap);
    replay = async (toolId) => getOutput(toolId);
  }

  const broker = new CapabilityBroker(manager, {
    allowedTools,
    approveWrites: options.approveWrites,
    maxCalls: manifest.runtime.maxCalls,
    replay,
  });

  const startMs = Date.now();
  const result = await executeSandboxCode(broker, {
    allowedTools,
    approveWrites: options.approveWrites,
    input: options.input ?? {},
    maxCalls: manifest.runtime.maxCalls,
    maxOutputBytes: manifest.runtime.maxOutputBytes,
    source,
    timeoutMs: manifest.runtime.timeoutMs,
  });
  const durationMs = Date.now() - startMs;

  if (original.agentVisibleCalls === 0) {
    original.agentVisibleCalls = allowedTools.length;
  }

  if (result.status !== 'succeeded') {
    return {
      capabilities,
      compiled: {
        agentVisibleCalls: 1,
        durationMs,
        estimatedResultTokens: 0,
        resultBytes: 0,
      },
      functionName: manifest.name,
      labels: {
        compiledDuration: mode === 'replay' ? 'replayed' : 'observed',
        compiledResultBytes: mode === 'replay' ? 'replayed' : 'observed',
        compiledResultTokens: 'estimated',
        originalDuration: 'observed',
        originalIntermediateBytes: 'estimated',
        originalIntermediateTokens: 'estimated',
      },
      mode,
      original,
      status: 'failed',
      warnings: [...warnings, result.error ?? 'Execution failed'],
    };
  }

  const resultBytes = estimateUtf8Bytes(result.output);
  const estimatedResultTokens = estimateTokensFromBytes(resultBytes);

  if (manifest.outputSchema) {
    const schemaErrors = validateJsonSchemaValue(
      result.output,
      manifest.outputSchema
    );
    if (schemaErrors.length > 0) {
      return {
        capabilities,
        compiled: {
          agentVisibleCalls: 1,
          durationMs,
          estimatedResultTokens,
          resultBytes,
        },
        functionName: manifest.name,
        labels: {
          compiledDuration: mode === 'replay' ? 'replayed' : 'observed',
          compiledResultBytes: mode === 'replay' ? 'replayed' : 'observed',
          compiledResultTokens: 'estimated',
          originalDuration: 'observed',
          originalIntermediateBytes: 'estimated',
          originalIntermediateTokens: 'estimated',
        },
        mode,
        original,
        status: 'failed',
        warnings: [...warnings, ...schemaErrors],
      };
    }
  }

  return {
    capabilities,
    compiled: {
      agentVisibleCalls: 1,
      durationMs,
      estimatedResultTokens,
      resultBytes,
    },
    functionName: manifest.name,
    labels: {
      compiledDuration: mode === 'replay' ? 'replayed' : 'observed',
      compiledResultBytes: mode === 'replay' ? 'replayed' : 'observed',
      compiledResultTokens: 'estimated',
      originalDuration: 'observed',
      originalIntermediateBytes: 'estimated',
      originalIntermediateTokens: 'estimated',
    },
    mode,
    original,
    status: 'verified locally',
    warnings,
  };
}

export function isPackageCall(
  toolId: string,
  packageNames: Set<string>
): boolean {
  return isPackageToolId(toolId) && packageNames.has(toolId);
}
