import { dirname } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

import { runInspect } from '../cli/inspect';
import { computeGatewayStats } from '../cli/stats';
import { runTestWithExitCode } from '../cli/test';
import { runThis } from '../cli/this';
import { FunctionLibrary, isFunctionToolId } from '../functions/library';
import type { FunctionSearchHit } from '../functions/library';
import { getFunctionsDir } from '../functions/paths';
import { runFunction } from '../functions/runner';
import {
  functionInputsToJsonSchema,
  functionInputsToZod,
} from '../functions/schema';
import type { FunctionDefinition } from '../functions/schema';
import { assertToolAllowed } from '../policy/access';
import { loadConfig } from '../storage/config';
import { getConfigPath } from '../storage/paths';
import { prepareCallOutput, TraceRecorder } from '../trace/recorder';
import { UpstreamManager } from '../upstream/manager';
import {
  buildResultEnvelope,
  estimateUtf8Bytes,
  shapeEvidenceOutput,
} from './output';

export interface StartGatewayOptions {
  configPath?: string;
  functionsDir?: string;
}

export interface GatewayDependencies {
  abortSignal?: AbortSignal;
  configDir: string;
  functionsDir: string;
  library: FunctionLibrary;
  manager: UpstreamManager;
  recorder: TraceRecorder;
}

function buildCallResponse(payload: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(payload, null, 2),
        type: 'text' as const,
      },
    ],
  };
}

function buildSuccessPayload(
  storedOutput: unknown,
  options: {
    address: string;
    full?: boolean;
    runId: string;
    safetyTruncated?: boolean;
    safetyOriginalBytes?: number;
  }
): {
  payload: Record<string, unknown>;
  returnedBytes: number;
  storedBytes: number;
} {
  const storedBytes = estimateUtf8Bytes(storedOutput);
  const { envelope, returnedBytes } = buildResultEnvelope(storedOutput, {
    address: options.address,
    full: options.full,
    runId: options.runId,
  });

  const payload: Record<string, unknown> = { ...envelope };
  if (options.safetyTruncated) {
    payload.safetyTruncated = true;
    payload.safetyOriginalBytes = options.safetyOriginalBytes;
  }

  return { payload, returnedBytes, storedBytes };
}

function describeFunction(definition: FunctionDefinition) {
  return {
    description: definition.description,
    id: definition.name,
    inputSchema: functionInputsToJsonSchema(definition.inputs),
    kind: 'function' as const,
    name: definition.name,
    requiredTools: definition.requiredTools,
    toolFingerprints: definition.toolFingerprints,
  };
}

async function invokeFunction(
  definition: FunctionDefinition,
  args: Record<string, unknown>,
  deps: GatewayDependencies,
  options?: {
    full?: boolean;
    newRun?: boolean;
    runId?: string;
    recordTrace?: boolean;
  }
) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const recordTrace = options?.recordTrace ?? true;

  if (recordTrace) {
    try {
      await deps.recorder.ensureRun({
        newRun: options?.newRun,
        runId: options?.runId,
      });
      deps.recorder.assertRunActive();
    } catch (error) {
      return {
        content: [
          {
            text: error instanceof Error ? error.message : String(error),
            type: 'text' as const,
          },
        ],
        isError: true,
      };
    }
  }

  try {
    const result = await runFunction(definition, args, deps.manager, {
      signal: deps.abortSignal,
    });

    if (!recordTrace) {
      return buildCallResponse({ result: result.output });
    }

    const { address, runId: activeRunId } = await deps.recorder.recordCall({
      arguments: args,
      durationMs: Date.now() - startMs,
      endedAt: new Date().toISOString(),
      output: result.output,
      startedAt,
      status: 'succeeded',
      toolFingerprint: 'function',
      toolId: definition.name,
    });

    const { payload, returnedBytes, storedBytes } = buildSuccessPayload(
      result.output,
      {
        address,
        full: options?.full,
        runId: activeRunId,
      }
    );

    await deps.recorder.updateLastCallMetrics({
      returnedBytes,
      storedBytes,
    });

    return buildCallResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('timed out') ? 'timeout' : 'failed';

    if (!recordTrace) {
      return buildCallResponse({ error: message });
    }

    const { address, runId: activeRunId } = await deps.recorder.recordCall({
      arguments: args,
      durationMs: Date.now() - startMs,
      endedAt: new Date().toISOString(),
      error: message,
      startedAt,
      status,
      toolFingerprint: 'function',
      toolId: definition.name,
    });

    return buildCallResponse({
      address,
      error: message,
      runId: activeRunId,
    });
  }
}

export function createGatewayServer(deps: GatewayDependencies): McpServer {
  const server = new McpServer({
    name: 'functhis',
    version: '0.1.0',
  });

  server.registerTool(
    'fn_search',
    {
      description:
        'Search compiled Functions first, then the local MCP tool catalog. Returns compact hits without full schemas.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum results (default 10)'),
        query: z.string().describe('Search query'),
      }),
    },
    async ({ query, limit }) => {
      const max = limit ?? 10;
      const functionHits: FunctionSearchHit[] = deps.library.search(query, max);
      const remaining = Math.max(0, max - functionHits.length);
      const catalogHits =
        remaining > 0
          ? deps.manager.catalog
              .searchTools(query, remaining)
              .map((hit) => ({ ...hit, kind: 'tool' as const }))
          : [];

      return {
        content: [
          {
            text: JSON.stringify(
              {
                hits: [...functionHits, ...catalogHits],
                totalCatalog: deps.manager.catalog.size(),
                totalFunctions: deps.library.size(),
              },
              null,
              2
            ),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_describe',
    {
      description:
        'Load full input schemas for Function names or namespaced upstream tool ids.',
      inputSchema: z.object({
        ids: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('Function names or namespaced tool ids'),
      }),
    },
    async ({ ids }) => {
      const tools = ids.map((id) => {
        if (isFunctionToolId(id)) {
          const definition = deps.library.get(id);
          if (!definition) {
            return { error: 'not found', id };
          }
          return describeFunction(definition);
        }

        const tool = deps.manager.catalog.getTool(id);
        if (!tool) {
          return { error: 'not found', id };
        }
        return {
          description: tool.description,
          fingerprint: tool.fingerprint,
          id: tool.id,
          inputSchema: tool.inputSchema,
          kind: 'tool' as const,
          name: tool.name,
          risk: tool.risk,
          serverId: tool.serverId,
        };
      });
      return {
        content: [
          {
            text: JSON.stringify({ tools }, null, 2),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_call',
    {
      description:
        'Invoke a compiled Function by name or an upstream MCP tool by namespaced id. Returns a compact pointer envelope for large results; use fn_recall with select to read fields.',
      inputSchema: z.object({
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Tool arguments object; use @N to reference prior evidence'
          ),
        full: z
          .boolean()
          .optional()
          .describe(
            'Return the full stored body instead of a compact envelope (small results only)'
          ),
        id: z
          .string()
          .describe('Function name or namespaced tool id (serverId.toolName)'),
        newRun: z
          .boolean()
          .optional()
          .describe('Start a fresh run instead of continuing the current one'),
        runId: z.string().optional().describe('Attach to an existing run'),
      }),
    },
    async ({ id, arguments: toolArgs, runId, newRun, full }) => {
      const rawArgs = (toolArgs ?? {}) as Record<string, unknown>;

      if (isFunctionToolId(id)) {
        const definition = deps.library.get(id);
        if (!definition) {
          return buildCallResponse({
            error: `Unknown Function "${id}". Use fn_search to find compiled Functions.`,
          });
        }
        return invokeFunction(definition, rawArgs, deps, {
          full,
          newRun,
          runId,
        });
      }

      const startedAt = new Date().toISOString();
      const startMs = Date.now();

      try {
        await deps.recorder.ensureRun({ newRun, runId });
        deps.recorder.assertRunActive();
      } catch (error) {
        return {
          content: [
            {
              text: error instanceof Error ? error.message : String(error),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }

      const { arguments: resolvedArgs, refs } =
        deps.recorder.resolveArguments(rawArgs);

      const tool = deps.manager.catalog.getTool(id);
      if (!tool) {
        const endedAt = new Date().toISOString();
        const { address, runId: activeRunId } = await deps.recorder.recordCall({
          arguments: rawArgs,
          durationMs: Date.now() - startMs,
          endedAt,
          error: `Unknown tool id: ${id}`,
          refs,
          startedAt,
          status: 'denied',
          toolFingerprint: 'unknown',
          toolId: id,
        });
        return buildCallResponse({
          address,
          error: `Unknown tool id: ${id}. Use fn_search and fn_describe first.`,
          runId: activeRunId,
        });
      }

      try {
        assertToolAllowed(tool);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const endedAt = new Date().toISOString();
        const { address, runId: activeRunId } = await deps.recorder.recordCall({
          arguments: rawArgs,
          durationMs: Date.now() - startMs,
          endedAt,
          error: message,
          refs,
          startedAt,
          status: 'denied',
          toolFingerprint: tool.fingerprint,
          toolId: tool.id,
        });
        return buildCallResponse({
          address,
          error: message,
          runId: activeRunId,
        });
      }

      try {
        const result = await deps.manager.callTool(id, resolvedArgs);
        const prepared = prepareCallOutput(result);
        const endedAt = new Date().toISOString();
        const { address, runId: activeRunId } = await deps.recorder.recordCall({
          arguments: rawArgs,
          durationMs: Date.now() - startMs,
          endedAt,
          originalBytes: prepared.originalBytes,
          output: prepared.output,
          refs,
          startedAt,
          status: 'succeeded',
          toolFingerprint: tool.fingerprint,
          toolId: tool.id,
          truncated: prepared.truncated,
        });

        const { payload, returnedBytes, storedBytes } = buildSuccessPayload(
          prepared.output,
          {
            address,
            full,
            runId: activeRunId,
            safetyOriginalBytes: prepared.originalBytes,
            safetyTruncated: prepared.truncated,
          }
        );

        await deps.recorder.updateLastCallMetrics({
          returnedBytes,
          storedBytes,
        });

        return buildCallResponse(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes('timed out') ? 'timeout' : 'failed';
        const endedAt = new Date().toISOString();
        const { address, runId: activeRunId } = await deps.recorder.recordCall({
          arguments: rawArgs,
          durationMs: Date.now() - startMs,
          endedAt,
          error: message,
          refs,
          startedAt,
          status,
          toolFingerprint: tool.fingerprint,
          toolId: tool.id,
        });
        return buildCallResponse({
          address,
          error: message,
          runId: activeRunId,
        });
      }
    }
  );

  server.registerTool(
    'fn_recall',
    {
      description:
        'Read stored evidence from a prior fn_call without repeating the upstream call. Prefer select/offset/limit over full dumps.',
      inputSchema: z.object({
        address: z.string().describe('Evidence address such as @1'),
        full: z
          .boolean()
          .optional()
          .describe(
            'Return the full shaped payload instead of a compact envelope'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Page size for arrays or strings'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Start offset for arrays or strings'),
        runId: z.string().describe('Run id returned by fn_call'),
        select: z
          .string()
          .optional()
          .describe('JMESPath expression to extract fields from stored JSON'),
      }),
    },
    async ({ runId, address, select, offset, limit, full }) => {
      try {
        const evidence = await deps.recorder.recall(runId, address);
        const shaped = shapeEvidenceOutput(evidence, {
          address,
          full,
          limit,
          offset,
          runId,
          select,
        });
        return buildCallResponse(shaped.output);
      } catch (error) {
        return {
          content: [
            {
              text: error instanceof Error ? error.message : String(error),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'fn_select',
    {
      description:
        'Alias for fn_recall with select/offset/limit. Extract fields from stored evidence without loading the full body.',
      inputSchema: z.object({
        address: z.string().describe('Evidence address such as @1'),
        full: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
        runId: z.string().describe('Run id returned by fn_call'),
        select: z.string().describe('JMESPath expression'),
      }),
    },
    async ({ runId, address, select, offset, limit, full }) => {
      try {
        const evidence = await deps.recorder.recall(runId, address);
        const shaped = shapeEvidenceOutput(evidence, {
          address,
          full,
          limit,
          offset,
          runId,
          select,
        });
        return buildCallResponse(shaped.output);
      } catch (error) {
        return {
          content: [
            {
              text: error instanceof Error ? error.message : String(error),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'fn_stats',
    {
      description:
        'Report local gateway usage and labeled token/byte savings estimates.',
      inputSchema: z.object({}),
    },
    async () => {
      const stats = await computeGatewayStats(deps.configDir, {
        catalogToolCount: deps.manager.catalog.size(),
        catalogTools: deps.manager.catalog.getAllTools().map((tool) => ({
          description: tool.description,
          inputSchema: tool.inputSchema,
          name: tool.name,
        })),
        functionCount: deps.library.size(),
      });
      return buildCallResponse(stats);
    }
  );

  server.registerTool(
    'fn_inspect',
    {
      description:
        'Inspect a captured run: status, calls, fingerprints, and successful path.',
      inputSchema: z.object({
        runId: z.string().describe('Run id returned by fn_call'),
      }),
    },
    async ({ runId }) => {
      try {
        const report = await runInspect({ dir: deps.configDir, runId });
        return {
          content: [{ text: report, type: 'text' as const }],
        };
      } catch (error) {
        return {
          content: [
            {
              text: error instanceof Error ? error.message : String(error),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'fn_this',
    {
      description:
        'Compile a successful read-only run into a reusable Function and fixture.',
      inputSchema: z.object({
        calls: z
          .array(z.string())
          .optional()
          .describe('Evidence addresses to compile (default: all succeeded)'),
        description: z.string().optional().describe('Function description'),
        force: z
          .boolean()
          .optional()
          .describe('Overwrite an existing Function with the same name'),
        name: z
          .string()
          .describe('Function name (lowercase letters, numbers, hyphens)'),
        runId: z.string().describe('Run id to compile'),
      }),
    },
    async ({ runId, name, calls, description, force }) => {
      try {
        const result = await runThis({
          calls,
          description,
          dir: deps.configDir,
          force,
          functionsDir: deps.functionsDir,
          name,
          runId,
        });
        await deps.library.reload(deps.functionsDir);
        return {
          content: [
            {
              text: JSON.stringify(
                {
                  definitionPath: result.definitionPath,
                  fixturePath: result.fixturePath,
                  name,
                  report: result.report,
                  searchable: deps.library.get(name) !== undefined,
                },
                null,
                2
              ),
              type: 'text' as const,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              text: error instanceof Error ? error.message : String(error),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'fn_test',
    {
      description:
        'Run a compiled Function against its fixture and report drift or failures.',
      inputSchema: z.object({
        name: z.string().describe('Function name'),
        repeat: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Repeat count (default 1)'),
      }),
    },
    async ({ name, repeat }) => {
      const { ok, output } = await runTestWithExitCode({
        dir: deps.configDir,
        functionsDir: deps.functionsDir,
        name,
        repeat,
      });
      return {
        content: [{ text: output, type: 'text' as const }],
        isError: !ok,
      };
    }
  );

  for (const definition of deps.library.getAll()) {
    const inputSchema = functionInputsToZod(definition.inputs);
    server.registerTool(
      definition.name,
      {
        description: `Functhis Function: ${definition.description}`,
        inputSchema,
      },
      async (args) =>
        invokeFunction(definition, args as Record<string, unknown>, deps, {
          recordTrace: true,
        })
    );
  }

  return server;
}

export async function startGateway(
  options?: StartGatewayOptions | string
): Promise<void> {
  const resolvedOptions: StartGatewayOptions =
    typeof options === 'string' ? { configPath: options } : (options ?? {});

  const path = resolvedOptions.configPath ?? getConfigPath();
  const configDir = dirname(path);
  const config = await loadConfig(path);
  const manager = new UpstreamManager();
  const recorder = new TraceRecorder(configDir);
  const functionsRoot = getFunctionsDir(
    process.cwd(),
    resolvedOptions.functionsDir
  );
  const library = await FunctionLibrary.load(functionsRoot);

  const abortController = new AbortController();
  const shutdown = async (): Promise<void> => {
    abortController.abort();
    await recorder.cancelCurrentRun();
    await manager.closeAll();
  };

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  await manager.connectAll(config.upstreams);

  const server = createGatewayServer({
    abortSignal: abortController.signal,
    configDir,
    functionsDir: functionsRoot,
    library,
    manager,
    recorder,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
