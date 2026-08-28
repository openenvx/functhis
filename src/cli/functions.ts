import { join } from 'node:path';

import { getPackagesDir } from '../packages/paths';
import { formatVerificationReport, testFunction } from '../packages/test';
import { loadConfig } from '../storage/config';
import { resolveConfigDir } from '../storage/paths';
import { UpstreamManager } from '../upstream/manager';

export async function runFunctionsTest(options: {
  approveWrites?: boolean;
  compiledFrom?: string;
  dir?: string;
  mode?: 'live' | 'replay';
  name: string;
  packagesDir?: string;
}): Promise<string> {
  const configDir = resolveConfigDir(options.dir);
  const configPath = join(configDir, 'upstreams.json');
  const config = await loadConfig(configPath);
  const manager = new UpstreamManager();
  const packagesRoot = getPackagesDir(process.cwd(), options.packagesDir);
  const packageDir = join(packagesRoot, options.name);

  try {
    await manager.connectAll(config.upstreams);
    const report = await testFunction(manager, {
      approveWrites: options.approveWrites,
      compiledFrom: options.compiledFrom,
      configDir,
      mode: options.mode ?? 'replay',
      name: options.name,
      packageDir,
    });
    return formatVerificationReport(report);
  } finally {
    await manager.closeAll();
  }
}
