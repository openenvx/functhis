import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export function findPackageRoot(fromModuleUrl: string): string {
  let dir = dirname(fileURLToPath(fromModuleUrl));
  while (true) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate package root');
    }
    dir = parent;
  }
}

export function fixtureServerPath(
  packageRoot: string,
  name: 'catalog' | 'fnbench' | 'readonly' | 'slow'
): string {
  const built = join(packageRoot, 'dist', 'fixtures', 'servers', `${name}.js`);
  if (existsSync(built)) {
    return built;
  }
  return join(packageRoot, 'fixtures', 'servers', `${name}.ts`);
}

export function invocationForScript(scriptPath: string): {
  args: string[];
  command: string;
} {
  // Bun executes TypeScript natively; Node needs tsx.
  const bunRuntime = typeof process.versions.bun === 'string';
  if (scriptPath.endsWith('.ts') && !bunRuntime) {
    return {
      args: [require.resolve('tsx/cli'), scriptPath],
      command: process.execPath,
    };
  }
  return { args: [scriptPath], command: process.execPath };
}
