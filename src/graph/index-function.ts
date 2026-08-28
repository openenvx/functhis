import type { PackageManifest, PackageLock } from '../packages/schema';
import type { GraphStore } from './store';

export function indexFunctionNode(
  store: GraphStore,
  manifest: PackageManifest,
  lock: PackageLock,
  options?: { compiledFrom?: string; packageDir: string }
): void {
  const resolved = options ?? { packageDir: '' };
  const now = Date.now();
  const functionNodeId = `function:${manifest.name}`;

  store.upsertNode({
    attrs: {
      compiledFrom: resolved.compiledFrom,
      description: manifest.description,
      packageDir: resolved.packageDir,
      requiredTools: manifest.capabilities.tools,
      writes: manifest.capabilities.writes,
    },
    id: functionNodeId,
    kind: 'function',
    name: manifest.name,
    updatedAt: now,
  });

  for (const toolId of Object.keys(lock.tools)) {
    store.upsertEdge({
      fromId: functionNodeId,
      kind: 'uses_tool',
      toId: toolId,
    });
  }

  if (options.compiledFrom) {
    store.upsertEdge({
      fromId: `run:${resolved.compiledFrom}`,
      kind: 'contains',
      toId: functionNodeId,
    });
  }
}
