import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { mergeFuncthisClientConfig } from '../src/cli/client-config';
import { runFunctionCommand } from '../src/cli/run';
import { runTestWithExitCode } from '../src/cli/test';
import { runThis } from '../src/cli/this';
import { checkDrift } from '../src/functions/drift';
import { loadFunctionDefinition } from '../src/functions/load';
import {
  planExecutionWaves,
  resolveStepDependencies,
} from '../src/functions/plan';
import { applyJmesPath } from '../src/functions/select';
import { saveConfig } from '../src/storage/config';
import { TraceRecorder, prepareCallOutput } from '../src/trace/recorder';
import { UpstreamManager } from '../src/upstream/manager';
import { runCli, testUpstreamConfig, withTempConfigDir } from './helpers';

describe('JMESPath selection', () => {
  test('filters nested fields', () => {
    const data = {
      items: [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
    };
    expect(applyJmesPath(data, 'items[0].name')).toBe('Ada');
  });

  test('rejects invalid expressions', () => {
    expect(() => applyJmesPath({ a: 1 }, 'not valid !!!')).toThrow(
      /JMESPath select failed/
    );
  });
});

describe('DAG planning', () => {
  test('runs independent read steps in parallel waves', () => {
    const planned = resolveStepDependencies([
      { args: {}, id: 'a', tool: 'readonly.get_user' },
      { args: {}, dependsOn: [], id: 'b', tool: 'readonly.list_issues' },
    ]);
    const waves = planExecutionWaves(planned);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(2);
  });

  test('detects dependency cycles', () => {
    const planned = resolveStepDependencies([
      { args: {}, dependsOn: ['b'], id: 'a', tool: 'readonly.get_user' },
      { args: {}, dependsOn: ['a'], id: 'b', tool: 'readonly.list_issues' },
    ]);
    expect(() => planExecutionWaves(planned)).toThrow(/cycle/);
  });
});

describe('function replay integration', () => {
  test('compile, test, and run a two-step readonly function', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      const manager = new UpstreamManager();
      const recorder = new TraceRecorder(configDir);
      let runId = '';

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
          output: prepareCallOutput(result1).output,
          startedAt,
          status: 'succeeded',
          toolFingerprint:
            manager.catalog.getTool('readonly.get_user')?.fingerprint ?? 'fp1',
          toolId: 'readonly.get_user',
        });
        runId = first.runId;

        const { arguments: resolved, refs } = recorder.resolveArguments({
          prior: '@1',
        });
        const startedAt2 = new Date().toISOString();
        const startMs2 = Date.now();
        const result2 = await manager.callTool('readonly.list_issues', {
          note: resolved.prior,
          owner: 'openenvx',
          repo: 'functhis',
        });
        await recorder.recordCall({
          arguments: { owner: 'openenvx', prior: '@1', repo: 'functhis' },
          durationMs: Date.now() - startMs2,
          endedAt: new Date().toISOString(),
          output: prepareCallOutput(result2).output,
          refs,
          startedAt: startedAt2,
          status: 'succeeded',
          toolFingerprint:
            manager.catalog.getTool('readonly.list_issues')?.fingerprint ??
            'fp2',
          toolId: 'readonly.list_issues',
        });
      } finally {
        await manager.closeAll();
      }

      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-fn-'));
      try {
        const compiled = await runThis({
          dir: configDir,
          functionsDir,
          name: 'lookup-user-issues',
          runId,
        });
        expect(compiled.report).toContain('Compiled function');

        const definition = await loadFunctionDefinition(
          functionsDir,
          'lookup-user-issues'
        );
        expect(definition.plan.steps[1]?.dependsOn).toContain('get_user');

        const testResult = await runTestWithExitCode({
          dir: configDir,
          functionsDir,
          name: 'lookup-user-issues',
          repeat: 3,
        });
        expect(testResult.ok).toBe(true);
        expect(testResult.output).toContain('Tool fingerprints: OK');

        const runOutput = await runFunctionCommand({
          dir: configDir,
          functionsDir,
          input: JSON.stringify({
            owner: 'openenvx',
            repo: 'functhis',
            userId: 'u2',
          }),
          name: 'lookup-user-issues',
        });
        expect(runOutput).toContain('Ada Lovelace');
        expect(runOutput).toContain('Deployment failed');
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 120_000);

  test('fails closed on fingerprint drift', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-fn-drift-'));

      try {
        const manager = new UpstreamManager();
        await manager.connectAll(testUpstreamConfig().upstreams);
        const tool = manager.catalog.getTool('readonly.get_user');
        await manager.closeAll();

        const trace = {
          calls: [
            {
              address: '@1',
              arguments: { userId: 'u1' },
              durationMs: 1,
              endedAt: new Date().toISOString(),
              id: 'c1',
              output: { ok: true },
              startedAt: new Date().toISOString(),
              status: 'succeeded' as const,
              toolFingerprint: tool?.fingerprint ?? 'old-fp',
              toolId: 'readonly.get_user',
            },
          ],
          endedAt: new Date().toISOString(),
          id: 'run-drift',
          redactionVersion: '1',
          startedAt: new Date().toISOString(),
          status: 'succeeded' as const,
          toolFingerprints: {
            'readonly.get_user': 'deadbeefdeadbeef',
          },
        };

        const { saveTrace } = await import('../src/trace/store');
        await saveTrace(configDir, trace);

        await runThis({
          dir: configDir,
          force: true,
          functionsDir,
          name: 'drift-demo',
          runId: 'run-drift',
        });

        const manager2 = new UpstreamManager();
        await manager2.connectAll(testUpstreamConfig().upstreams);
        const definition = await loadFunctionDefinition(
          functionsDir,
          'drift-demo'
        );
        const drift = checkDrift(definition, manager2.catalog);
        await manager2.closeAll();

        expect(drift.ok).toBe(false);
        expect(drift.issues[0]?.kind).toBe('schema-changed');

        const testResult = await runTestWithExitCode({
          dir: configDir,
          functionsDir,
          name: 'drift-demo',
        });
        expect(testResult.ok).toBe(false);
        expect(testResult.output).toContain('schema-changed');
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 120_000);

  test('CLI exposes this, test, and run commands', async () => {
    const help = await runCli(['--help']);
    expect(help.stdout).toContain('this');
    expect(help.stdout).toContain('test');
    expect(help.stdout).toContain('run');
  });
});

describe('client MCP merge', () => {
  test('merges functhis entry with backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'functhis-client-'));
    const path = join(dir, 'mcp.json');
    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        path,
        `${JSON.stringify({ mcpServers: { other: { args: [], command: 'echo' } } }, null, 2)}\n`
      );
      const result = await mergeFuncthisClientConfig({
        client: 'cursor',
        targetPath: path,
      });
      expect(result.changed).toBe(true);
      expect(result.backupPath).toBeDefined();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
