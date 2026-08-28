import { fingerprintTool } from '../catalog/fingerprint';
import { classifyToolRisk } from '../policy/access';
import type { DiscoveredTool } from '../upstream/types';
import type { GraphStore } from './store';

const EXCLUDED_FIELD_NAMES = new Set(['id', 'name', 'type', 'data']);

export function indexMcpTools(
  store: GraphStore,
  tools: DiscoveredTool[]
): { toolsIndexed: number; fieldsIndexed: number } {
  const now = Date.now();
  const serverIds = new Set<string>();
  let fieldsIndexed = 0;

  for (const tool of tools) {
    serverIds.add(tool.serverId);
    const serverId = `server:${tool.serverId}`;
    store.upsertNode({
      attrs: {},
      id: serverId,
      kind: 'server',
      name: tool.serverId,
      updatedAt: now,
    });

    store.upsertNode({
      attrs: {
        description: tool.description,
        fingerprint: tool.fingerprint,
        inputSchema: tool.inputSchema,
        risk: tool.risk,
        serverId: tool.serverId,
      },
      id: tool.id,
      kind: 'tool',
      name: tool.name,
      updatedAt: now,
    });
    store.upsertEdge({
      fromId: serverId,
      kind: 'has_tool',
      toId: tool.id,
    });

    const fields = extractSchemaFields(tool.inputSchema);
    for (const fieldName of fields) {
      const fieldId = `field:${tool.id}:${fieldName}`;
      store.upsertNode({
        attrs: { fieldName },
        id: fieldId,
        kind: 'schema_field',
        name: fieldName,
        updatedAt: now,
      });
      store.upsertEdge({
        fromId: tool.id,
        kind: 'has_field',
        toId: fieldId,
      });
      fieldsIndexed += 1;
    }
  }

  recomputeFieldNameMatches(store);

  return { fieldsIndexed, toolsIndexed: tools.length };
}

export function recomputeFieldNameMatches(store: GraphStore): void {
  store.clearFieldNameMatchEdges();
  const fields = store.listSchemaFieldNames();
  const byName = new Map<string, { fieldId: string; toolId: string }[]>();

  for (const field of fields) {
    if (
      field.fieldName.length < 3 ||
      EXCLUDED_FIELD_NAMES.has(field.fieldName)
    ) {
      continue;
    }
    const list = byName.get(field.fieldName) ?? [];
    list.push({ fieldId: field.fieldId, toolId: field.toolId });
    byName.set(field.fieldName, list);
  }

  for (const entries of byName.values()) {
    if (entries.length < 2) {
      continue;
    }
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const left = entries[i];
        const right = entries[j];
        if (left.toolId === right.toolId) {
          continue;
        }
        store.upsertEdge({
          attrs: {
            fieldName: fields.find((f) => f.fieldId === left.fieldId)
              ?.fieldName,
          },
          fromId: left.toolId,
          kind: 'field_name_match',
          toId: right.toolId,
        });
      }
    }
  }
}

function extractSchemaFields(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (!properties || typeof properties !== 'object') {
    return [];
  }
  return Object.keys(properties as Record<string, unknown>);
}

export function discoveredToolFromNode(node: {
  attrs: Record<string, unknown>;
  id: string;
  name: string;
}): DiscoveredTool | undefined {
  if (node.attrs.fingerprint === undefined) {
    return undefined;
  }
  return {
    description: String(node.attrs.description ?? ''),
    discoveredAt: new Date().toISOString(),
    fingerprint: String(node.attrs.fingerprint),
    id: node.id,
    inputSchema: node.attrs.inputSchema,
    name: node.name,
    risk: (node.attrs.risk as DiscoveredTool['risk']) ?? 'unknown',
    serverId: String(node.attrs.serverId ?? ''),
  };
}

export function makeDiscoveredTool(
  serverId: string,
  tool: { description?: string; inputSchema: unknown; name: string }
): DiscoveredTool {
  const description = tool.description ?? '';
  return {
    description,
    discoveredAt: new Date().toISOString(),
    fingerprint: fingerprintTool(tool.name, description, tool.inputSchema),
    id: `${serverId}.${tool.name}`,
    inputSchema: tool.inputSchema,
    name: tool.name,
    risk: classifyToolRisk(tool.name, description),
    serverId,
  };
}
