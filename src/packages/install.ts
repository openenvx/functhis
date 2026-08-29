import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { schemaHash } from '../catalog/fingerprint';
import type { UpstreamManager } from '../upstream/manager';
import { loadPackage } from './save';
import type { LockDriftIssue, LockInspection } from './schema';
import {
  promoteStagedPackage,
  quarantineStagedPackage,
  stagePackage,
} from './stage';

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

async function readReplayFixture(
  packageDir: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(
      join(packageDir, 'tests', 'replay.fixture.json'),
      'utf-8'
    );
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function installPackageFromPath(
  sourcePath: string,
  packagesRoot: string,
  options: { approve?: boolean } = {}
): Promise<{ lifecycle: string; name: string; targetDir: string }> {
  const resolved = resolve(sourcePath);
  const { lock, manifest, source } = await loadPackage(resolved);

  if (!options.approve) {
    throw new Error(
      `Installation of "${manifest.name}" requires explicit approval. Re-run with --approve after reviewing capabilities.`
    );
  }

  if (
    manifest.capabilities.writes === 'review-required' &&
    !manifest.autonomousOrigin
  ) {
    throw new Error(
      `Installation of write-capable package "${manifest.name}" requires reviewing capabilities. Re-run with approve=true after review.`
    );
  }

  const replayFixture = await readReplayFixture(resolved);
  const stageDir = await stagePackage(packagesRoot, {
    functionSource: source,
    lock,
    manifest: {
      ...manifest,
      lifecycle: 'active',
    },
    replayFixture,
  });

  try {
    const targetDir = await promoteStagedPackage(
      packagesRoot,
      stageDir,
      'active'
    );
    return {
      lifecycle: 'active',
      name: manifest.name,
      targetDir,
    };
  } catch (error) {
    await quarantineStagedPackage(
      packagesRoot,
      stageDir,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
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
    `Lifecycle: ${manifest.lifecycle ?? 'active'}`,
    `Autonomous origin: ${manifest.autonomousOrigin ? 'yes' : 'no'}`,
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
