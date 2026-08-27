import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runImportAll, runImportFromSources } from '../src/cli/import';
import {
  cursorServerToUpstream,
  importFromAllClients,
  importFromCursorFiles,
  importFromSources,
  mergeUpstreamsConfig,
  opencodeServerToUpstream,
  parseJsonc,
  sanitizeUpstreamId,
} from '../src/import/clients';
import { findPackageRoot } from '../src/paths';

const packageRoot = findPackageRoot(import.meta.url);
const cursorFixtures = join(packageRoot, 'test', 'fixtures', 'cursor');
const claudeFixtures = join(packageRoot, 'test', 'fixtures', 'claude');
const opencodeFixtures = join(packageRoot, 'test', 'fixtures', 'opencode');

describe('client import', () => {
  test('sanitizeUpstreamId normalizes names', () => {
    expect(sanitizeUpstreamId('GitHub')).toBe('github');
    expect(sanitizeUpstreamId('my_server')).toBe('my-server');
    expect(sanitizeUpstreamId('123bad')).toBe('srv-123bad');
  });

  test('parseJsonc handles comments and trailing commas', () => {
    const parsed = parseJsonc(`{
      // comment
      "mcp": {
        "demo": { "command": "npx", },
      },
    }`) as { mcp: { demo: { command: string } } };
    expect(parsed.mcp.demo.command).toBe('npx');
  });

  test('skips HTTP servers', () => {
    const result = cursorServerToUpstream(
      'remote',
      { url: 'https://example.com/mcp' },
      'test'
    );
    expect(result.skip).toContain('HTTP');
  });

  test('converts stdio servers', () => {
    const result = cursorServerToUpstream(
      'filesystem',
      {
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        command: 'npx',
      },
      'test'
    );
    expect(result.upstream?.id).toBe('filesystem');
    expect(result.upstream?.command).toBe('npx');
    expect(result.upstream?.transport).toBe('stdio');
  });

  test('importFromCursorFiles merges project over global', () => {
    const result = importFromCursorFiles([
      {
        client: 'cursor',
        path: join(cursorFixtures, 'global.mcp.json'),
        scope: 'global',
      },
      {
        client: 'cursor',
        path: join(cursorFixtures, 'project.mcp.json'),
        scope: 'project',
      },
    ]);

    expect(result.upstreams).toHaveLength(3);
    expect(result.upstreams.find((u) => u.id === 'shared')?.command).toBe(
      'project-cmd'
    );
  });

  test('mergeUpstreamsConfig merges by id', () => {
    const existing = {
      upstreams: [
        {
          args: [],
          command: 'old',
          enabled: true,
          id: 'github',
          label: 'Old',
          transport: 'stdio' as const,
        },
      ],
      version: 1 as const,
    };
    const imported = [
      {
        args: ['x'],
        command: 'new',
        enabled: true,
        id: 'github',
        label: 'New',
        transport: 'stdio' as const,
      },
      {
        args: [],
        command: 'npx',
        enabled: true,
        id: 'linear',
        label: 'Linear',
        transport: 'stdio' as const,
      },
    ];
    const merged = mergeUpstreamsConfig(existing, imported, 'merge');
    expect(merged.upstreams).toHaveLength(2);
    expect(merged.upstreams.find((u) => u.id === 'github')?.command).toBe(
      'new'
    );
  });

  test('runImportCursor writes imported upstreams', async () => {
    const functhisDir = join(packageRoot, 'test', '.tmp-import', 'out');
    await mkdir(functhisDir, { recursive: true });

    const result = await runImportFromSources({
      dir: functhisDir,
      sources: [
        {
          client: 'cursor',
          path: join(cursorFixtures, 'demo.mcp.json'),
          scope: 'project',
        },
      ],
    });

    expect(result.path).toContain('upstreams.json');
    expect(result.report).toContain('demo');
  });

  test('importFromAllClients reads Claude and OpenCode fixtures', () => {
    const result = importFromSources([
      {
        client: 'claude',
        path: join(claudeFixtures, 'global.mcp.json'),
        scope: 'global',
      },
      {
        client: 'opencode',
        path: join(opencodeFixtures, 'global.opencode.jsonc'),
        scope: 'global',
      },
    ]);

    expect(result.upstreams.find((u) => u.id === 'claude-tool')).toBeDefined();
    expect(result.upstreams.find((u) => u.id === 'git-mcp')).toBeDefined();
    expect(result.skipped.some((s) => s.name === 'functhis')).toBe(true);
    expect(result.skipped.some((s) => s.name === 'remote-sentry')).toBe(true);
  });

  test('opencodeServerToUpstream converts local command arrays', () => {
    const result = opencodeServerToUpstream('git-mcp', {
      command: ['uvx', 'mcp-server-git'],
      enabled: true,
      type: 'local',
    });
    expect(result.upstream?.command).toBe('uvx');
    expect(result.upstream?.args).toEqual(['mcp-server-git']);
  });

  test('importFromAllClients returns empty when no configs in empty dir', async () => {
    const tmp = join(packageRoot, 'test', '.tmp-import-empty');
    await mkdir(tmp, { recursive: true });
    const result = importFromAllClients(tmp);
    expect(result.upstreams).toHaveLength(0);
  });

  test('runImportAll writes when client config is present', async () => {
    const workspace = join(packageRoot, 'test', 'fixtures', 'import-workspace');
    const functhisDir = join(packageRoot, 'test', '.tmp-import-all-out');
    await mkdir(functhisDir, { recursive: true });
    const result = await runImportAll({ cwd: workspace, dir: functhisDir });
    expect(result.report).toContain('workspace-demo');
    expect(result.path).toContain('upstreams.json');
  });
});
