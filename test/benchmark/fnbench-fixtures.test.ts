import { describe, expect, test } from 'vitest';

import { FNBENCH_CASES } from '../../fixtures/benchmark/cases';
import { utf8Bytes } from '../../fixtures/benchmark/payload';
import { buildFnbenchUpstreamConfig } from '../../scripts/benchmark/config';
import { evaluateOracle, normalizeJson } from '../../scripts/benchmark/oracle';
import { buildReplayDefinition } from '../../scripts/benchmark/replay';
import { runFunction } from '../../src/functions/runner';
import { findPackageRoot } from '../../src/paths';
import { UpstreamManager } from '../../src/upstream/manager';

const packageRoot = findPackageRoot(import.meta.url);

describe('fnbench fixtures', () => {
  test('each tool payload is between 60 KB and 95 KB', async () => {
    const manager = new UpstreamManager();
    try {
      await manager.connectAll(
        buildFnbenchUpstreamConfig(packageRoot).upstreams
      );
      for (const caseDef of FNBENCH_CASES) {
        const result = await manager.callTool(caseDef.upstreamId, {});
        const text = result.content.find(
          (entry) => entry.type === 'text'
        )?.text;
        expect(text).toBeDefined();
        const bytes = utf8Bytes(JSON.parse(text!));
        expect(bytes).toBeGreaterThanOrEqual(60 * 1024);
        expect(bytes).toBeLessThanOrEqual(95 * 1024);
      }
    } finally {
      await manager.closeAll();
    }
  }, 120_000);

  test('replay Functions return exact oracles', async () => {
    const manager = new UpstreamManager();
    try {
      await manager.connectAll(
        buildFnbenchUpstreamConfig(packageRoot).upstreams
      );
      for (const caseDef of FNBENCH_CASES) {
        const tool = manager.catalog.getTool(caseDef.upstreamId);
        expect(tool).toBeDefined();
        const definition = buildReplayDefinition(caseDef, tool!.fingerprint);
        const result = await runFunction(definition, {}, manager);
        expect(normalizeJson(result.output)).toEqual(
          normalizeJson(caseDef.oracle)
        );
      }
    } finally {
      await manager.closeAll();
    }
  }, 120_000);

  test('oracle parser accepts fenced JSON', () => {
    const oracle = FNBENCH_CASES[0]!.oracle;
    const text = `\`\`\`json\n${JSON.stringify(oracle)}\n\`\`\``;
    expect(evaluateOracle(text, oracle).passed).toBe(true);
  });
});
