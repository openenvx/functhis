import { describe, expect, test } from 'vitest';

import {
  buildResultEnvelope,
  DEFAULT_CONTEXT_BUDGET_BYTES,
  describeValueShape,
  estimateUtf8Bytes,
  pageValue,
  shapeEvidenceOutput,
} from '../src/output';

describe('output shaping', () => {
  test('describes object and array shapes', () => {
    expect(describeValueShape({ a: 1, b: 2 })).toEqual({
      keys: ['a', 'b'],
      type: 'object',
    });
    expect(describeValueShape([1, 2, 3])).toEqual({
      length: 3,
      type: 'array',
    });
  });

  test('returns full result for small payloads', () => {
    const value = { name: 'Ada', userId: 'u1' };
    const { envelope } = buildResultEnvelope(value);
    expect(envelope.truncated).toBe(false);
    expect(envelope.result).toEqual(value);
    expect(envelope.bytes).toBe(estimateUtf8Bytes(value));
  });

  test('returns compact envelope for large payloads', () => {
    const value = {
      items: Array.from({ length: 500 }, (_, index) => ({
        body: `payload-${index} `.repeat(30),
        id: index,
      })),
    };
    const bytes = estimateUtf8Bytes(value);
    expect(bytes).toBeGreaterThan(DEFAULT_CONTEXT_BUDGET_BYTES);

    const { envelope, returnedBytes } = buildResultEnvelope(value);
    expect(envelope.truncated).toBe(true);
    expect(envelope.preview).toBeDefined();
    expect(envelope.result).toBeUndefined();
    expect(envelope.hint).toContain('fn_recall');
    expect(returnedBytes).toBeLessThan(bytes);
  });

  test('full:true bypasses compact envelope', () => {
    const value = {
      items: Array.from({ length: 200 }, (_, index) => ({ id: index })),
    };
    const { envelope } = buildResultEnvelope(value, { full: true });
    expect(envelope.truncated).toBe(false);
    expect(envelope.result).toEqual(value);
  });

  test('shapeEvidenceOutput applies JMESPath and paging', () => {
    const value = {
      issues: [
        { number: 1, title: 'one' },
        { number: 2, title: 'two' },
        { number: 3, title: 'three' },
      ],
    };
    const shaped = shapeEvidenceOutput(value, {
      address: '@1',
      runId: 'run-test',
      select: 'issues[0].title',
    });
    expect(shaped.output).toMatchObject({
      address: '@1',
      result: 'one',
      runId: 'run-test',
      truncated: false,
    });

    const paged = shapeEvidenceOutput(value.issues, {
      address: '@1',
      limit: 1,
      offset: 1,
      runId: 'run-test',
    });
    expect((paged.output as { result?: unknown[] }).result).toEqual([
      { number: 2, title: 'two' },
    ]);
  });

  test('pageValue slices arrays and strings', () => {
    expect(pageValue([1, 2, 3, 4], 1, 2)).toEqual([2, 3]);
    expect(pageValue('abcdef', 2, 2)).toBe('cd');
  });
});
