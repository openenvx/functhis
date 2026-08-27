import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function getConfigDir(cwd = process.cwd()): string {
  const projectConfig = join(cwd, '.functhis');
  if (existsSync(join(projectConfig, 'upstreams.json'))) {
    return projectConfig;
  }
  return join(homedir(), '.functhis');
}

export function getConfigPath(cwd = process.cwd()): string {
  return join(getConfigDir(cwd), 'upstreams.json');
}

export function resolveConfigDir(dir?: string): string {
  if (dir) {
    return resolve(dir);
  }
  return getConfigDir();
}
