import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { indexRepository } from '../src/graph/index-repo';
import { searchContext } from '../src/graph/retrieve';
import { GraphStore } from '../src/graph/store';

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
});
