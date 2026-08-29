import { describe, expect, test } from 'vitest';

import {
  canHotRegister,
  classifyPackageWrites,
  hasWriteCapabilities,
  resolvesWriteApproval,
} from '../src/packages/capabilities';
import type { PackageManifest } from '../src/packages/schema';
import { UpstreamManager } from '../src/upstream/manager';

function baseManifest(
  overrides: Partial<PackageManifest> = {}
): PackageManifest {
  return {
    capabilities: { tools: ['readonly.get_user'], writes: 'deny' },
    description: 'Test package',
    entrypoint: 'function.ts',
    inputSchema: { properties: {}, type: 'object' },
    name: 'test-package',
    runtime: {
      execution: 'sandbox',
      maxCalls: 20,
      maxOutputBytes: 6 * 1024,
      timeoutMs: 30_000,
    },
    ...overrides,
  };
}

describe('package capabilities', () => {
  test('classifies write and unknown tools as review-required', () => {
    const manager = new UpstreamManager();
    manager.catalog.addTools('readonly', [
      {
        description: 'Delete user',
        inputSchema: { properties: {}, type: 'object' },
        name: 'delete_user',
      },
      {
        description: 'Get user',
        inputSchema: { properties: {}, type: 'object' },
        name: 'get_user',
      },
    ]);

    expect(classifyPackageWrites(manager, ['readonly.get_user'])).toBe('deny');
    expect(classifyPackageWrites(manager, ['readonly.delete_user'])).toBe(
      'review-required'
    );
    expect(hasWriteCapabilities(manager, ['readonly.delete_user'])).toBe(true);
  });

  test('hot-registers autonomous write packages', () => {
    const manifest = baseManifest({
      autonomousOrigin: true,
      capabilities: {
        tools: ['write.create_issue'],
        writes: 'review-required',
      },
    });
    expect(canHotRegister(manifest)).toBe(true);
  });

  test('does not hot-register manual write packages', () => {
    const manifest = baseManifest({
      capabilities: {
        tools: ['write.create_issue'],
        writes: 'review-required',
      },
    });
    expect(canHotRegister(manifest)).toBe(false);
  });

  test('resolves write approval for autonomous packages without approveWrites', () => {
    const manifest = baseManifest({
      autonomousOrigin: true,
      capabilities: {
        tools: ['write.create_issue'],
        writes: 'review-required',
      },
    });
    expect(resolvesWriteApproval(manifest)).toBe(true);
    expect(resolvesWriteApproval(manifest, false)).toBe(true);
  });

  test('requires approveWrites for manual write packages', () => {
    const manifest = baseManifest({
      capabilities: {
        tools: ['write.create_issue'],
        writes: 'review-required',
      },
    });
    expect(resolvesWriteApproval(manifest)).toBe(false);
    expect(resolvesWriteApproval(manifest, true)).toBe(true);
  });
});
