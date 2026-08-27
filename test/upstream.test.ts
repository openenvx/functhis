import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { assertToolAllowed } from '../src/policy/access';
import { saveConfig } from '../src/storage/config';
import { UpstreamManager } from '../src/upstream/manager';
import { testUpstreamConfig, withTempConfigDir } from './helpers';

describe('upstream integration', () => {
  test('lists and calls tools through manager', async () => {
    const manager = new UpstreamManager();
    const config = testUpstreamConfig();

    try {
      const results = await manager.connectAll(config.upstreams);
      expect(results.get('catalog')).not.toBeInstanceOf(Error);
      expect(manager.catalog.size()).toBeGreaterThanOrEqual(100);

      const hits = manager.catalog.searchTools('github issues', 5);
      expect(hits.some((h) => h.id === 'catalog.search_github_issues')).toBe(
        true
      );

      const userTool = manager.catalog.getTool('readonly.get_user');
      expect(userTool).toBeDefined();
      assertToolAllowed(userTool!);

      const result = await manager.callTool('readonly.get_user', {
        userId: 'u1',
      });
      expect(result.content[0]?.text).toContain('Ada Lovelace');

      const deleteTool = manager.catalog.getTool('readonly.delete_user');
      expect(deleteTool?.risk).toBe('write');
      expect(() => assertToolAllowed(deleteTool!)).toThrow(/not allowed/);
    } finally {
      await manager.closeAll();
    }
  }, 60_000);

  test('gateway config loads from temp dir', async () => {
    await withTempConfigDir(async (dir) => {
      await saveConfig(join(dir, 'upstreams.json'), testUpstreamConfig());
      const manager = new UpstreamManager();
      try {
        const { loadConfig } = await import('../src/storage/config');
        const config = await loadConfig(join(dir, 'upstreams.json'));
        await manager.connectAll(config.upstreams);
        expect(
          manager.catalog.searchTools('deployment', 3).length
        ).toBeGreaterThan(0);
      } finally {
        await manager.closeAll();
      }
    });
  }, 60_000);
});
