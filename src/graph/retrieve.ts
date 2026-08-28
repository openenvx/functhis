import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { estimateUtf8Bytes } from '../output';
import type { GraphStore } from './store';
import type {
  ContextSearchHit,
  EdgeKind,
  NodeKind,
  SubgraphResult,
} from './types';

const DEFAULT_CONTEXT_BUDGET_BYTES = 6 * 1024;
const MAX_EXCERPT_LINES = 20;
const REPO_EDGE_KINDS: EdgeKind[] = ['contains', 'imports', 'exported_from'];
const TOOL_EDGE_KINDS: EdgeKind[] = [
  'has_tool',
  'has_field',
  'field_name_match',
];

export function searchContext(
  store: GraphStore,
  query: string,
  options: {
    limit?: number;
    maxBytes?: number;
    repoRoot?: string;
  } = {}
): SubgraphResult {
  const limit = options.limit ?? 15;
  const maxBytes = options.maxBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
  const repoRoot = resolve(options.repoRoot ?? process.cwd());

  const hits = store.searchFts(query, ['file', 'symbol'], limit);
  const nodes: ContextSearchHit[] = [];
  const edges: SubgraphResult['edges'] = [];
  const seenNodeIds = new Set<string>();
  const seenEdgeKeys = new Set<string>();

  for (const hit of hits) {
    if (seenNodeIds.has(hit.id)) {
      continue;
    }
    const node = store.getNode(hit.id);
    if (!node) {
      continue;
    }

    const contextHit = nodeToHit(node, hit.score, repoRoot);
    nodes.push(contextHit);
    seenNodeIds.add(hit.id);

    const neighbors = store.getNeighbors(hit.id, REPO_EDGE_KINDS).slice(0, 20);
    for (const { edge, node: neighbor } of neighbors) {
      const edgeKey = `${edge.fromId}:${edge.kind}:${edge.toId}`;
      if (!seenEdgeKeys.has(edgeKey)) {
        edges.push({
          fromId: edge.fromId,
          kind: edge.kind,
          toId: edge.toId,
        });
        seenEdgeKeys.add(edgeKey);
      }
      if (!seenNodeIds.has(neighbor.id) && nodes.length < limit * 2) {
        nodes.push(nodeToHit(neighbor, 0, repoRoot));
        seenNodeIds.add(neighbor.id);
      }
    }
  }

  return trimSubgraph({ bytes: 0, edges, nodes }, maxBytes);
}

export function getSubgraph(
  store: GraphStore,
  ids: string[],
  options: {
    maxBytes?: number;
    maxHops?: number;
    repoRoot?: string;
  } = {}
): SubgraphResult {
  const maxBytes = options.maxBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
  const maxHops = options.maxHops ?? (ids.length <= 3 ? 2 : 1);
  const repoRoot = resolve(options.repoRoot ?? process.cwd());

  const nodes: ContextSearchHit[] = [];
  const edges: SubgraphResult['edges'] = [];
  const seenNodeIds = new Set<string>();
  const seenEdgeKeys = new Set<string>();
  const queue: { depth: number; id: string }[] = ids.map((id) => ({
    depth: 0,
    id,
  }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seenNodeIds.has(current.id)) {
      continue;
    }
    const node = store.getNode(current.id);
    if (!node) {
      continue;
    }

    nodes.push(nodeToHit(node, 0, repoRoot));
    seenNodeIds.add(current.id);

    if (current.depth >= maxHops) {
      continue;
    }

    const edgeKinds =
      node.kind === 'tool' || node.kind === 'server'
        ? TOOL_EDGE_KINDS
        : REPO_EDGE_KINDS;

    for (const { edge, node: neighbor } of store.getNeighbors(
      current.id,
      edgeKinds
    )) {
      const edgeKey = `${edge.fromId}:${edge.kind}:${edge.toId}`;
      if (!seenEdgeKeys.has(edgeKey)) {
        edges.push({
          fromId: edge.fromId,
          kind: edge.kind,
          toId: edge.toId,
        });
        seenEdgeKeys.add(edgeKey);
      }
      if (!seenNodeIds.has(neighbor.id)) {
        queue.push({ depth: current.depth + 1, id: neighbor.id });
      }
    }
  }

  return trimSubgraph({ bytes: 0, edges, nodes }, maxBytes);
}

export function searchToolsInGraph(
  store: GraphStore,
  query: string,
  limit = 10
): ContextSearchHit[] {
  const hits = store.searchFts(query, ['tool', 'schema_field'], limit);
  return hits.map((hit) => ({
    id: hit.id,
    kind: hit.kind as NodeKind,
    name: hit.name,
    score: hit.score,
  }));
}

function nodeToHit(
  node: {
    attrs: Record<string, unknown>;
    id: string;
    kind: NodeKind;
    name: string;
    srcEnd?: number;
    srcPath?: string;
    srcStart?: number;
  },
  score: number,
  repoRoot: string
): ContextSearchHit {
  const hit: ContextSearchHit = {
    id: node.id,
    kind: node.kind,
    name: node.name,
    score,
    srcEnd: node.srcEnd,
    srcPath: node.srcPath,
    srcStart: node.srcStart,
  };

  if (node.srcPath && node.srcStart && node.srcEnd) {
    hit.excerpt = readExcerpt(
      join(repoRoot, node.srcPath),
      node.srcStart,
      node.srcEnd
    );
  }

  return hit;
}

function readExcerpt(
  absPath: string,
  startLine: number,
  _endLine: number
): string | undefined {
  try {
    const lines = readFileSync(absPath, 'utf-8').split('\n');
    const from = Math.max(0, startLine - 1);
    const to = Math.min(lines.length, from + MAX_EXCERPT_LINES);
    return lines.slice(from, to).join('\n');
  } catch {
    return undefined;
  }
}

function trimSubgraph(
  result: SubgraphResult,
  maxBytes: number
): SubgraphResult {
  result.bytes = estimateUtf8Bytes(result);
  while (result.bytes > maxBytes && result.nodes.length > 1) {
    const removed = result.nodes.pop();
    if (removed) {
      result.edges = result.edges.filter(
        (edge) => edge.fromId !== removed.id && edge.toId !== removed.id
      );
    }
    result.bytes = estimateUtf8Bytes(result);
  }
  return result;
}
