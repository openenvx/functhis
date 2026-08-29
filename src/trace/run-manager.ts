import type { GraphService } from '../graph/service';
import type { EnsureRunOptions } from './recorder';
import { generateRunId, REDACTION_VERSION } from './schema';
import type { ExecutionTrace } from './schema';
import { loadTrace, saveTrace } from './store';

function sessionKey(options?: EnsureRunOptions): string {
  return options?.sessionId ?? 'default';
}

export class RunManager {
  private activeRuns = new Map<string, ExecutionTrace>();
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly configDir: string,
    private readonly graph?: GraphService
  ) {}

  getTrace(sessionId?: string): ExecutionTrace | undefined {
    return this.activeRuns.get(sessionId ?? 'default');
  }

  setTrace(sessionId: string | undefined, trace: ExecutionTrace): void {
    this.activeRuns.set(sessionId ?? 'default', trace);
  }

  clearTrace(sessionId?: string): void {
    this.activeRuns.delete(sessionId ?? 'default');
  }

  async ensureRun(options?: EnsureRunOptions): Promise<ExecutionTrace> {
    const key = sessionKey(options);

    if (options?.newRun) {
      await this.finalizeRun(key);
      const trace = this.createRun(options);
      this.activeRuns.set(key, trace);
      await this.persist(trace);
      return trace;
    }

    if (options?.runId) {
      const existing = this.activeRuns.get(key);
      if (existing?.id === options.runId) {
        return existing;
      }
      const loaded = await loadTrace(this.configDir, options.runId);
      if (loaded.status !== 'running') {
        throw new Error(
          `Run "${options.runId}" is ${loaded.status}. Pass newRun: true to start a fresh run.`
        );
      }
      this.activeRuns.set(key, loaded);
      return loaded;
    }

    const current = this.activeRuns.get(key);
    if (current) {
      return current;
    }

    const trace = this.createRun(options);
    this.activeRuns.set(key, trace);
    await this.persist(trace);
    return trace;
  }

  async finalizeRun(
    sessionId = 'default'
  ): Promise<ExecutionTrace | undefined> {
    const trace = this.activeRuns.get(sessionId);
    if (!trace || trace.calls.length === 0) {
      this.activeRuns.delete(sessionId);
      return undefined;
    }

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
    trace.endedAt = new Date().toISOString();
    await this.persist(trace);
    this.activeRuns.delete(sessionId);
    return trace;
  }

  async finalizeAll(): Promise<ExecutionTrace[]> {
    const finalized: ExecutionTrace[] = [];
    for (const key of this.activeRuns.keys()) {
      const trace = await this.finalizeRun(key);
      if (trace) {
        finalized.push(trace);
      }
    }
    return finalized;
  }

  async persistTrace(trace: ExecutionTrace): Promise<void> {
    await this.persist(trace);
  }

  private createRun(options?: EnsureRunOptions): ExecutionTrace {
    return {
      calls: [],
      client: options?.client,
      cwd: options?.cwd ?? process.cwd(),
      id: generateRunId(),
      redactionVersion: REDACTION_VERSION,
      sessionId: options?.sessionId,
      skillId: options?.skillId,
      startedAt: new Date().toISOString(),
      status: 'running',
      toolFingerprints: {},
    };
  }

  private async persist(trace: ExecutionTrace): Promise<void> {
    const task = this.persistChain.then(async () => {
      await saveTrace(this.configDir, trace);
      this.graph?.indexRun(trace);
    });
    this.persistChain = task.catch(() => undefined);
    await task;
  }
}
