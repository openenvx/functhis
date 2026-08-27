import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import * as z from 'zod/v4';

export const upstreamServerSchema = z.object({
  allowedTools: z.array(z.string()).optional(),
  args: z.array(z.string()).default([]),
  command: z.string().min(1),
  cwd: z.string().optional(),
  deniedTools: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
  env: z.record(z.string(), z.string()).optional(),
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  transport: z.literal('stdio'),
});

export const upstreamsConfigSchema = z.object({
  upstreams: z.array(upstreamServerSchema),
  version: z.literal(1),
});

export type UpstreamServer = z.infer<typeof upstreamServerSchema>;
export type UpstreamsConfig = z.infer<typeof upstreamsConfigSchema>;

export function getDefaultConfig(): UpstreamsConfig {
  return {
    upstreams: [],
    version: 1,
  };
}

export async function loadConfig(path: string): Promise<UpstreamsConfig> {
  const raw = await readFile(path, 'utf-8');
  return upstreamsConfigSchema.parse(JSON.parse(raw));
}

export async function saveConfig(
  path: string,
  config: UpstreamsConfig
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
