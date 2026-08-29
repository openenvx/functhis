import { readdir, readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertValidAddress,
  assertValidRunId,
  executionTraceSchema,
} from './schema';
import type { ExecutionTrace, TraceCall } from './schema';

export function getRunsDir(configDir: string): string {
  return join(configDir, 'runs');
}

export function getRunPath(configDir: string, runId: string): string {
  assertValidRunId(runId);
  return join(getRunsDir(configDir), `${runId}.json`);
}

export async function saveTrace(
  configDir: string,
  trace: ExecutionTrace
): Promise<void> {
  assertValidRunId(trace.id);
  const runsDir = getRunsDir(configDir);
  await mkdir(runsDir, { recursive: true });
  const targetPath = join(runsDir, `${trace.id}.json`);
  const tempPath = `${targetPath}.tmp`;
  const payload = `${JSON.stringify(trace, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf-8');
  await rename(tempPath, targetPath);
}

const LOAD_TRACE_RETRY_DELAYS_MS = [10, 25, 50] as const;

export async function loadTrace(
  configDir: string,
  runId: string
): Promise<ExecutionTrace> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= LOAD_TRACE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const path = getRunPath(configDir, runId);
      const raw = await readFile(path, 'utf-8');
      return executionTraceSchema.parse(JSON.parse(raw));
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      const delay = LOAD_TRACE_RETRY_DELAYS_MS[attempt];
      if (code === 'ENOENT' && delay !== undefined) {
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function listTraces(configDir: string): Promise<ExecutionTrace[]> {
  const runsDir = getRunsDir(configDir);
  try {
    const entries = await readdir(runsDir);
    const traces: ExecutionTrace[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.endsWith('.tmp')) {
        continue;
      }
      const runId = entry.slice(0, -'.json'.length);
      try {
        traces.push(await loadTrace(configDir, runId));
      } catch {
        // skip corrupted files
      }
    }
    return traces.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function getCallByAddress(
  trace: ExecutionTrace,
  address: string
): TraceCall | undefined {
  assertValidAddress(address);
  return trace.calls.find((call) => call.address === address);
}
