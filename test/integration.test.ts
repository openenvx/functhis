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
  withTempConfigDir,
} from './helpers';

const packageRoot = findPackageRoot(import.meta.url);

describe('integration', () => {
  test('indexes the repo and returns a compact subgraph', async () => {
    await withTempConfigDir(async (configDir) => {
      const { report } = await runIndex({
        dir: configDir,
        include: ['src/catalog'],
        root: packageRoot,
      });
      expect(report.filesIndexed).toBeGreaterThan(0);

      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient({ configPath, cwd: packageRoot }, async (client) => {
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
        expect(subgraph.nodes.some((node) => node.name.includes('fingerprint'))).toBe(
          true
        );
        expect(subgraph.edges.length).toBeGreaterThan(0);
      });
    });
  }, 60_000);

  test('executes sandbox code through the gateway', async () => {
    await withTempConfigDir(async (configDir) => {
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
            source,
          },
          name: 'fn_execute_code',
        });
        const body = parseToolText(result) as {
          output?: { name: string; userId: string };
          status: string;
        };
        expect(body.status).toBe('succeeded');
        expect(body.output).toEqual({ name: 'Ada Lovelace', userId: 'u42' });
      });
    });
  }, 30_000);

  test('saves and runs a function package through the gateway', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-int-pkg-'));

      try {
        const source = `
export default async function(ctx, input) {
  return await ctx.tools.readonly.get_user({ userId: input.userId });
}
`;

        await withGatewayClient(
          { configPath, cwd: packageRoot, functionsDir },
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
                id: 'get-user',
              },
              name: 'fn_call',
            });
            const runBody = parseToolText(runResult) as {
              output?: { userId: string };
            };
            expect(runBody.output?.userId).toBe('u7');

            const inspectResult = await client.callTool({
              arguments: { name: 'get-user' },
              name: 'fn_inspect_function',
            });
            const inspectText = inspectResult.content.find(
              (entry) => entry.type === 'text'
            )?.text;
            expect(inspectText).toContain('Lock status: OK');
          }
        );
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 60_000);

  test('exposes graph and sandbox MCP tools', async () => {
    await withTempConfigDir(async (configDir) => {
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
        ]) {
          expect(names).toContain(tool);
        }
      });
    });
  }, 30_000);
});
