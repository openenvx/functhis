import { resolveConfigDir } from '../storage/paths';
import {
  computeFunctionStats,
  computeStats,
  computeToolStats,
} from '../trace/stats';

export {
  computeFunctionStats,
  computeGatewayStats,
  computeStats,
  computeToolStats,
  type FunctionStats,
  type GatewayStats,
  type StatsSummary,
  type ToolStats,
} from '../trace/stats';

export async function runStats(options?: {
  dir?: string;
  functionName?: string;
  toolId?: string;
}): Promise<string> {
  const configDir = resolveConfigDir(options?.dir);

  if (options?.functionName) {
    const stats = await computeFunctionStats(configDir, options.functionName);
    return [
      `Function: ${stats.functionName}`,
      `Used: ${stats.used} times (${stats.labels.used})`,
      `Verification runs: ${stats.invocations.verification.replay} replayed (${stats.labels.verificationReplay}), ${stats.invocations.verification.live} live (${stats.labels.verificationLive})`,
      `Underlying calls: ${stats.underlyingCalls} (${stats.labels.underlyingCalls})`,
      `Estimated upstream calls avoided: ${stats.estimatedUpstreamCallsAvoided} (${stats.labels.estimatedUpstreamCallsAvoided})`,
      `Average duration: ${(stats.averageDurationMs / 1000).toFixed(1)} seconds (${stats.labels.averageDurationMs})`,
      `Average intermediate context avoided: ${stats.estimatedIntermediateBytesAvoided} bytes (${stats.labels.estimatedIntermediateBytesAvoided})`,
      `Estimated context tokens avoided: ${stats.estimatedContextTokensAvoided}/run (${stats.labels.estimatedContextTokensAvoided})`,
      `Schema status: ${stats.schemaStatus}`,
    ].join('\n');
  }

  if (options?.toolId) {
    const stats = await computeToolStats(configDir, options.toolId);
    return [
      `Tool: ${stats.toolId}`,
      `Calls: ${stats.callCount}`,
      `Intermediate bytes (est.): ${stats.estimatedIntermediateBytes}`,
      `Intermediate tokens (est.): ${stats.estimatedIntermediateTokens}`,
    ].join('\n');
  }

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
    `Package calls: ${summary.packageCalls}`,
    `Upstream calls: ${summary.upstreamCalls}`,
    `Total call duration: ${summary.totalDurationMs}ms`,
  ].join('\n');
}
