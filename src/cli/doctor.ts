import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { FunctionLibrary } from '../functions/library';
import { getFunctionsDir } from '../functions/paths';
import { findPackageRoot } from '../paths';
import { loadConfig } from '../storage/config';
import { resolveConfigDir } from '../storage/paths';
import { UpstreamManager } from '../upstream/manager';
import { countBackupsForFile } from './backup';

const packageJson = JSON.parse(
  readFileSync(join(findPackageRoot(import.meta.url), 'package.json'), 'utf-8')
) as { version: string };

export interface DoctorResult {
  backups: number;
  configPath: string;
  environment: {
    nodeVersion: string;
    packageVersion: string;
  };
  functions: {
    loaded: string[];
    skipped: { name: string; error: string }[];
    total: number;
  };
  upstreams: {
    id: string;
    label: string;
    enabled: boolean;
    toolCount?: number;
    error?: string;
  }[];
  totalTools: number;
  ok: boolean;
}

export async function runDoctor(options: {
  dir?: string;
  functionsDir?: string;
}): Promise<DoctorResult> {
  const configDir = resolveConfigDir(options.dir);
  const configPath = join(configDir, 'upstreams.json');

  if (!existsSync(configPath)) {
    throw new Error(`No config at ${configPath}. Run "fn setup" first.`);
  }

  const config = await loadConfig(configPath);
  const manager = new UpstreamManager();
  const functionsRoot = getFunctionsDir(process.cwd(), options.functionsDir);
  const library = await FunctionLibrary.load(functionsRoot);
  const backups = await countBackupsForFile(configPath);

  try {
    const connectionResults = await manager.connectAll(config.upstreams);
    const upstreams = config.upstreams.map((upstream) => {
      const result = connectionResults.get(upstream.id);
      if (result instanceof Error) {
        return {
          enabled: upstream.enabled,
          error: result.message,
          id: upstream.id,
          label: upstream.label,
        };
      }
      return {
        enabled: upstream.enabled,
        id: upstream.id,
        label: upstream.label,
        toolCount: result,
      };
    });

    const totalTools = manager.catalog.size();
    const ok = upstreams.every((u) => !u.enabled || u.toolCount !== undefined);

    return {
      backups,
      configPath,
      environment: {
        nodeVersion: process.version,
        packageVersion: packageJson.version,
      },
      functions: {
        loaded: library.getAll().map((definition) => definition.name),
        skipped: library.getSkipped(),
        total: library.size(),
      },
      ok,
      totalTools,
      upstreams,
    };
  } finally {
    await manager.closeAll();
  }
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines = [
    `Functhis ${result.environment.packageVersion} (Node ${result.environment.nodeVersion})`,
    `Config: ${result.configPath}`,
    `Config backups: ${result.backups}`,
    '',
  ];
  for (const upstream of result.upstreams) {
    if (upstream.error) {
      lines.push(`✗ ${upstream.id} (${upstream.label}): ${upstream.error}`);
    } else if (upstream.enabled) {
      lines.push(
        `✓ ${upstream.id} (${upstream.label}): ${upstream.toolCount} tools`
      );
    } else {
      lines.push(`- ${upstream.id} (${upstream.label}): disabled`);
    }
  }
  lines.push(
    '',
    `Total indexed tools: ${result.totalTools}`,
    `Loaded Functions: ${result.functions.total}`
  );
  if (result.functions.loaded.length > 0) {
    lines.push(`  ${result.functions.loaded.join(', ')}`);
  }
  for (const skipped of result.functions.skipped) {
    lines.push(`  ⚠ skipped ${skipped.name}: ${skipped.error}`);
  }
  lines.push('', result.ok ? 'Status: OK' : 'Status: FAILED');
  return lines.join('\n');
}
