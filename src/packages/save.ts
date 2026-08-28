import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { schemaHash } from '../catalog/fingerprint';
import type { UpstreamManager } from '../upstream/manager';
import type { PackageLock, PackageManifest } from './schema';
import { packageLockSchema, packageManifestSchema } from './schema';

export interface SavePackageOptions {
  allowedTools: string[];
  description: string;
  functionsRoot: string;
  inputSchema?: Record<string, unknown>;
  name: string;
  repoRead?: boolean;
  source: string;
}

export async function savePackage(
  manager: UpstreamManager,
  options: SavePackageOptions
): Promise<string> {
  const manifest: PackageManifest = packageManifestSchema.parse({
    apiVersion: 'functhis.dev/v1',
    capabilities: {
      repo: options.repoRead ? 'read' : 'none',
      tools: options.allowedTools,
      writes: 'deny',
    },
    description: options.description,
    entrypoint: 'function.ts',
    inputSchema: options.inputSchema ?? {
      properties: {},
      type: 'object',
    },
    name: options.name,
    runtime: {
      functhis: '>=0.2.0',
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

  const packageDir = join(options.functionsRoot, options.name);
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

  return packageDir;
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
