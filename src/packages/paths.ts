import { resolve } from 'node:path';

import { PACKAGE_NAME_PATTERN } from './schema';

export function assertValidPackageName(name: string): void {
  if (!PACKAGE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid package name "${name}". Use lowercase letters, digits, and hyphens; must start with a letter.`
    );
  }
}

export function getPackagesDir(
  cwd = process.cwd(),
  packagesDir?: string
): string {
  if (packagesDir) {
    return resolve(cwd, packagesDir);
  }
  return resolve(cwd, 'packages');
}

export function isPackageToolId(id: string): boolean {
  return !id.includes('.');
}

export function getPackageDir(packagesRoot: string, name: string): string {
  assertValidPackageName(name);
  const root = resolve(packagesRoot);
  const target = resolve(root, name);
  if (!target.startsWith(`${root}/`) && target !== `${root}/${name}`) {
    throw new Error(`Package path escapes packages directory: ${name}`);
  }
  return target;
}
