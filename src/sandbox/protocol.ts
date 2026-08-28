export type SandboxParentMessage =
  | {
      allowedTools: string[];
      input: Record<string, unknown>;
      source: string;
      type: 'run';
    }
  | { callId: number; error?: string; result?: unknown; type: 'tool_result' };

export type SandboxChildMessage =
  | { error?: string; result?: unknown; type: 'done' }
  | {
      args: unknown;
      callId: number;
      toolId: string;
      type: 'tool_call';
    }
  | { error: string; type: 'error' };

export interface SandboxExecuteOptions {
  allowedTools: string[];
  approveWrites?: boolean;
  input?: Record<string, unknown>;
  maxCalls?: number;
  maxOutputBytes?: number;
  source: string;
  timeoutMs?: number;
}

export interface SandboxExecuteResult {
  calls: number;
  durationMs: number;
  error?: string;
  output?: unknown;
  status: 'succeeded' | 'failed' | 'timeout' | 'denied' | 'budget_exceeded';
}
