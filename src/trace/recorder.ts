import { randomUUID } from 'node:crypto';

import type { GraphService } from '../graph/service';
import {
  estimateTokensFromBytes,
  estimateUtf8Bytes,
  shapeCallResult,
} from '../output';
import { classifyToolRisk } from '../policy/access';
import { redactValue } from '../redaction/redact';
import type { ToolRisk } from '../upstream/types';
import { appendTraceEvent } from './event-log';
import { resolveEvidenceRefs } from './refs';
import { RunManager } from './run-manager';
import { makeAddress } from './schema';
import type { ExecutionTrace, TraceCall, TraceCallStatus } from './schema';
import { loadTrace } from './store';

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
  sideEffect?: ToolRisk;
}

export interface EnsureRunOptions {
  client?: string;
  cwd?: string;
  newRun?: boolean;
  runId?: string;
  sessionId?: string;
  skillId?: string;
}

export class TraceRecorder {
  private cancelled = false;
  private graph?: GraphService;
  private onRunFinalized?: (trace: ExecutionTrace) => Promise<void>;
  private readonly runManager: RunManager;
  private currentSessionId?: string;

  constructor(
    private readonly configDir: string,
    options: { graph?: GraphService } = {}
  ) {
    this.graph = options.graph;
    this.runManager = new RunManager(configDir, options.graph);
  }

  setOnRunFinalized(handler: (trace: ExecutionTrace) => Promise<void>): void {
    this.onRunFinalized = handler;
  }

  setGraph(graph: GraphService): void {
    this.graph = graph;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  async cancelCurrentRun(): Promise<void> {
    const trace = this.getCurrentTrace();
    if (!trace || trace.status !== 'running') {
      return;
    }
    this.cancelled = true;
    trace.status = 'cancelled';
    trace.endedAt = new Date().toISOString();
    await this.runManager.persistTrace(trace);
    this.runManager.clearTrace(this.currentSessionId);
  }

  getCurrentRunId(): string | undefined {
    return this.getCurrentTrace()?.id;
  }

  async ensureRun(options?: EnsureRunOptions): Promise<ExecutionTrace> {
    this.currentSessionId = options?.sessionId;
    const trace = await this.runManager.ensureRun(options);
    if (this.applyRunMetadata(trace, options)) {
      await this.runManager.persistTrace(trace);
    }
    return trace;
  }

  assertRunActive(): void {
    const trace = this.getCurrentTrace();
    if (!trace) {
      return;
    }
    if (trace.status === 'cancelled') {
      throw new Error(
        'Current run was cancelled. Pass newRun: true to continue.'
      );
    }
    this.assertRunNotExpired(trace);
  }

  resolveArguments(args: Record<string, unknown>): {
    arguments: Record<string, unknown>;
    refs: string[];
  } {
    const trace = this.getCurrentTrace();
    if (!trace) {
      return { arguments: args, refs: [] };
    }
    return resolveEvidenceRefs(args, trace);
  }

  async recordCall(
    input: RecordCallInput
  ): Promise<{ address: string; runId: string }> {
    const trace = this.getCurrentTrace();
    if (!trace) {
      throw new Error('No active run to record call');
    }

    const callIndex = trace.calls.length;
    const address = makeAddress(callIndex);
    const redactedOutput =
      input.output === undefined ? undefined : redactValue(input.output);
    const outputBytes =
      input.storedBytes ??
      (redactedOutput === undefined
        ? undefined
        : estimateUtf8Bytes(redactedOutput));

    const call: TraceCall = {
      address,
      arguments: redactValue(input.arguments) as Record<string, unknown>,
      durationMs: input.durationMs,
      endedAt: input.endedAt,
      error: input.error,
      estimatedOutputTokens:
        outputBytes === undefined
          ? undefined
          : estimateTokensFromBytes(outputBytes),
      id: randomUUID(),
      originalBytes: input.originalBytes,
      output: redactedOutput,
      outputBytes,
      refs: input.refs?.length ? input.refs : undefined,
      returnedBytes: input.returnedBytes,
      sideEffect: input.sideEffect,
      startedAt: input.startedAt,
      status: input.status,
      storedBytes: input.storedBytes,
      toolFingerprint: input.toolFingerprint,
      toolId: input.toolId,
      truncated: input.truncated,
    };

    trace.calls.push(call);
    trace.toolFingerprints[input.toolId] = input.toolFingerprint;
    const hasFailure = trace.calls.some(
      (entry) => entry.status !== 'succeeded' && entry.status !== 'denied'
    );
    trace.status = hasFailure ? 'failed' : 'running';
    trace.endedAt = input.endedAt;

    await this.runManager.persistTrace(trace);
    await appendTraceEvent(this.configDir, {
      attempt: 0,
      capability: input.toolId.startsWith('system.')
        ? input.toolId
        : 'mcp.call',
      endedAt: input.endedAt,
      error: input.error,
      operationKey: `${input.toolId}:${input.toolFingerprint}`,
      risk: input.sideEffect,
      runId: trace.id,
      sessionId: trace.sessionId,
      startedAt: input.startedAt,
      status: input.status,
      toolId: input.toolId,
    });

    return { address, runId: trace.id };
  }

  async finalizeCurrentRun(): Promise<void> {
    const finalized = await this.runManager.finalizeRun(this.currentSessionId);
    if (finalized?.status === 'succeeded' && this.onRunFinalized) {
      await this.onRunFinalized(finalized);
    }
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
    const trace = this.getCurrentTrace();
    if (!trace || trace.calls.length === 0) {
      return;
    }
    const lastCall = trace.calls.at(-1);
    if (!lastCall) {
      return;
    }
    lastCall.returnedBytes = metrics.returnedBytes;
    lastCall.storedBytes = metrics.storedBytes;
    lastCall.outputBytes = metrics.storedBytes;
    lastCall.estimatedOutputTokens = estimateTokensFromBytes(
      metrics.storedBytes
    );
    await this.runManager.persistTrace(trace);
  }

  private getCurrentTrace(): ExecutionTrace | undefined {
    return this.runManager.getTrace(this.currentSessionId);
  }

  private applyRunMetadata(
    trace: ExecutionTrace,
    options?: EnsureRunOptions
  ): boolean {
    let changed = false;
    if (options?.client && !trace.client) {
      trace.client = options.client;
      changed = true;
    }
    if (options?.sessionId && !trace.sessionId) {
      trace.sessionId = options.sessionId;
      changed = true;
    }
    if (options?.skillId && !trace.skillId) {
      trace.skillId = options.skillId;
      changed = true;
    }
    return changed;
  }

  private assertRunNotExpired(trace: ExecutionTrace): void {
    const started = Date.parse(trace.startedAt);
    if (Number.isNaN(started)) {
      return;
    }
    if (Date.now() - started > WHOLE_RUN_DEADLINE_MS) {
      trace.status = 'failed';
      trace.endedAt = new Date().toISOString();
      void this.runManager.persistTrace(trace);
      this.runManager.clearTrace(this.currentSessionId);
      throw new Error(
        `Run "${trace.id}" exceeded the ${WHOLE_RUN_DEADLINE_MS / 60_000} minute deadline. Pass newRun: true to start a fresh run.`
      );
    }
  }
}

export function prepareCallOutput(result: unknown): {
  output: unknown;
  truncated: boolean;
  originalBytes?: number;
} {
  return shapeCallResult(result);
}

export function inferSideEffect(
  toolId: string,
  toolName?: string,
  description?: string
): ToolRisk {
  const name = toolName ?? toolId.split('.').pop() ?? toolId;
  return classifyToolRisk(name, description ?? '');
}
