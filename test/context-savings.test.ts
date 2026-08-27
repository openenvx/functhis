import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { estimateUtf8Bytes } from '../src/output';
import { saveConfig } from '../src/storage/config';
import {
  parseToolText,
  testUpstreamConfig,
  withGatewayClient,
  withTempConfigDir,
} from './helpers';

describe('context savings gateway', () => {
  test('fn_call returns compact envelope for large upstream results', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient({ configPath }, async (client) => {
        const listed = await client.listTools();
        expect(listed.tools.map((tool) => tool.name)).toContain('fn_stats');
        expect(listed.tools.map((tool) => tool.name)).toContain('fn_select');

        const callResult = await client.callTool({
          arguments: {
            arguments: { itemCount: 200 },
            id: 'readonly.get_large_payload',
            newRun: true,
          },
          name: 'fn_call',
        });
        const payload = parseToolText(callResult) as {
          address?: string;
          bytes?: number;
          preview?: unknown;
          result?: unknown;
          runId?: string;
          truncated?: boolean;
        };

        expect(payload.runId).toBeDefined();
        expect(payload.address).toBe('@1');
        expect(payload.truncated).toBe(true);
        expect(payload.preview).toBeDefined();
        expect(payload.result).toBeUndefined();
        expect(payload.bytes).toBeGreaterThan(6000);

        const selectResult = await client.callTool({
          arguments: {
            address: '@1',
            runId: payload.runId,
            select: 'items[0].title',
          },
          name: 'fn_select',
        });
        const selectPayload = parseToolText(selectResult) as {
          result?: string;
          truncated?: boolean;
        };
        expect(selectPayload.truncated).toBe(false);
        expect(selectPayload.result).toBe('Synthetic issue 0');

        const statsResult = await client.callTool({
          arguments: {},
          name: 'fn_stats',
        });
        const statsPayload = parseToolText(statsResult) as {
          estimatedResultBytesSaved?: number;
          labels?: { resultBytes?: string };
          storedResultBytes?: number;
        };
        expect(statsPayload.labels?.resultBytes).toBe('estimated');
        expect(statsPayload.storedResultBytes).toBeGreaterThan(0);
        expect(statsPayload.estimatedResultBytesSaved).toBeGreaterThan(0);
      });
    });
  }, 120_000);

  test('fn_call full:true returns entire small payloads inline', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient({ configPath }, async (client) => {
        const callResult = await client.callTool({
          arguments: {
            arguments: { userId: 'u1' },
            id: 'readonly.get_user',
            newRun: true,
          },
          name: 'fn_call',
        });
        const payload = parseToolText(callResult) as {
          result?: { name?: string };
          truncated?: boolean;
        };
        expect(payload.truncated).toBe(false);
        expect(payload.result?.name).toBe('Ada Lovelace');
      });
    });
  }, 120_000);
});

describe('result token benchmark helpers', () => {
  test('large fixture exceeds context budget', () => {
    const value = {
      items: Array.from({ length: 200 }, (_, index) => ({
        body: `Issue body ${index} `.repeat(20),
        id: index + 1,
        title: `Synthetic issue ${index}`,
      })),
    };
    expect(estimateUtf8Bytes(value)).toBeGreaterThan(6000);
  });
});
