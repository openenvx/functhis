import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { getStarterConfig, runSetup } from '../src/cli/setup';
import { runTestWithExitCode } from '../src/cli/test';
import { findPackageRoot } from '../src/paths';
import { saveConfig } from '../src/storage/config';

const packageRoot = findPackageRoot(import.meta.url);
const functionsDir = join(packageRoot, 'functions');
const REPLAY_CASES = 30;

describe('public demo loop', () => {
  test('committed lookup-user-issues passes 30 replays against demo upstreams', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-demo-loop-'));
    try {
      await saveConfig(join(configDir, 'upstreams.json'), getStarterConfig());

      const result = await runTestWithExitCode({
        dir: configDir,
        functionsDir,
        name: 'lookup-user-issues',
        repeat: REPLAY_CASES,
      });

      expect(result.ok).toBe(true);
      expect(result.output).toContain(`passed (${REPLAY_CASES} repeats)`);
      expect(result.output).toContain('Tool fingerprints: OK');
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  }, 180_000);

  test('fn setup produces upstreams compatible with the demo Function', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'functhis-demo-setup-'));
    try {
      const setup = await runSetup({ dir: configDir });
      expect(setup.created).toBe(true);

      const result = await runTestWithExitCode({
        dir: configDir,
        functionsDir,
        name: 'lookup-user-issues',
        repeat: 3,
      });
      expect(result.ok).toBe(true);
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  }, 120_000);
});
