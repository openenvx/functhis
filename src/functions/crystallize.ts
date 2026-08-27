import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { containsCanary, redactValue } from '../redaction/redact';
import { loadConfig } from '../storage/config';
import { loadTrace } from '../trace/store';
import { UpstreamManager } from '../upstream/manager';
import { compileTraceToFunction, getSuccessfulPath } from './compile';
import { generateFixtureSource, generateFunctionSource } from './generate';
import { getFixturePath, getFunctionSourcePath } from './paths';
import type { Fixture } from './schema';

const CANARY = 'fn_canary_secret_DO_NOT_STORE';

function sanitizeFixture(fixture: Fixture): Fixture {
  const sanitized = {
    ...fixture,
    assertions: fixture.assertions
      ? {
          ...fixture.assertions,
          output:
            fixture.assertions.output === undefined
              ? undefined
              : redactValue(fixture.assertions.output),
        }
      : undefined,
    input: redactValue(fixture.input) as Record<string, unknown>,
    recordedCalls: fixture.recordedCalls.map((call) => ({
      ...call,
      arguments: redactValue(call.arguments) as Record<string, unknown>,
      output: call.output === undefined ? undefined : redactValue(call.output),
    })),
  };

  if (containsCanary(sanitized, CANARY)) {
    throw new Error('Fixture still contains canary secret after sanitization');
  }

  return sanitized;
}

export interface CrystallizeResult {
  definitionPath: string;
  fixturePath: string;
  report: string;
}

export async function crystallizeRun(options: {
  runId: string;
  name: string;
  configDir: string;
  functionsDir: string;
  calls?: string[];
  description?: string;
  force?: boolean;
}): Promise<CrystallizeResult> {
  const trace = await loadTrace(options.configDir, options.runId);
  const functionsRoot = options.functionsDir;
  const definitionPath = getFunctionSourcePath(functionsRoot, options.name);
  const fixturePath = getFixturePath(functionsRoot, options.name);

  const configPath = join(options.configDir, 'upstreams.json');
  const config = await loadConfig(configPath);
  const manager = new UpstreamManager();
  try {
    await manager.connectAll(config.upstreams);
    const catalog = manager.catalog;
    const { definition, fixture } = compileTraceToFunction(trace, {
      calls: options.calls,
      catalog,
      description: options.description,
      name: options.name,
      sourceRunId: options.runId,
    });

    const sanitizedFixture = sanitizeFixture(fixture);
    await mkdir(functionsRoot, { recursive: true });

    const definitionSource = generateFunctionSource(definition);
    const fixtureSource = generateFixtureSource(sanitizedFixture);

    await writeFile(definitionPath, definitionSource, {
      flag: options.force ? 'w' : 'wx',
    });
    await writeFile(fixturePath, fixtureSource, {
      flag: options.force ? 'w' : 'wx',
    });

    const successfulPath = getSuccessfulPath(trace);
    const selectedPath =
      options.calls ?? successfulPath.map((address) => address);

    const report = [
      `Compiled function "${options.name}" from run ${options.runId}`,
      `Successful path: ${successfulPath.join(', ') || '—'}`,
      `Compiled calls: ${selectedPath.join(', ')}`,
      `Wrote ${definitionPath}`,
      `Wrote ${fixturePath}`,
      '',
      'Inputs:',
      ...Object.entries(definition.inputs).map(
        ([key, value]) => `  ${key}: ${value.type}`
      ),
      '',
      'Required tools:',
      ...definition.requiredTools.map((toolId) => `  ${toolId}`),
      '',
      'Review bindings in the .ts file, then run:',
      `  fn test ${options.name}`,
      `  fn run ${options.name} --input '${JSON.stringify(sanitizedFixture.input)}'`,
    ].join('\n');

    return { definitionPath, fixturePath, report };
  } finally {
    await manager.closeAll();
  }
}
