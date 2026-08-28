import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';

import { UpstreamManager } from '../src/upstream/manager';
import { PackageLibrary } from '../src/packages/library';
import { savePackage } from '../src/packages/save';
import { inspectLockDrift } from '../src/packages/install';

describe('function packages', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('saves and loads a package with lock hashes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'functhis-pkg-'));
    const functionsRoot = join(tempDir, 'functions');
    await mkdir(functionsRoot, { recursive: true });

    const manager = new UpstreamManager();
    manager.catalog.addTools('readonly', [
      {
        description: 'Get user',
        inputSchema: { properties: { userId: { type: 'string' } }, type: 'object' },
        name: 'get_user',
      },
    ]);

    await savePackage(manager, {
      allowedTools: ['readonly.get_user'],
      description: 'Test package',
      functionsRoot,
      name: 'test-pkg',
      source: `export default async function(ctx, input) {
  return await ctx.tools.readonly.get_user(input);
}`,
    });

    const library = await PackageLibrary.load(functionsRoot);
    const pkg = library.get('test-pkg');
    expect(pkg).toBeDefined();
    expect(pkg?.manifest.apiVersion).toBe('functhis.dev/v1');

    const drift = inspectLockDrift(manager, pkg!.lock);
    expect(drift.ok).toBe(true);
  });
});
