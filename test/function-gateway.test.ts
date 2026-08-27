import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runThis } from '../src/cli/this';
import { saveConfig } from '../src/storage/config';
import { TraceRecorder, prepareCallOutput } from '../src/trace/recorder';
import { loadTrace } from '../src/trace/store';
import { UpstreamManager } from '../src/upstream/manager';
import {
  parseToolText,
  testUpstreamConfig,
  withGatewayClient,
  withTempConfigDir,
} from './helpers';

async function compileLookupFunction(
  configDir: string,
  functionsDir: string
): Promise<string> {
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
        manager.catalog.getTool('readonly.list_issues')?.fingerprint ?? 'fp2',
      toolId: 'readonly.list_issues',
    });

    const trace = await loadTrace(configDir, runId);
    expect(trace.status).toBe('succeeded');
  } finally {
    await manager.closeAll();
  }

  await runThis({
    dir: configDir,
    force: true,
    functionsDir,
    name: 'lookup-user-issues',
    runId,
  });

  return runId;
}

describe('function gateway', () => {
  test('exposes compiled Functions as MCP tools and ranks them in search', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-gw-fn-'));

      try {
        await compileLookupFunction(configDir, functionsDir);

        await withGatewayClient(
          { configPath, functionsDir },
          async (client) => {
            const listed = await client.listTools();
            const toolNames = listed.tools.map((tool) => tool.name);
            expect(toolNames).toContain('lookup-user-issues');
            expect(toolNames).toContain('fn_search');
            expect(toolNames).toContain('fn_inspect');
            expect(toolNames).toContain('fn_this');
            expect(toolNames).toContain('fn_test');

            const lookupTool = listed.tools.find(
              (tool) => tool.name === 'lookup-user-issues'
            );
            expect(lookupTool?.inputSchema).toMatchObject({
              properties: expect.objectContaining({
                full: expect.objectContaining({ type: 'boolean' }),
              }),
            });

            const searchResult = await client.callTool({
              arguments: { limit: 5, query: 'lookup user issues' },
              name: 'fn_search',
            });
            const searchPayload = parseToolText(searchResult) as {
              hits: { id: string; kind?: string }[];
              totalFunctions: number;
            };
            expect(searchPayload.totalFunctions).toBe(1);
            expect(searchPayload.hits[0]?.id).toBe('lookup-user-issues');
            expect(searchPayload.hits[0]?.kind).toBe('function');

            const describeResult = await client.callTool({
              arguments: { ids: ['lookup-user-issues'] },
              name: 'fn_describe',
            });
            const describePayload = parseToolText(describeResult) as {
              tools: { id: string; kind?: string; requiredTools?: string[] }[];
            };
            expect(describePayload.tools[0]?.kind).toBe('function');
            expect(describePayload.tools[0]?.requiredTools).toContain(
              'readonly.get_user'
            );

            const directResult = await client.callTool({
              arguments: {
                owner: 'openenvx',
                repo: 'functhis',
                userId: 'u2',
              },
              name: 'lookup-user-issues',
            });
            const directPayload = parseToolText(directResult) as {
              result?: unknown;
            };
            expect(JSON.stringify(directPayload.result)).toContain(
              'Deployment failed'
            );

            const directFullResult = await client.callTool({
              arguments: {
                full: true,
                owner: 'openenvx',
                repo: 'functhis',
                userId: 'u2',
              },
              name: 'lookup-user-issues',
            });
            const directFullPayload = parseToolText(directFullResult) as {
              result?: unknown;
              truncated?: boolean;
            };
            expect(directFullPayload.truncated).toBe(false);
            expect(JSON.stringify(directFullPayload.result)).toContain(
              'Deployment failed'
            );

            const fnCallResult = await client.callTool({
              arguments: {
                arguments: {
                  owner: 'openenvx',
                  repo: 'functhis',
                  userId: 'u2',
                },
                id: 'lookup-user-issues',
                newRun: true,
              },
              name: 'fn_call',
            });
            const fnCallPayload = parseToolText(fnCallResult) as {
              result?: unknown;
            };
            expect(JSON.stringify(fnCallPayload.result)).toContain(
              'Deployment failed'
            );
          }
        );
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 120_000);

  test('serves meta-tools only when functions directory is empty', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-gw-empty-'));

      try {
        await withGatewayClient(
          { configPath, functionsDir },
          async (client) => {
            const listed = await client.listTools();
            const toolNames = listed.tools.map((tool) => tool.name);
            expect(toolNames).toContain('fn_search');
            expect(toolNames).not.toContain('lookup-user-issues');

            const searchResult = await client.callTool({
              arguments: { limit: 3, query: 'get user' },
              name: 'fn_search',
            });
            const searchPayload = parseToolText(searchResult) as {
              hits: { kind?: string }[];
              totalFunctions: number;
            };
            expect(searchPayload.totalFunctions).toBe(0);
            expect(searchPayload.hits.every((hit) => hit.kind === 'tool')).toBe(
              true
            );
          }
        );
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 120_000);

  test('fails closed when invoking a drifted Function through the gateway', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-gw-drift-'));

      try {
        await compileLookupFunction(configDir, functionsDir);

        const { loadFunctionDefinition } =
          await import('../src/functions/load');
        const { writeFile } = await import('node:fs/promises');
        const definition = await loadFunctionDefinition(
          functionsDir,
          'lookup-user-issues'
        );
        definition.toolFingerprints['readonly.get_user'] = 'deadbeefdeadbeef';
        const source = [
          '// drifted fingerprint',
          'export default ',
          `${JSON.stringify(definition, null, 2)};`,
          '',
        ].join('\n');
        await writeFile(
          join(functionsDir, 'lookup-user-issues.ts'),
          source,
          'utf-8'
        );

        await withGatewayClient(
          { configPath, functionsDir },
          async (client) => {
            const result = await client.callTool({
              arguments: {
                owner: 'openenvx',
                repo: 'functhis',
                userId: 'u2',
              },
              name: 'lookup-user-issues',
            });
            const payload = parseToolText(result) as { error?: string };
            expect(payload.error).toContain('drift');
          }
        );
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 120_000);

  test('fn_this reloads library for fn_search without gateway restart', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-gw-this-'));

      try {
        const runId = await compileLookupFunction(configDir, functionsDir);
        await rm(join(functionsDir, 'lookup-user-issues.ts'), { force: true });
        await rm(join(functionsDir, 'lookup-user-issues.fixture.json'), {
          force: true,
        });

        await withGatewayClient(
          { configPath, functionsDir },
          async (client) => {
            const inspectResult = await client.callTool({
              arguments: { runId },
              name: 'fn_inspect',
            });
            const inspectText =
              inspectResult.content.find((entry) => entry.type === 'text')
                ?.text ?? '';
            expect(inspectText).toContain('Successful path');

            const thisResult = await client.callTool({
              arguments: {
                name: 'lookup-user-issues',
                runId,
              },
              name: 'fn_this',
            });
            const thisPayload = parseToolText(thisResult) as {
              searchable?: boolean;
            };
            expect(thisPayload.searchable).toBe(true);

            const searchResult = await client.callTool({
              arguments: { limit: 5, query: 'lookup user issues' },
              name: 'fn_search',
            });
            const searchPayload = parseToolText(searchResult) as {
              hits: { id: string }[];
              totalFunctions: number;
            };
            expect(searchPayload.totalFunctions).toBe(1);
            expect(searchPayload.hits[0]?.id).toBe('lookup-user-issues');

            const testResult = await client.callTool({
              arguments: { name: 'lookup-user-issues', repeat: 3 },
              name: 'fn_test',
            });
            const testText =
              testResult.content.find((entry) => entry.type === 'text')?.text ??
              '';
            expect(testText).toContain('passed');
          }
        );
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 120_000);
});
