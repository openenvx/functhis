import { existsSync } from 'node:fs';

import type { PackageManifest, PackageLock } from '../packages/schema';
import type { ExecutionTrace } from '../trace/schema';
import type { UpstreamManager } from '../upstream/manager';
import type { DiscoveredTool } from '../upstream/types';
import { findSchemaDriftImpact } from './drift';
import { indexFunctionNode } from './index-function';
import { indexMcpTools } from './index-mcp';
import { indexRepository } from './index-repo';
import type { IndexRepoOptions } from './index-repo';
import { indexRunNode } from './index-run';
import { getGraphDbPath } from './paths';
import {
  findFunctionsUsingTool,
  findRunsUsingTool,
  findSimilarFunctions,
  getSubgraph,
  searchContext,
  searchSymbolAndTool,
  searchToolsInGraph,
} from './retrieve';
import { GraphStore } from './store';

export class GraphService {
  readonly store: GraphStore;

  constructor(configDir?: string) {
    this.store = new GraphStore(getGraphDbPath(configDir));
  }

  close(): void {
    this.store.close();
  }

  indexRepo(options: IndexRepoOptions = {}) {
    return indexRepository(this.store, options);
  }

  indexMcp(tools: DiscoveredTool[]) {
    return indexMcpTools(this.store, tools);
  }

  indexRun(trace: ExecutionTrace): void {
    indexRunNode(this.store, trace);
  }

  indexFunction(
    manifest: PackageManifest,
    lock: PackageLock,
    options: { compiledFrom?: string; packageDir: string }
  ): void {
    indexFunctionNode(this.store, manifest, lock, options);
  }

  deleteRunNode(runId: string): void {
    this.store.deleteNode(`run:${runId}`);
  }

  searchContext(query: string, options?: Parameters<typeof searchContext>[2]) {
    return searchContext(this.store, query, options);
  }

  searchSymbolAndTool(options: Parameters<typeof searchSymbolAndTool>[1]) {
    return searchSymbolAndTool(this.store, options);
  }

  async schemaDriftImpact(
    manager: UpstreamManager,
    options?: { toolId?: string }
  ) {
    return findSchemaDriftImpact(manager, this.store, options);
  }

  subgraph(ids: string[], options?: Parameters<typeof getSubgraph>[2]) {
    return getSubgraph(this.store, ids, options);
  }

  searchTools(query: string, limit?: number) {
    return searchToolsInGraph(this.store, query, limit);
  }

  functionsUsingTool(toolId: string) {
    return findFunctionsUsingTool(this.store, toolId);
  }

  runsUsingTool(toolId: string) {
    return findRunsUsingTool(this.store, toolId);
  }

  similarFunctions(requiredTools: string[]) {
    return findSimilarFunctions(this.store, requiredTools);
  }

  isEmpty(): boolean {
    return !existsSync(getGraphDbPath());
  }

  needsIndex(): boolean {
    const states = this.store.listFileStates();
    return states.length === 0;
  }
}
