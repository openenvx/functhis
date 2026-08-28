import { describe, expect, it } from 'vitest';

import {
  transpileGuestSource,
  wrapGuestModule,
} from '../src/sandbox/transpile';

describe('sandbox transpile', () => {
  it('rejects imports and transpiles guest TypeScript', () => {
    const source = `
export default async function(ctx: { tools: unknown }, input: { value: number }) {
  return { doubled: input.value * 2 };
}
`;
    const { code } = transpileGuestSource(source);
    const wrapped = wrapGuestModule(code);
    expect(wrapped).toContain('const __guestRun =');
  });

  it('rejects forbidden constructs', () => {
    expect(() =>
      transpileGuestSource(
        'import fs from "fs"; export default async function() {}'
      )
    ).toThrow(/forbidden/i);
  });
});
