import { createHash } from 'node:crypto';

import type { PackageLock } from './schema';

export function packageFingerprint(lock: PackageLock): string {
  return createHash('sha256')
    .update(JSON.stringify(lock))
    .digest('hex')
    .slice(0, 16);
}
