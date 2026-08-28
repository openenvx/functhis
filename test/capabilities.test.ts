import { describe, expect, test } from 'vitest';

import {
  classifyPackageWrites,
  hasWriteCapabilities,
} from '../src/packages/capabilities';
import { UpstreamManager } from '../src/upstream/manager';

describe('package capabilities', () => {
  test('classifies write and unknown tools as review-required', () => {
    const manager = new UpstreamManager();
    manager.catalog.addTools('readonly', [
      {
        description: 'Delete user',
        inputSchema: { properties: {}, type: 'object' },
        name: 'delete_user',
        risk: 'write',
      },
      {
        description: 'Get user',
        inputSchema: { properties: {}, type: 'object' },
        name: 'get_user',
        risk: 'read',
      },
    ]);

    expect(classifyPackageWrites(manager, ['readonly.get_user'])).toBe('deny');
    expect(classifyPackageWrites(manager, ['readonly.delete_user'])).toBe(
      'review-required'
    );
    expect(hasWriteCapabilities(manager, ['readonly.delete_user'])).toBe(true);
  });
});
