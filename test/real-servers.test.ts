import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runDoctor } from '../src/cli/doctor';
import { saveConfig } from '../src/storage/config';
import type { UpstreamsConfig } from '../src/storage/config';
import { withTempConfigDir } from './helpers';

function realUpstreamConfig(readRoot: string): UpstreamsConfig {
  return {
    upstreams: [
      {
        args: ['-y', '@modelcontextprotocol/server-filesystem', readRoot],
        command: 'bunx',
        enabled: true,
        id: 'filesystem',
        label: 'Official MCP filesystem server (read-only root)',
        transport: 'stdio',
      },
      {
        args: ['-y', '@modelcontextprotocol/server-memory'],
        command: 'bunx',
        enabled: true,
        id: 'memory',
        label: 'Official MCP memory server',
        transport: 'stdio',
      },
    ],
    version: 1,
  };
}

async function prepareReadRoot(): Promise<string> {
  const readRoot = await mkdtemp(join(tmpdir(), 'functhis-real-read-'));
  await writeFile(
    join(readRoot, 'sample.txt'),
    'Functhis real-server validation file.\n',
    'utf-8'
  );
  return readRoot;
}

describe('real MCP servers (Layer 4)', () => {
  test('doctor connects to official filesystem + memory upstreams', async () => {
    const readRoot = await prepareReadRoot();
    try {
      await withTempConfigDir(async (configDir) => {
        await saveConfig(
          join(configDir, 'upstreams.json'),
          realUpstreamConfig(readRoot)
        );
        const result = await runDoctor({ dir: configDir });
        expect(result.ok).toBe(true);
        expect(result.totalTools).toBeGreaterThan(0);
      });
    } finally {
      await rm(readRoot, { force: true, recursive: true });
    }
  }, 180_000);
});
