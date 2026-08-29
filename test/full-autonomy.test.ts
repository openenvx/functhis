import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { processAutonomousLearning } from '../src/learning/autonomous';
import { pauseLearning, resumeLearning } from '../src/learning/control';
import { evaluateAutonomousPolicy } from '../src/learning/policy';
import { loadLearningState } from '../src/learning/state';
import { PackageLibrary } from '../src/packages/library';
import { promoteStagedPackage, stagePackage } from '../src/packages/stage';
import { CapabilityBroker } from '../src/sandbox/broker';
import { appendTraceEvent, listTraceEvents } from '../src/trace/event-log';
import { TraceRecorder } from '../src/trace/recorder';
import { RunManager } from '../src/trace/run-manager';
import type { ExecutionTrace } from '../src/trace/schema';
import { saveTrace } from '../src/trace/store';
import { UpstreamManager } from '../src/upstream/manager';
import { isTransientError, withReadRetries } from '../src/upstream/retry';
import { testUpstreamConfig } from './helpers';

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

describe('full autonomy infrastructure', () => {
  test('RunManager isolates sessions and appends durable events', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-runmgr-'));
    try {
      const runManager = new RunManager(configDir);
      const sessionA = await runManager.ensureRun({ sessionId: 'agent-a' });
      const sessionB = await runManager.ensureRun({ sessionId: 'agent-b' });
      expect(sessionA.id).not.toBe(sessionB.id);

      const recorder = new TraceRecorder(configDir);
      await recorder.ensureRun({ sessionId: 'agent-a' });
      await recorder.recordCall({
        arguments: { userId: 'u1' },
        durationMs: 5,
        endedAt: new Date().toISOString(),
        output: { ok: true },
        sideEffect: 'read',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp1',
        toolId: 'readonly.get_user',
      });

      const events = await listTraceEvents(configDir, { limit: 10 });
      expect(events.some((event) => event.toolId === 'readonly.get_user')).toBe(
        true
      );
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test('same candidate crystallizes only one package', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-idem-'));
    const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-idem-pkg-'));
    const manager = new UpstreamManager();

    try {
      await manager.connectAll(testUpstreamConfig().upstreams);
      await saveTrace(configDir, makeTwoStepTrace('run-a', 'u1'));
      await saveTrace(configDir, makeTwoStepTrace('run-b', 'u2'));

      const first = await processAutonomousLearning(
        { configDir, manager, packagesDir },
        makeTwoStepTrace('run-b', 'u2')
      );
      const second = await processAutonomousLearning(
        { configDir, manager, packagesDir },
        makeTwoStepTrace('run-b', 'u2')
      );

      expect(first.some((result) => result.status === 'promoted')).toBe(true);
      expect(second.some((result) => result.status === 'skipped')).toBe(true);

      const library = await PackageLibrary.load(packagesDir);
      const autoPackages = library
        .getAll()
        .filter((pkg) => pkg.manifest.name.startsWith('auto-'));
      expect(autoPackages).toHaveLength(1);
    } finally {
      await manager.closeAll();
      await rm(configDir, { force: true, recursive: true });
      await rm(packagesDir, { force: true, recursive: true });
    }
  });

  test('write flow is quarantined without scoped policy allowance', async () => {
    const manager = new UpstreamManager();
    manager.catalog.addTools('write', [
      {
        description: 'Create a new issue',
        inputSchema: { properties: {}, type: 'object' },
        name: 'create_issue',
      },
    ]);

    const denied = evaluateAutonomousPolicy(manager, ['write.create_issue'], {
      writePolicy: 'deny',
    });
    expect(denied.decision).toBe('quarantine');

    const scoped = evaluateAutonomousPolicy(manager, ['write.create_issue'], {
      allowedWriteTools: ['write.create_issue'],
      writePolicy: 'scoped',
    });
    expect(scoped.decision).toBe('allow');

    await manager.closeAll();
  });

  test('system capability broker records read_file calls', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-sys-'));
    const manager = new UpstreamManager();
    const filePath = join(configDir, 'sample.txt');

    try {
      await writeFile(filePath, 'hello autonomy', 'utf-8');
      const recorder = new TraceRecorder(configDir);
      await recorder.ensureRun();
      const broker = new CapabilityBroker(manager, {
        allowedTools: ['system.read_file'],
        recorder,
        systemCapabilities: { cwd: configDir },
      });

      const result = await broker.callTool('system.read_file', {
        path: 'sample.txt',
      });
      expect(result).toMatchObject({ content: 'hello autonomy' });

      const events = await listTraceEvents(configDir, { limit: 5 });
      expect(events.some((event) => event.toolId === 'system.read_file')).toBe(
        true
      );
    } finally {
      await manager.closeAll();
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test('transactional staging promotes active lifecycle manifest', async () => {
    const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-stage-'));
    try {
      const stageDir = await stagePackage(packagesDir, {
        functionSource:
          'export default async function() { return { ok: true }; }',
        lock: { tools: {}, version: 1 },
        manifest: {
          capabilities: { tools: ['readonly.get_user'], writes: 'deny' },
          description: 'Staged package',
          entrypoint: 'function.ts',
          inputSchema: { properties: {}, type: 'object' },
          name: 'staged-demo',
          runtime: {
            execution: 'sandbox',
            maxCalls: 20,
            maxOutputBytes: 6 * 1024,
            timeoutMs: 30_000,
          },
        },
      });
      const packageDir = await promoteStagedPackage(
        packagesDir,
        stageDir,
        'active'
      );
      const manifestRaw = await readFile(
        join(packageDir, 'functhis.json'),
        'utf-8'
      );
      const manifest = JSON.parse(manifestRaw) as { lifecycle?: string };
      expect(manifest.lifecycle).toBe('active');
    } finally {
      await rm(packagesDir, { force: true, recursive: true });
    }
  });

  test('learning pause and resume persist control state', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-pause-'));
    try {
      const paused = await pauseLearning(configDir);
      expect(paused.paused).toBe(true);
      const resumed = await resumeLearning(configDir);
      expect(resumed.paused).toBe(false);
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test('read retries only for transient errors', async () => {
    expect(
      isTransientError(new Error('Tool call timed out after 1000ms'))
    ).toBe(true);
    expect(isTransientError(new Error('permission denied'))).toBe(false);

    let attempts = 0;
    const result = await withReadRetries(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error('ECONNRESET');
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  test('appendTraceEvent is idempotent per line', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-events-'));
    try {
      await appendTraceEvent(configDir, {
        attempt: 0,
        capability: 'mcp.call',
        endedAt: new Date().toISOString(),
        runId: 'run-1',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolId: 'readonly.get_user',
      });
      const events = await listTraceEvents(configDir);
      expect(events).toHaveLength(1);
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test('learning state tracks promoted packages', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-state-'));
    try {
      const state = await loadLearningState(configDir);
      expect(state.version).toBe(2);
      expect(state.jobs).toEqual([]);
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test('recoverOrphanedLearningJobs resumes non-terminal jobs', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-recover-'));
    const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-recover-pkg-'));
    const manager = new UpstreamManager();

    try {
      await manager.connectAll(testUpstreamConfig().upstreams);
      const trace = makeTwoStepTrace('run-recover', 'u1');
      await saveTrace(configDir, trace);
      await saveTrace(configDir, makeTwoStepTrace('run-recover-b', 'u2'));

      const { createLearningJob, updateLearningJob } =
        await import('../src/learning/jobs');
      const { saveLearningState, upsertJob } =
        await import('../src/learning/state');
      const { recoverOrphanedLearningJobs } =
        await import('../src/learning/recovery');

      let state = await loadLearningState(configDir);
      const job = updateLearningJob(
        createLearningJob({
          candidateFingerprint: 'cand-test',
          candidateId: 'cand-test',
          runId: 'run-recover-b',
        }),
        { status: 'compiled' }
      );
      state = upsertJob(state, job);
      await saveLearningState(configDir, state);

      const result = await recoverOrphanedLearningJobs({
        configDir,
        manager,
        packagesDir,
      });
      expect(result.recovered).toBeGreaterThanOrEqual(0);
    } finally {
      await manager.closeAll();
      await rm(configDir, { force: true, recursive: true });
      await rm(packagesDir, { force: true, recursive: true });
    }
  });
});
