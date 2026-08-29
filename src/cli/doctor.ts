import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  importFromAllClients,
  listUnsupportedRemoteSkips,
} from '../import/clients';
import { PackageLibrary } from '../packages/library';
import { getPackagesDir } from '../packages/paths';
import { findPackageRoot } from '../paths';
import { loadConfig } from '../storage/config';
import { resolveConfigDir } from '../storage/paths';
import { UpstreamManager } from '../upstream/manager';
import { countBackupsForFile } from './backup';

const packageJson = JSON.parse(
  readFileSync(join(findPackageRoot(import.meta.url), 'package.json'), 'utf-8')
) as { version: string };

export interface DoctorSkippedRemote {
  name: string;
  reason: string;
  source: string;
}

export interface DoctorResult {
  backups: number;
  configPath: string;
  environment: {
    nodeVersion: string;
    packageVersion: string;
  };
  packages: {
    loaded: string[];
    total: number;
  };
  skippedRemote: DoctorSkippedRemote[];
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
  cwd?: string;
  dir?: string;
  packagesDir?: string;
}): Promise<DoctorResult> {
  const configDir = resolveConfigDir(options.dir);
  const configPath = join(configDir, 'upstreams.json');

  if (!existsSync(configPath)) {
    throw new Error(`No config at ${configPath}. Run "fn setup" first.`);
  }

  const config = await loadConfig(configPath);
  const manager = new UpstreamManager();
  const packagesRoot = getPackagesDir(process.cwd(), options.packagesDir);
  const packageLibrary = await PackageLibrary.load(packagesRoot);
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
    const skippedRemote = listUnsupportedRemoteSkips(
      importFromAllClients(options.cwd ?? process.cwd())
    );

    return {
      backups,
      configPath,
      environment: {
        nodeVersion: process.version,
        packageVersion: packageJson.version,
      },
      ok,
      packages: {
        loaded: packageLibrary.getAll().map((pkg) => pkg.manifest.name),
        total: packageLibrary.size(),
      },
      skippedRemote,
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
  if (result.skippedRemote.length > 0) {
    lines.push(
      '',
      `Warning: ${result.skippedRemote.length} HTTP/SSE or remote MCP server(s) are not imported (stdio only):`
    );
    for (const item of result.skippedRemote) {
      lines.push(`  ! ${item.name}: ${item.reason}`);
    }
  }
  lines.push(
    '',
    `Total indexed tools: ${result.totalTools}`,
    `Loaded packages: ${result.packages.total}`
  );
  if (result.packages.loaded.length > 0) {
    lines.push(`  ${result.packages.loaded.join(', ')}`);
  }
  lines.push('', result.ok ? 'Status: OK' : 'Status: FAILED');
  return lines.join('\n');
}
