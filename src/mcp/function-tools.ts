import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { FunctionLibrary } from '../functions/library';
import { runFunction } from '../functions/runner';
import {
  functionInputsToJsonSchema,
  functionInputsToZod,
} from '../functions/schema';
import type { FunctionDefinition } from '../functions/schema';
import type { GraphService } from '../graph/service';
import type { PackageLibrary } from '../packages/library';
import type { TraceRecorder } from '../trace/recorder';
import type { UpstreamManager } from '../upstream/manager';
import { invokePackageFunction } from './graph-tools';
import {
  buildCallResponse,
  buildGatewayErrorResponse,
  recordGatewayCallAndEnvelope,
} from './invoke';

const FULL_OPTION_DESCRIPTION =
  'Return the full stored body instead of a compact envelope (small results only)';

export interface GatewayDependencies {
  abortSignal?: AbortSignal;
  configDir: string;
  functionsDir: string;
  graph?: GraphService;
  library: FunctionLibrary;
  manager: UpstreamManager;
  recorder: TraceRecorder;
  packageLibrary?: PackageLibrary;
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

export async function invokeFunction(
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
      return buildGatewayErrorResponse(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  try {
    const result = await runFunction(definition, args, deps.manager, {
      signal: deps.abortSignal,
    });

    if (!recordTrace) {
      return buildCallResponse({ result: result.output });
    }

    return recordGatewayCallAndEnvelope(
      deps.recorder,
      {
        arguments: args,
        durationMs: Date.now() - startMs,
        endedAt: new Date().toISOString(),
        output: result.output,
        startedAt,
        status: 'succeeded',
        toolFingerprint: 'function',
        toolId: definition.name,
      },
      { full: options?.full }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('timed out') ? 'timeout' : 'failed';

    if (!recordTrace) {
      return buildCallResponse({ error: message });
    }

    return recordGatewayCallAndEnvelope(
      deps.recorder,
      {
        arguments: args,
        durationMs: Date.now() - startMs,
        endedAt: new Date().toISOString(),
        error: message,
        startedAt,
        status,
        toolFingerprint: 'function',
        toolId: definition.name,
      },
      { full: options?.full }
    );
  }
}

function functionToolInputSchema(
  definition: FunctionDefinition
): z.ZodObject<Record<string, z.ZodType>> {
  const baseSchema = functionInputsToZod(definition.inputs);
  if ('full' in definition.inputs) {
    return baseSchema;
  }
  return baseSchema.extend({
    full: z.boolean().optional().describe(FULL_OPTION_DESCRIPTION),
  });
}

function peelFunctionArgs(args: Record<string, unknown>): {
  full?: boolean;
  functionArgs: Record<string, unknown>;
} {
  const { full, ...functionArgs } = args;
  return {
    full: typeof full === 'boolean' ? full : undefined,
    functionArgs,
  };
}

export function registerFunctionTools(
  server: McpServer,
  deps: GatewayDependencies
): void {
  for (const definition of deps.library.getAll()) {
    const inputSchema = functionToolInputSchema(definition);
    server.registerTool(
      definition.name,
      {
        description: `Functhis Function: ${definition.description}`,
        inputSchema,
      },
      async (args) => {
        const { full, functionArgs } = peelFunctionArgs(
          args as Record<string, unknown>
        );
        return invokeFunction(definition, functionArgs, deps, {
          full,
          recordTrace: true,
        });
      }
    );
  }

  if (deps.packageLibrary) {
    for (const pkg of deps.packageLibrary.getAll()) {
      server.registerTool(
        pkg.manifest.name,
        {
          description: `Functhis Function: ${pkg.manifest.description}`,
          inputSchema: z.object({
            input: z
              .record(z.string(), z.unknown())
              .optional()
              .describe('Function input'),
          }),
        },
        async ({ input }) => invokePackageFunction(pkg.dir, input ?? {}, deps)
      );
    }
  }
}

export { describeFunction };
