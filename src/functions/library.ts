import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadFunctionDefinitionFromSource } from './load';
import {
  assertValidFunctionName,
  FUNCTION_NAME_PATTERN,
  getFunctionSourcePath,
} from './paths';
import type { FunctionDefinition } from './schema';

export interface FunctionLoadSkip {
  name: string;
  error: string;
}

export interface FunctionSearchHit {
  description: string;
  id: string;
  kind: 'function';
  name: string;
  score: number;
}

export class FunctionLibrary {
  private functions = new Map<string, FunctionDefinition>();
  private skipped: FunctionLoadSkip[] = [];

  get(name: string): FunctionDefinition | undefined {
    return this.functions.get(name);
  }

  getAll(): FunctionDefinition[] {
    return [...this.functions.values()];
  }

  getSkipped(): FunctionLoadSkip[] {
    return [...this.skipped];
  }

  size(): number {
    return this.functions.size;
  }

  search(query: string, limit = 10): FunctionSearchHit[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const terms = normalized.split(/\s+/u).filter((term) => term.length > 0);
    const scored: FunctionSearchHit[] = [];

    for (const definition of this.functions.values()) {
      const haystack =
        `${definition.name} ${definition.description}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (definition.name.toLowerCase().includes(term)) {
          score += 3;
        }
        if (definition.description.toLowerCase().includes(term)) {
          score += 1;
        }
        if (haystack.includes(term)) {
          score += 0.5;
        }
      }
      if (score > 0) {
        scored.push({
          description: definition.description,
          id: definition.name,
          kind: 'function',
          name: definition.name,
          score,
        });
      }
    }

    return scored
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  static async load(functionsRoot: string): Promise<FunctionLibrary> {
    const library = new FunctionLibrary();
    await library.loadFromDir(functionsRoot);
    return library;
  }

  async reload(functionsRoot: string): Promise<void> {
    this.functions.clear();
    this.skipped = [];
    await this.loadFromDir(functionsRoot);
  }

  private async loadFromDir(functionsRoot: string): Promise<void> {
    const root = resolve(functionsRoot);
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.ts')) {
        continue;
      }
      const name = entry.slice(0, -3);
      if (!FUNCTION_NAME_PATTERN.test(name)) {
        continue;
      }

      try {
        assertValidFunctionName(name);
        const sourcePath = getFunctionSourcePath(root, name);
        const definition = await loadFunctionDefinitionFromSource(sourcePath);
        if (definition.name !== name) {
          this.skipped.push({
            error: `Function name mismatch: file is "${definition.name}", expected "${name}"`,
            name,
          });
          continue;
        }
        if (definition.policy.writes !== 'deny') {
          this.skipped.push({
            error: `Function "${name}" has writes policy "${definition.policy.writes}"; only read-only Functions are exposed`,
            name,
          });
          continue;
        }
        this.functions.set(name, definition);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.skipped.push({ error: message, name });
      }
    }
  }
}

export function isFunctionToolId(id: string): boolean {
  return !id.includes('.');
}
