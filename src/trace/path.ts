import type { ExecutionTrace } from './schema';

export function getSuccessfulPath(trace: ExecutionTrace): string[] {
  return trace.calls
    .filter((call) => call.status === 'succeeded')
    .map((call) => call.address);
}
