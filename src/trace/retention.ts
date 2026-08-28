import { unlink } from 'node:fs/promises';

import type { GraphService } from '../graph/service';
import { loadSettings, resolveRetention } from '../storage/settings';
import type { RetentionSettings } from '../storage/settings';
import { listTraces } from './store';

export interface RetentionReport {
  deletedRunIds: string[];
  keptRuns: number;
  reason: Record<string, 'age' | 'count'>;
}

export async function pruneTraces(
  configDir: string,
  options: {
    graph?: GraphService;
    retention?: RetentionSettings;
  } = {}
): Promise<RetentionReport> {
  const settings =
    options.retention ?? resolveRetention(await loadSettings(configDir));
  const traces = await listTraces(configDir);
  const now = Date.now();
  const maxAgeMs = settings.maxAgeDays * 24 * 60 * 60 * 1000;

  const sorted = [...traces].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  );

  const toDelete = new Set<string>();
  const reason: Record<string, 'age' | 'count'> = {};

  for (const trace of sorted) {
    const started = Date.parse(trace.startedAt);
    if (!Number.isNaN(started) && now - started > maxAgeMs) {
      toDelete.add(trace.id);
      reason[trace.id] = 'age';
    }
  }

  const keptByCount = sorted.filter((trace) => !toDelete.has(trace.id));
  if (keptByCount.length > settings.maxRuns) {
    for (const trace of keptByCount.slice(settings.maxRuns)) {
      toDelete.add(trace.id);
      reason[trace.id] = 'count';
    }
  }

  for (const runId of toDelete) {
    try {
      const { getRunPath } = await import('./store');
      await unlink(getRunPath(configDir, runId));
      options.graph?.deleteRunNode(runId);
    } catch {
      // skip missing files
    }
  }

  return {
    deletedRunIds: [...toDelete],
    keptRuns: sorted.length - toDelete.size,
    reason,
  };
}
