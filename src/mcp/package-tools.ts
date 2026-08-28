import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { GraphService } from '../graph/service';
import type { PackageLibrary } from '../packages/library';
import type { TraceRecorder } from '../trace/recorder';
import type { UpstreamManager } from '../upstream/manager';
import { invokePackageFunction } from './graph-tools';

export interface GatewayDependencies {
  abortSignal?: AbortSignal;
  configDir: string;
  graph?: GraphService;
  manager: UpstreamManager;
  packageLibrary: PackageLibrary;
  packagesDir: string;
  recorder: TraceRecorder;
}

export function registerPackageTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
  for (const pkg of deps.packageLibrary.getAll()) {
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
  }
}
