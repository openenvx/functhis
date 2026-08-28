import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { GraphService } from '../graph/service';
import type { PackageLibrary } from '../packages/library';
import type { SavedPackage } from '../packages/schema';
import type { TraceRecorder } from '../trace/recorder';
import type { UpstreamManager } from '../upstream/manager';
import { invokePackageFunction } from './package-invoke';

export interface GatewayDependencies {
  abortSignal?: AbortSignal;
  configDir: string;
  graph?: GraphService;
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

export function hotRegisterPackage(
  server: McpServer,
  deps: GatewayDependencies,
  name: string
): boolean {
  const pkg = deps.packageLibrary.get(name);
  if (!pkg) {
    return false;
  }
  const added = registerPackageTool(server, pkg, deps);
  if (added) {
    server.sendToolListChanged();
  }
  return added;
}

export function registerPackageTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
  for (const pkg of deps.packageLibrary.getAll()) {
    registerPackageTool(server, pkg, deps);
  }
}
