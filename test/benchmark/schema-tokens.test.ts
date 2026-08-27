import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { encode } from 'gpt-tokenizer';
import { describe, expect, test } from 'vitest';

import { ToolCatalog } from '../../src/catalog/index';
import { normalizeCallResult } from '../../src/mcp/normalize';
import {
  buildResultEnvelope,
  estimateUtf8Bytes,
  estimateTokensFromBytes,
} from '../../src/output';
import { findPackageRoot } from '../../src/paths';
import { UpstreamManager } from '../../src/upstream/manager';
import { testUpstreamConfig } from '../helpers';

const META_TOOL_SCHEMAS = [
  {
    description: 'Search the local MCP tool catalog.',
    inputSchema: {
      properties: {
        limit: { type: 'integer' },
        query: { type: 'string' },
      },
      required: ['query'],
      type: 'object',
    },
    name: 'fn_search',
  },
  {
    description: 'Load schemas for selected tool ids.',
    inputSchema: {
      properties: { ids: { items: { type: 'string' }, type: 'array' } },
      required: ['ids'],
      type: 'object',
    },
    name: 'fn_describe',
  },
  {
    description: 'Invoke an upstream tool by id.',
    inputSchema: {
      properties: {
        arguments: { type: 'object' },
        id: { type: 'string' },
      },
      required: ['id'],
      type: 'object',
    },
    name: 'fn_call',
  },
];

function estimateSchemaTokens(
  tools: { name: string; description?: string; inputSchema: unknown }[]
): number {
  const payload = JSON.stringify(tools);
  return encode(payload).length;
}

describe('schema token benchmark', () => {
  test('discovery arm exposes far fewer schema tokens than direct', async () => {
    const manager = new UpstreamManager();
    try {
      await manager.connectAll(testUpstreamConfig().upstreams);
      const allTools = manager.catalog.getAllTools().map((tool) => ({
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
      }));

      const directTokens = estimateSchemaTokens(allTools);
      const discoveryTokens = estimateSchemaTokens(META_TOOL_SCHEMAS);

      expect(allTools.length).toBeGreaterThanOrEqual(100);
      expect(discoveryTokens).toBeLessThan(directTokens * 0.3);

      const reduction = 1 - discoveryTokens / directTokens;
      expect(reduction).toBeGreaterThan(0.7);

      const catalog = new ToolCatalog();
      for (const tool of manager.catalog.getAllTools()) {
        catalog.addTools(tool.serverId, [
          {
            description: tool.description,
            inputSchema: tool.inputSchema,
            name: tool.name,
          },
        ]);
      }

      const start = performance.now();
      const hits = catalog.searchTools('github issues', 5);
      const searchMs = performance.now() - start;
      expect(hits.length).toBeGreaterThan(0);

      const describeStart = performance.now();
      for (const hit of hits.slice(0, 3)) {
        catalog.getTool(hit.id);
      }
      const describeMs = performance.now() - describeStart;

      const callStart = performance.now();
      const largeResult = normalizeCallResult(
        await manager.callTool('readonly.get_large_payload', {
          itemCount: 200,
        })
      );
      const callMs = performance.now() - callStart;

      const storedBytes = estimateUtf8Bytes(largeResult);
      const { envelope, returnedBytes } = buildResultEnvelope(largeResult);
      const storedTokens = estimateTokensFromBytes(storedBytes);
      const returnedTokens = estimateTokensFromBytes(returnedBytes);
      const resultReduction = 1 - returnedBytes / storedBytes;

      expect(envelope.truncated).toBe(true);
      expect(resultReduction).toBeGreaterThan(0.7);

      const packageRoot = findPackageRoot(import.meta.url);
      const report = [
        '# M1 discovery benchmark',
        '',
        'Token counts are **estimates** using gpt-tokenizer on serialized JSON schemas.',
        '',
        '| Arm | Schema tokens (est.) |',
        '|---|---:|',
        `| Direct MCP (all tools) | ${directTokens} |`,
        `| Functhis discovery (meta-tools) | ${discoveryTokens} |`,
        `| Saved Function replay | n/a (M3) |`,
        '',
        `Schema reduction: ${(reduction * 100).toFixed(1)}%`,
        '',
        '## Result shaping (local fixture, est.)',
        '',
        '| Metric | Value |',
        '|---|---:|',
        `| Stored result bytes | ${storedBytes} |`,
        `| Returned envelope bytes | ${returnedBytes} |`,
        `| Stored result tokens (est.) | ${storedTokens} |`,
        `| Returned envelope tokens (est.) | ${returnedTokens} |`,
        `| Result byte reduction | ${(resultReduction * 100).toFixed(1)}% |`,
        '',
        '## Latency (local fixture, ms)',
        '',
        `| Step | Median-ish (single run) |`,
        `|---|---:|`,
        `| fn_search | ${searchMs.toFixed(1)} |`,
        `| fn_describe (3 ids) | ${describeMs.toFixed(1)} |`,
        `| fn_call | ${callMs.toFixed(1)} |`,
        '',
      ].join('\n');

      await mkdir(join(packageRoot, 'benchmarks'), { recursive: true });
      await writeFile(
        join(packageRoot, 'benchmarks', 'm1-discovery.md'),
        report
      );
    } finally {
      await manager.closeAll();
    }
  }, 60_000);
});
