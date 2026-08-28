import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { indexRepository } from '../src/graph/index-repo';
import { indexRunNode } from '../src/graph/index-run';
import { searchContext, searchSymbolAndTool } from '../src/graph/retrieve';
import { GraphStore } from '../src/graph/store';
import type { ExecutionTrace } from '../src/trace/schema';

describe('graph store and indexer', () => {
  let tempDir: string;
  let configDir: string;
  let repoRoot: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('indexes files, exports, and imports incrementally', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'functhis-graph-'));
    configDir = join(tempDir, 'config');
    repoRoot = join(tempDir, 'repo');
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(
      join(repoRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'ESNext', target: 'ES2022' },
        include: ['src/**/*'],
      }),
      'utf-8'
    );
    await writeFile(
      join(repoRoot, 'src', 'util.ts'),
      `export function helper() { return 1; }\n`,
      'utf-8'
    );
    await writeFile(
      join(repoRoot, 'src', 'main.ts'),
      `import { helper } from './util.js';\nexport function run() { return helper(); }\n`,
      'utf-8'
    );

    const store = new GraphStore(join(configDir, 'graph.sqlite'));
    const report = indexRepository(store, {
      include: ['src'],
      root: repoRoot,
    });

    expect(report.filesIndexed).toBe(2);
    expect(report.symbolsAdded).toBeGreaterThanOrEqual(2);

    const hits = searchContext(store, 'helper', { repoRoot });
    expect(hits.nodes.some((node) => node.name === 'helper')).toBe(true);
    expect(hits.edges.length).toBeGreaterThan(0);
    expect(hits.bytes).toBeLessThanOrEqual(6 * 1024);

    store.close();
  });

  it('links repo symbols and tool-using runs in one subgraph', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'functhis-graph-cross-'));
    configDir = join(tempDir, 'config');
    repoRoot = join(tempDir, 'repo');
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(
      join(repoRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'ESNext', target: 'ES2022' },
        include: ['src/**/*'],
      }),
      'utf-8'
    );
    await writeFile(
      join(repoRoot, 'src', 'billing.ts'),
      `export function chargeCustomer() { return true; }\n`,
      'utf-8'
    );

    const store = new GraphStore(join(configDir, 'graph.sqlite'));
    indexRepository(store, { include: ['src'], root: repoRoot });
    store.upsertNode({
      attrs: {},
      id: 'readonly.get_user',
      kind: 'tool',
      name: 'get_user',
      updatedAt: Date.now(),
    });

    const trace: ExecutionTrace = {
      calls: [
        {
          address: '@1',
          arguments: { userId: 'u1' },
          durationMs: 10,
          endedAt: new Date().toISOString(),
          id: 'call-1',
          sideEffect: 'read',
          startedAt: new Date().toISOString(),
          status: 'succeeded',
          toolFingerprint: 'fp1',
          toolId: 'readonly.get_user',
        },
      ],
      id: 'run-billing',
      redactionVersion: '1',
      startedAt: new Date().toISOString(),
      status: 'succeeded',
      toolFingerprints: { 'readonly.get_user': 'fp1' },
    };
    indexRunNode(store, trace);

    const result = searchSymbolAndTool(store, {
      query: 'chargeCustomer',
      repoRoot,
      toolId: 'readonly.get_user',
    });

    expect(result.nodes.some((node) => node.name === 'chargeCustomer')).toBe(
      true
    );
    expect(result.nodes.some((node) => node.id === 'run:run-billing')).toBe(
      true
    );
    expect(
      result.edges.some(
        (edge) => edge.kind === 'uses_tool' && edge.toId === 'readonly.get_user'
      )
    ).toBe(true);

    store.close();
  });
});
