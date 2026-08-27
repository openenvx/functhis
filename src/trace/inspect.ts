import { getSuccessfulPath } from './path';
import { assertValidRunId } from './schema';
import { loadTrace } from './store';

export async function formatInspectReport(
  runId: string,
  configDir: string
): Promise<string> {
  assertValidRunId(runId);
  const trace = await loadTrace(configDir, runId);
  const lines = [
    `Run: ${trace.id}`,
    `Status: ${trace.status}`,
    `Started: ${trace.startedAt}`,
    trace.endedAt ? `Ended: ${trace.endedAt}` : 'Ended: —',
    `Redaction: v${trace.redactionVersion}`,
    `Calls: ${trace.calls.length}`,
    '',
  ];

  if (Object.keys(trace.toolFingerprints).length > 0) {
    lines.push('Tool fingerprints:');
    for (const [toolId, fingerprint] of Object.entries(
      trace.toolFingerprints
    )) {
      lines.push(`  ${toolId}: ${fingerprint}`);
    }
    lines.push('');
  }

  for (const call of trace.calls) {
    lines.push(
      `${call.address} ${call.toolId} [${call.status}] (${call.durationMs}ms)`
    );
    if (call.refs?.length) {
      lines.push(`  refs: ${call.refs.join(', ')}`);
    }
    if (call.error) {
      lines.push(`  error: ${call.error}`);
    }
    if (call.truncated) {
      lines.push(
        `  truncated: yes (${call.originalBytes ?? '?'} bytes original)`
      );
    }
  }

  const successfulPath = getSuccessfulPath(trace);
  if (successfulPath.length > 0) {
    lines.push('', `Successful path: ${successfulPath.join(', ')}`);
  }

  return lines.join('\n');
}
