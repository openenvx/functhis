import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceFile } from 'ts-morph';

import type { GraphStore } from './store';
import type { IndexReport } from './types';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.functhis',
  'coverage',
]);
const MAX_FILE_BYTES = 200 * 1024;

export interface IndexRepoOptions {
  root?: string;
  force?: boolean;
  include?: string[];
}

export function indexRepository(
  store: GraphStore,
  options: IndexRepoOptions = {}
): IndexReport {
  const startMs = Date.now();
  const root = resolve(options.root ?? process.cwd());
  const tsconfigPath = findTsconfig(root);
  if (!tsconfigPath) {
    throw new Error(`No tsconfig.json found under ${root}`);
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: tsconfigPath,
  });

  const sourcePaths = collectSourceFiles(root, options.include);
  let filesIndexed = 0;
  let filesSkipped = 0;
  let filesRemoved = 0;
  let symbolsAdded = 0;

  const seenPaths = new Set(sourcePaths);

  for (const old of store.listFileStates()) {
    if (!seenPaths.has(old.path)) {
      store.deleteNodesBySrcPath(old.path);
      store.removeFileState(old.path);
      filesRemoved += 1;
    }
  }

  for (const absPath of sourcePaths) {
    const relPath = relative(root, absPath);
    let content: string;
    try {
      const stat = statSync(absPath);
      if (stat.size > MAX_FILE_BYTES) {
        filesSkipped += 1;
        continue;
      }
      content = readFileSync(absPath, 'utf-8');
    } catch {
      filesSkipped += 1;
      continue;
    }

    const contentSha = sha256(content);
    const existing = store.getFileState(relPath);
    if (!options.force && existing?.contentSha === contentSha) {
      filesSkipped += 1;
      continue;
    }

    store.deleteNodesBySrcPath(relPath);

    let sourceFile: SourceFile;
    try {
      sourceFile = project.addSourceFileAtPath(absPath);
    } catch {
      filesSkipped += 1;
      continue;
    }

    const now = Date.now();
    const fileId = `file:${relPath}`;
    store.upsertNode({
      attrs: { extension: absPath.endsWith('.tsx') ? 'tsx' : 'ts' },
      id: fileId,
      kind: 'file',
      name: relPath,
      srcEnd: content.split('\n').length,
      srcPath: relPath,
      srcStart: 1,
      updatedAt: now,
    });

    indexImports(store, sourceFile, fileId, relPath, root, now);
    symbolsAdded += indexExports(store, sourceFile, fileId, relPath, now);

    project.removeSourceFile(sourceFile);
    store.setFileState(relPath, contentSha);
    filesIndexed += 1;
  }

  return {
    durationMs: Date.now() - startMs,
    filesIndexed,
    filesRemoved,
    filesSkipped,
    symbolsAdded,
  };
}

function indexImports(
  store: GraphStore,
  sourceFile: SourceFile,
  fileId: string,
  relPath: string,
  root: string,
  _now: number
): void {
  for (const decl of sourceFile.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    const resolved = resolveImportPath(root, relPath, specifier);
    if (!resolved) {
      continue;
    }
    const targetId = `file:${resolved}`;
    if (store.getNode(targetId)) {
      store.upsertEdge({
        fromId: fileId,
        kind: 'imports',
        toId: targetId,
      });
    }
  }
}

function indexExports(
  store: GraphStore,
  sourceFile: SourceFile,
  fileId: string,
  relPath: string,
  now: number
): number {
  let count = 0;

  for (const [name, decls] of sourceFile.getExportedDeclarations()) {
    for (const decl of decls) {
      const kind = decl.getKind();
      let symbolKind = 'unknown';
      if (
        kind === SyntaxKind.FunctionDeclaration ||
        kind === SyntaxKind.MethodDeclaration
      ) {
        symbolKind = 'function';
      } else if (kind === SyntaxKind.ClassDeclaration) {
        symbolKind = 'class';
      } else if (
        kind === SyntaxKind.InterfaceDeclaration ||
        kind === SyntaxKind.TypeAliasDeclaration
      ) {
        symbolKind = 'type';
      } else if (kind === SyntaxKind.VariableDeclaration) {
        symbolKind = 'variable';
      } else {
        continue;
      }

      const symbolName = decl.getSymbol()?.getName() ?? name;
      const start = decl.getStartLineNumber();
      const end = decl.getEndLineNumber();
      const symbolId = `symbol:${relPath}:${symbolName}`;

      const jsDoc =
        'getJsDocs' in decl
          ? decl.getJsDocs().at(0)?.getDescription().trim()
          : undefined;
      store.upsertNode({
        attrs: {
          description: jsDoc?.split('\n').at(0) ?? '',
          symbolKind,
        },
        id: symbolId,
        kind: 'symbol',
        name: symbolName,
        srcEnd: end,
        srcPath: relPath,
        srcStart: start,
        updatedAt: now,
      });
      store.upsertEdge({
        fromId: fileId,
        kind: 'contains',
        toId: symbolId,
      });
      store.upsertEdge({
        fromId: symbolId,
        kind: 'exported_from',
        toId: fileId,
      });
      count += 1;
    }
  }

  return count;
}

function collectSourceFiles(root: string, include?: string[]): string[] {
  const results: string[] = [];
  const includePrefixes = include?.map((pattern) =>
    pattern.replace(/\/\*\*$/u, '').replace(/\/$/u, '')
  );

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) {
        continue;
      }
      const abs = join(dir, entry);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!abs.endsWith('.ts') && !abs.endsWith('.tsx')) {
        continue;
      }
      if (abs.endsWith('.d.ts')) {
        continue;
      }
      const rel = relative(root, abs);
      if (includePrefixes && includePrefixes.length > 0) {
        const allowed = includePrefixes.some(
          (prefix) => rel === prefix || rel.startsWith(`${prefix}/`)
        );
        if (!allowed) {
          continue;
        }
      }
      results.push(abs);
    }
  }

  walk(root);
  return results.sort();
}

function findTsconfig(root: string): string | undefined {
  let current = root;
  while (true) {
    const candidate = join(current, 'tsconfig.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(current, '..');
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function resolveImportPath(
  root: string,
  fromRel: string,
  specifier: string
): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const fromDir = resolve(root, fromRel, '..');
  const target = resolve(fromDir, specifier);
  const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
  if (target.endsWith('.ts') || target.endsWith('.tsx')) {
    const rel = relative(root, target);
    return rel.startsWith('..') ? undefined : rel;
  }
  for (const ext of extensions) {
    const candidate = target + ext;
    if (existsSync(candidate)) {
      const rel = relative(root, candidate);
      return rel.startsWith('..') ? undefined : rel;
    }
  }
  return undefined;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
