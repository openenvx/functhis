import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { GraphService } from '../graph/service';
import type { LearningWorker } from '../learning/worker';
import { canHotRegister } from '../packages/capabilities';
import type { PackageLibrary } from '../packages/library';
import type { SavedPackage } from '../packages/schema';
import type { TraceRecorder } from '../trace/recorder';
import type { UpstreamManager } from '../upstream/manager';
import { invokePackageFunction } from './package-invoke';

export interface GatewayDependencies {
  abortSignal?: AbortSignal;
  configDir: string;
  graph?: GraphService;
  learningWorker?: LearningWorker;
  manager: UpstreamManager;
  packageLibrary: PackageLibrary;
  packagesDir: string;
  recorder: TraceRecorder;
  server?: McpServer;
}

const registeredPackageNames = new Set<string>();

export function registerPackageTool(
  server: McpServer,
  pkg: SavedPackage,
  deps: GatewayDependencies
): boolean {
  if (registeredPackageNames.has(pkg.manifest.name)) {
    return false;
  }
  if (!canHotRegister(pkg.manifest)) {
    return false;
  }

  server.registerTool(
    pkg.manifest.name,
    {
      description: `Functhis package: ${pkg.manifest.description}`,
      inputSchema: z.object({
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Package input'),
      }),
    },
    async ({ input }) => invokePackageFunction(pkg.dir, input ?? {}, deps)
  );
  registeredPackageNames.add(pkg.manifest.name);
  return true;
}

export function registerPackageTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
  reconcilePackageTools(server, deps);
}

export function reconcilePackageTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
  const activeNames = new Set(
    deps.packageLibrary.getInvokable().map((pkg) => pkg.manifest.name)
  );
  let changed = false;

  for (const name of registeredPackageNames) {
    if (!activeNames.has(name)) {
      registeredPackageNames.delete(name);
      changed = true;
    }
  }

  for (const pkg of deps.packageLibrary.getInvokable()) {
    if (registerPackageTool(server, pkg, deps)) {
      changed = true;
    }
  }

  if (changed) {
    server.sendToolListChanged();
  }
}
