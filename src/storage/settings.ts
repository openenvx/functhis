import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as z from 'zod/v4';

export const retentionSettingsSchema = z.object({
  maxAgeDays: z.number().int().positive().default(30),
  maxRuns: z.number().int().positive().default(200),
});

export const functhisSettingsSchema = z.object({
  retention: retentionSettingsSchema.optional(),
  version: z.literal(1).default(1),
});

export type FuncthisSettings = z.infer<typeof functhisSettingsSchema>;
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

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
