import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { GraphService } from '../graph/service';
import { PackageLibrary } from '../packages/library';
import { getPackagesDir } from '../packages/paths';
import { findPackageRoot } from '../paths';
import { loadConfig } from '../storage/config';
import { getConfigPath } from '../storage/paths';
import { TraceRecorder } from '../trace/recorder';
import { UpstreamManager } from '../upstream/manager';
import { registerGraphAndSandboxTools } from './graph-tools';
import { registerMetaTools } from './meta-tools';
import { registerPackageTools } from './package-tools';
import type { GatewayDependencies } from './package-tools';

export type { GatewayDependencies } from './package-tools';

const packageJson = JSON.parse(
  readFileSync(join(findPackageRoot(import.meta.url), 'package.json'), 'utf-8')
) as { version: string };

export interface StartGatewayOptions {
  configPath?: string;
  packagesDir?: string;
}

export function createGatewayServer(deps: GatewayDependencies): McpServer {
  const server = new McpServer({
    name: 'functhis',
    version: packageJson.version,
  });

  deps.server = server;
  registerMetaTools(server, deps);
  registerGraphAndSandboxTools(server, deps);
  registerPackageTools(server, deps);

  return server;
}

export async function startGateway(
  options?: StartGatewayOptions | string
): Promise<void> {
  const resolvedOptions: StartGatewayOptions =
    typeof options === 'string' ? { configPath: options } : (options ?? {});

  const path = resolvedOptions.configPath ?? getConfigPath();
  const configDir = dirname(path);
  const config = await loadConfig(path);
  const manager = new UpstreamManager();
  const recorder = new TraceRecorder(configDir);
  const packagesRoot = getPackagesDir(
    process.cwd(),
    resolvedOptions.packagesDir
  );
  const packageLibrary = await PackageLibrary.load(packagesRoot);
  const graph = new GraphService(configDir);
  recorder.setGraph(graph);

  const { pruneTraces } = await import('../trace/retention');
  await pruneTraces(configDir, { graph });

  if (graph.needsIndex()) {
    graph.indexRepo({ include: ['src'] });
  }

  const abortController = new AbortController();
  const shutdown = async (): Promise<void> => {
    abortController.abort();
    await recorder.finalizeCurrentRun();
    await recorder.cancelCurrentRun();
    graph.close();
    await manager.closeAll();
  };

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  await manager.connectAll(config.upstreams);
  graph.indexMcp(manager.catalog.getAllTools());

  const server = createGatewayServer({
    abortSignal: abortController.signal,
    configDir,
    graph,
    manager,
    packageLibrary,
    packagesDir: packagesRoot,
    recorder,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
