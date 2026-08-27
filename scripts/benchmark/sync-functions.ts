import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FNBENCH_CASES } from '../../fixtures/benchmark/cases';
import { getPackageRoot, withBenchmarkConfigDir } from './config';
import { benchmarkFunctionSource } from './replay';
import { loadConfig } from '../../src/storage/config';
import { UpstreamManager } from '../../src/upstream/manager';

export function getBenchmarkFunctionsDir(packageRoot: string): string {
  return join(packageRoot, 'fixtures', 'benchmark', 'functions');
}

export async function syncBenchmarkFunctions(options: {
  configPath: string;
  functionsDir: string;
}): Promise<void> {
  const config = await loadConfig(options.configPath);
  const manager = new UpstreamManager();
  try {
    await manager.connectAll(config.upstreams);
    await mkdir(options.functionsDir, { recursive: true });
    for (const caseDef of FNBENCH_CASES) {
      const tool = manager.catalog.getTool(caseDef.upstreamId);
      if (!tool) {
        throw new Error(`Tool not found: ${caseDef.upstreamId}`);
      }
      const source = benchmarkFunctionSource(caseDef, tool.fingerprint);
      await writeFile(
        join(options.functionsDir, `${caseDef.id}.ts`),
        source,
        'utf-8'
      );
    }
  } finally {
    await manager.closeAll();
  }
}

async function main(): Promise<void> {
  const packageRoot = getPackageRoot();
  const functionsDir = getBenchmarkFunctionsDir(packageRoot);
  await withBenchmarkConfigDir(async ({ configPath }) => {
    await syncBenchmarkFunctions({ configPath, functionsDir });
  });
  console.log(`Wrote ${FNBENCH_CASES.length} functions to ${functionsDir}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
