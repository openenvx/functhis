import { join } from 'node:path';

import { loadFunctionDefinition } from '../functions/load';
import { getFunctionsDir } from '../functions/paths';
import { runFunction } from '../functions/runner';
import { loadConfig } from '../storage/config';
import { getConfigPath, resolveConfigDir } from '../storage/paths';
import { UpstreamManager } from '../upstream/manager';

export async function runFunctionCommand(options: {
  name: string;
  input: string;
  approveWrites?: boolean;
  dir?: string;
  functionsDir?: string;
}): Promise<string> {
  let parsedInput: Record<string, unknown>;
  try {
    const value = JSON.parse(options.input) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Input must be a JSON object');
    }
    parsedInput = value as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --input JSON: ${message}`, { cause: error });
  }

  const configDir = resolveConfigDir(options.dir);
  const configPath = options.dir
    ? join(configDir, 'upstreams.json')
    : getConfigPath();
  const config = await loadConfig(configPath);
  const functionsRoot = getFunctionsDir(process.cwd(), options.functionsDir);
  const definition = await loadFunctionDefinition(functionsRoot, options.name);

  const manager = new UpstreamManager();
  try {
    await manager.connectAll(config.upstreams);
    const result = await runFunction(definition, parsedInput, manager, {
      approveWrites: options.approveWrites,
    });
    return JSON.stringify(result, null, 2);
  } finally {
    await manager.closeAll();
  }
}
