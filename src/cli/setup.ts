import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  findPackageRoot,
  fixtureServerPath,
  invocationForScript,
} from '../paths';
import { getDefaultConfig, saveConfig } from '../storage/config';
import type { UpstreamsConfig } from '../storage/config';
import { resolveConfigDir } from '../storage/paths';
import { backupFileIfExists } from './backup';
import {
  discoverClientConfigTargets,
  mergeFuncthisClientConfig,
} from './client-config';
import type { ClientTarget } from './client-config';

const packageRoot = findPackageRoot(import.meta.url);

export function getStarterConfig(): UpstreamsConfig {
  const catalog = invocationForScript(
    fixtureServerPath(packageRoot, 'catalog')
  );
  const readonly = invocationForScript(
    fixtureServerPath(packageRoot, 'readonly')
  );

  return {
    upstreams: [
      {
        args: catalog.args,
        command: catalog.command,
        enabled: true,
        id: 'catalog',
        label: 'Fake catalog server (fixture)',
        transport: 'stdio',
      },
      {
        args: readonly.args,
        command: readonly.command,
        enabled: true,
        id: 'readonly',
        label: 'Fake read-only server',
        transport: 'stdio',
      },
    ],
    version: 1,
  };
}

export interface SetupResult {
  backupPath?: string;
  clientWrites?: { backupPath?: string; changed: boolean; path: string }[];
  created: boolean;
  path: string;
}

export async function runSetup(options: {
  dir?: string;
  dryRun?: boolean;
  force?: boolean;
  functionsDir?: string;
  writeClient?: ClientTarget[];
}): Promise<SetupResult> {
  const configDir = resolveConfigDir(options.dir);
  const configPath = join(configDir, 'upstreams.json');

  if (existsSync(configPath) && !options.force) {
    throw new Error(
      `Config already exists at ${configPath}. Pass --force to overwrite.`
    );
  }

  let backupPath: string | undefined;
  if (existsSync(configPath) && options.force && !options.dryRun) {
    backupPath = await backupFileIfExists(configPath);
  }

  if (options.dryRun) {
    const clientWrites = (options.writeClient ?? []).flatMap((client) =>
      discoverClientConfigTargets(client).map((target) => ({
        changed: true,
        path: target.path,
      }))
    );
    return {
      backupPath,
      clientWrites,
      created: !existsSync(configPath) || options.force === true,
      path: configPath,
    };
  }

  await mkdir(configDir, { recursive: true });
  const config =
    existsSync(configPath) && !options.force
      ? getDefaultConfig()
      : getStarterConfig();
  await saveConfig(configPath, config);

  const clientWrites: SetupResult['clientWrites'] = [];
  for (const client of options.writeClient ?? []) {
    for (const target of discoverClientConfigTargets(client)) {
      const result = await mergeFuncthisClientConfig({
        client,
        functionsDir: options.functionsDir,
        targetPath: target.path,
      });
      clientWrites.push(result);
    }
  }

  return {
    backupPath,
    clientWrites,
    created: true,
    path: configPath,
  };
}

export function formatSetupReport(result: SetupResult): string {
  const lines = [`Wrote config to ${result.path}`];
  if (result.backupPath) {
    lines.push(`Backed up previous config to ${result.backupPath}`);
  }
  for (const write of result.clientWrites ?? []) {
    if (write.changed) {
      lines.push(`Updated client MCP config: ${write.path}`);
      if (write.backupPath) {
        lines.push(`  backup: ${write.backupPath}`);
      }
    } else {
      lines.push(`Client MCP config unchanged: ${write.path}`);
    }
  }
  return lines.join('\n');
}
