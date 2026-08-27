import { ADDRESS_PATTERN } from './schema';
import type { ExecutionTrace } from './schema';

export interface ResolvedArguments {
  arguments: Record<string, unknown>;
  refs: string[];
}

export function resolveEvidenceRefs(
  args: Record<string, unknown>,
  trace: ExecutionTrace
): ResolvedArguments {
  const resolved: Record<string, unknown> = {};
  const refs: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && ADDRESS_PATTERN.test(value)) {
      const call = trace.calls.find((entry) => entry.address === value);
      if (call?.output !== undefined) {
        resolved[key] = call.output;
        refs.push(value);
        continue;
      }
    }
    resolved[key] = value;
  }

  return { arguments: resolved, refs };
}
