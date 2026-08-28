import { join } from 'node:path';

import { resolveConfigDir } from '../storage/paths';

export function getGraphDbPath(configDir?: string): string {
  return join(resolveConfigDir(configDir), 'graph.sqlite');
}
