import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { findPackageRoot } from '../src/paths';

const packageRoot = findPackageRoot(import.meta.url);

function readSkillDescription(skillPath: string): string {
  const raw = readFileSync(skillPath, 'utf-8');
  const match = raw.match(/^description:\s*>-\s*\n([\s\S]*?)^\w/m);
  if (!match) {
    throw new Error(`Missing description in ${skillPath}`);
  }
  return match[1].replaceAll(/\n\s+/g, ' ').trim();
}

describe('skill descriptions', () => {
  test('functhis skill triggers on optimization intent', () => {
    const description = readSkillDescription(
      join(packageRoot, 'skills', 'functhis', 'SKILL.md')
    );
    expect(description.toLowerCase()).toContain('record');
    expect(description.toLowerCase()).toContain('fn_search');
    expect(description.toLowerCase()).toContain('fn_save_function');
    expect(description.toLowerCase()).toContain('auto-bootstrap');
  });

  test('functhis-setup skill triggers on unconfigured MCP optimization', () => {
    const description = readSkillDescription(
      join(packageRoot, 'skills', 'functhis-setup', 'SKILL.md')
    );
    expect(description.toLowerCase()).toContain('opencode');
    expect(description.toLowerCase()).toContain('auto-import');
  });
});
