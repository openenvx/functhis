import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runPackage } from '../src/packages/run';
import { savePackage } from '../src/packages/save';
import { testFunction } from '../src/packages/test';
import { CapabilityBroker } from '../src/sandbox/broker';
import { executeSandboxCode } from '../src/sandbox/runner';
import { detectCandidates } from '../src/trace/candidates';
import { buildCompileBrief } from '../src/trace/compile';
import { analyzeDataflow } from '../src/trace/dataflow';
import { pruneTraces } from '../src/trace/retention';
import type { ExecutionTrace } from '../src/trace/schema';
import { saveTrace } from '../src/trace/store';
import { UpstreamManager } from '../src/upstream/manager';
import { testUpstreamConfig, withTempConfigDir } from './helpers';

function makeTrace(calls: ExecutionTrace['calls']): ExecutionTrace {
  return {
    calls,
    id: 'run-test-compile',
    redactionVersion: '1',
    startedAt: new Date().toISOString(),
    status: 'succeeded',
    toolFingerprints: {},
  };
}

describe('dataflow', () => {
  test('classifies explicit refs and structural matches', () => {
    const trace = makeTrace([
      {
        address: '@1',
        arguments: { userId: 'u1' },
        durationMs: 10,
        endedAt: new Date().toISOString(),
        id: 'c1',
        output: { name: 'Ada', userId: 'u1' },
        outputBytes: 32,
        sideEffect: 'read',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp1',
        toolId: 'readonly.get_user',
      },
      {
        address: '@2',
        arguments: { note: '@1', owner: 'openenvx', repo: 'functhis' },
        durationMs: 12,
        endedAt: new Date().toISOString(),
        id: 'c2',
        output: { issues: [] },
        outputBytes: 20,
        refs: ['@1'],
        sideEffect: 'read',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp2',
        toolId: 'readonly.list_issues',
      },
    ]);

    const analysis = analyzeDataflow(trace);
    expect(analysis.toolSequence).toEqual([
      'readonly.get_user',
      'readonly.list_issues',
    ]);
    expect(analysis.edges.some((edge) => edge.kind === 'explicit_ref')).toBe(
      true
    );
    expect(analysis.readOnly).toBe(true);
  });
});

describe('compile', () => {
  test('promotes run-specific values to input instead of hardcoding', () => {
    const trace = makeTrace([
      {
        address: '@1',
        arguments: { userId: 'u42' },
        durationMs: 10,
        endedAt: new Date().toISOString(),
        id: 'c1',
        output: { name: 'Ada', userId: 'u42' },
        outputBytes: 32,
        sideEffect: 'read',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp1',
        toolId: 'readonly.get_user',
      },
    ]);

    const brief = buildCompileBrief(trace, { name: 'get-user-profile' });
    expect(brief.suggestedInputs).toContain('userId');
    expect(brief.skeleton).toContain('input.userId');
    expect(brief.skeleton).not.toContain('"u42"');
    expect(brief.inputSchema).toEqual({
      properties: { userId: { type: 'string' } },
      required: ['userId'],
      type: 'object',
    });
  });
});

describe('candidates', () => {
  test('groups repeated upstream tool sequences', async () => {
    await withTempConfigDir(async (dir) => {
      const makeSucceededTrace = (
        id: string,
        userId: string
      ): ExecutionTrace => ({
        ...makeTrace([
          {
            address: '@1',
            arguments: { userId },
            durationMs: 10,
            endedAt: new Date().toISOString(),
            id: `${id}-call`,
            output: { name: 'Ada', userId },
            outputBytes: 32,
            sideEffect: 'read',
            startedAt: new Date().toISOString(),
            status: 'succeeded',
            toolFingerprint: 'fp1',
            toolId: 'readonly.get_user',
          },
        ]),
        id,
        status: 'succeeded',
      });

      await saveTrace(dir, makeSucceededTrace('run-a', 'u1'));
      await saveTrace(dir, makeSucceededTrace('run-b', 'u2'));

      const candidates = await detectCandidates(dir, { minOccurrences: 2 });
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]?.toolSequence).toEqual(['readonly.get_user']);
      expect(candidates[0]?.runIds).toEqual(
        expect.arrayContaining(['run-a', 'run-b'])
      );
    });
  });

  test('groups sequences that differ only by consecutive duplicate tools', async () => {
    await withTempConfigDir(async (dir) => {
      const makeSequenceTrace = (
        id: string,
        sequence: string[]
      ): ExecutionTrace => ({
        ...makeTrace(
          sequence.map((toolId, index) => ({
            address: `@${index + 1}`,
            arguments: { userId: 'u1' },
            durationMs: 10,
            endedAt: new Date().toISOString(),
            id: `${id}-call-${index + 1}`,
            output: { ok: true },
            outputBytes: 16,
            sideEffect: 'read' as const,
            startedAt: new Date().toISOString(),
            status: 'succeeded' as const,
            toolFingerprint: `fp-${index + 1}`,
            toolId,
          }))
        ),
        id,
        status: 'succeeded',
      });

      await saveTrace(
        dir,
        makeSequenceTrace('run-short', [
          'readonly.get_user',
          'readonly.list_issues',
        ])
      );
      await saveTrace(
        dir,
        makeSequenceTrace('run-dup', [
          'readonly.get_user',
          'readonly.get_user',
          'readonly.list_issues',
        ])
      );

      const candidates = await detectCandidates(dir, { minOccurrences: 2 });
      const normalized = candidates.find(
        (candidate) =>
          candidate.signals.normalizedSequence ===
          'readonly.get_user→readonly.list_issues'
      );
      expect(normalized).toBeDefined();
      expect(normalized?.signals.matchKind).toBe('normalized');
      expect(normalized?.occurrenceCount).toBe(2);
      expect(normalized?.runIds).toEqual(
        expect.arrayContaining(['run-short', 'run-dup'])
      );
    });
  });
});

describe('sandbox execution', () => {
  test('runs saved package via runPackage in sandbox regardless of legacy execution flag', async () => {
    const packagesRoot = await mkdtemp(join(tmpdir(), 'functhis-sandbox-pkg-'));
    const manager = new UpstreamManager();
    try {
      await manager.connectAll(testUpstreamConfig().upstreams);
      await savePackage(manager, {
        allowedTools: ['readonly.get_user'],
        description: 'Sandbox package',
        name: 'sandbox-get-user',
        packagesRoot,
        source:
          'export default async function(ctx, input) { return await ctx.tools.readonly.get_user(input); }',
      });

      const result = await runPackage(manager, {
        input: { userId: 'u1' },
        packageDir: join(packagesRoot, 'sandbox-get-user'),
      });
      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({ userId: 'u1' });
      expect(result.manifest.runtime.execution).toBe('sandbox');
    } finally {
      await manager.closeAll();
      await rm(packagesRoot, { force: true, recursive: true });
    }
  });

  test('runs package source in sandbox child with the same allowlist', async () => {
    await withTempConfigDir(async (dir) => {
      const manager = new UpstreamManager();
      try {
        await manager.connectAll(testUpstreamConfig().upstreams);
        const broker = new CapabilityBroker(manager, {
          allowedTools: ['readonly.get_user'],
        });
        const result = await executeSandboxCode(broker, {
          allowedTools: ['readonly.get_user'],
          input: { userId: 'u1' },
          source:
            'export default async function(ctx, input) { return await ctx.tools.readonly.get_user(input); }',
        });
        expect(result.status).toBe('succeeded');
        expect(result.output).toMatchObject({ userId: 'u1' });
      } finally {
        await manager.closeAll();
      }
    });
  });
});

describe('verification', () => {
  test('denies live testing for write-capable tools without approval', async () => {
    await withTempConfigDir(async (dir) => {
      const manager = new UpstreamManager();
      try {
        await manager.connectAll(testUpstreamConfig().upstreams);
        const report = await testFunction(manager, {
          allowedTools: ['readonly.delete_user'],
          configDir: dir,
          mode: 'live',
          name: 'delete-user',
          source:
            'export default async function(ctx, input) { return await ctx.tools.readonly.delete_user(input); }',
        });
        expect(report.status).toBe('denied');
      } finally {
        await manager.closeAll();
      }
    });
  });
});

describe('retention', () => {
  test('deletes old runs but keeps recent ones', async () => {
    await withTempConfigDir(async (dir) => {
      const oldTrace = makeTrace([]);
      oldTrace.id = 'run-old';
      oldTrace.startedAt = new Date(
        Date.now() - 40 * 24 * 60 * 60 * 1000
      ).toISOString();
      await saveTrace(dir, oldTrace);

      const recentTrace = makeTrace([]);
      recentTrace.id = 'run-recent';
      await saveTrace(dir, recentTrace);

      const report = await pruneTraces(dir, {
        retention: { maxAgeDays: 30, maxRuns: 200 },
      });
      expect(report.deletedRunIds).toContain('run-old');
      expect(report.deletedRunIds).not.toContain('run-recent');
    });
  });
});
