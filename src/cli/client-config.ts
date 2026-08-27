import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import * as z from 'zod/v4';

import { parseJsonc } from '../import/clients';
import { backupFileIfExists } from './backup';

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

export type ClientTarget = 'cursor' | 'claude' | 'opencode';

export interface ClientConfigTarget {
  label: string;
  path: string;
  scope: 'global' | 'project';
}

export function detectClient(cwd = process.cwd()): ClientTarget {
  const home = homedir();
  if (existsSync(join(cwd, '.cursor', 'mcp.json'))) {
    return 'cursor';
  }
  if (existsSync(join(cwd, '.mcp.json'))) {
    return 'claude';
  }
  if (
    existsSync(join(cwd, 'opencode.json')) ||
    existsSync(join(cwd, 'opencode.jsonc')) ||
    existsSync(join(cwd, '.opencode', 'opencode.json')) ||
    existsSync(join(cwd, '.opencode', 'opencode.jsonc'))
  ) {
    return 'opencode';
  }
  if (existsSync(join(home, '.cursor', 'mcp.json'))) {
    return 'cursor';
  }
  if (existsSync(join(home, '.claude', 'mcp.json'))) {
    return 'claude';
  }
  if (
    existsSync(join(home, '.config', 'opencode', 'opencode.json')) ||
    existsSync(join(home, '.config', 'opencode', 'opencode.jsonc'))
  ) {
    return 'opencode';
  }
  return 'cursor';
}

export function discoverClientConfigTargets(
  client: ClientTarget,
  cwd = process.cwd()
): ClientConfigTarget[] {
  if (client === 'cursor') {
    const targets: ClientConfigTarget[] = [];
    const globalPath = join(homedir(), '.cursor', 'mcp.json');
    const projectPath = join(cwd, '.cursor', 'mcp.json');
    if (existsSync(globalPath)) {
      targets.push({
        label: 'Cursor global',
        path: globalPath,
        scope: 'global',
      });
    }
    if (existsSync(projectPath)) {
      targets.push({
        label: 'Cursor project',
        path: projectPath,
        scope: 'project',
      });
    }
    if (targets.length === 0) {
      targets.push({
        label: 'Cursor global',
        path: globalPath,
        scope: 'global',
      });
    }
    return targets;
  }

  if (client === 'claude') {
    const targets: ClientConfigTarget[] = [];
    const claudeGlobal = join(homedir(), '.claude', 'mcp.json');
    const claudeProject = join(cwd, '.mcp.json');
    if (existsSync(claudeGlobal)) {
      targets.push({
        label: 'Claude global',
        path: claudeGlobal,
        scope: 'global',
      });
    }
    if (existsSync(claudeProject)) {
      targets.push({
        label: 'Claude project',
        path: claudeProject,
        scope: 'project',
      });
    }
    if (targets.length === 0) {
      targets.push({
        label: 'Claude global',
        path: claudeGlobal,
        scope: 'global',
      });
    }
    return targets;
  }

  const targets: ClientConfigTarget[] = [];
  const globalCandidates = [
    join(homedir(), '.config', 'opencode', 'opencode.json'),
    join(homedir(), '.config', 'opencode', 'opencode.jsonc'),
  ];
  for (const path of globalCandidates) {
    if (existsSync(path)) {
      targets.push({
        label: 'OpenCode global',
        path,
        scope: 'global',
      });
      break;
    }
  }

  const projectCandidates = [
    join(cwd, 'opencode.json'),
    join(cwd, 'opencode.jsonc'),
    join(cwd, '.opencode', 'opencode.json'),
    join(cwd, '.opencode', 'opencode.jsonc'),
  ];
  for (const path of projectCandidates) {
    if (existsSync(path)) {
      targets.push({
        label: 'OpenCode project',
        path,
        scope: 'project',
      });
      break;
    }
  }

  if (targets.length === 0) {
    targets.push({
      label: 'OpenCode global',
      path: join(homedir(), '.config', 'opencode', 'opencode.jsonc'),
      scope: 'global',
    });
  }
  return targets;
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
