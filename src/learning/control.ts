import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as z from 'zod/v4';

const learningControlSchema = z.object({
  paused: z.boolean().default(false),
  pausedAt: z.string().optional(),
  version: z.literal(1).default(1),
});

export type LearningControl = z.infer<typeof learningControlSchema>;

function controlPath(configDir: string): string {
  return join(configDir, 'learning-control.json');
}

export async function loadLearningControl(
  configDir: string
): Promise<LearningControl> {
  try {
    const raw = await readFile(controlPath(configDir), 'utf-8');
    return learningControlSchema.parse(JSON.parse(raw));
  } catch {
    return { paused: false, version: 1 };
  }
}

export async function saveLearningControl(
  configDir: string,
  control: LearningControl
): Promise<void> {
  await writeFile(
    controlPath(configDir),
    `${JSON.stringify(control, null, 2)}\n`,
    'utf-8'
  );
}

export async function pauseLearning(
  configDir: string
): Promise<LearningControl> {
  const control: LearningControl = {
    paused: true,
    pausedAt: new Date().toISOString(),
    version: 1,
  };
  await saveLearningControl(configDir, control);
  return control;
}

export async function resumeLearning(
  configDir: string
): Promise<LearningControl> {
  const control: LearningControl = { paused: false, version: 1 };
  await saveLearningControl(configDir, control);
  return control;
}

export async function isLearningPaused(configDir: string): Promise<boolean> {
  const control = await loadLearningControl(configDir);
  return control.paused;
}
