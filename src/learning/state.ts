import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as z from 'zod/v4';

import { learningJobSchema } from './jobs';

const learningStateSchema = z.object({
  crystallizedCandidateIds: z.array(z.string()).default([]),
  crystallizedPackages: z
    .array(
      z.object({
        candidateId: z.string(),
        name: z.string(),
        runId: z.string(),
        savedAt: z.string(),
        status: z.enum(['promoted', 'quarantined']).default('promoted'),
      })
    )
    .default([]),
  jobs: z.array(learningJobSchema).default([]),
  version: z.literal(2).default(2),
});

export type LearningState = z.infer<typeof learningStateSchema>;

function statePath(configDir: string): string {
  return join(configDir, 'learning.json');
}

export async function loadLearningState(
  configDir: string
): Promise<LearningState> {
  try {
    const raw = await readFile(statePath(configDir), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.version) {
      parsed.version = 2;
    }
    return learningStateSchema.parse(parsed);
  } catch {
    return {
      crystallizedCandidateIds: [],
      crystallizedPackages: [],
      jobs: [],
      version: 2,
    };
  }
}

export async function saveLearningState(
  configDir: string,
  state: LearningState
): Promise<void> {
  const path = statePath(configDir);
  const tempPath = `${path}.tmp`;
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf-8');
  await rename(tempPath, path);
}

export function hasCrystallizedCandidate(
  state: LearningState,
  candidateId: string
): boolean {
  return state.crystallizedCandidateIds.includes(candidateId);
}

export function findJobByCandidate(
  state: LearningState,
  candidateId: string
): LearningState['jobs'][number] | undefined {
  return state.jobs.find((job) => job.candidateId === candidateId);
}

export function upsertJob(
  state: LearningState,
  job: LearningState['jobs'][number]
): LearningState {
  const jobs = [...state.jobs.filter((entry) => entry.id !== job.id), job];
  return { ...state, jobs };
}

export function markCandidateCrystallized(
  state: LearningState,
  entry: {
    candidateId: string;
    name: string;
    runId: string;
    status?: 'promoted' | 'quarantined';
  }
): LearningState {
  const crystallizedCandidateIds = state.crystallizedCandidateIds.includes(
    entry.candidateId
  )
    ? state.crystallizedCandidateIds
    : [...state.crystallizedCandidateIds, entry.candidateId];

  return {
    ...state,
    crystallizedCandidateIds,
    crystallizedPackages: [
      ...state.crystallizedPackages.filter(
        (pkg) => pkg.candidateId !== entry.candidateId
      ),
      {
        candidateId: entry.candidateId,
        name: entry.name,
        runId: entry.runId,
        savedAt: new Date().toISOString(),
        status: entry.status ?? 'promoted',
      },
    ],
  };
}
