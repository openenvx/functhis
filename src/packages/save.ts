import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { schemaHash } from '../catalog/fingerprint';
import { analyzeDataflow } from '../trace/dataflow';
import { loadTrace } from '../trace/store';
import type { UpstreamManager } from '../upstream/manager';
import { classifyPackageWrites } from './capabilities';
import type { PackageLock, PackageManifest } from './schema';
import { packageLockSchema, packageManifestSchema } from './schema';
import { loadStagedPackage, promoteStagedPackage, stagePackage } from './stage';

export interface SavePackageOptions {
  allowedTools: string[];
  compiledFrom?: string;
  configDir?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  name: string;
  outputSchema?: Record<string, unknown>;
  packagesRoot: string;
  source: string;
  writes?: 'deny' | 'review-required';
}

export async function savePackage(
  manager: UpstreamManager,
  options: SavePackageOptions
): Promise<string> {
  const manifest: PackageManifest = packageManifestSchema.parse({
    capabilities: {
      tools: options.allowedTools,
      writes:
        options.writes ?? classifyPackageWrites(manager, options.allowedTools),
    },
    compiledFrom: options.compiledFrom,
    description: options.description,
    entrypoint: 'function.ts',
    inputSchema: options.inputSchema ?? {
      properties: {},
      type: 'object',
    },
    lifecycle: 'active',
    name: options.name,
    outputSchema: options.outputSchema,
    runtime: {
      execution: 'sandbox',
      maxCalls: 20,
      maxOutputBytes: 6 * 1024,
      timeoutMs: 30_000,
    },
  });

  const lockTools: PackageLock['tools'] = {};
  for (const toolId of options.allowedTools) {
    const tool = manager.catalog.getTool(toolId);
    if (!tool) {
      throw new Error(`Cannot save package: unknown tool ${toolId}`);
    }
    const dot = toolId.indexOf('.');
    lockTools[toolId] = {
      name: tool.name,
      schemaHash: schemaHash(tool.inputSchema),
      server: dot === -1 ? tool.serverId : toolId.slice(0, dot),
    };
  }

  const lock: PackageLock = packageLockSchema.parse({
    tools: lockTools,
    version: 1,
  });

  let replayFixture: Record<string, unknown> | undefined;
  if (options.compiledFrom && options.configDir) {
    replayFixture = await buildReplayFixture(
      options.configDir,
      options.compiledFrom
    );
  }

  const stageDir = await stagePackage(options.packagesRoot, {
    functionSource: options.source,
    lock,
    manifest,
    replayFixture,
  });

  const packageDir = await promoteStagedPackage(
    options.packagesRoot,
    stageDir,
    'active'
  );

  await mkdir(join(packageDir, 'tests'), { recursive: true });
  await writePackageReadme(packageDir, manifest);

  return packageDir;
}

async function buildReplayFixture(
  configDir: string,
  compiledFrom: string
): Promise<Record<string, unknown>> {
  const trace = await loadTrace(configDir, compiledFrom);
  const analysis = analyzeDataflow(trace);
  const input: Record<string, unknown> = {};
  for (const call of analysis.calls) {
    for (const arg of call.arguments) {
      if (arg.classification === 'input' && arg.valuePreview) {
        try {
          input[arg.key] = JSON.parse(arg.valuePreview);
        } catch {
          // skip non-json previews
        }
      }
    }
  }

  const finalCall = trace.calls.find(
    (call) => call.address === analysis.finalOutputAddress
  );

  return {
    compiledFrom,
    input,
    output: finalCall?.output,
    toolSequence: analysis.toolSequence,
  };
}

async function writePackageReadme(
  packageDir: string,
  manifest: PackageManifest
): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    join(packageDir, 'README.md'),
    `# ${manifest.name}\n\n${manifest.description}\n`,
    'utf-8'
  );
}

export async function loadPackage(dir: string): Promise<{
  lock: PackageLock;
  manifest: PackageManifest;
  source: string;
}> {
  return loadStagedPackage(dir);
}
