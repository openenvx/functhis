import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { resolvePackageDir } from '../packages/install';
import { isPackageToolId } from '../packages/paths';
import { assertToolAllowed } from '../policy/access';
import { detectCandidates } from '../trace/candidates';
import { compileTrace } from '../trace/compile';
import { formatInspectReport, formatTraceListReport } from '../trace/inspect';
import { prepareCallOutput } from '../trace/recorder';
import { computeGatewayStats } from '../trace/stats';
import { resolveMcpClientLabel } from './client-info';
import {
  buildCallResponse,
  buildGatewayErrorResponse,
  recordGatewayCallAndEnvelope,
  respondWithStoredEvidence,
} from './invoke';
import { invokePackageFunction } from './package-invoke';
import type { GatewayDependencies } from './package-tools';

export function registerMetaTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
  server.registerTool(
    'fn_search',
    {
      description:
        'Search saved function packages first, then the local MCP tool catalog. Returns compact hits without full schemas.',
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
      const packageHits = deps.packageLibrary.search(query, max).map((hit) => ({
        ...hit,
        kind: 'package' as const,
      }));
      const remaining = Math.max(0, max - packageHits.length);
      const graphToolHits =
        remaining > 0 && deps.graph
          ? deps.graph
              .searchTools(query, remaining)
              .map((hit) => ({ ...hit, kind: 'tool' as const }))
          : [];
      const remainingAfterGraph = Math.max(0, remaining - graphToolHits.length);
      const catalogHits =
        remainingAfterGraph > 0
          ? deps.manager.catalog
              .searchTools(query, remainingAfterGraph)
              .map((hit) => ({ ...hit, kind: 'tool' as const }))
          : [];

      return {
        content: [
          {
            text: JSON.stringify(
              {
                hits: [...packageHits, ...graphToolHits, ...catalogHits],
                totalCatalog: deps.manager.catalog.size(),
                totalPackages: deps.packageLibrary.size(),
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
        'Load full input schemas for saved package names or namespaced upstream tool ids.',
      inputSchema: z.object({
        ids: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('Package names or namespaced tool ids'),
      }),
    },
    async ({ ids }) => {
      const tools = ids.map((id) => {
        if (isPackageToolId(id)) {
          const pkg = deps.packageLibrary.get(id);
          if (!pkg) {
            return { error: 'not found', id };
          }
          return {
            description: pkg.manifest.description,
            id: pkg.manifest.name,
            inputSchema: pkg.manifest.inputSchema,
            kind: 'package' as const,
            name: pkg.manifest.name,
            requiredTools: pkg.manifest.capabilities.tools,
          };
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
        'Invoke a saved package by name or an upstream MCP tool by namespaced id. Returns a compact pointer envelope for large results; use fn_recall with select to read fields.',
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
          .describe('Package name or namespaced tool id (serverId.toolName)'),
        newRun: z
          .boolean()
          .optional()
          .describe('Start a fresh run instead of continuing the current one'),
        runId: z.string().optional().describe('Attach to an existing run'),
        sessionId: z
          .string()
          .optional()
          .describe('Optional client session id for trace metadata'),
        skillId: z
          .string()
          .optional()
          .describe('Optional skill id for trace metadata'),
      }),
    },
    async ({
      id,
      arguments: toolArgs,
      runId,
      newRun,
      full,
      sessionId,
      skillId,
    }) => {
      const rawArgs = (toolArgs ?? {}) as Record<string, unknown>;

      if (isPackageToolId(id)) {
        const packageDir = await resolvePackageDir(deps.packagesDir, id);
        if (packageDir) {
          return invokePackageFunction(packageDir, rawArgs, deps, {
            full,
            newRun,
            runId,
          });
        }
        return buildCallResponse({
          error: `Unknown package "${id}". Use fn_search to find saved packages.`,
        });
      }

      try {
        await deps.recorder.ensureRun({
          client: resolveMcpClientLabel(deps.server),
          newRun,
          runId,
          sessionId,
          skillId,
        });
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
            sideEffect: tool.risk,
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
      inputSchema: z.object({
        function: z
          .string()
          .optional()
          .describe('Filter stats to a saved function package name'),
        tool: z
          .string()
          .optional()
          .describe('Filter stats to an upstream tool id'),
      }),
    },
    async ({ function: functionName, tool }) => {
      const packageNames = new Set(
        deps.packageLibrary.getAll().map((pkg) => pkg.manifest.name)
      );
      const pkg = functionName
        ? deps.packageLibrary.get(functionName)
        : undefined;
      const stats = await computeGatewayStats(deps.configDir, {
        catalogToolCount: deps.manager.catalog.size(),
        catalogTools: deps.manager.catalog.getAllTools().map((toolEntry) => ({
          description: toolEntry.description,
          inputSchema: toolEntry.inputSchema,
          name: toolEntry.name,
        })),
        functionName,
        packageCount: deps.packageLibrary.size(),
        packageNames,
        toolId: tool,
        underlyingCalls: pkg?.manifest.capabilities.tools.length,
      });
      return buildCallResponse(stats);
    }
  );

  server.registerTool(
    'fn_inspect',
    {
      description:
        'Inspect captured runs. Omit runId to list recent traces; provide runId for dataflow and call details.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Max traces when listing (default 20)'),
        runId: z.string().optional().describe('Run id returned by fn_call'),
      }),
    },
    async ({ runId, limit }) => {
      try {
        const report = runId
          ? await formatInspectReport(runId, deps.configDir)
          : await formatTraceListReport(deps.configDir, limit ?? 20);
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
    'fn_compile_trace',
    {
      description:
        'Compile a successful gateway trace into a compile brief and TypeScript skeleton for a reusable function package.',
      inputSchema: z.object({
        description: z.string().optional(),
        name: z.string().describe('Package name (lowercase, hyphens allowed)'),
        runId: z.string().describe('Run id to compile'),
      }),
    },
    async ({ runId, name, description }) => {
      try {
        const brief = await compileTrace(deps.configDir, runId, {
          description,
          name,
        });
        return buildCallResponse(brief);
      } catch (error) {
        return buildGatewayErrorResponse(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );

  server.registerTool(
    'fn_candidates',
    {
      description:
        'Detect repeated trace patterns that may be worth compiling into reusable function packages. Suggestions only — no automatic codegen.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum candidates to return (default 20)'),
        minOccurrences: z
          .number()
          .int()
          .min(2)
          .max(20)
          .optional()
          .describe('Minimum matching traces required (default 2)'),
      }),
    },
    async ({ limit, minOccurrences }) => {
      try {
        const candidates = await detectCandidates(deps.configDir, {
          limit,
          minOccurrences,
        });
        return buildCallResponse({
          candidates,
          labels: { occurrenceCount: 'observed', signals: 'deterministic' },
          total: candidates.length,
        });
      } catch (error) {
        return buildGatewayErrorResponse(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
}
