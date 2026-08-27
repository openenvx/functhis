import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runInspect } from '../src/cli/inspect';
import { runRecall } from '../src/cli/recall';
import { runTestWithExitCode } from '../src/cli/test';
import { runThis } from '../src/cli/this';
import { saveConfig } from '../src/storage/config';
import {
  parseToolText,
  testUpstreamConfig,
  withGatewayClient,
  withTempConfigDir,
} from './helpers';

describe('e2e crystallize loop (Layer 3)', () => {
  test('search → call → inspect → recall → this → test → reuse via gateway', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-e2e-fn-'));

      try {
        let runId = '';

        await withGatewayClient(
          { configPath, functionsDir },
          async (client) => {
            const searchResult = await client.callTool({
              arguments: { limit: 5, query: 'get user' },
              name: 'fn_search',
            });
            const searchPayload = parseToolText(searchResult) as {
              hits: { id: string }[];
            };
            expect(
              searchPayload.hits.some((hit) => hit.id === 'readonly.get_user')
            ).toBe(true);

            const describeResult = await client.callTool({
              arguments: { ids: ['readonly.get_user', 'readonly.list_issues'] },
              name: 'fn_describe',
            });
            const describePayload = parseToolText(describeResult) as {
              tools: { id: string }[];
            };
            expect(describePayload.tools).toHaveLength(2);

            const call1 = await client.callTool({
              arguments: {
                arguments: { userId: 'u1' },
                id: 'readonly.get_user',
                newRun: true,
              },
              name: 'fn_call',
            });
            const call1Payload = parseToolText(call1) as {
              address?: string;
              runId?: string;
            };
            expect(call1Payload.runId).toBeDefined();
            expect(call1Payload.address).toBe('@1');
            runId = call1Payload.runId ?? '';

            const call2 = await client.callTool({
              arguments: {
                arguments: {
                  owner: 'openenvx',
                  prior: '@1',
                  repo: 'functhis',
                },
                id: 'readonly.list_issues',
              },
              name: 'fn_call',
            });
            const call2Payload = parseToolText(call2) as { address?: string };
            expect(call2Payload.address).toBe('@2');

            const denied = await client.callTool({
              arguments: {
                arguments: { userId: 'u1' },
                id: 'readonly.delete_user',
              },
              name: 'fn_call',
            });
            const deniedPayload = parseToolText(denied) as { error?: string };
            expect(deniedPayload.error).toContain('not allowed');
          }
        );

        const inspectOutput = await runInspect({ dir: configDir, runId });
        expect(inspectOutput).toContain('Successful path');
        expect(inspectOutput).toContain('@1');
        expect(inspectOutput).toContain('@2');

        const recallOutput = await runRecall({
          address: '@1',
          dir: configDir,
          runId,
        });
        expect(recallOutput).toContain('Ada Lovelace');

        const compiled = await runThis({
          dir: configDir,
          force: true,
          functionsDir,
          name: 'e2e-lookup',
          runId,
        });
        expect(compiled.report).toContain('Compiled function');

        const testResult = await runTestWithExitCode({
          dir: configDir,
          functionsDir,
          name: 'e2e-lookup',
          repeat: 3,
        });
        expect(testResult.ok).toBe(true);
        expect(testResult.output).toContain('Tool fingerprints: OK');

        await withGatewayClient(
          { configPath, functionsDir },
          async (client) => {
            const listed = await client.listTools();
            expect(listed.tools.map((tool) => tool.name)).toContain(
              'e2e-lookup'
            );

            const searchResult = await client.callTool({
              arguments: { limit: 3, query: 'lookup user' },
              name: 'fn_search',
            });
            const searchPayload = parseToolText(searchResult) as {
              hits: { id: string; kind?: string }[];
            };
            expect(searchPayload.hits[0]?.id).toBe('e2e-lookup');
            expect(searchPayload.hits[0]?.kind).toBe('function');

            const directResult = await client.callTool({
              arguments: {
                owner: 'openenvx',
                repo: 'functhis',
                userId: 'u2',
              },
              name: 'e2e-lookup',
            });
            const directPayload = parseToolText(directResult) as {
              result?: unknown;
            };
            expect(JSON.stringify(directPayload.result)).toContain(
              'Deployment failed'
            );
          }
        );
      } finally {
        await rm(functionsDir, { force: true, recursive: true });
      }
    });
  }, 180_000);
});
