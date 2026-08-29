import { loadTrace } from '../trace/store';
import type { AutonomousLearningDeps } from './autonomous';
import { processAutonomousLearning } from './autonomous';
import { updateLearningJob } from './jobs';
import { loadLearningState, saveLearningState, upsertJob } from './state';

const TERMINAL_JOB_STATUSES = new Set(['promoted', 'quarantined']);

export async function recoverOrphanedLearningJobs(
  deps: AutonomousLearningDeps
): Promise<{ recovered: number; skipped: number }> {
  let state = await loadLearningState(deps.configDir);
  let recovered = 0;
  let skipped = 0;

  for (const job of state.jobs) {
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      continue;
    }

    try {
      const trace = await loadTrace(deps.configDir, job.runId);
      if (trace.status !== 'succeeded') {
        skipped += 1;
        continue;
      }

      state = upsertJob(
        state,
        updateLearningJob(job, { attempts: job.attempts + 1 })
      );
      await saveLearningState(deps.configDir, state);
      await processAutonomousLearning(deps, trace);
      recovered += 1;
    } catch {
      skipped += 1;
    }
  }

  return { recovered, skipped };
}
