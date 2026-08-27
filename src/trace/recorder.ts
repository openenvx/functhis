import { randomUUID } from 'node:crypto';

import { shapeCallResult } from '../output';
import { redactValue } from '../redaction/redact';
import { resolveEvidenceRefs } from './refs';
import { generateRunId, makeAddress, REDACTION_VERSION } from './schema';
import type { ExecutionTrace, TraceCall, TraceCallStatus } from './schema';
import { loadTrace, saveTrace } from './store';

export const WHOLE_RUN_DEADLINE_MS = 15 * 60 * 1000;

export interface RecordCallInput {
  toolId: string;
  toolFingerprint: string;
  arguments: Record<string, unknown>;
  status: TraceCallStatus;
  output?: unknown;
  error?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  truncated?: boolean;
  originalBytes?: number;
  refs?: string[];
  returnedBytes?: number;
  storedBytes?: number;
}

export class TraceRecorder {
  private currentTrace: ExecutionTrace | null = null;
  private cancelled = false;

  constructor(private readonly configDir: string) {}

  isCancelled(): boolean {
    return this.cancelled;
  }

  async cancelCurrentRun(): Promise<void> {
    if (!this.currentTrace || this.currentTrace.status !== 'running') {
      return;
    }
    this.cancelled = true;
    this.currentTrace.status = 'cancelled';
    this.currentTrace.endedAt = new Date().toISOString();
    await this.persist(this.currentTrace);
  }

  getCurrentRunId(): string | undefined {
    return this.currentTrace?.id;
  }

  async ensureRun(options?: {
    runId?: string;
    newRun?: boolean;
  }): Promise<ExecutionTrace> {
    if (options?.newRun) {
      this.currentTrace = this.createRun();
      await this.persist(this.currentTrace);
      return this.currentTrace;
    }

    if (options?.runId) {
      const loaded = await loadTrace(this.configDir, options.runId);
      if (loaded.status !== 'running') {
        throw new Error(
          `Run "${options.runId}" is ${loaded.status}. Pass newRun: true to start a fresh run.`
        );
      }
      this.currentTrace = loaded;
      return loaded;
    }

    if (this.currentTrace) {
      this.assertRunNotExpired(this.currentTrace);
      return this.currentTrace;
    }

    this.currentTrace = this.createRun();
    await this.persist(this.currentTrace);
    return this.currentTrace;
  }

  assertRunActive(): void {
    if (!this.currentTrace) {
      return;
    }
    if (this.currentTrace.status === 'cancelled') {
      throw new Error(
        'Current run was cancelled. Pass newRun: true to continue.'
      );
    }
    this.assertRunNotExpired(this.currentTrace);
  }

  resolveArguments(args: Record<string, unknown>): {
    arguments: Record<string, unknown>;
    refs: string[];
  } {
    if (!this.currentTrace) {
      return { arguments: args, refs: [] };
    }
    return resolveEvidenceRefs(args, this.currentTrace);
  }

  async recordCall(
    input: RecordCallInput
  ): Promise<{ address: string; runId: string }> {
    const trace = this.currentTrace;
    if (!trace) {
      throw new Error('No active run to record call');
    }

    const callIndex = trace.calls.length;
    const address = makeAddress(callIndex);
    const call: TraceCall = {
      address,
      arguments: redactValue(input.arguments) as Record<string, unknown>,
      durationMs: input.durationMs,
      endedAt: input.endedAt,
      error: input.error,
      id: randomUUID(),
      originalBytes: input.originalBytes,
      output:
        input.output === undefined ? undefined : redactValue(input.output),
      refs: input.refs?.length ? input.refs : undefined,
      returnedBytes: input.returnedBytes,
      startedAt: input.startedAt,
      status: input.status,
      storedBytes: input.storedBytes,
      toolFingerprint: input.toolFingerprint,
      toolId: input.toolId,
      truncated: input.truncated,
    };

    trace.calls.push(call);
    trace.toolFingerprints[input.toolId] = input.toolFingerprint;

    const allSucceeded = trace.calls.every(
      (entry) => entry.status === 'succeeded'
    );
    const hasFailure = trace.calls.some(
      (entry) => entry.status !== 'succeeded' && entry.status !== 'denied'
    );
    trace.status = hasFailure
      ? 'failed'
      : allSucceeded
        ? 'succeeded'
        : 'running';
    trace.endedAt = input.endedAt;

    await this.persist(trace);
    return { address, runId: trace.id };
  }

  async recall(runId: string, address: string): Promise<unknown> {
    const trace = await loadTrace(this.configDir, runId);
    const call = trace.calls.find((entry) => entry.address === address);
    if (!call) {
      throw new Error(`Address ${address} not found in run ${runId}`);
    }
    if (call.output === undefined) {
      throw new Error(`Address ${address} has no stored output`);
    }
    return call.output;
  }

  async updateLastCallMetrics(metrics: {
    returnedBytes: number;
    storedBytes: number;
  }): Promise<void> {
    const trace = this.currentTrace;
    if (!trace || trace.calls.length === 0) {
      return;
    }
    const lastCall = trace.calls.at(-1);
    if (!lastCall) {
      return;
    }
    lastCall.returnedBytes = metrics.returnedBytes;
    lastCall.storedBytes = metrics.storedBytes;
    await this.persist(trace);
  }

  private createRun(): ExecutionTrace {
    return {
      calls: [],
      id: generateRunId(),
      redactionVersion: REDACTION_VERSION,
      startedAt: new Date().toISOString(),
      status: 'running',
      toolFingerprints: {},
    };
  }

  private assertRunNotExpired(trace: ExecutionTrace): void {
    const started = Date.parse(trace.startedAt);
    if (Number.isNaN(started)) {
      return;
    }
    if (Date.now() - started > WHOLE_RUN_DEADLINE_MS) {
      trace.status = 'failed';
      trace.endedAt = new Date().toISOString();
      throw new Error(
        `Run "${trace.id}" exceeded the ${WHOLE_RUN_DEADLINE_MS / 60_000} minute deadline. Pass newRun: true to start a fresh run.`
      );
    }
  }

  private async persist(trace: ExecutionTrace): Promise<void> {
    await saveTrace(this.configDir, trace);
  }
}

export function prepareCallOutput(result: unknown): {
  output: unknown;
  truncated: boolean;
  originalBytes?: number;
} {
  return shapeCallResult(result);
}
