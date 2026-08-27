import { shapeEvidenceOutput } from '../mcp/output';
import { resolveConfigDir } from '../storage/paths';
import { assertValidAddress, assertValidRunId } from '../trace/schema';
import { loadTrace } from '../trace/store';

export async function runRecall(options: {
  runId: string;
  address: string;
  dir?: string;
  full?: boolean;
  limit?: number;
  offset?: number;
  select?: string;
}): Promise<string> {
  assertValidRunId(options.runId);
  assertValidAddress(options.address);
  const configDir = resolveConfigDir(options.dir);
  const trace = await loadTrace(configDir, options.runId);
  const call = trace.calls.find((entry) => entry.address === options.address);
  if (!call) {
    throw new Error(
      `Address ${options.address} not found in run ${options.runId}`
    );
  }
  if (call.output === undefined) {
    throw new Error(`Address ${options.address} has no stored output`);
  }

  const shaped = shapeEvidenceOutput(call.output, {
    address: options.address,
    full: options.full ?? true,
    limit: options.limit,
    offset: options.offset,
    runId: options.runId,
    select: options.select,
  });

  return JSON.stringify(shaped.output, null, 2);
}
