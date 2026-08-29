export type NodeKind =
  | 'file'
  | 'symbol'
  | 'server'
  | 'tool'
  | 'schema_field'
  | 'function'
  | 'run';

export type EdgeKind =
  | 'contains'
  | 'imports'
  | 'exported_from'
  | 'has_tool'
  | 'has_field'
  | 'field_name_match'
  | 'uses_tool'
  | 'touched_symbol';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  attrs: Record<string, unknown>;
  srcPath?: string;
  srcStart?: number;
  srcEnd?: number;
  updatedAt: number;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  kind: EdgeKind;
  attrs?: Record<string, unknown>;
}

export interface FileState {
  path: string;
  contentSha: string;
  indexedAt: number;
}

export interface IndexReport {
  filesIndexed: number;
  filesSkipped: number;
  filesRemoved: number;
  symbolsAdded: number;
  durationMs: number;
  /** Set when the repo cannot be indexed (no TypeScript tsconfig). */
  skippedReason?: string;
}

export interface ContextSearchHit {
  attrs?: Record<string, unknown>;
  id: string;
  kind: NodeKind;
  name: string;
  score: number;
  srcPath?: string;
  srcStart?: number;
  srcEnd?: number;
  excerpt?: string;
}

export interface SubgraphEdge {
  fromId: string;
  toId: string;
  kind: EdgeKind;
}

export interface SubgraphResult {
  nodes: ContextSearchHit[];
  edges: SubgraphEdge[];
  bytes: number;
}
