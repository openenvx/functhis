import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { SavedPackage } from './schema';
import { packageLockSchema, packageManifestSchema } from './schema';

export class PackageLibrary {
  private packages = new Map<string, SavedPackage>();

  get(name: string): SavedPackage | undefined {
    return this.packages.get(name);
  }

  getAll(): SavedPackage[] {
    return [...this.packages.values()];
  }

  size(): number {
    return this.packages.size;
  }

  search(
    query: string,
    limit = 10
  ): {
    description: string;
    id: string;
    kind: 'package';
    name: string;
    score: number;
  }[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    const terms = normalized.split(/\s+/u);
    const hits: {
      description: string;
      id: string;
      kind: 'package';
      name: string;
      score: number;
    }[] = [];

    for (const pkg of this.packages.values()) {
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
          name: pkg.manifest.name,
          score,
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
    this.packages.clear();
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
      const dir = join(packagesRoot, entry);
      try {
        const info = await stat(dir);
        if (!info.isDirectory()) {
          continue;
        }
        const manifestRaw = await readFile(join(dir, 'functhis.json'), 'utf-8');
        const lockRaw = await readFile(join(dir, 'functhis.lock'), 'utf-8');
        const source = await readFile(join(dir, 'function.ts'), 'utf-8');
        const manifest = packageManifestSchema.parse(JSON.parse(manifestRaw));
        const lock = packageLockSchema.parse(JSON.parse(lockRaw));
        if (manifest.capabilities.writes !== 'deny') {
          continue;
        }
        this.packages.set(manifest.name, {
          dir,
          lock,
          manifest,
          source,
        });
      } catch {
        // skip non-package entries
      }
    }
  }
}
