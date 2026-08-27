import { join } from 'node:path';

import { formatDriftReport } from '../functions/drift';
import { loadFixture, loadFunctionDefinition } from '../functions/load';
import { getFunctionsDir } from '../functions/paths';
import { testFunction } from '../functions/runner';
import { loadConfig } from '../storage/config';
import { getConfigPath, resolveConfigDir } from '../storage/paths';
import { UpstreamManager } from '../upstream/manager';

export async function runTest(options: {
  name: string;
  dir?: string;
  functionsDir?: string;
  repeat?: number;
}): Promise<string> {
  const configDir = resolveConfigDir(options.dir);
  const configPath = options.dir
    ? join(configDir, 'upstreams.json')
    : getConfigPath();
  const config = await loadConfig(configPath);
  const functionsRoot = getFunctionsDir(process.cwd(), options.functionsDir);
  const definition = await loadFunctionDefinition(functionsRoot, options.name);
  const fixture = await loadFixture(functionsRoot, options.name);

  const manager = new UpstreamManager();
  try {
    await manager.connectAll(config.upstreams);
    const report = await testFunction(
      definition,
      fixture,
      manager,
      options.repeat ?? 1
    );

    const lines: string[] = [];
    if (report.drift) {
      lines.push(
        'Regression report:',
        ...formatDriftReport(report.drift).map((line) => `- ${line}`),
        ''
      );
    }

    if (report.passed) {
      lines.push(
        `Function "${options.name}" passed (${report.repeats} repeat${report.repeats === 1 ? '' : 's'})`
      );
      return lines.join('\n');
    }

    lines.push(
      `Function "${options.name}" failed (${report.repeats} repeat${report.repeats === 1 ? '' : 's'})`,
      ...report.failures.map((failure) => `- ${failure}`)
    );
    return lines.join('\n');
  } finally {
    await manager.closeAll();
  }
}

export async function runTestWithExitCode(options: {
  name: string;
  dir?: string;
  functionsDir?: string;
  repeat?: number;
}): Promise<{ output: string; ok: boolean }> {
  const output = await runTest(options);
  const ok = output.includes(' passed ');
  return { ok, output };
}
