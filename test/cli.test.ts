import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runDoctor } from '../src/cli/doctor';
import { runSetup } from '../src/cli/setup';
import { findPackageRoot } from '../src/paths';
import { saveConfig } from '../src/storage/config';
import { runCli, testUpstreamConfig, withTempConfigDir } from './helpers';

const packageRoot = findPackageRoot(import.meta.url);
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf-8')
) as { version: string };

describe('fn CLI', () => {
  test('prints help', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('setup');
    expect(stdout).toContain('serve');
    expect(stdout).toContain('doctor');
  });

  test('prints version', async () => {
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(packageJson.version);
  });

  test('setup writes config', async () => {
    await withTempConfigDir(async (dir) => {
      const result = await runSetup({ dir });
      expect(result.created).toBe(true);
      expect(result.path).toBe(join(dir, 'upstreams.json'));
    });
  });

  test('setup refuses overwrite without force', async () => {
    await withTempConfigDir(async (dir) => {
      await runSetup({ dir });
      await expect(runSetup({ dir })).rejects.toThrow(/already exists/);
    });
  });

  test('setup backs up on force overwrite', async () => {
    await withTempConfigDir(async (dir) => {
      await runSetup({ dir });
      const result = await runSetup({ dir, force: true });
      expect(result.backupPath).toBeDefined();
      expect(result.backupPath).toContain('.bak-');
    });
  });

  test('stats reports empty state', async () => {
    const { stdout, exitCode } = await runCli(['stats']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No runs captured yet');
  });

  test('inspect rejects invalid run id', async () => {
    const { exitCode } = await runCli(['inspect', '../escape']);
    expect(exitCode).not.toBe(0);
  });

  test('unknown command fails', async () => {
    const { exitCode, stderr } = await runCli(['nope']);
    expect(exitCode).not.toBe(0);
    expect(stderr.length + exitCode).toBeGreaterThan(0);
  });
});

describe('fn doctor', () => {
  test('connects to fake upstreams', async () => {
    await withTempConfigDir(async (dir) => {
      const configPath = join(dir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const result = await runDoctor({ dir });
      expect(result.ok).toBe(true);
      expect(result.totalTools).toBeGreaterThanOrEqual(100);
      expect(result.environment.packageVersion).toBe(packageJson.version);
      expect(result.environment.nodeVersion).toMatch(/^v\d+/);
      const catalog = result.upstreams.find((u) => u.id === 'catalog');
      expect(catalog?.toolCount).toBeGreaterThanOrEqual(100);
    });
  }, 60_000);

  test('warns about HTTP/SSE servers in client configs', async () => {
    await withTempConfigDir(async (dir) => {
      const configPath = join(dir, 'upstreams.json');
      await saveConfig(configPath, testUpstreamConfig());
      const result = await runDoctor({
        cwd: join(packageRoot, 'test', 'fixtures', 'remote-mcp'),
        dir,
      });
      expect(result.ok).toBe(true);
      expect(result.skippedRemote.some((item) => item.name === 'remote')).toBe(
        true
      );
    });
  }, 60_000);
});
