import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  formatImportReport,
  importFromAllClients,
  importFromCursor,
  importFromSources,
  mergeUpstreamsConfig,
} from '../import/clients';
import type { ClientImportSource } from '../import/clients';
import { loadConfig, saveConfig } from '../storage/config';
import { resolveConfigDir } from '../storage/paths';

async function writeImportResult(
  result: ReturnType<typeof importFromSources>,
  options: { dir?: string; merge?: boolean; dryRun?: boolean }
): Promise<{ path: string; report: string }> {
  const report = formatImportReport(result);

  if (options.dryRun) {
    return { path: '(dry run)', report };
  }

  const configDir = resolveConfigDir(options.dir);
  const configPath = join(configDir, 'upstreams.json');
  await mkdir(configDir, { recursive: true });

  const mode = options.merge === false ? 'replace' : 'merge';
  const existing = existsSync(configPath)
    ? await loadConfig(configPath)
    : { upstreams: [], version: 1 as const };

  const merged = mergeUpstreamsConfig(existing, result.upstreams, mode);
  await saveConfig(configPath, merged);

  return {
    path: configPath,
    report: `${report}\n\nWrote ${merged.upstreams.length} upstream(s) to ${configPath}`,
  };
}

export async function runImportAll(options: {
  dir?: string;
  merge?: boolean;
  dryRun?: boolean;
  cwd?: string;
}): Promise<{ path: string; report: string }> {
  const result = importFromAllClients(options.cwd ?? process.cwd());
  return writeImportResult(result, options);
}

export async function runImportFromSources(options: {
  dir?: string;
  merge?: boolean;
  dryRun?: boolean;
  cwd?: string;
  sources?: ClientImportSource[];
}): Promise<{ path: string; report: string }> {
  const result = options.sources
    ? importFromSources(options.sources)
    : importFromCursor(options.cwd ?? process.cwd());
  return writeImportResult(result, options);
}
