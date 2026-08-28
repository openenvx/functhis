import { inspectLockDrift } from '../packages/install';
import { loadPackage } from '../packages/save';
import type { UpstreamManager } from '../upstream/manager';
import type { GraphStore } from './store';

export interface SchemaDriftImpact {
  drift: {
    issues: { kind: string; message: string; toolId: string }[];
    ok: boolean;
  };
  functionName: string;
  id: string;
  packageDir?: string;
  requiredTools: string[];
}

export async function findSchemaDriftImpact(
  manager: UpstreamManager,
  store: GraphStore,
  options: { toolId?: string } = {}
): Promise<SchemaDriftImpact[]> {
  const functions = options.toolId
    ? store.listNodesUsingTool(options.toolId, 'function')
    : store.listNodesByKind('function');

  const impacts: SchemaDriftImpact[] = [];

  for (const node of functions) {
    const packageDir =
      typeof node.attrs.packageDir === 'string'
        ? node.attrs.packageDir
        : undefined;
    if (!packageDir) {
      continue;
    }

    let lock;
    try {
      ({ lock } = await loadPackage(packageDir));
    } catch {
      continue;
    }

    const drift = inspectLockDrift(manager, lock);
    if (drift.ok) {
      continue;
    }

    const requiredTools = Array.isArray(node.attrs.requiredTools)
      ? (node.attrs.requiredTools as string[])
      : [];

    impacts.push({
      drift: {
        issues: drift.issues.map((issue) => ({
          kind: issue.kind,
          message: issue.message,
          toolId: issue.toolId,
        })),
        ok: drift.ok,
      },
      functionName: node.name,
      id: node.id,
      packageDir,
      requiredTools,
    });
  }

  return impacts;
}
