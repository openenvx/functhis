import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  compileTraceToFunction,
  getSuccessfulPath,
} from '../src/functions/compile';
import { resolveArgs, resolveTemplate } from '../src/functions/interpolate';
import { FunctionLibrary, isFunctionToolId } from '../src/functions/library';
import { extractDefaultExport } from '../src/functions/load';
import { assertValidFunctionName } from '../src/functions/paths';
import {
  functionInputsToJsonSchema,
  functionInputsToZod,
} from '../src/functions/schema';
import type { ExecutionTrace } from '../src/trace/schema';

describe('function interpolation', () => {
  test('resolves $input and $step templates', () => {
    const context = {
      input: { owner: 'openenvx', userId: 'u1' },
      steps: {
        get_user: { content: [{ text: '{"name":"Ada"}' }] },
      },
    };

    expect(resolveTemplate('$input.userId', context)).toBe('u1');
    expect(resolveTemplate('$step.get_user', context)).toEqual(
      context.steps.get_user
    );
    expect(
      resolveArgs(
        {
          owner: '$input.owner',
          prior: '$step.get_user',
          userId: '$input.userId',
        },
        context
      )
    ).toEqual({
      owner: 'openenvx',
      prior: context.steps.get_user,
      userId: 'u1',
    });
  });

  test('rejects missing step output', () => {
    expect(() =>
      resolveTemplate('$step.missing', { input: {}, steps: {} })
    ).toThrow(/no output yet/);
  });
});

describe('function loader', () => {
  test('extracts export default JSON and rejects executable trailing code', () => {
    const source = [
      '// comment',
      'export default {',
      '  "name": "demo",',
      '  "value": 1',
      '};',
    ].join('\n');
    expect(extractDefaultExport(source)).toEqual({ name: 'demo', value: 1 });

    expect(() =>
      extractDefaultExport('export default { "a": 1 }; console.log("nope");')
    ).toThrow(/only comments and export default JSON/);
  });
});

describe('function compile', () => {
  test('compiles succeeded calls from a mixed run', () => {
    const trace: ExecutionTrace = {
      calls: [
        {
          address: '@1',
          arguments: { id: 'x' },
          durationMs: 1,
          endedAt: new Date().toISOString(),
          error: 'denied',
          id: 'c1',
          startedAt: new Date().toISOString(),
          status: 'denied',
          toolFingerprint: 'fp0',
          toolId: 'readonly.delete_user',
        },
        {
          address: '@2',
          arguments: { userId: 'u1' },
          durationMs: 2,
          endedAt: new Date().toISOString(),
          id: 'c2',
          output: { name: 'Ada' },
          startedAt: new Date().toISOString(),
          status: 'succeeded',
          toolFingerprint: 'fp1',
          toolId: 'readonly.get_user',
        },
        {
          address: '@3',
          arguments: { owner: 'openenvx', prior: '@2', repo: 'functhis' },
          durationMs: 3,
          endedAt: new Date().toISOString(),
          id: 'c3',
          output: { issues: [] },
          refs: ['@2'],
          startedAt: new Date().toISOString(),
          status: 'succeeded',
          toolFingerprint: 'fp2',
          toolId: 'readonly.list_issues',
        },
      ],
      id: 'run-mixed',
      redactionVersion: '1',
      startedAt: new Date().toISOString(),
      status: 'running',
      toolFingerprints: {
        'readonly.get_user': 'fp1',
        'readonly.list_issues': 'fp2',
      },
    };

    expect(getSuccessfulPath(trace)).toEqual(['@2', '@3']);

    const { definition, fixture } = compileTraceToFunction(trace, {
      name: 'lookup-user-issues',
      sourceRunId: trace.id,
    });

    expect(definition.plan.steps).toHaveLength(2);
    expect(definition.plan.steps[1]?.dependsOn).toEqual(['get_user']);
    expect(definition.plan.steps[0]?.args).toEqual({ userId: '$input.userId' });
    expect(definition.plan.steps[1]?.args.prior).toBe('$step.get_user');
    expect(fixture.input).toEqual({
      owner: 'openenvx',
      repo: 'functhis',
      userId: 'u1',
    });
  });

  test('rejects write tools in selected path', () => {
    const trace: ExecutionTrace = {
      calls: [
        {
          address: '@1',
          arguments: { userId: 'u1' },
          durationMs: 1,
          endedAt: new Date().toISOString(),
          id: 'c1',
          output: {},
          startedAt: new Date().toISOString(),
          status: 'succeeded',
          toolFingerprint: 'fpw',
          toolId: 'readonly.delete_user',
        },
      ],
      id: 'run-write',
      redactionVersion: '1',
      startedAt: new Date().toISOString(),
      status: 'succeeded',
      toolFingerprints: { 'readonly.delete_user': 'fpw' },
    };

    expect(() =>
      compileTraceToFunction(trace, {
        name: 'bad-write',
        sourceRunId: trace.id,
      })
    ).toThrow(/classified as "write"/);
  });
});

describe('function paths', () => {
  test('validates function names', () => {
    expect(() => assertValidFunctionName('../escape')).toThrow(
      /Invalid function name/
    );
    expect(() => assertValidFunctionName('valid-name')).not.toThrow();
  });
});

describe('function schema exposure', () => {
  test('converts inputs to zod and json schema', () => {
    const inputs = {
      owner: { description: 'GitHub owner', type: 'string' as const },
      repo: { type: 'string' as const },
      userId: { type: 'string' as const },
    };

    const zodSchema = functionInputsToZod(inputs);
    expect(
      zodSchema.parse({ owner: 'openenvx', repo: 'functhis', userId: 'u1' })
    ).toEqual({
      owner: 'openenvx',
      repo: 'functhis',
      userId: 'u1',
    });
    expect(() =>
      zodSchema.parse({ extra: true, owner: 'openenvx', repo: 'functhis' })
    ).toThrow();

    expect(functionInputsToJsonSchema(inputs)).toEqual({
      additionalProperties: false,
      properties: {
        owner: { description: 'GitHub owner', type: 'string' },
        repo: { type: 'string' },
        userId: { type: 'string' },
      },
      required: ['owner', 'repo', 'userId'],
      type: 'object',
    });
  });
});

describe('function library', () => {
  test('loads valid functions and skips invalid files', async () => {
    const functionsDir = await mkdtemp(join(tmpdir(), 'functhis-lib-'));
    try {
      await mkdir(functionsDir, { recursive: true });
      await writeFile(
        join(functionsDir, 'valid-fn.ts'),
        [
          'export default {',
          '  "apiVersion": "functhis.dev/v2",',
          '  "name": "valid-fn",',
          '  "description": "demo",',
          '  "inputs": { "userId": { "type": "string" } },',
          '  "plan": { "version": 1, "steps": [{ "id": "get_user", "tool": "readonly.get_user", "args": { "userId": "$input.userId" } }], "output": "$step.get_user" },',
          '  "policy": { "allowedTools": ["readonly.get_user"], "writes": "deny", "maxCalls": 1, "maxBytesPerResult": 65536, "allowNetwork": "upstream-only" },',
          '  "provenance": { "sourceRunId": "run-1", "createdAt": "2026-01-01T00:00:00.000Z" },',
          '  "requiredTools": ["readonly.get_user"],',
          '  "runtime": { "maxDurationMs": 900000, "maxOutputBytes": 65536 },',
          '  "sourcePath": "functions/valid-fn.ts",',
          '  "toolFingerprints": { "readonly.get_user": "abc123" }',
          '};',
        ].join('\n')
      );
      await writeFile(
        join(functionsDir, 'broken.ts'),
        'export default { not json'
      );
      await writeFile(join(functionsDir, 'ignored.fixture.json'), '{}');

      const library = await FunctionLibrary.load(functionsDir);
      expect(library.size()).toBe(1);
      expect(library.get('valid-fn')?.name).toBe('valid-fn');
      expect(
        library.getSkipped().some((entry) => entry.name === 'broken')
      ).toBe(true);
      expect(library.search('demo', 5)[0]?.id).toBe('valid-fn');
    } finally {
      await rm(functionsDir, { force: true, recursive: true });
    }
  });

  test('treats missing directory as empty library', async () => {
    const functionsDir = join(tmpdir(), `functhis-missing-${Date.now()}`);
    const library = await FunctionLibrary.load(functionsDir);
    expect(library.size()).toBe(0);
  });

  test('identifies function tool ids without dots', () => {
    expect(isFunctionToolId('lookup-user-issues')).toBe(true);
    expect(isFunctionToolId('readonly.get_user')).toBe(false);
  });
});
