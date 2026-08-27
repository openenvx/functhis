import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runInspect } from '../src/cli/inspect';
import { runRecall } from '../src/cli/recall';
import { runStats } from '../src/cli/stats';
import {
  findPackageRoot,
  fixtureServerPath,
  invocationForScript,
} from '../src/paths';
import { saveConfig } from '../src/storage/config';
import { TraceRecorder } from '../src/trace/recorder';
import { loadTrace } from '../src/trace/store';
import { UpstreamManager } from '../src/upstream/manager';
import { testUpstreamConfig, withTempConfigDir } from './helpers';

const packageRoot = findPackageRoot(import.meta.url);

function slowUpstreamConfig() {
  const slow = invocationForScript(fixtureServerPath(packageRoot, 'slow'));
  return {
    upstreams: [
      {
        args: slow.args,
        command: slow.command,
        enabled: true,
        id: 'slow',
        label: 'Slow fixture',
        transport: 'stdio' as const,
      },
    ],
    version: 1 as const,
  };
}

describe('trace integration', () => {
  test('records multiple calls in one run with addresses', async () => {
    await withTempConfigDir(async (dir) => {
      const configPath = join(dir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      const manager = new UpstreamManager();
      const recorder = new TraceRecorder(dir);

      try {
        await manager.connectAll(testUpstreamConfig().upstreams);
        await recorder.ensureRun();

        const startedAt = new Date().toISOString();
        const startMs = Date.now();
        const result1 = await manager.callTool('readonly.get_user', {
          userId: 'u1',
        });
        const first = await recorder.recordCall({
          arguments: { userId: 'u1' },
          durationMs: Date.now() - startMs,
          endedAt: new Date().toISOString(),
          output: result1,
          startedAt,
          status: 'succeeded',
          toolFingerprint: 'fp1',
          toolId: 'readonly.get_user',
        });
        expect(first.address).toBe('@1');

        const startedAt2 = new Date().toISOString();
        const startMs2 = Date.now();
        const { arguments: resolved, refs } = recorder.resolveArguments({
          prior: '@1',
        });
        expect(refs).toEqual(['@1']);

        const result2 = await manager.callTool('readonly.list_issues', {
          note: resolved.prior,
          owner: 'openenvx',
          repo: 'functhis',
        });
        const second = await recorder.recordCall({
          arguments: { prior: '@1' },
          durationMs: Date.now() - startMs2,
          endedAt: new Date().toISOString(),
          output: result2,
          refs,
          startedAt: startedAt2,
          status: 'succeeded',
          toolFingerprint: 'fp2',
          toolId: 'readonly.list_issues',
        });
        expect(second.address).toBe('@2');
        expect(second.runId).toBe(first.runId);

        const trace = await loadTrace(dir, first.runId);
        expect(trace.calls).toHaveLength(2);
        expect(trace.calls[1]?.refs).toEqual(['@1']);

        const recalled = await recorder.recall(first.runId, '@1');
        expect(JSON.stringify(recalled)).toContain('Ada Lovelace');

        const inspect = await runInspect({ dir, runId: first.runId });
        expect(inspect).toContain('@1 readonly.get_user');
        expect(inspect).toContain('@2 readonly.list_issues');

        const stats = await runStats({ dir });
        expect(stats).toContain('Runs: 1');
        expect(stats).toContain('Calls: 2');

        const recallCli = await runRecall({
          address: '@1',
          dir,
          runId: first.runId,
        });
        expect(recallCli).toContain('Ada Lovelace');
      } finally {
        await manager.closeAll();
      }
    });
  }, 60_000);

  test('records timeout status for slow upstream calls', async () => {
    await withTempConfigDir(async (dir) => {
      const manager = new UpstreamManager();
      const recorder = new TraceRecorder(dir);

      try {
        await manager.connectAll(slowUpstreamConfig().upstreams);
        await recorder.ensureRun();

        const startedAt = new Date().toISOString();
        const startMs = Date.now();
        let errorMessage = '';
        try {
          await manager.callTool(
            'slow.slow_lookup',
            { query: 'wait' },
            {
              timeoutMs: 200,
            }
          );
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
        }

        expect(errorMessage).toContain('timed out');

        const recorded = await recorder.recordCall({
          arguments: { query: 'wait' },
          durationMs: Date.now() - startMs,
          endedAt: new Date().toISOString(),
          error: errorMessage,
          startedAt,
          status: 'timeout',
          toolFingerprint: 'slow-fp',
          toolId: 'slow.slow_lookup',
        });

        const trace = await loadTrace(dir, recorded.runId);
        expect(trace.calls[0]?.status).toBe('timeout');
        expect(trace.status).toBe('failed');

        const stats = await runStats({ dir });
        expect(stats).toContain('Timeouts: 1');
      } finally {
        await manager.closeAll();
      }
    });
  }, 60_000);
});
