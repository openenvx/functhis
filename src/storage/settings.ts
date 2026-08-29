import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as z from 'zod/v4';

export const retentionSettingsSchema = z.object({
  maxAgeDays: z.number().int().positive().default(30),
  maxRuns: z.number().int().positive().default(200),
});

export const learningSettingsSchema = z.object({
  allowedWriteTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  maxConcurrency: z.number().int().min(1).max(8).default(2),
  minOccurrences: z.number().int().min(2).max(20).default(2),
  writePolicy: z.enum(['deny', 'scoped']).default('scoped'),
});

export const functhisSettingsSchema = z.object({
  learning: learningSettingsSchema.optional(),
  retention: retentionSettingsSchema.optional(),
  version: z.literal(1).default(1),
});

export type FuncthisSettings = z.infer<typeof functhisSettingsSchema>;
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;
export type LearningSettings = z.infer<typeof learningSettingsSchema>;

export const DEFAULT_RETENTION: RetentionSettings = {
  maxAgeDays: 30,
  maxRuns: 200,
};

export async function loadSettings(
  configDir: string
): Promise<FuncthisSettings> {
  const path = join(configDir, 'settings.json');
  try {
    const raw = await readFile(path, 'utf-8');
    return functhisSettingsSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1 };
  }
}

export function resolveRetention(
  settings: FuncthisSettings
): RetentionSettings {
  return {
    ...DEFAULT_RETENTION,
    ...settings.retention,
  };
}
