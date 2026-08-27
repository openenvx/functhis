import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  containsCanary,
  redactObject,
  redactString,
  REDACTED,
} from '../src/redaction/redact';
import { TraceRecorder } from '../src/trace/recorder';
import { resolveEvidenceRefs } from '../src/trace/refs';
import {
  assertValidRunId,
  generateRunId,
  makeAddress,
} from '../src/trace/schema';
import type { ExecutionTrace } from '../src/trace/schema';
import { getRunsDir, loadTrace, saveTrace } from '../src/trace/store';
import { withTempConfigDir } from './helpers';

describe('redaction', () => {
  test('redacts sensitive keys', () => {
    const result = redactObject({
      api_key: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      password: 'hunter2',
      user: 'ada',
    });
    expect(result.user).toBe('ada');
    expect(result.api_key).toBe(REDACTED);
    expect(result.password).toBe(REDACTED);
  });

  test('redacts canary and token patterns in strings', () => {
    const input =
      'prefix fn_canary_secret_DO_NOT_STORE suffix Bearer sk-live-abc123';
    const result = redactString(input);
    expect(result).not.toContain('fn_canary_secret_DO_NOT_STORE');
    expect(result).toContain(REDACTED);
  });
});

describe('trace schema', () => {
  test('generates valid run ids', () => {
    const runId = generateRunId();
    expect(() => assertValidRunId(runId)).not.toThrow();
    expect(() => assertValidRunId('../escape')).toThrow(/Invalid run id/);
  });

  test('allocates sequential addresses', () => {
    expect(makeAddress(0)).toBe('@1');
    expect(makeAddress(1)).toBe('@2');
  });
});

describe('evidence refs', () => {
  test('substitutes @N references from prior calls', () => {
    const trace: ExecutionTrace = {
      calls: [
        {
          address: '@1',
          arguments: { userId: 'u1' },
          durationMs: 1,
          endedAt: new Date().toISOString(),
          id: 'call-1',
          output: { name: 'Ada' },
          startedAt: new Date().toISOString(),
          status: 'succeeded',
          toolFingerprint: 'abc',
          toolId: 'readonly.get_user',
        },
      ],
      id: 'run-test',
      redactionVersion: '1',
      startedAt: new Date().toISOString(),
      status: 'running',
      toolFingerprints: {},
    };

    const resolved = resolveEvidenceRefs({ prior: '@1' }, trace);
    expect(resolved.refs).toEqual(['@1']);
    expect(resolved.arguments.prior).toEqual({ name: 'Ada' });
  });
});

describe('trace store', () => {
  test('persists and loads runs atomically', async () => {
    await withTempConfigDir(async (dir) => {
      const trace: ExecutionTrace = {
        calls: [],
        id: 'run-store-test',
        redactionVersion: '1',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprints: {},
      };
      await saveTrace(dir, trace);
      const loaded = await loadTrace(dir, 'run-store-test');
      expect(loaded.id).toBe('run-store-test');
    });
  });
});

describe('canary redaction on disk', () => {
  test('never writes canary secrets to run files', async () => {
    const canary = 'fn_canary_secret_DO_NOT_STORE';
    const redacted = redactObject({
      api_key: canary,
      message: canary,
    });
    expect(containsCanary(redacted, canary)).toBe(false);

    await withTempConfigDir(async (dir) => {
      const recorder = new TraceRecorder(dir);
      await recorder.ensureRun();
      await recorder.recordCall({
        arguments: { api_key: canary, message: canary },
        durationMs: 1,
        endedAt: new Date().toISOString(),
        output: { echoed: canary },
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        toolFingerprint: 'fp',
        toolId: 'slow.canary_echo',
      });

      const runsDir = getRunsDir(dir);
      const files = await readdir(runsDir);
      for (const file of files) {
        const contents = await readFile(join(runsDir, file), 'utf-8');
        expect(contents).not.toContain(canary);
      }
    });
  });
});
