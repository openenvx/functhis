import { describe, expect, test } from 'vitest';

import { buildCompileBrief } from '../src/trace/compile';
import { analyzeDataflow } from '../src/trace/dataflow';
import { pruneTraces } from '../src/trace/retention';
import type { ExecutionTrace } from '../src/trace/schema';
import { saveTrace } from '../src/trace/store';
import { withTempConfigDir } from './helpers';

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
