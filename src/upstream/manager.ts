import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { ToolCatalog } from '../catalog/index';
import { parseToolId } from '../catalog/namespace';
import type { McpCallResult } from '../mcp/types';
import type { UpstreamServer } from '../storage/config';

const CONNECT_TIMEOUT_MS = 30_000;
export const CALL_TIMEOUT_MS = 60_000;

export interface CallToolOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class UpstreamManager {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport>();
  readonly catalog = new ToolCatalog();

  async connect(server: UpstreamServer): Promise<number> {
    if (!server.enabled) {
      return 0;
    }

    const existing = this.clients.get(server.id);
    if (existing) {
      const tools = await this.listToolsForServer(server.id);
      return tools.length;
    }

    const transport = new StdioClientTransport({
      args: server.args,
      command: server.command,
      cwd: server.cwd,
      env: resolveEnv(server.env),
      stderr: 'pipe',
    });

    const client = new Client({
      name: 'functhis-gateway',
      version: '0.1.0',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    try {
      await client.connect(transport, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    this.clients.set(server.id, client);
    this.transports.set(server.id, transport);

    const listed = await client.listTools();
    const filtered = listed.tools.filter((tool) => {
      if (server.deniedTools?.includes(tool.name)) {
        return false;
      }
      if (server.allowedTools && !server.allowedTools.includes(tool.name)) {
        return false;
      }
      return true;
    });

    this.catalog.addTools(
      server.id,
      filtered.map((tool) => ({
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
      }))
    );

    return filtered.length;
  }

  async connectAll(
    servers: UpstreamServer[]
  ): Promise<Map<string, number | Error>> {
    const results = new Map<string, number | Error>();
    for (const server of servers) {
      if (!server.enabled) {
        results.set(server.id, 0);
        continue;
      }
      try {
        const count = await this.connect(server);
        results.set(server.id, count);
      } catch (error) {
        results.set(
          server.id,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    return results;
  }

  async callTool(
    id: string,
    args: unknown,
    options: CallToolOptions = {}
  ): Promise<McpCallResult> {
    const tool = this.catalog.getTool(id);
    if (!tool) {
      throw new Error(`Unknown tool id: ${id}`);
    }

    const { serverId, toolName } = parseToolId(id);
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Upstream "${serverId}" is not connected`);
    }

    const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeout);
        throw new Error('Tool call was cancelled');
      }
      options.signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    try {
      const result = await client.callTool(
        {
          arguments: args as Record<string, unknown>,
          name: toolName,
        },
        { signal: controller.signal }
      );
      return result as McpCallResult;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Tool call timed out after ${timeoutMs}ms`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // ignore shutdown errors
      }
    }
    this.clients.clear();
    this.transports.clear();
  }

  private async listToolsForServer(serverId: string): Promise<string[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      return [];
    }
    const listed = await client.listTools();
    return listed.tools.map((tool) => tool.name);
  }
}

function resolveEnv(
  env?: Record<string, string>
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith('$')) {
      const envName = value.slice(1);
      const fromProcess = process.env[envName];
      if (fromProcess !== undefined) {
        resolved[key] = fromProcess;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
