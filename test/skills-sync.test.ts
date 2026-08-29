import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

import { findPackageRoot } from '../src/paths';

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

describe('plugin skill mirror', () => {
  test('plugins/functhis/skills matches skills/', () => {
    const packageRoot = findPackageRoot(import.meta.url);
    const canonical = join(packageRoot, 'skills');
    const pluginCopy = join(packageRoot, 'plugins', 'functhis', 'skills');
    const canonicalFiles = listFiles(canonical);
    expect(listFiles(pluginCopy)).toEqual(canonicalFiles);
    for (const file of canonicalFiles) {
      expect(readFileSync(join(pluginCopy, file), 'utf-8')).toBe(
        readFileSync(join(canonical, file), 'utf-8')
      );
    }
  });
});
