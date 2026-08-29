import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { findPackageRoot } from '../src/paths';
import { saveConfig } from '../src/storage/config';
import {
  parseToolText,
  runTwoStepSandboxFlow,
  testUpstreamConfig,
  waitForCrystallizedAutoPackage,
  withGatewayClient,
  withTempConfigDir,
  writeFuncthisSettings,
} from './helpers';

const packageRoot = findPackageRoot(import.meta.url);

describe('autonomous learning e2e', () => {
  test('auto-crystallizes a repeated sandbox flow and hot-registers the package', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      await writeFuncthisSettings(configDir);
      const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-auto-e2e-'));

      try {
        await withGatewayClient(
          { configPath, cwd: packageRoot, packagesDir },
          async (client) => {
            await runTwoStepSandboxFlow(client, 'u1');
            await runTwoStepSandboxFlow(client, 'u2');

            const packageName = await waitForCrystallizedAutoPackage(client);
            expect(packageName.startsWith('auto-')).toBe(true);

            const searchResult = await client.callTool({
              arguments: { query: packageName },
              name: 'fn_search',
            });
            const searchBody = parseToolText(searchResult) as {
              hits: { id: string; kind: string }[];
            };
            expect(
              searchBody.hits.some(
                (hit) => hit.kind === 'package' && hit.id === packageName
              )
            ).toBe(true);

            const listed = await client.listTools();
            expect(listed.tools.map((tool) => tool.name)).toContain(
              packageName
            );

            const invokeResult = await client.callTool({
              arguments: {
                full: true,
                input: { userId: 'u9' },
              },
              name: packageName,
            });
            const invokeBody = parseToolText(invokeResult) as {
              result?: { issueCount: number; userId: string };
            };
            expect(invokeBody.result?.userId).toBe('u9');
            expect(invokeBody.result?.issueCount).toBe(1);

            const manifestRaw = await readFile(
              join(packagesDir, packageName, 'functhis.json'),
              'utf-8'
            );
            const manifest = JSON.parse(manifestRaw) as {
              autonomousOrigin?: boolean;
              lifecycle?: string;
            };
            expect(manifest.autonomousOrigin).toBe(true);
            expect(manifest.lifecycle).toBe('active');
          }
        );
      } finally {
        await rm(packagesDir, { force: true, recursive: true });
      }
    });
  }, 120_000);

  test('exposes learning control tools and observation metadata', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());

      await withGatewayClient({ configPath }, async (client) => {
        const listed = await client.listTools();
        const names = listed.tools.map((tool) => tool.name);
        for (const tool of [
          'fn_learning_status',
          'fn_learning_pause',
          'fn_learning_resume',
        ]) {
          expect(names).toContain(tool);
        }

        const statusResult = await client.callTool({
          arguments: {},
          name: 'fn_learning_status',
        });
        const status = parseToolText(statusResult) as {
          observation: { directMcpBypass: string; scope: string };
        };
        expect(status.observation.scope).toBe('gateway-routed');
        expect(status.observation.directMcpBypass).toContain('unobservable');

        const pauseResult = await client.callTool({
          arguments: {},
          name: 'fn_learning_pause',
        });
        const paused = parseToolText(pauseResult) as { paused: boolean };
        expect(paused.paused).toBe(true);

        const resumeResult = await client.callTool({
          arguments: {},
          name: 'fn_learning_resume',
        });
        const resumed = parseToolText(resumeResult) as { paused: boolean };
        expect(resumed.paused).toBe(false);
      });
    });
  }, 60_000);

  test('installs a saved package through staging with approve', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const packagesDir = await mkdtemp(
        join(tmpdir(), 'functhis-install-e2e-')
      );
      const sourceDir = await mkdtemp(join(tmpdir(), 'functhis-install-src-'));

      try {
        await withGatewayClient(
          { configPath, cwd: packageRoot, packagesDir },
          async (client) => {
            const source = `
export default async function(ctx, input) {
  return await ctx.tools.readonly.get_user({ userId: input.userId });
}
`;
            const saveResult = await client.callTool({
              arguments: {
                allowedTools: ['readonly.get_user'],
                description: 'Portable user lookup',
                name: 'portable-user',
                source,
              },
              name: 'fn_save_function',
            });
            const saved = parseToolText(saveResult) as { saved: boolean };
            expect(saved.saved).toBe(true);

            const externalPackageDir = join(sourceDir, 'portable-user');
            await cp(join(packagesDir, 'portable-user'), externalPackageDir, {
              recursive: true,
            });
            await rm(join(packagesDir, 'portable-user'), {
              force: true,
              recursive: true,
            });

            const installResult = await client.callTool({
              arguments: {
                approve: true,
                path: externalPackageDir,
              },
              name: 'fn_install_function',
            });
            const installed = parseToolText(installResult) as {
              lifecycle: string;
              name: string;
            };
            expect(installed.name).toBe('portable-user');
            expect(installed.lifecycle).toBe('active');

            const runResult = await client.callTool({
              arguments: {
                arguments: { userId: 'u5' },
                full: true,
                id: 'portable-user',
                newRun: true,
              },
              name: 'fn_call',
            });
            const runBody = parseToolText(runResult) as {
              result?: { userId: string };
            };
            expect(runBody.result?.userId).toBe('u5');
          }
        );
      } finally {
        await rm(packagesDir, { force: true, recursive: true });
        await rm(sourceDir, { force: true, recursive: true });
      }
    });
  }, 90_000);

  test('fn_candidates reports crystallized packages after autonomous learning', async () => {
    await withTempConfigDir(async (configDir) => {
      const configPath = join(configDir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      await writeFuncthisSettings(configDir);
      const packagesDir = await mkdtemp(join(tmpdir(), 'functhis-cand-e2e-'));

      try {
        await withGatewayClient(
          { configPath, cwd: packageRoot, packagesDir },
          async (client) => {
            await runTwoStepSandboxFlow(client, 'u1');
            await runTwoStepSandboxFlow(client, 'u2');
            const packageName = await waitForCrystallizedAutoPackage(client);

            const candidatesResult = await client.callTool({
              arguments: { minOccurrences: 2 },
              name: 'fn_candidates',
            });
            const candidatesBody = parseToolText(candidatesResult) as {
              candidates: { toolSequence: string[] }[];
              crystallized: { name: string }[];
            };
            expect(candidatesBody.candidates.length).toBeGreaterThan(0);
            expect(
              candidatesBody.crystallized.some(
                (entry) => entry.name === packageName
              )
            ).toBe(true);
          }
        );
      } finally {
        await rm(packagesDir, { force: true, recursive: true });
      }
    });
  }, 120_000);
});
