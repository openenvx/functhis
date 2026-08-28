import { existsSync } from 'node:fs';

import type { DiscoveredTool } from '../upstream/types';
import { indexMcpTools } from './index-mcp';
import { indexRepository } from './index-repo';
import type { IndexRepoOptions } from './index-repo';
import { getGraphDbPath } from './paths';
import { getSubgraph, searchContext, searchToolsInGraph } from './retrieve';
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

  searchContext(query: string, options?: Parameters<typeof searchContext>[2]) {
    return searchContext(this.store, query, options);
  }

  subgraph(ids: string[], options?: Parameters<typeof getSubgraph>[2]) {
    return getSubgraph(this.store, ids, options);
  }

  searchTools(query: string, limit?: number) {
    return searchToolsInGraph(this.store, query, limit);
  }

  isEmpty(): boolean {
    return !existsSync(getGraphDbPath());
  }

  needsIndex(): boolean {
    const states = this.store.listFileStates();
    return states.length === 0;
  }
}
