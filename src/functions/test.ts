import { join } from 'node:path';

import { loadConfig } from '../storage/config';
import { getConfigPath, resolveConfigDir } from '../storage/paths';
import { UpstreamManager } from '../upstream/manager';
import { formatDriftReport } from './drift';
import { loadFixture, loadFunctionDefinition } from './load';
import { getFunctionsDir } from './paths';
import { testFunction } from './runner';

export interface FunctionTestResult {
  output: string;
  passed: boolean;
}

function formatFunctionTestReport(
  name: string,
  report: Awaited<ReturnType<typeof testFunction>>
): string {
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
      `Function "${name}" passed (${report.repeats} repeat${report.repeats === 1 ? '' : 's'})`
    );
    return lines.join('\n');
  }

  lines.push(
    `Function "${name}" failed (${report.repeats} repeat${report.repeats === 1 ? '' : 's'})`,
    ...report.failures.map((failure) => `- ${failure}`)
  );
  return lines.join('\n');
}

export async function runFunctionTest(options: {
  name: string;
  configPath: string;
  functionsDir: string;
  repeat?: number;
}): Promise<FunctionTestResult> {
  const config = await loadConfig(options.configPath);
  const definition = await loadFunctionDefinition(
    options.functionsDir,
    options.name
  );
  const fixture = await loadFixture(options.functionsDir, options.name);

  const manager = new UpstreamManager();
  try {
    await manager.connectAll(config.upstreams);
    const report = await testFunction(
      definition,
      fixture,
      manager,
      options.repeat ?? 1
    );
    return {
      output: formatFunctionTestReport(options.name, report),
      passed: report.passed,
    };
  } finally {
    await manager.closeAll();
  }
}

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
  const functionsRoot = getFunctionsDir(process.cwd(), options.functionsDir);
  const result = await runFunctionTest({
    configPath,
    functionsDir: functionsRoot,
    name: options.name,
    repeat: options.repeat,
  });
  return result.output;
}

export async function runTestWithExitCode(options: {
  name: string;
  dir?: string;
  functionsDir?: string;
  repeat?: number;
}): Promise<{ output: string; ok: boolean }> {
  const configDir = resolveConfigDir(options.dir);
  const configPath = options.dir
    ? join(configDir, 'upstreams.json')
    : getConfigPath();
  const functionsRoot = getFunctionsDir(process.cwd(), options.functionsDir);
  const result = await runFunctionTest({
    configPath,
    functionsDir: functionsRoot,
    name: options.name,
    repeat: options.repeat,
  });
  return { ok: result.passed, output: result.output };
}
