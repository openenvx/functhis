import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as z from 'zod/v4';

export const traceEventSchema = z.object({
  attempt: z.number().int().nonnegative().default(0),
  capability: z.string(),
  endedAt: z.string(),
  error: z.string().optional(),
  operationKey: z.string().optional(),
  risk: z.enum(['read', 'write', 'unknown']).optional(),
  runId: z.string(),
  sessionId: z.string().optional(),
  startedAt: z.string(),
  status: z.enum(['succeeded', 'failed', 'denied', 'timeout', 'cancelled']),
  toolId: z.string().optional(),
});

export type TraceEvent = z.infer<typeof traceEventSchema>;

function eventsPath(configDir: string): string {
  return join(configDir, 'events.jsonl');
}

export async function appendTraceEvent(
  configDir: string,
  event: TraceEvent
): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const line = `${JSON.stringify(traceEventSchema.parse(event))}\n`;
  await appendFile(eventsPath(configDir), line, 'utf-8');
}

export async function listTraceEvents(
  configDir: string,
  options: { limit?: number; runId?: string } = {}
): Promise<TraceEvent[]> {
  const limit = options.limit ?? 200;
  try {
    const raw = await readFile(eventsPath(configDir), 'utf-8');
    const events = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => traceEventSchema.parse(JSON.parse(line)));
    const filtered = options.runId
      ? events.filter((event) => event.runId === options.runId)
      : events;
    return filtered.slice(-limit);
  } catch {
    return [];
  }
}
