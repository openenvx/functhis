import { parseToolId } from '../catalog/namespace';
import { normalizeCallResult } from '../mcp/normalize';
import { estimateUtf8Bytes } from '../output';
import { assertToolAllowed } from '../policy/access';
import { redactValue } from '../redaction/redact';
import type { TraceRecorder } from '../trace/recorder';
import type { UpstreamManager } from '../upstream/manager';

export interface BrokerOptions {
  allowedTools: string[];
  approveWrites?: boolean;
  maxBytesPerResult?: number;
  maxCalls?: number;
  onCall?: (info: {
    args: unknown;
    durationMs: number;
    toolId: string;
  }) => void;
  recorder?: TraceRecorder;
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
