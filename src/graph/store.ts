import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}',
  src_path TEXT,
  src_start INTEGER,
  src_end INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE TABLE IF NOT EXISTS file_state (
  path TEXT PRIMARY KEY,
  content_sha TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id UNINDEXED,
  kind,
  name,
  body
);
`;

export class GraphStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  upsertNode(node: GraphNode): void {
    this.db
      .prepare(
        `INSERT INTO nodes (id, kind, name, attrs, src_path, src_start, src_end, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           name = excluded.name,
           attrs = excluded.attrs,
           src_path = excluded.src_path,
           src_start = excluded.src_start,
           src_end = excluded.src_end,
           updated_at = excluded.updated_at`
      )
      .run(
        node.id,
        node.kind,
        node.name,
        JSON.stringify(node.attrs),
        node.srcPath ?? null,
        node.srcStart ?? null,
        node.srcEnd ?? null,
        node.updatedAt
      );

    const body = [
      node.name,
      node.srcPath ?? '',
      JSON.stringify(node.attrs),
    ].join(' ');

    this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(node.id);
    this.db
      .prepare(
        'INSERT INTO nodes_fts (id, kind, name, body) VALUES (?, ?, ?, ?)'
      )
      .run(node.id, node.kind, node.name, body);
  }

  upsertEdge(edge: GraphEdge): void {
    this.db
      .prepare(
        `INSERT INTO edges (from_id, to_id, kind, attrs)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(from_id, to_id, kind) DO UPDATE SET attrs = excluded.attrs`
      )
      .run(edge.fromId, edge.toId, edge.kind, JSON.stringify(edge.attrs ?? {}));
  }

  deleteNodesBySrcPath(srcPath: string): void {
    const rows = this.db
      .prepare('SELECT id FROM nodes WHERE src_path = ?')
      .all(srcPath) as { id: string }[];

    for (const row of rows) {
      this.deleteNode(row.id);
    }
  }

  deleteNode(id: string): void {
    this.db
      .prepare('DELETE FROM edges WHERE from_id = ? OR to_id = ?')
      .run(id, id);
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id);
  }

  deleteNodesByKind(kind: NodeKind): void {
    const rows = this.db
      .prepare('SELECT id FROM nodes WHERE kind = ?')
      .all(kind) as { id: string }[];
    for (const row of rows) {
      this.deleteNode(row.id);
    }
  }

  getNode(id: string): GraphNode | undefined {
    const row = this.db
      .prepare(
        'SELECT id, kind, name, attrs, src_path, src_start, src_end, updated_at FROM nodes WHERE id = ?'
      )
      .get(id) as
      | {
          attrs: string;
          id: string;
          kind: string;
          name: string;
          src_end: number | null;
          src_path: string | null;
          src_start: number | null;
          updated_at: number;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return rowToNode(row);
  }

  getFileState(
    path: string
  ): { contentSha: string; indexedAt: number } | undefined {
    const row = this.db
      .prepare('SELECT content_sha, indexed_at FROM file_state WHERE path = ?')
      .get(path) as { content_sha: string; indexed_at: number } | undefined;
    if (!row) {
      return undefined;
    }
    return { contentSha: row.content_sha, indexedAt: row.indexed_at };
  }

  setFileState(path: string, contentSha: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO file_state (path, content_sha, indexed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET content_sha = excluded.content_sha, indexed_at = excluded.indexed_at`
      )
      .run(path, contentSha, now);
  }

  listFileStates(): { path: string; contentSha: string }[] {
    const rows = this.db
      .prepare('SELECT path, content_sha FROM file_state')
      .all() as { content_sha: string; path: string }[];
    return rows.map((row) => ({
      contentSha: row.content_sha,
      path: row.path,
    }));
  }

  removeFileState(path: string): void {
    this.db.prepare('DELETE FROM file_state WHERE path = ?').run(path);
  }

  searchFts(
    query: string,
    kinds: NodeKind[],
    limit: number
  ): { id: string; kind: string; name: string; score: number }[] {
    const sanitized = query
      .trim()
      .replaceAll(/[^\w\s.-]/gu, ' ')
      .split(/\s+/u)
      .filter((term) => term.length > 0)
      .map((term) => `"${term}"*`)
      .join(' ');

    if (!sanitized) {
      return [];
    }

    const kindPlaceholders = kinds.map(() => '?').join(', ');
    const sql = `
      SELECT nodes_fts.id, nodes_fts.kind, nodes_fts.name,
             bm25(nodes_fts) AS score
      FROM nodes_fts
      WHERE nodes_fts MATCH ?
        AND nodes_fts.kind IN (${kindPlaceholders})
      ORDER BY score
      LIMIT ?
    `;

    try {
      const rows = this.db.prepare(sql).all(sanitized, ...kinds, limit) as {
        id: string;
        kind: string;
        name: string;
        score: number;
      }[];
      return rows;
    } catch {
      return [];
    }
  }

  getNeighbors(
    nodeId: string,
    edgeKinds: EdgeKind[]
  ): { edge: GraphEdge; node: GraphNode }[] {
    if (edgeKinds.length === 0) {
      return [];
    }
    const placeholders = edgeKinds.map(() => '?').join(', ');

    const outgoing = this.db
      .prepare(
        `SELECT from_id, to_id, kind FROM edges WHERE from_id = ? AND kind IN (${placeholders})`
      )
      .all(nodeId, ...edgeKinds) as {
      from_id: string;
      kind: string;
      to_id: string;
    }[];

    const incoming = this.db
      .prepare(
        `SELECT from_id, to_id, kind FROM edges WHERE to_id = ? AND kind IN (${placeholders})`
      )
      .all(nodeId, ...edgeKinds) as {
      from_id: string;
      kind: string;
      to_id: string;
    }[];

    const results: { edge: GraphEdge; node: GraphNode }[] = [];

    for (const row of outgoing) {
      const node = this.getNode(row.to_id);
      if (node) {
        results.push({
          edge: {
            fromId: row.from_id,
            kind: row.kind as EdgeKind,
            toId: row.to_id,
          },
          node,
        });
      }
    }

    for (const row of incoming) {
      const node = this.getNode(row.from_id);
      if (node) {
        results.push({
          edge: {
            fromId: row.from_id,
            kind: row.kind as EdgeKind,
            toId: row.to_id,
          },
          node,
        });
      }
    }

    return results;
  }

  listNodesUsingTool(toolId: string, kind: NodeKind): GraphNode[] {
    const rows = this.db
      .prepare(
        `SELECT n.id, n.kind, n.name, n.attrs, n.src_path, n.src_start, n.src_end, n.updated_at
         FROM nodes n
         JOIN edges e ON e.from_id = n.id
         WHERE e.to_id = ? AND e.kind = 'uses_tool' AND n.kind = ?`
      )
      .all(toolId, kind) as {
      attrs: string;
      id: string;
      kind: string;
      name: string;
      src_end: number | null;
      src_path: string | null;
      src_start: number | null;
      updated_at: number;
    }[];

    return rows.map((row) => rowToNode(row));
  }

  listNodesByKind(kind: NodeKind): GraphNode[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, name, attrs, src_path, src_start, src_end, updated_at
         FROM nodes WHERE kind = ?`
      )
      .all(kind) as {
      attrs: string;
      id: string;
      kind: string;
      name: string;
      src_end: number | null;
      src_path: string | null;
      src_start: number | null;
      updated_at: number;
    }[];

    return rows.map((row) => rowToNode(row));
  }

  listToolIds(): string[] {
    const rows = this.db
      .prepare("SELECT id FROM nodes WHERE kind = 'tool'")
      .all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  listFunctionsWithTools(requiredTools: string[]): GraphNode[] {
    if (requiredTools.length === 0) {
      return [];
    }

    const placeholders = requiredTools.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT n.id, n.kind, n.name, n.attrs, n.src_path, n.src_start, n.src_end, n.updated_at
         FROM nodes n
         WHERE n.kind = 'function'
           AND (
             SELECT COUNT(DISTINCT e.to_id)
             FROM edges e
             WHERE e.from_id = n.id
               AND e.kind = 'uses_tool'
               AND e.to_id IN (${placeholders})
           ) = ?`
      )
      .all(...requiredTools, requiredTools.length) as {
      attrs: string;
      id: string;
      kind: string;
      name: string;
      src_end: number | null;
      src_path: string | null;
      src_start: number | null;
      updated_at: number;
    }[];

    return rows.map((row) => rowToNode(row));
  }

  listSchemaFieldNames(): {
    toolId: string;
    fieldName: string;
    fieldId: string;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT f.id AS field_id, f.name AS field_name, e.from_id AS tool_id
         FROM nodes f
         JOIN edges e ON e.to_id = f.id AND e.kind = 'has_field'
         WHERE f.kind = 'schema_field'`
      )
      .all() as { field_id: string; field_name: string; tool_id: string }[];

    return rows.map((row) => ({
      fieldId: row.field_id,
      fieldName: row.field_name,
      toolId: row.tool_id,
    }));
  }

  clearFieldNameMatchEdges(): void {
    this.db.prepare("DELETE FROM edges WHERE kind = 'field_name_match'").run();
  }
}

function rowToNode(row: {
  attrs: string;
  id: string;
  kind: string;
  name: string;
  src_end: number | null;
  src_path: string | null;
  src_start: number | null;
  updated_at: number;
}): GraphNode {
  return {
    attrs: JSON.parse(row.attrs) as Record<string, unknown>,
    id: row.id,
    kind: row.kind as NodeKind,
    name: row.name,
    srcEnd: row.src_end ?? undefined,
    srcPath: row.src_path ?? undefined,
    srcStart: row.src_start ?? undefined,
    updatedAt: row.updated_at,
  };
}
