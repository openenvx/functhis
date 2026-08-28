import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { DEFAULT_CONTEXT_BUDGET_BYTES } from '../output';
import { prepareCallOutput } from '../trace/recorder';
import type { CapabilityBroker } from './broker';
import type {
  SandboxChildMessage,
  SandboxExecuteOptions,
  SandboxExecuteResult,
  SandboxParentMessage,
} from './protocol';
import { transpileGuestSource, wrapGuestModule } from './transpile';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export async function executeSandboxCode(
  broker: CapabilityBroker,
  options: SandboxExecuteOptions
): Promise<SandboxExecuteResult> {
  const startMs = Date.now();
  const timeoutMs = Math.min(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );

  let transpiled: string;
  try {
    const { code } = transpileGuestSource(options.source);
    transpiled = wrapGuestModule(code);
  } catch (error) {
    return {
      calls: 0,
      durationMs: Date.now() - startMs,
      error: error instanceof Error ? error.message : String(error),
      status: 'failed',
    };
  }

  const childPath = join(import.meta.dirname, 'child-worker.js');

  let finishResolve!: (result: SandboxExecuteResult) => void;
  const promise = new Promise<SandboxExecuteResult>((resolve) => {
    finishResolve = resolve;
  });

  const child: ChildProcess = fork(childPath, [], {
    env: {},
    execArgv: ['--permission'],
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  let settled = false;
  let callCount = 0;

  const finish = (result: SandboxExecuteResult): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    child.kill();
    finishResolve(result);
  };

  const timer = setTimeout(() => {
    finish({
      calls: callCount,
      durationMs: Date.now() - startMs,
      error: `Sandbox timed out after ${timeoutMs}ms`,
      status: 'timeout',
    });
  }, timeoutMs);

  child.on('message', async (message: SandboxChildMessage) => {
    if (message.type === 'tool_call') {
      callCount += 1;
      try {
        const result = await broker.callTool(message.toolId, message.args);
        child.send({
          callId: message.callId,
          result,
          type: 'tool_result',
        } satisfies SandboxParentMessage);
      } catch (error) {
        child.send({
          callId: message.callId,
          error: error instanceof Error ? error.message : String(error),
          type: 'tool_result',
        } satisfies SandboxParentMessage);
      }
      return;
    }

    if (message.type === 'done') {
      if (message.error) {
        finish({
          calls: callCount,
          durationMs: Date.now() - startMs,
          error: message.error,
          status: 'failed',
        });
        return;
      }

      const maxOutput = options.maxOutputBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
      const prepared = prepareCallOutput(message.result);
      const originalBytes = prepared.originalBytes ?? 0;
      if (originalBytes > maxOutput) {
        finish({
          calls: callCount,
          durationMs: Date.now() - startMs,
          error: `Output exceeds maxOutputBytes (${originalBytes} > ${maxOutput})`,
          status: 'budget_exceeded',
        });
        return;
      }

      finish({
        calls: callCount,
        durationMs: Date.now() - startMs,
        output: prepared.output,
        status: 'succeeded',
      });
      return;
    }

    if (message.type === 'error') {
      finish({
        calls: callCount,
        durationMs: Date.now() - startMs,
        error: message.error,
        status: 'failed',
      });
    }
  });

  child.on('error', (error) => {
    finish({
      calls: callCount,
      durationMs: Date.now() - startMs,
      error: error.message,
      status: 'failed',
    });
  });

  child.on('exit', (code) => {
    if (!settled) {
      finish({
        calls: callCount,
        durationMs: Date.now() - startMs,
        error: `Sandbox child exited with code ${code ?? 'unknown'}`,
        status: 'failed',
      });
    }
  });

  const runMessage: SandboxParentMessage = {
    allowedTools: options.allowedTools,
    input: options.input ?? {},
    source: transpiled,
    type: 'run',
  };
  child.send(runMessage);

  return promise;
}
