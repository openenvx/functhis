import { join } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { crystallizeRun } from '../functions/crystallize';
import { isFunctionToolId } from '../functions/library';
import type { FunctionSearchHit } from '../functions/library';
import { runFunctionTest } from '../functions/test';
import { assertToolAllowed } from '../policy/access';
import { formatInspectReport } from '../trace/inspect';
import { prepareCallOutput } from '../trace/recorder';
import { computeGatewayStats } from '../trace/stats';
import { describeFunction, invokeFunction } from './function-tools';
import type { GatewayDependencies } from './function-tools';
import {
  buildCallResponse,
  buildGatewayErrorResponse,
  recordGatewayCallAndEnvelope,
  respondWithStoredEvidence,
} from './invoke';

export function registerMetaTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
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

      try {
        await deps.recorder.ensureRun({ newRun, runId });
        deps.recorder.assertRunActive();
      } catch (error) {
        return buildGatewayErrorResponse(
          error instanceof Error ? error.message : String(error)
        );
      }

      const { arguments: resolvedArgs, refs } =
        deps.recorder.resolveArguments(rawArgs);

      const tool = deps.manager.catalog.getTool(id);
      const startedAt = new Date().toISOString();
      const startMs = Date.now();

      if (!tool) {
        return recordGatewayCallAndEnvelope(
          deps.recorder,
          {
            arguments: rawArgs,
            durationMs: Date.now() - startMs,
            endedAt: new Date().toISOString(),
            error: `Unknown tool id: ${id}. Use fn_search and fn_describe first.`,
            refs,
            startedAt,
            status: 'denied',
            toolFingerprint: 'unknown',
            toolId: id,
          },
          { full }
        );
      }

      try {
        assertToolAllowed(tool);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return recordGatewayCallAndEnvelope(
          deps.recorder,
          {
            arguments: rawArgs,
            durationMs: Date.now() - startMs,
            endedAt: new Date().toISOString(),
            error: message,
            refs,
            startedAt,
            status: 'denied',
            toolFingerprint: tool.fingerprint,
            toolId: tool.id,
          },
          { full }
        );
      }

      try {
        const result = await deps.manager.callTool(id, resolvedArgs);
        const prepared = prepareCallOutput(result);
        return recordGatewayCallAndEnvelope(
          deps.recorder,
          {
            arguments: rawArgs,
            durationMs: Date.now() - startMs,
            endedAt: new Date().toISOString(),
            originalBytes: prepared.originalBytes,
            output: prepared.output,
            refs,
            startedAt,
            status: 'succeeded',
            toolFingerprint: tool.fingerprint,
            toolId: tool.id,
            truncated: prepared.truncated,
          },
          { full }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes('timed out') ? 'timeout' : 'failed';
        return recordGatewayCallAndEnvelope(
          deps.recorder,
          {
            arguments: rawArgs,
            durationMs: Date.now() - startMs,
            endedAt: new Date().toISOString(),
            error: message,
            refs,
            startedAt,
            status,
            toolFingerprint: tool.fingerprint,
            toolId: tool.id,
          },
          { full }
        );
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
    async ({ runId, address, select, offset, limit, full }) =>
      respondWithStoredEvidence(deps.recorder, {
        address,
        full,
        limit,
        offset,
        runId,
        select,
      })
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
    async ({ runId, address, select, offset, limit, full }) =>
      respondWithStoredEvidence(deps.recorder, {
        address,
        full,
        limit,
        offset,
        runId,
        select,
      })
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
        const report = await formatInspectReport(runId, deps.configDir);
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
        const result = await crystallizeRun({
          calls,
          configDir: deps.configDir,
          description,
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
      try {
        const configPath = join(deps.configDir, 'upstreams.json');
        const result = await runFunctionTest({
          configPath,
          functionsDir: deps.functionsDir,
          name,
          repeat,
        });
        return {
          content: [{ text: result.output, type: 'text' as const }],
          isError: !result.passed,
        };
      } catch (error) {
        return buildGatewayErrorResponse(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
}
