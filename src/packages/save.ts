import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { schemaHash } from '../catalog/fingerprint';
import { analyzeDataflow } from '../trace/dataflow';
import { loadTrace } from '../trace/store';
import type { UpstreamManager } from '../upstream/manager';
import { classifyPackageWrites } from './capabilities';
import type { PackageLock, PackageManifest } from './schema';
import { packageLockSchema, packageManifestSchema } from './schema';

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
    name: options.name,
    outputSchema: options.outputSchema,
    runtime: {
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

  const packageDir = join(options.packagesRoot, options.name);
  await mkdir(packageDir, { recursive: true });
  await mkdir(join(packageDir, 'tests'), { recursive: true });

  await writeFile(join(packageDir, 'function.ts'), options.source, 'utf-8');
  await writeFile(
    join(packageDir, 'functhis.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8'
  );
  await writeFile(
    join(packageDir, 'functhis.lock'),
    `${JSON.stringify(lock, null, 2)}\n`,
    'utf-8'
  );
  await writeFile(
    join(packageDir, 'README.md'),
    `# ${manifest.name}\n\n${manifest.description}\n`,
    'utf-8'
  );

  if (options.compiledFrom && options.configDir) {
    await writeReplayFixture(
      packageDir,
      options.configDir,
      options.compiledFrom
    );
  }

  return packageDir;
}

async function writeReplayFixture(
  packageDir: string,
  configDir: string,
  compiledFrom: string
): Promise<void> {
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

  await writeFile(
    join(packageDir, 'tests', 'replay.fixture.json'),
    `${JSON.stringify(
      {
        compiledFrom,
        input,
        output: finalCall?.output,
        toolSequence: analysis.toolSequence,
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
}

export async function loadPackage(dir: string): Promise<{
  lock: PackageLock;
  manifest: PackageManifest;
  source: string;
}> {
  const manifestRaw = await readFile(join(dir, 'functhis.json'), 'utf-8');
  const lockRaw = await readFile(join(dir, 'functhis.lock'), 'utf-8');
  const source = await readFile(join(dir, 'function.ts'), 'utf-8');
  return {
    lock: packageLockSchema.parse(JSON.parse(lockRaw)),
    manifest: packageManifestSchema.parse(JSON.parse(manifestRaw)),
    source,
  };
}
