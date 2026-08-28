import { analyzeDataflow } from './dataflow';
import { assertValidRunId } from './schema';
import type { ExecutionTrace } from './schema';
import { listTraces, loadTrace } from './store';

export interface TraceListEntry {
  callCount: number;
  endedAt?: string;
  readOnly: boolean;
  runId: string;
  startedAt: string;
  status: ExecutionTrace['status'];
  toolSequence: string[];
  totalDurationMs: number;
}

export async function listTraceSummaries(
  configDir: string,
  limit = 20
): Promise<TraceListEntry[]> {
  const traces = await listTraces(configDir);
  return traces.slice(0, limit).map((trace) => {
    const analysis = analyzeDataflow(trace);
    return {
      callCount: trace.calls.length,
      endedAt: trace.endedAt,
      readOnly: analysis.readOnly,
      runId: trace.id,
      startedAt: trace.startedAt,
      status: trace.status,
      toolSequence: analysis.toolSequence,
      totalDurationMs: analysis.totalDurationMs,
    };
  });
}

export async function formatInspectReport(
  runId: string,
  configDir: string
): Promise<string> {
  assertValidRunId(runId);
  const trace = await loadTrace(configDir, runId);
  const analysis = analyzeDataflow(trace);
  const lines = [
    `Run: ${trace.id}`,
    `Status: ${trace.status}`,
    `Started: ${trace.startedAt}`,
    trace.endedAt ? `Ended: ${trace.endedAt}` : 'Ended: —',
    `Redaction: v${trace.redactionVersion}`,
    trace.sessionId ? `Session: ${trace.sessionId}` : undefined,
    trace.skillId ? `Skill: ${trace.skillId}` : undefined,
    trace.client ? `Client: ${trace.client}` : undefined,
    `Calls: ${trace.calls.length}`,
    `Upstream calls: ${analysis.toolSequence.length}`,
    `Read-only: ${analysis.readOnly ? 'yes' : 'no'}`,
    `Intermediate bytes (est.): ${analysis.totalIntermediateBytes}`,
    `Intermediate tokens (est.): ${analysis.totalIntermediateTokens}`,
    `Total duration: ${analysis.totalDurationMs}ms`,
    '',
  ].filter((line): line is string => line !== undefined);

  if (Object.keys(trace.toolFingerprints).length > 0) {
    lines.push('Tool fingerprints:');
    for (const [toolId, fingerprint] of Object.entries(
      trace.toolFingerprints
    )) {
      lines.push(`  ${toolId}: ${fingerprint}`);
    }
    lines.push('');
  }

  if (analysis.edges.length > 0) {
    lines.push('Dataflow:');
    for (const edge of analysis.edges) {
      const path = edge.fromPath ? `.${edge.fromPath}` : '';
      lines.push(
        `  ${edge.fromAddress}${path} → ${edge.toAddress}.${edge.toArgument} [${edge.kind}]`
      );
    }
    lines.push('');
  }

  for (const call of analysis.calls) {
    lines.push(
      `${call.address} ${call.toolId} [${call.status}] (${call.durationMs}ms, ${call.sideEffect ?? 'unknown'})`
    );
    if (call.outputBytes !== undefined) {
      lines.push(
        `  output: ${call.outputBytes} bytes, ~${call.estimatedOutputTokens ?? 0} tokens`
      );
    }
    if (call.parallelSafe) {
      lines.push('  parallel-safe: yes');
    }
    for (const arg of call.arguments) {
      lines.push(
        `  arg ${arg.key}: ${arg.classification}${arg.priorAddress ? ` from ${arg.priorAddress}${arg.priorPath ? `.${arg.priorPath}` : ''}` : ''}`
      );
    }
  }

  return lines.join('\n');
}

export async function formatTraceListReport(
  configDir: string,
  limit = 20
): Promise<string> {
  const entries = await listTraceSummaries(configDir, limit);
  if (entries.length === 0) {
    return 'No runs captured yet.';
  }

  const lines = ['Recent runs:', ''];
  for (const entry of entries) {
    lines.push(
      `${entry.runId} [${entry.status}] ${entry.callCount} calls, ${entry.totalDurationMs}ms, read-only: ${entry.readOnly ? 'yes' : 'no'}`
    );
    if (entry.toolSequence.length > 0) {
      lines.push(`  tools: ${entry.toolSequence.join(' → ')}`);
    }
  }
  return lines.join('\n');
}
