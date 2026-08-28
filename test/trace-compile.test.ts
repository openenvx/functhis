import { describe, expect, test } from 'vitest';

import { testFunction } from '../src/packages/test';
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
