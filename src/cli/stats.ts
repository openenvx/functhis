import { resolveConfigDir } from '../storage/paths';
import { computeStats } from '../trace/stats';

export {
  computeGatewayStats,
  computeStats,
  type GatewayStats,
  type StatsSummary,
} from '../trace/stats';

export async function runStats(options?: { dir?: string }): Promise<string> {
  const configDir = resolveConfigDir(options?.dir);
  const summary = await computeStats(configDir);

  if (summary.runCount === 0) {
    return [
      'No runs captured yet.',
      '',
      'Use fn serve and fn_call to record evidence.',
      'Inspect a run with: fn inspect <run-id>',
    ].join('\n');
  }

  return [
    `Runs: ${summary.runCount}`,
    `Calls: ${summary.callCount}`,
    `Succeeded: ${summary.succeededCalls}`,
    `Failed: ${summary.failedCalls}`,
    `Denied: ${summary.deniedCalls}`,
    `Timeouts: ${summary.timeoutCalls}`,
    `Safety-truncated outputs: ${summary.truncatedCalls}`,
    `Stored result bytes (est.): ${summary.storedResultBytes}`,
    `Returned result bytes (est.): ${summary.returnedResultBytes}`,
    `Result bytes saved (est.): ${summary.estimatedResultBytesSaved}`,
    `Function calls: ${summary.functionCalls}`,
    `Upstream calls: ${summary.upstreamCalls}`,
    `Total call duration: ${summary.totalDurationMs}ms`,
  ].join('\n');
}
