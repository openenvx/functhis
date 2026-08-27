import * as z from 'zod/v4';

export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
export const ADDRESS_PATTERN = /^@\d+$/u;
export const REDACTION_VERSION = '1';

export const traceCallStatusSchema = z.enum([
  'succeeded',
  'failed',
  'denied',
  'timeout',
  'cancelled',
]);

export const traceCallSchema = z.object({
  address: z.string().regex(ADDRESS_PATTERN),
  arguments: z.record(z.string(), z.unknown()),
  durationMs: z.number().int().nonnegative(),
  endedAt: z.string(),
  error: z.string().optional(),
  id: z.string(),
  originalBytes: z.number().int().positive().optional(),
  output: z.unknown().optional(),
  refs: z.array(z.string().regex(ADDRESS_PATTERN)).optional(),
  returnedBytes: z.number().int().nonnegative().optional(),
  startedAt: z.string(),
  status: traceCallStatusSchema,
  storedBytes: z.number().int().nonnegative().optional(),
  toolFingerprint: z.string(),
  toolId: z.string(),
  truncated: z.boolean().optional(),
});

export const executionTraceSchema = z.object({
  calls: z.array(traceCallSchema),
  endedAt: z.string().optional(),
  id: z.string().regex(RUN_ID_PATTERN),
  redactionVersion: z.string(),
  startedAt: z.string(),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  toolFingerprints: z.record(z.string(), z.string()),
});

export type TraceCallStatus = z.infer<typeof traceCallStatusSchema>;
export type TraceCall = z.infer<typeof traceCallSchema>;
export type ExecutionTrace = z.infer<typeof executionTraceSchema>;

export function assertValidRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
}

export function assertValidAddress(address: string): void {
  if (!ADDRESS_PATTERN.test(address)) {
    throw new Error(`Invalid evidence address: ${address}`);
  }
}

export function makeAddress(callIndex: number): string {
  return `@${callIndex + 1}`;
}

export function generateRunId(): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `run-${stamp}-${random}`;
}
