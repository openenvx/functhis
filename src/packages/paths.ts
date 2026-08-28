import { resolve } from 'node:path';

import { PACKAGE_NAME_PATTERN } from './schema';

export function assertValidPackageName(name: string): void {
  if (!PACKAGE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid function name "${name}". Use lowercase letters, digits, and hyphens; must start with a letter.`
    );
  }
}

export function getFunctionsDir(
  cwd = process.cwd(),
  functionsDir?: string
): string {
  if (functionsDir) {
    return resolve(cwd, functionsDir);
  }
  return resolve(cwd, 'functions');
}

export function getPackageDir(functionsRoot: string, name: string): string {
  assertValidPackageName(name);
  const root = resolve(functionsRoot);
  const target = resolve(root, name);
  if (!target.startsWith(`${root}/`) && target !== `${root}/${name}`) {
    throw new Error(`Package path escapes functions directory: ${name}`);
  }
  return target;
}
