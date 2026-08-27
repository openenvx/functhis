import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runDoctor } from '../src/cli/doctor';
import { runInspect } from '../src/cli/inspect';
import { runTestWithExitCode } from '../src/cli/test';
import { runThis } from '../src/cli/this';
import { saveConfig } from '../src/storage/config';
import type { UpstreamsConfig } from '../src/storage/config';
import { prepareCallOutput, TraceRecorder } from '../src/trace/recorder';
import { UpstreamManager } from '../src/upstream/manager';
import { parseToolText, withGatewayClient, withTempConfigDir } from './helpers';

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

  test('capture, compile, and replay a read-only path through real upstreams', async () => {
    const readRoot = await prepareReadRoot();
    const samplePath = join(readRoot, 'sample.txt');
    const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-real-fn-'));

    try {
      await withTempConfigDir(async (configDir) => {
        const configPath = join(configDir, 'upstreams.json');
        await saveConfig(configPath, realUpstreamConfig(readRoot));

        const manager = new UpstreamManager();
        const recorder = new TraceRecorder(configDir);
        let runId = '';

        try {
          await manager.connectAll(realUpstreamConfig(readRoot).upstreams);
          await recorder.ensureRun();

          const readTool = manager.catalog
            .getAllTools()
            .find((tool) => tool.name === 'read_text_file');
          expect(readTool).toBeDefined();

          const startedAt = new Date().toISOString();
          const startMs = Date.now();
          const readResult = await manager.callTool(
            `${readTool!.serverId}.${readTool!.name}`,
            { path: samplePath }
          );
          const first = await recorder.recordCall({
            arguments: { path: samplePath },
            durationMs: Date.now() - startMs,
            endedAt: new Date().toISOString(),
            output: prepareCallOutput(readResult).output,
            startedAt,
            status: 'succeeded',
            toolFingerprint: readTool!.fingerprint,
            toolId: `${readTool!.serverId}.${readTool!.name}`,
          });
          runId = first.runId;
        } finally {
          await manager.closeAll();
        }

        const inspectOutput = await runInspect({ dir: configDir, runId });
        expect(inspectOutput).toContain('Successful path');

        await runThis({
          dir: configDir,
          force: true,
          functionsDir,
          name: 'read-sample-file',
          runId,
        });

        const testResult = await runTestWithExitCode({
          dir: configDir,
          functionsDir,
          name: 'read-sample-file',
          repeat: 30,
        });
        expect(testResult.ok).toBe(true);
        expect(testResult.output).toContain('passed (30 repeats)');

        await withGatewayClient(
          { configPath, functionsDir },
          async (client) => {
            const listed = await client.listTools();
            expect(listed.tools.map((tool) => tool.name)).toContain(
              'read-sample-file'
            );

            const searchResult = await client.callTool({
              arguments: { limit: 3, query: 'read sample file' },
              name: 'fn_search',
            });
            const searchPayload = parseToolText(searchResult) as {
              hits: { id: string }[];
            };
            expect(
              searchPayload.hits.some((hit) => hit.id === 'read-sample-file')
            ).toBe(true);
          }
        );
      });
    } finally {
      await rm(functionsDir, { force: true, recursive: true });
      await rm(readRoot, { force: true, recursive: true });
    }
  }, 300_000);
});
