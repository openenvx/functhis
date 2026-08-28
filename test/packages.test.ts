import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { inspectLockDrift } from '../src/packages/install';
import { PackageLibrary } from '../src/packages/library';
import { savePackage } from '../src/packages/save';
import { UpstreamManager } from '../src/upstream/manager';

describe('packages', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('saves and loads a package with lock hashes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'functhis-pkg-'));
    const packagesRoot = join(tempDir, 'packages');
    await mkdir(packagesRoot, { recursive: true });

    const manager = new UpstreamManager();
    manager.catalog.addTools('readonly', [
      {
        description: 'Get user',
        inputSchema: {
          properties: { userId: { type: 'string' } },
          type: 'object',
        },
        name: 'get_user',
      },
    ]);

    await savePackage(manager, {
      allowedTools: ['readonly.get_user'],
      description: 'Test package',
      packagesRoot,
      name: 'test-pkg',
      source: `export default async function(ctx, input) {
  return await ctx.tools.readonly.get_user(input);
}`,
    });

    const library = await PackageLibrary.load(packagesRoot);
    const pkg = library.get('test-pkg');
    expect(pkg).toBeDefined();
    expect(pkg?.manifest.name).toBe('test-pkg');

    const drift = inspectLockDrift(manager, pkg!.lock);
    expect(drift.ok).toBe(true);
  });
});
