import { resolve } from 'node:path';

export const FUNCTION_NAME_PATTERN = /^[a-z][a-z0-9-]*$/u;

export function assertValidFunctionName(name: string): void {
  if (!FUNCTION_NAME_PATTERN.test(name)) {
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

export function getFunctionSourcePath(
  functionsRoot: string,
  name: string
): string {
  assertValidFunctionName(name);
  const root = resolve(functionsRoot);
  const target = resolve(root, `${name}.ts`);
  if (!target.startsWith(`${root}/`) && target !== `${root}/${name}.ts`) {
    throw new Error(`Function path escapes functions directory: ${name}`);
  }
  return target;
}

export function getFixturePath(functionsRoot: string, name: string): string {
  assertValidFunctionName(name);
  const root = resolve(functionsRoot);
  const target = resolve(root, `${name}.fixture.json`);
  if (!target.startsWith(`${root}/`)) {
    throw new Error(`Fixture path escapes functions directory: ${name}`);
  }
  return target;
}
