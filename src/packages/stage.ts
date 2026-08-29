import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PackageLock, PackageManifest } from './schema';
import { packageLockSchema, packageManifestSchema } from './schema';

export type PackageLifecycle =
  | 'active'
  | 'quarantined'
  | 'rejected'
  | 'staging';

export interface StagedPackageFiles {
  functionSource: string;
  lock: PackageLock;
  manifest: PackageManifest & { lifecycle?: PackageLifecycle };
  replayFixture?: Record<string, unknown>;
}

function stagingRoot(packagesRoot: string): string {
  return join(packagesRoot, '.staging');
}

export async function stagePackage(
  packagesRoot: string,
  files: StagedPackageFiles
): Promise<string> {
  const stageId = randomUUID();
  const stageDir = join(stagingRoot(packagesRoot), stageId);
  await mkdir(join(stageDir, 'tests'), { recursive: true });

  const manifest = {
    ...files.manifest,
    lifecycle: 'staging' as const,
  };

  await writeFile(join(stageDir, 'function.ts'), files.functionSource, 'utf-8');
  await writeFile(
    join(stageDir, 'functhis.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8'
  );
  await writeFile(
    join(stageDir, 'functhis.lock'),
    `${JSON.stringify(files.lock, null, 2)}\n`,
    'utf-8'
  );

  if (files.replayFixture) {
    await writeFile(
      join(stageDir, 'tests', 'replay.fixture.json'),
      `${JSON.stringify(files.replayFixture, null, 2)}\n`,
      'utf-8'
    );
  }

  return stageDir;
}

export async function promoteStagedPackage(
  packagesRoot: string,
  stageDir: string,
  lifecycle: PackageLifecycle = 'active'
): Promise<string> {
  const manifestRaw = await readFile(join(stageDir, 'functhis.json'), 'utf-8');
  const manifest = packageManifestSchema.parse(JSON.parse(manifestRaw));
  const targetDir = join(packagesRoot, manifest.name);

  const promotedManifest = {
    ...(JSON.parse(manifestRaw) as Record<string, unknown>),
    lifecycle,
  };
  await writeFile(
    join(stageDir, 'functhis.json'),
    `${JSON.stringify(promotedManifest, null, 2)}\n`,
    'utf-8'
  );

  await mkdir(packagesRoot, { recursive: true });
  await rm(targetDir, { force: true, recursive: true });
  await cp(stageDir, targetDir, { recursive: true });
  await rm(stageDir, { force: true, recursive: true });

  return targetDir;
}

export async function quarantineStagedPackage(
  packagesRoot: string,
  stageDir: string,
  reason: string
): Promise<string> {
  const manifestRaw = await readFile(join(stageDir, 'functhis.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
  const name = String(manifest.name ?? 'quarantined');
  const quarantineDir = join(packagesRoot, `.quarantine-${name}`);

  const quarantined = {
    ...manifest,
    lifecycle: 'quarantined',
    quarantineReason: reason,
  };
  await writeFile(
    join(stageDir, 'functhis.json'),
    `${JSON.stringify(quarantined, null, 2)}\n`,
    'utf-8'
  );

  await mkdir(packagesRoot, { recursive: true });
  await rm(quarantineDir, { force: true, recursive: true });
  await rename(stageDir, quarantineDir);
  return quarantineDir;
}

export function readPackageLifecycle(
  manifest: Record<string, unknown>
): PackageLifecycle {
  const lifecycle = manifest.lifecycle;
  if (
    lifecycle === 'active' ||
    lifecycle === 'quarantined' ||
    lifecycle === 'rejected' ||
    lifecycle === 'staging'
  ) {
    return lifecycle;
  }
  return 'active';
}

export async function loadStagedPackage(stageDir: string): Promise<{
  lock: PackageLock;
  manifest: PackageManifest;
  source: string;
}> {
  const manifestRaw = await readFile(join(stageDir, 'functhis.json'), 'utf-8');
  const lockRaw = await readFile(join(stageDir, 'functhis.lock'), 'utf-8');
  const source = await readFile(join(stageDir, 'function.ts'), 'utf-8');
  return {
    lock: packageLockSchema.parse(JSON.parse(lockRaw)),
    manifest: packageManifestSchema.parse(JSON.parse(manifestRaw)),
    source,
  };
}
