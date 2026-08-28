import { cp, mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { schemaHash } from '../catalog/fingerprint';
import type { UpstreamManager } from '../upstream/manager';
import { loadPackage } from './save';
import type { LockDriftIssue, LockInspection } from './schema';

export function inspectLockDrift(
  manager: UpstreamManager,
  lock: {
    tools: Record<string, { name: string; schemaHash: string; server: string }>;
  }
): LockInspection {
  const issues: LockDriftIssue[] = [];

  for (const [toolId, entry] of Object.entries(lock.tools)) {
    const live = manager.catalog.getTool(toolId);
    if (!live) {
      issues.push({
        kind: 'missing',
        message: `Tool ${toolId} is not available in the local catalog`,
        toolId,
      });
      continue;
    }
    const liveHash = schemaHash(live.inputSchema);
    if (liveHash !== entry.schemaHash) {
      issues.push({
        kind: 'schema-changed',
        message: `Schema hash mismatch for ${toolId}: expected ${entry.schemaHash}, got ${liveHash}`,
        toolId,
      });
    }
  }

  return { issues, ok: issues.length === 0 };
}

export async function installPackageFromPath(
  sourcePath: string,
  packagesRoot: string,
  options: { approve?: boolean } = {}
): Promise<{ name: string; targetDir: string }> {
  const resolved = resolve(sourcePath);
  const { manifest } = await loadPackage(resolved);
  const targetDir = join(packagesRoot, manifest.name);

  if (!options.approve) {
    throw new Error(
      `Installation of "${manifest.name}" requires explicit approval. Re-run with --approve after reviewing capabilities.`
    );
  }

  await mkdir(packagesRoot, { recursive: true });
  await cp(resolved, targetDir, { recursive: true });

  return { name: manifest.name, targetDir };
}

export async function formatInspectReport(
  manager: UpstreamManager,
  packageDir: string
): Promise<string> {
  const { manifest, lock } = await loadPackage(packageDir);
  const drift = inspectLockDrift(manager, lock);
  const lines = [
    `Function: ${manifest.name}`,
    `Description: ${manifest.description}`,
    `Tools: ${manifest.capabilities.tools.join(', ')}`,
    `Writes: ${manifest.capabilities.writes}`,
    '',
    drift.ok ? 'Lock status: OK' : 'Lock status: DRIFT DETECTED',
  ];

  for (const issue of drift.issues) {
    lines.push(`- [${issue.kind}] ${issue.message}`);
  }

  return lines.join('\n');
}

export async function resolvePackageDir(
  packagesRoot: string,
  name: string
): Promise<string | undefined> {
  const packageDir = join(packagesRoot, name);
  try {
    await readFile(join(packageDir, 'functhis.json'), 'utf-8');
    return packageDir;
  } catch {
    return undefined;
  }
}

export function packageNameFromPath(path: string): string {
  return basename(resolve(path));
}
