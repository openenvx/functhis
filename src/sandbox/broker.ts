import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseToolId } from '../catalog/namespace';
import type { GraphStore } from '../graph/store';
import { normalizeCallResult } from '../mcp/normalize';
import { estimateUtf8Bytes } from '../output';
import { assertToolAllowed } from '../policy/access';
import { redactValue } from '../redaction/redact';
import type { TraceRecorder } from '../trace/recorder';
import type { UpstreamManager } from '../upstream/manager';

export interface BrokerOptions {
  allowedTools: string[];
  approveWrites?: boolean;
  graphStore?: GraphStore;
  maxBytesPerResult?: number;
  maxCalls?: number;
  onCall?: (info: {
    args: unknown;
    durationMs: number;
    toolId: string;
  }) => void;
  recorder?: TraceRecorder;
  repoRead?: boolean;
  repoRoot?: string;
  signal?: AbortSignal;
}

export class CapabilityBroker {
  private callCount = 0;

  constructor(
    private manager: UpstreamManager,
    private options: BrokerOptions
  ) {}

  async callTool(toolId: string, args: unknown): Promise<unknown> {
    if (this.options.signal?.aborted) {
      throw new Error('Sandbox execution was cancelled');
    }

    if (!this.options.allowedTools.includes(toolId)) {
      throw new Error(`Tool "${toolId}" is not in the allowedTools list`);
    }

    const maxCalls = this.options.maxCalls ?? 20;
    this.callCount += 1;
    if (this.callCount > maxCalls) {
      throw new Error(`Exceeded maximum tool calls (${maxCalls})`);
    }

    const tool = this.manager.catalog.getTool(toolId);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    if (this.options.approveWrites) {
      assertToolAllowed(tool, { denyUnknown: true, denyWrite: false });
    } else {
      assertToolAllowed(tool, { denyUnknown: true, denyWrite: true });
    }

    const startMs = Date.now();
    const result = await this.manager.callTool(toolId, args, {
      signal: this.options.signal,
    });
    const normalized = normalizeCallResult(result);
    const redacted = redactValue(normalized);
    const bytes = estimateUtf8Bytes(redacted);
    const maxBytes = this.options.maxBytesPerResult ?? 256 * 1024;
    if (bytes > maxBytes) {
      throw new Error(
        `Tool result exceeds sandbox byte limit (${bytes} > ${maxBytes})`
      );
    }

    this.options.onCall?.({
      args,
      durationMs: Date.now() - startMs,
      toolId,
    });

    return redacted;
  }

  getRepoSnippet(nodeId: string): string {
    if (!this.options.repoRead) {
      throw new Error('Repository read access was not granted');
    }
    const store = this.options.graphStore;
    if (!store) {
      throw new Error('Graph store is not available for repo reads');
    }
    const node = store.getNode(nodeId);
    if (!node?.srcPath || !node.srcStart || !node.srcEnd) {
      throw new Error(`No source location for node ${nodeId}`);
    }
    const root = this.options.repoRoot ?? process.cwd();
    const absPath = join(root, node.srcPath);
    const lines = readFileSync(absPath, 'utf-8').split('\n');
    const from = Math.max(0, node.srcStart - 1);
    const to = Math.min(lines.length, node.srcEnd);
    return lines.slice(from, to).join('\n');
  }

  buildToolsProxy(): Record<
    string,
    Record<string, (args: unknown) => Promise<unknown>>
  > {
    const proxy: Record<
      string,
      Record<string, (args: unknown) => Promise<unknown>>
    > = {};

    for (const toolId of this.options.allowedTools) {
      const { serverId, toolName } = parseToolId(toolId);
      if (!proxy[serverId]) {
        proxy[serverId] = {};
      }
      proxy[serverId][toolName] = (args: unknown) =>
        this.callTool(toolId, args);
    }

    return proxy;
  }

  getCallCount(): number {
    return this.callCount;
  }
}
