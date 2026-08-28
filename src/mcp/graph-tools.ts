import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import {
  formatInspectReport as formatPackageInspectReport,
  installPackageFromPath,
} from '../packages/install';
import { savePackage, loadPackage } from '../packages/save';
import { formatVerificationReport, testFunction } from '../packages/test';
import { CapabilityBroker } from '../sandbox/broker';
import { executeSandboxCode } from '../sandbox/runner';
import {
  buildCallResponse,
  buildGatewayErrorResponse,
  recordGatewayCallAndEnvelope,
} from './invoke';
import { hotRegisterPackage } from './package-tools';
import type { GatewayDependencies } from './package-tools';

export function registerGraphAndSandboxTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
  if (!deps.graph) {
    return;
  }

  server.registerTool(
    'fn_index',
    {
      description:
        'Incrementally index the local TypeScript repository into the knowledge graph.',
      inputSchema: z.object({
        force: z.boolean().optional().describe('Reindex all files'),
        include: z
          .array(z.string())
          .optional()
          .describe('Path prefixes to include (default: src)'),
        root: z.string().optional().describe('Repository root'),
      }),
    },
    async ({ force, include, root }) => {
      const report = deps.graph?.indexRepo({
        force,
        include: include ?? ['src'],
        root,
      });
      if (!report) {
        return {
          content: [
            {
              text: JSON.stringify({ error: 'Graph not available' }),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            text: JSON.stringify(report, null, 2),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_search_context',
    {
      description:
        'Search the repository knowledge graph and return a compact subgraph with excerpts.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(30).optional(),
        query: z.string(),
      }),
    },
    async ({ query, limit }) => {
      if (!deps.graph) {
        return {
          content: [
            {
              text: JSON.stringify({ error: 'Graph not available' }),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
      const result = deps.graph.searchContext(query, { limit });
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_subgraph',
    {
      description:
        'Return relationships and excerpts for explicit graph node ids.',
      inputSchema: z.object({
        ids: z.array(z.string()).min(1).max(20),
      }),
    },
    async ({ ids }) => {
      if (!deps.graph) {
        return {
          content: [
            {
              text: JSON.stringify({ error: 'Graph not available' }),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
      const result = deps.graph.subgraph(ids);
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_execute_code',
    {
      description:
        'Execute agent-written TypeScript in a sandbox. Intermediate MCP results stay in the runtime; only the compact final result returns.',
      inputSchema: z.object({
        allowedTools: z
          .array(z.string())
          .min(1)
          .max(16)
          .describe('Namespaced MCP tool ids'),
        approveWrites: z.boolean().optional(),
        full: z
          .boolean()
          .optional()
          .describe(
            'Return the full stored body instead of a compact envelope'
          ),
        input: z.record(z.string(), z.unknown()).optional(),
        maxCalls: z.number().int().positive().optional(),
        maxOutputBytes: z.number().int().positive().optional(),
        newRun: z
          .boolean()
          .optional()
          .describe(
            'Start a fresh trace run instead of continuing the current one'
          ),
        runId: z
          .string()
          .optional()
          .describe('Attach to an existing trace run'),
        source: z
          .string()
          .describe('TypeScript with export default async function'),
        timeoutMs: z.number().int().positive().optional(),
      }),
    },
    async ({
      source,
      input,
      allowedTools,
      timeoutMs,
      maxCalls,
      maxOutputBytes,
      approveWrites,
      runId,
      newRun,
      full,
    }) => {
      try {
        await deps.recorder.ensureRun({ newRun, runId });
        deps.recorder.assertRunActive();
      } catch (error) {
        return buildGatewayErrorResponse(
          error instanceof Error ? error.message : String(error)
        );
      }

      const broker = new CapabilityBroker(deps.manager, {
        allowedTools,
        approveWrites,
        maxCalls,
        recorder: deps.recorder,
        signal: deps.abortSignal,
      });

      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      const result = await executeSandboxCode(broker, {
        allowedTools,
        approveWrites,
        input,
        maxCalls,
        maxOutputBytes,
        source,
        timeoutMs,
      });

      const fingerprint = `sandbox:${allowedTools.sort().join(',')}`;
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      if (result.status !== 'succeeded') {
        return recordGatewayCallAndEnvelope(
          deps.recorder,
          {
            arguments: { allowedTools, input: input ?? {}, source },
            durationMs,
            endedAt,
            error: result.error,
            startedAt,
            status: result.status === 'timeout' ? 'timeout' : 'failed',
            toolFingerprint: fingerprint,
            toolId: 'fn_execute_code',
          },
          { full }
        );
      }

      const recorded = await recordGatewayCallAndEnvelope(
        deps.recorder,
        {
          arguments: { allowedTools, input: input ?? {}, source },
          durationMs,
          endedAt,
          output: result.output,
          startedAt,
          status: 'succeeded',
          toolFingerprint: fingerprint,
          toolId: 'fn_execute_code',
        },
        { full }
      );

      const recordedBody = JSON.parse(
        recorded.content[0]?.text ?? '{}'
      ) as Record<string, unknown>;
      return buildCallResponse({
        ...recordedBody,
        calls: result.calls,
        durationMs: result.durationMs,
      });
    }
  );

  server.registerTool(
    'fn_save_function',
    {
      description:
        'Save a sandbox function as a portable package (function.ts + functhis.json + functhis.lock).',
      inputSchema: z.object({
        allowedTools: z.array(z.string()).min(1),
        compiledFrom: z
          .string()
          .optional()
          .describe('Source trace run id when compiling from a trace'),
        description: z.string(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        name: z.string(),
        outputSchema: z.record(z.string(), z.unknown()).optional(),
        source: z.string(),
      }),
    },
    async ({
      source,
      name,
      description,
      allowedTools,
      inputSchema,
      outputSchema,
      compiledFrom,
    }) => {
      const packageDir = await savePackage(deps.manager, {
        allowedTools,
        compiledFrom,
        description,
        inputSchema,
        name,
        outputSchema,
        packagesRoot: deps.packagesDir,
        source,
      });
      const { lock, manifest } = await loadPackage(packageDir);
      deps.graph?.indexFunction(manifest, lock, {
        compiledFrom,
        packageDir,
      });
      await deps.packageLibrary.reload(deps.packagesDir);
      if (deps.server && manifest.capabilities.writes === 'deny') {
        hotRegisterPackage(deps.server, deps, name);
      }
      return {
        content: [
          {
            text: JSON.stringify({ name, packageDir, saved: true }, null, 2),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_install_function',
    {
      description:
        'Install a function package from a local path. Requires approve=true after reviewing capabilities.',
      inputSchema: z.object({
        approve: z
          .boolean()
          .describe('Explicit approval after reviewing requested capabilities'),
        path: z.string().describe('Path to package directory'),
      }),
    },
    async ({ path, approve }) => {
      const installed = await installPackageFromPath(path, deps.packagesDir, {
        approve,
      });
      await deps.packageLibrary.reload(deps.packagesDir);
      if (deps.server) {
        hotRegisterPackage(deps.server, deps, installed.name);
      }
      return {
        content: [
          {
            text: JSON.stringify(installed, null, 2),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_inspect_function',
    {
      description:
        'Inspect a function manifest and compare lockfile tool schemas to the live catalog.',
      inputSchema: z.object({
        name: z.string().optional(),
        path: z.string().optional(),
      }),
    },
    async ({ name, path }) => {
      const packageDir =
        path ?? (name ? `${deps.packagesDir}/${name}` : undefined);
      if (!packageDir) {
        return {
          content: [
            {
              text: JSON.stringify({ error: 'Provide name or path' }),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }
      const report = await formatPackageInspectReport(deps.manager, packageDir);
      return {
        content: [{ text: report, type: 'text' as const }],
      };
    }
  );

  server.registerTool(
    'fn_test_function',
    {
      description:
        'Verify a function package or source locally. Replay mode uses recorded trace evidence; live mode calls upstream read tools only.',
      inputSchema: z.object({
        allowedTools: z.array(z.string()).optional(),
        approveWrites: z.boolean().optional(),
        compiledFrom: z.string().optional(),
        description: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        mode: z.enum(['replay', 'live']).optional(),
        name: z.string().optional(),
        outputSchema: z.record(z.string(), z.unknown()).optional(),
        path: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    async ({
      path,
      name,
      source,
      allowedTools,
      input,
      inputSchema,
      outputSchema,
      description,
      compiledFrom,
      mode,
      approveWrites,
    }) => {
      try {
        const packageDir =
          path ||
          (source
            ? undefined
            : name
              ? `${deps.packagesDir}/${name}`
              : undefined);
        const report = await testFunction(deps.manager, {
          allowedTools,
          approveWrites,
          compiledFrom,
          configDir: deps.configDir,
          description,
          input,
          inputSchema,
          mode,
          name,
          outputSchema,
          packageDir,
          source,
        });
        return {
          content: [
            {
              text: formatVerificationReport(report),
              type: 'text' as const,
            },
          ],
          isError: report.status !== 'verified locally',
        };
      } catch (error) {
        return buildGatewayErrorResponse(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
}
