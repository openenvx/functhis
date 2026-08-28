import type { SandboxChildMessage, SandboxParentMessage } from './protocol';

let nextCallId = 1;

const AsyncFunction = Object.getPrototypeOf(async () => {
  /* noop */
}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

async function main(): Promise<void> {
  process.on('message', (message: SandboxParentMessage) => {
    if (message.type !== 'run') {
      return;
    }
    void runGuest(message).then(
      (result) => {
        process.send?.({ result, type: 'done' } satisfies SandboxChildMessage);
      },
      (error: unknown) => {
        process.send?.({
          error: error instanceof Error ? error.message : String(error),
          type: 'done',
        } satisfies SandboxChildMessage);
      }
    );
  });
}

async function runGuest(
  message: Extract<SandboxParentMessage, { type: 'run' }>
): Promise<unknown> {
  const tools = buildToolsProxy(message.allowedTools);
  const ctx: Record<string, unknown> = { tools };

  const runner = new AsyncFunction(
    'ctx',
    'input',
    `${message.source}\nreturn await __guestRun(ctx, input);`
  );

  return runner(ctx, message.input ?? {});
}

function buildToolsProxy(
  allowedTools: string[]
): Record<string, Record<string, (args: unknown) => Promise<unknown>>> {
  const servers: Record<string, Record<string, string>> = {};
  for (const toolId of allowedTools) {
    const dot = toolId.indexOf('.');
    if (dot === -1) {
      continue;
    }
    const serverId = toolId.slice(0, dot);
    const toolName = toolId.slice(dot + 1);
    servers[serverId] ??= {};
    servers[serverId][toolName] = toolId;
  }

  const proxy: Record<
    string,
    Record<string, (args: unknown) => Promise<unknown>>
  > = {};
  for (const [serverId, tools] of Object.entries(servers)) {
    proxy[serverId] = {};
    for (const [toolName, toolId] of Object.entries(tools)) {
      proxy[serverId][toolName] = (args: unknown) =>
        callParentTool(toolId, args);
    }
  }
  return proxy;
}

async function callParentTool(toolId: string, args: unknown): Promise<unknown> {
  nextCallId += 1;
  const callId = nextCallId;
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const onMessage = (response: SandboxParentMessage): void => {
    if (response.type === 'tool_result' && response.callId === callId) {
      process.off('message', onMessage);
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.result);
      }
    }
  };
  process.on('message', onMessage);
  process.send?.({
    args,
    callId,
    toolId,
    type: 'tool_call',
  } satisfies SandboxChildMessage);
  return promise;
}

void main();
