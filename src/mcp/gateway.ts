import { dirname } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { FunctionLibrary } from '../functions/library';
import { getFunctionsDir } from '../functions/paths';
import { GraphService } from '../graph/service';
import { PackageLibrary } from '../packages/library';
import { loadConfig } from '../storage/config';
import { getConfigPath } from '../storage/paths';
import { TraceRecorder } from '../trace/recorder';
import { UpstreamManager } from '../upstream/manager';
import { registerFunctionTools } from './function-tools';
import type { GatewayDependencies } from './function-tools';
import { registerGraphAndSandboxTools } from './graph-tools';
import { registerMetaTools } from './meta-tools';

export type { GatewayDependencies } from './function-tools';

export interface StartGatewayOptions {
  configPath?: string;
  functionsDir?: string;
}

export function createGatewayServer(deps: GatewayDependencies): McpServer {
  const server = new McpServer({
    name: 'functhis',
    version: '0.1.0',
  });

  registerMetaTools(server, deps);
  registerGraphAndSandboxTools(server, deps);
  registerFunctionTools(server, deps);

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
  const functionsRoot = getFunctionsDir(
    process.cwd(),
    resolvedOptions.functionsDir
  );
  const library = await FunctionLibrary.load(functionsRoot);
  const packageLibrary = await PackageLibrary.load(functionsRoot);
  const graph = new GraphService(configDir);

  if (graph.needsIndex()) {
    graph.indexRepo({ include: ['src'] });
  }

  const abortController = new AbortController();
  const shutdown = async (): Promise<void> => {
    abortController.abort();
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
    functionsDir: functionsRoot,
    graph,
    library,
    manager,
    recorder,
    packageLibrary,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
