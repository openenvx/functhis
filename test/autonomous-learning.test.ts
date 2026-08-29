import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { processAutonomousLearning } from '../src/learning/autonomous';
import { loadLearningState } from '../src/learning/state';
import { PackageLibrary } from '../src/packages/library';
import type { ExecutionTrace } from '../src/trace/schema';
import { saveTrace } from '../src/trace/store';
import { UpstreamManager } from '../src/upstream/manager';
import { testUpstreamConfig } from './helpers';

function makeSucceededTrace(id: string, userId: string): ExecutionTrace {
  return {
    calls: [
      {
        address: '@1',
        arguments: { userId },
        durationMs: 10,
        endedAt: new Date().toISOString(),
        id: `${id}-call`,
        output: { name: 'Ada Lovelace', userId },
        outputBytes: 32,
        sideEffect: 'read',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp1',
        toolId: 'readonly.get_user',
      },
    ],
    id,
    redactionVersion: '1',
    startedAt: new Date().toISOString(),
    status: 'succeeded',
    toolFingerprints: { 'readonly.get_user': 'fp1' },
  };
}

function makeTwoStepTrace(id: string, userId: string): ExecutionTrace {
  return {
    calls: [
      {
        address: '@1',
        arguments: { userId },
        durationMs: 10,
        endedAt: new Date().toISOString(),
        id: `${id}-call-1`,
        output: { name: 'Ada Lovelace', userId },
        outputBytes: 32,
        sideEffect: 'read',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp1',
        toolId: 'readonly.get_user',
      },
      {
        address: '@2',
        arguments: { owner: 'openenvx', repo: 'functhis' },
        durationMs: 12,
        endedAt: new Date().toISOString(),
        id: `${id}-call-2`,
        output: { issues: [] },
        outputBytes: 20,
        sideEffect: 'read',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp2',
        toolId: 'readonly.list_issues',
      },
    ],
    id,
    redactionVersion: '1',
    startedAt: new Date().toISOString(),
    status: 'succeeded',
    toolFingerprints: {
      'readonly.get_user': 'fp1',
      'readonly.list_issues': 'fp2',
    },
  };
}

describe('autonomous learning', () => {
  test('auto-crystallizes a repeated read-only multi-step flow', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-learn-'));
    const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-learn-pkg-'));
    const manager = new UpstreamManager();

    try {
      await manager.connectAll(testUpstreamConfig().upstreams);
      await saveTrace(configDir, makeTwoStepTrace('run-a', 'u1'));
      await saveTrace(configDir, makeTwoStepTrace('run-b', 'u2'));

      const results = await processAutonomousLearning(
        {
          configDir,
          manager,
          packagesDir,
        },
        makeTwoStepTrace('run-b', 'u2')
      );

      expect(results.some((result) => result.saved && result.verified)).toBe(
        true
      );

      const library = await PackageLibrary.load(packagesDir);
      const autoPackage = library
        .getAll()
        .find((pkg) => pkg.manifest.name.startsWith('auto-'));
      expect(autoPackage).toBeDefined();

      const state = await loadLearningState(configDir);
      expect(state.crystallizedPackages.length).toBeGreaterThan(0);

      const manifestRaw = await readFile(
        join(packagesDir, autoPackage!.manifest.name, 'functhis.json'),
        'utf-8'
      );
      const manifest = JSON.parse(manifestRaw) as { compiledFrom?: string };
      expect(manifest.compiledFrom).toBeDefined();
    } finally {
      await manager.closeAll();
      await rm(configDir, { force: true, recursive: true });
      await rm(packagesDir, { force: true, recursive: true });
    }
  });

  test('does not crystallize single-step flows', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-learn-single-'));
    const packagesDir = await mkdtemp(
      join(tmpdir(), 'functhis-learn-single-pkg-')
    );
    const manager = new UpstreamManager();

    try {
      await manager.connectAll(testUpstreamConfig().upstreams);
      await saveTrace(configDir, makeSucceededTrace('run-a', 'u1'));
      await saveTrace(configDir, makeSucceededTrace('run-b', 'u2'));

      const results = await processAutonomousLearning(
        {
          configDir,
          manager,
          packagesDir,
        },
        makeSucceededTrace('run-b', 'u2')
      );

      expect(results).toEqual([]);
      const library = await PackageLibrary.load(packagesDir);
      expect(library.size()).toBe(0);
    } finally {
      await manager.closeAll();
      await rm(configDir, { force: true, recursive: true });
      await rm(packagesDir, { force: true, recursive: true });
    }
  });
});
