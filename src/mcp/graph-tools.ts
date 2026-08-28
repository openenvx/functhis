import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { buildResultEnvelope } from '../output';
import {
  formatInspectReport,
  installPackageFromPath,
} from '../packages/install';
import { runPackage } from '../packages/run';
import { savePackage } from '../packages/save';
import { CapabilityBroker } from '../sandbox/broker';
import { executeSandboxCode } from '../sandbox/runner';
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
        input: z.record(z.string(), z.unknown()).optional(),
        maxCalls: z.number().int().positive().optional(),
        maxOutputBytes: z.number().int().positive().optional(),
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
    }) => {
      const broker = new CapabilityBroker(deps.manager, {
        allowedTools,
        approveWrites,
        maxCalls,
      });

      const result = await executeSandboxCode(broker, {
        allowedTools,
        approveWrites,
        input,
        maxCalls,
        maxOutputBytes,
        source,
        timeoutMs,
      });

      if (result.status !== 'succeeded') {
        return {
          content: [
            {
              text: JSON.stringify(result, null, 2),
              type: 'text' as const,
            },
          ],
          isError: true,
        };
      }

      const { envelope } = buildResultEnvelope(result.output);
      return {
        content: [
          {
            text: JSON.stringify({ ...result, envelope }, null, 2),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'fn_save_function',
    {
      description:
        'Save a sandbox function as a portable package (function.ts + functhis.json + functhis.lock).',
      inputSchema: z.object({
        allowedTools: z.array(z.string()).min(1),
        description: z.string(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        name: z.string(),
        source: z.string(),
      }),
    },
    async ({ source, name, description, allowedTools, inputSchema }) => {
      const packageDir = await savePackage(deps.manager, {
        allowedTools,
        description,
        inputSchema,
        name,
        packagesRoot: deps.packagesDir,
        source,
      });
      await deps.packageLibrary.reload(deps.packagesDir);
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
      const report = await formatInspectReport(deps.manager, packageDir);
      return {
        content: [{ text: report, type: 'text' as const }],
      };
    }
  );
}

export async function invokePackageFunction(
  packageDir: string,
  args: Record<string, unknown>,
  deps: GatewayDependencies
) {
  const result = await runPackage(deps.manager, {
    input: args,
    packageDir,
    signal: deps.abortSignal,
  });

  if (result.status !== 'succeeded') {
    return {
      content: [
        {
          text: JSON.stringify(result, null, 2),
          type: 'text' as const,
        },
      ],
      isError: true,
    };
  }

  const { envelope } = buildResultEnvelope(result.output);
  return {
    content: [
      {
        text: JSON.stringify(
          { envelope, output: result.output, status: result.status },
          null,
          2
        ),
        type: 'text' as const,
      },
    ],
  };
}
