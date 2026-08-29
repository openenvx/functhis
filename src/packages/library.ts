import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { SavedPackage } from './schema';
import { packageLockSchema, packageManifestSchema } from './schema';
import { readPackageLifecycle } from './stage';

export interface PackageSearchHit {
  description: string;
  id: string;
  kind: 'package';
  lifecycle: 'active' | 'quarantined' | 'rejected' | 'staging';
  name: string;
  score: number;
  writes: 'deny' | 'review-required';
}

export async function countPackagesOnDisk(
  packagesRoot: string
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(packagesRoot);
  } catch {
    return 0;
  }

  let count = 0;
  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue;
    }
    const dir = join(packagesRoot, entry);
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) {
        continue;
      }
      await readFile(join(dir, 'functhis.json'), 'utf-8');
      count += 1;
    } catch {
      // skip non-package entries
    }
  }
  return count;
}

export class PackageLibrary {
  private invokable = new Map<string, SavedPackage>();
  private visible = new Map<string, SavedPackage>();

  get(name: string): SavedPackage | undefined {
    return this.visible.get(name);
  }

  getAll(): SavedPackage[] {
    return [...this.visible.values()];
  }

  getInvokable(): SavedPackage[] {
    return [...this.invokable.values()];
  }

  size(): number {
    return this.visible.size;
  }

  search(query: string, limit = 10): PackageSearchHit[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    const terms = normalized.split(/\s+/u);
    const hits: PackageSearchHit[] = [];

    for (const pkg of this.visible.values()) {
      const haystack =
        `${pkg.manifest.name} ${pkg.manifest.description}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (pkg.manifest.name.includes(term)) {
          score += 3;
        }
        if (haystack.includes(term)) {
          score += 1;
        }
      }
      if (score > 0) {
        hits.push({
          description: pkg.manifest.description,
          id: pkg.manifest.name,
          kind: 'package',
          lifecycle: pkg.manifest.lifecycle ?? 'active',
          name: pkg.manifest.name,
          score,
          writes: pkg.manifest.capabilities.writes,
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  static async load(packagesRoot: string): Promise<PackageLibrary> {
    const library = new PackageLibrary();
    await library.loadFromDir(packagesRoot);
    return library;
  }

  async reload(packagesRoot: string): Promise<void> {
    this.invokable.clear();
    this.visible.clear();
    await this.loadFromDir(packagesRoot);
  }

  private async loadFromDir(packagesRoot: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(packagesRoot);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) {
        continue;
      }
      const dir = join(packagesRoot, entry);
      try {
        const info = await stat(dir);
        if (!info.isDirectory()) {
          continue;
        }
        const manifestRaw = await readFile(join(dir, 'functhis.json'), 'utf-8');
        const lockRaw = await readFile(join(dir, 'functhis.lock'), 'utf-8');
        const source = await readFile(join(dir, 'function.ts'), 'utf-8');
        const manifestJson = JSON.parse(manifestRaw) as Record<string, unknown>;
        const lifecycle = readPackageLifecycle(manifestJson);
        const manifest = packageManifestSchema.parse({
          ...manifestJson,
          lifecycle,
        });
        const lock = packageLockSchema.parse(JSON.parse(lockRaw));
        const saved: SavedPackage = {
          dir,
          lock,
          manifest,
          source,
        };
        this.visible.set(manifest.name, saved);
        if (lifecycle === 'active') {
          this.invokable.set(manifest.name, saved);
        }
      } catch {
        // skip non-package entries
      }
    }
  }
}
