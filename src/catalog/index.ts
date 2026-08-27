import { createHash } from 'node:crypto';

import MiniSearch from 'minisearch';

import { classifyToolRisk } from '../policy/access';
import type { DiscoveredTool } from '../upstream/types';
import { makeToolId } from './namespace';

export interface CatalogSearchHit {
  id: string;
  serverId: string;
  name: string;
  description: string;
  risk: DiscoveredTool['risk'];
  score: number;
}

export class ToolCatalog {
  private tools = new Map<string, DiscoveredTool>();
  private index: MiniSearch<DiscoveredTool>;

  constructor() {
    this.index = new MiniSearch({
      fields: ['id', 'name', 'description', 'serverId'],
      searchOptions: {
        boost: { description: 1, id: 2, name: 3, serverId: 1.5 },
        fuzzy: 0.15,
        prefix: true,
      },
      storeFields: ['id', 'serverId', 'name', 'description', 'risk'],
    });
  }

  addTools(
    serverId: string,
    tools: { name: string; description?: string; inputSchema: unknown }[]
  ): void {
    for (const tool of tools) {
      const id = makeToolId(serverId, tool.name);
      const description = tool.description ?? '';
      const discovered: DiscoveredTool = {
        description,
        discoveredAt: new Date().toISOString(),
        fingerprint: fingerprintTool(tool.name, description, tool.inputSchema),
        id,
        inputSchema: tool.inputSchema as DiscoveredTool['inputSchema'],
        name: tool.name,
        risk: classifyToolRisk(tool.name, description),
        serverId,
      };
      this.tools.set(id, discovered);
      if (this.index.has(id)) {
        this.index.discard(id);
      }
      this.index.add(discovered);
    }
  }

  searchTools(query: string, limit = 10): CatalogSearchHit[] {
    if (!query.trim()) {
      return [];
    }
    const results = this.index.search(query).slice(0, limit);
    return results.map((result) => ({
      description: String(result.description),
      id: String(result.id),
      name: String(result.name),
      risk: result.risk as DiscoveredTool['risk'],
      score: result.score,
      serverId: String(result.serverId),
    }));
  }

  getTool(id: string): DiscoveredTool | undefined {
    return this.tools.get(id);
  }

  getAllTools(): DiscoveredTool[] {
    return [...this.tools.values()];
  }

  size(): number {
    return this.tools.size;
  }
}

function fingerprintTool(
  name: string,
  description: string,
  schema: unknown
): string {
  return createHash('sha256')
    .update(JSON.stringify({ description, name, schema }))
    .digest('hex')
    .slice(0, 16);
}
