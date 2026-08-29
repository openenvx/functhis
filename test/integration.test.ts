import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runIndex } from '../src/cli/index-cmd';
import { findPackageRoot } from '../src/paths';
import { saveConfig } from '../src/storage/config';
import {
  parseToolText,
  testUpstreamConfig,
  withGatewayClient,
  withIntegrationConfigDir,
} from './helpers';

const packageRoot = findPackageRoot(import.meta.url);

describe('integration', () => {
  test('indexes the repo and returns a compact subgraph', async () => {
    await withIntegrationConfigDir(async (configDir) => {
      const { report } = await runIndex({
        dir: configDir,
        include: ['src/catalog'],
        root: packageRoot,
      });
      expect(report.filesIndexed).toBeGreaterThan(0);

      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient(
        { configPath, cwd: packageRoot },
        async (client) => {
          const indexResult = await client.callTool({
            arguments: { include: ['src/catalog'], root: packageRoot },
            name: 'fn_index',
          });
          const indexBody = parseToolText(indexResult) as {
            filesIndexed: number;
          };
          expect(indexBody.filesIndexed).toBeGreaterThan(0);

          const searchResult = await client.callTool({
            arguments: { limit: 10, query: 'fingerprintTool' },
            name: 'fn_search_context',
          });
          const subgraph = parseToolText(searchResult) as {
            bytes: number;
            edges: unknown[];
            nodes: { name: string }[];
          };
          expect(subgraph.bytes).toBeLessThanOrEqual(6 * 1024);
          expect(
            subgraph.nodes.some((node) => node.name.includes('fingerprint'))
          ).toBe(true);
          expect(subgraph.edges.length).toBeGreaterThan(0);
        }
      );
    });
  }, 60_000);

  test('executes sandbox code through the gateway', async () => {
    await withIntegrationConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient({ configPath }, async (client) => {
        const source = `
export default async function(ctx, input) {
  const data = await ctx.tools.readonly.get_user({ userId: 'u42' });
  return { userId: data.userId, name: data.name };
}
`;
        const result = await client.callTool({
          arguments: {
            allowedTools: ['readonly.get_user'],
            full: true,
            newRun: true,
            source,
          },
          name: 'fn_execute_code',
        });
        const body = parseToolText(result) as {
          result?: { name: string; userId: string };
        };
        expect(body.result).toEqual({ name: 'Ada Lovelace', userId: 'u42' });
      });
    });
  }, 30_000);

  test('saves and runs a function package through the gateway', async () => {
    await withIntegrationConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-int-pkg-'));

      try {
        const source = `
export default async function(ctx, input) {
  return await ctx.tools.readonly.get_user({ userId: input.userId });
}
`;

        await withGatewayClient(
          { configPath, cwd: packageRoot, packagesDir },
          async (client) => {
            const saveResult = await client.callTool({
              arguments: {
                allowedTools: ['readonly.get_user'],
                description: 'Fetch a user by id',
                name: 'get-user',
                source,
              },
              name: 'fn_save_function',
            });
            const saved = parseToolText(saveResult) as { saved: boolean };
            expect(saved.saved).toBe(true);

            const runResult = await client.callTool({
              arguments: {
                arguments: { userId: 'u7' },
                full: true,
                id: 'get-user',
                newRun: true,
              },
              name: 'fn_call',
            });
            const runBody = parseToolText(runResult) as {
              result?: { userId: string };
            };
            expect(runBody.result?.userId).toBe('u7');

            const inspectResult = await client.callTool({
              arguments: { name: 'get-user' },
              name: 'fn_inspect_function',
            });
            const inspectText = inspectResult.content.find(
              (entry) => entry.type === 'text'
            )?.text;
            expect(inspectText).toContain('Lock status: OK');

            const listed = await client.listTools();
            expect(listed.tools.map((tool) => tool.name)).toContain('get-user');

            const traced = await client.callTool({
              arguments: {
                arguments: { userId: 'u9' },
                full: true,
                id: 'get-user',
                newRun: true,
              },
              name: 'fn_call',
            });
            const tracedBody = parseToolText(traced) as { runId?: string };
            expect(tracedBody.runId).toBeDefined();

            const runInspect = await client.callTool({
              arguments: { runId: tracedBody.runId },
              name: 'fn_inspect',
            });
            const runInspectText = runInspect.content.find(
              (entry) => entry.type === 'text'
            )?.text;
            expect(runInspectText).toContain('get-user');
            expect(runInspectText).toContain('readonly.get_user');
          }
        );
      } finally {
        await rm(packagesDir, { force: true, recursive: true });
      }
    });
  }, 60_000);

  test('exposes graph and sandbox MCP tools', async () => {
    await withIntegrationConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient({ configPath }, async (client) => {
        const listed = await client.listTools();
        const names = listed.tools.map((tool) => tool.name);
        for (const tool of [
          'fn_index',
          'fn_search_context',
          'fn_subgraph',
          'fn_execute_code',
          'fn_save_function',
          'fn_install_function',
          'fn_inspect_function',
          'fn_compile_trace',
          'fn_candidates',
          'fn_compile_group',
          'fn_test_function',
          'fn_learning_status',
          'fn_learning_pause',
          'fn_learning_resume',
        ]) {
          expect(names).toContain(tool);
        }
      });
    });
  }, 30_000);

  test('compiles a trace into a tested and saved function package', async () => {
    await withIntegrationConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-compile-'));

      try {
        await withGatewayClient(
          { configPath, cwd: packageRoot, packagesDir },
          async (client) => {
            const first = await client.callTool({
              arguments: {
                arguments: { userId: 'u42' },
                full: true,
                id: 'readonly.get_user',
                newRun: true,
              },
              name: 'fn_call',
            });
            const firstBody = parseToolText(first) as { runId?: string };
            expect(firstBody.runId).toBeDefined();

            const compileResult = await client.callTool({
              arguments: {
                name: 'trace-user-issues',
                runId: firstBody.runId!,
              },
              name: 'fn_compile_trace',
            });
            const brief = parseToolText(compileResult) as {
              allowedTools: string[];
              skeleton: string;
              suggestedInputs: string[];
            };
            expect(brief.allowedTools).toContain('readonly.get_user');
            expect(brief.skeleton).toContain('input.userId');

            const testResult = await client.callTool({
              arguments: {
                allowedTools: brief.allowedTools,
                compiledFrom: firstBody.runId,
                input: { userId: 'u42' },
                mode: 'replay',
                name: 'trace-user-issues',
                source: brief.skeleton,
              },
              name: 'fn_test_function',
            });
            const testText = testResult.content.find(
              (entry) => entry.type === 'text'
            )?.text;
            expect(testText).toContain('Status: verified locally');

            const saveResult = await client.callTool({
              arguments: {
                allowedTools: brief.allowedTools,
                compiledFrom: firstBody.runId,
                description: 'Compiled from trace',
                inputSchema: {
                  properties: { userId: { type: 'string' } },
                  type: 'object',
                },
                name: 'trace-user-issues',
                source: brief.skeleton,
              },
              name: 'fn_save_function',
            });
            const saved = parseToolText(saveResult) as { saved: boolean };
            expect(saved.saved).toBe(true);

            const searchResult = await client.callTool({
              arguments: { query: 'trace-user-issues' },
              name: 'fn_search',
            });
            const searchBody = parseToolText(searchResult) as {
              hits: { id: string; kind: string }[];
            };
            expect(searchBody.hits[0]?.kind).toBe('package');

            const invokeResult = await client.callTool({
              arguments: {
                arguments: { userId: 'u42' },
                full: true,
                id: 'trace-user-issues',
                newRun: true,
              },
              name: 'fn_call',
            });
            const invokeBody = parseToolText(invokeResult) as {
              result?: { name?: string; userId?: string };
            };
            expect(invokeBody.result?.userId).toBe('u42');
            expect(invokeBody.result?.name).toBe('Ada Lovelace');
          }
        );
      } finally {
        await rm(packagesDir, { force: true, recursive: true });
      }
    });
  }, 90_000);

  test('denies write-capable package without approveWrites and runs with approval', async () => {
    await withIntegrationConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-write-pkg-'));

      try {
        const source = `
export default async function(ctx, input) {
  return await ctx.tools.readonly.delete_user(input);
}
`;

        await withGatewayClient(
          { configPath, cwd: packageRoot, packagesDir },
          async (client) => {
            const saveResult = await client.callTool({
              arguments: {
                allowedTools: ['readonly.delete_user'],
                approveWrites: true,
                description: 'Delete a user',
                name: 'delete-user',
                source,
              },
              name: 'fn_save_function',
            });
            const saved = parseToolText(saveResult) as {
              hotRegistered: boolean;
              hotRegisterReason?: string;
              saved: boolean;
            };
            expect(saved.saved).toBe(true);
            expect(saved.hotRegistered).toBe(false);
            expect(saved.hotRegisterReason).toContain('manual write packages');

            const denied = await client.callTool({
              arguments: {
                arguments: { userId: 'u1' },
                full: true,
                id: 'delete-user',
                newRun: true,
              },
              name: 'fn_call',
            });
            const deniedBody = parseToolText(denied) as { error?: string };
            expect(deniedBody.error).toContain('approveWrites');

            const approved = await client.callTool({
              arguments: {
                approveWrites: true,
                arguments: { userId: 'u1' },
                full: true,
                id: 'delete-user',
                newRun: true,
              },
              name: 'fn_call',
            });
            const approvedBody = parseToolText(approved) as {
              result?: { deleted: string };
            };
            expect(approvedBody.result?.deleted).toBe('u1');
          }
        );
      } finally {
        await rm(packagesDir, { force: true, recursive: true });
      }
    });
  }, 60_000);

  test('fn_execute_code is always sandboxed and has no execution mode', async () => {
    await withIntegrationConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient({ configPath }, async (client) => {
        const listed = await client.listTools();
        const executeTool = listed.tools.find(
          (tool) => tool.name === 'fn_execute_code'
        );
        expect(executeTool).toBeDefined();
        const schema = executeTool?.inputSchema as {
          properties?: Record<string, unknown>;
        };
        expect(schema?.properties?.execution).toBeUndefined();
      });
    });
  }, 30_000);
});
