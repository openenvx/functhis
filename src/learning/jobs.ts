import { randomUUID } from 'node:crypto';

import * as z from 'zod/v4';

export const learningJobStatusSchema = z.enum([
  'observed',
  'candidate',
  'compiled',
  'verified',
  'policy_evaluated',
  'staged',
  'promoted',
  'quarantined',
]);

export type LearningJobStatus = z.infer<typeof learningJobStatusSchema>;

export const learningJobSchema = z.object({
  attempts: z.number().int().nonnegative().default(0),
  candidateFingerprint: z.string(),
  candidateId: z.string(),
  error: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
  packageName: z.string().optional(),
  runId: z.string(),
  status: learningJobStatusSchema,
  updatedAt: z.string(),
});

export type LearningJob = z.infer<typeof learningJobSchema>;

export function createLearningJob(input: {
  candidateFingerprint: string;
  candidateId: string;
  runId: string;
}): LearningJob {
  return {
    attempts: 0,
    candidateFingerprint: input.candidateFingerprint,
    candidateId: input.candidateId,
    id: randomUUID(),
    runId: input.runId,
    status: 'observed',
    updatedAt: new Date().toISOString(),
  };
}

export function updateLearningJob(
  job: LearningJob,
  patch: Partial<LearningJob> & { status?: LearningJobStatus }
): LearningJob {
  return {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}
