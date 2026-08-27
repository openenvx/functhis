import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import * as z from 'zod/v4';

import { discoverWriteTargets } from '../clients/paths';
import type { ClientConfigTarget, ClientTarget } from '../clients/paths';
import { parseJsonc } from '../import/clients';
import { backupFileIfExists } from './backup';

export type { ClientConfigTarget, ClientTarget } from '../clients/paths';
export { detectClient, discoverWriteTargets } from '../clients/paths';

const mcpServerEntrySchema = z.object({
  args: z.array(z.string()).optional(),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const mcpFileSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerEntrySchema),
});

const opencodeLocalEntrySchema = z.object({
  command: z.array(z.string()),
  cwd: z.string().optional(),
  enabled: z.boolean().optional(),
  type: z.literal('local'),
});

const opencodeFileSchema = z.object({
  mcp: z.record(z.string(), z.unknown()).optional(),
});

export function discoverClientConfigTargets(
  client: ClientTarget,
  cwd = process.cwd()
): ClientConfigTarget[] {
  return discoverWriteTargets(client, cwd);
}

export function getFuncthisMcpEntry(functionsDir?: string): {
  command: string;
  args: string[];
} {
  const args = ['serve'];
  if (functionsDir) {
    args.push('--functions-dir', functionsDir);
  }
  return { args, command: 'fn' };
}

function getFuncthisOpenCodeEntry(
  functionsDir?: string
): z.infer<typeof opencodeLocalEntrySchema> {
  const entry = getFuncthisMcpEntry(functionsDir);
  return {
    command: [entry.command, ...entry.args],
    enabled: true,
    type: 'local',
  };
}

function parseConfigFile(path: string): unknown {
  const raw = readFileSync(path, 'utf-8');
  return path.endsWith('.jsonc') ? parseJsonc(raw) : JSON.parse(raw);
}

export async function mergeFuncthisClientConfig(options: {
  client: ClientTarget;
  targetPath: string;
  functionsDir?: string;
  dryRun?: boolean;
}): Promise<{ backupPath?: string; changed: boolean; path: string }> {
  if (options.client === 'opencode') {
    return mergeFuncthisOpenCodeConfig(options);
  }

  const entry = getFuncthisMcpEntry(options.functionsDir);
  let existing: z.infer<typeof mcpFileSchema> = { mcpServers: {} };

  if (existsSync(options.targetPath)) {
    const raw = await readFile(options.targetPath, 'utf-8');
    existing = mcpFileSchema.parse(JSON.parse(raw));
  }

  const current = existing.mcpServers.functhis;
  const unchanged =
    current?.command === entry.command &&
    JSON.stringify(current.args ?? []) === JSON.stringify(entry.args);

  if (unchanged) {
    return { changed: false, path: options.targetPath };
  }

  if (options.dryRun) {
    return { changed: true, path: options.targetPath };
  }

  let backupPath: string | undefined;
  if (existsSync(options.targetPath)) {
    backupPath = await backupFileIfExists(options.targetPath);
  } else {
    await mkdir(dirname(options.targetPath), { recursive: true });
  }

  const next = {
    mcpServers: {
      ...existing.mcpServers,
      functhis: entry,
    },
  };
  await writeFile(
    options.targetPath,
    `${JSON.stringify(next, null, 2)}\n`,
    'utf-8'
  );

  return { backupPath, changed: true, path: options.targetPath };
}

async function mergeFuncthisOpenCodeConfig(options: {
  targetPath: string;
  functionsDir?: string;
  dryRun?: boolean;
}): Promise<{ backupPath?: string; changed: boolean; path: string }> {
  const entry = getFuncthisOpenCodeEntry(options.functionsDir);
  let existing: z.infer<typeof opencodeFileSchema> = { mcp: {} };

  if (existsSync(options.targetPath)) {
    existing = opencodeFileSchema.parse(parseConfigFile(options.targetPath));
  }

  const current = existing.mcp?.functhis;
  const unchanged =
    current !== undefined && JSON.stringify(current) === JSON.stringify(entry);

  if (unchanged) {
    return { changed: false, path: options.targetPath };
  }

  if (options.dryRun) {
    return { changed: true, path: options.targetPath };
  }

  let backupPath: string | undefined;
  if (existsSync(options.targetPath)) {
    backupPath = await backupFileIfExists(options.targetPath);
  } else {
    await mkdir(dirname(options.targetPath), { recursive: true });
  }

  const next = {
    ...existing,
    mcp: {
      ...existing.mcp,
      functhis: entry,
    },
  };
  await writeFile(
    options.targetPath,
    `${JSON.stringify(next, null, 2)}\n`,
    'utf-8'
  );

  return { backupPath, changed: true, path: options.targetPath };
}

export function readClientConfigSummary(path: string): string {
  if (!existsSync(path)) {
    return 'missing';
  }
  const raw = readFileSync(path, 'utf-8');
  if (path.endsWith('.jsonc') || path.includes('opencode')) {
    const parsed = opencodeFileSchema.safeParse(parseConfigFile(path));
    if (!parsed.success) {
      return 'invalid';
    }
    return parsed.data.mcp?.functhis
      ? 'configured'
      : 'present (no functhis entry)';
  }
  const parsed = mcpFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return 'invalid';
  }
  return parsed.data.mcpServers.functhis
    ? 'configured'
    : 'present (no functhis entry)';
}
