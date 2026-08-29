import { parseToolId } from '../catalog/namespace';
import { analyzeDataflow } from './dataflow';
import type { ExecutionTrace } from './schema';
import { loadTrace } from './store';

export interface CompileBrief {
  allowedTools: string[];
  capabilities: { sideEffect: string; toolId: string }[];
  constants: Record<string, unknown>;
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
  readOnly: boolean;
  runId: string;
  skeleton: string;
  suggestedInputs: string[];
  toolSequence: string[];
  warnings: string[];
}

function isUpstreamCall(toolId: string): boolean {
  return toolId.includes('.') && !toolId.startsWith('fn_');
}

function inferJsonSchemaType(previews: string[]): Record<string, unknown> {
  const types = new Set<string>();
  for (const preview of previews) {
    try {
      const value = JSON.parse(preview);
      if (value === null) {
        types.add('null');
      } else if (Array.isArray(value)) {
        types.add('array');
      } else {
        types.add(typeof value);
      }
    } catch {
      types.add('string');
    }
  }

  if (types.size === 1) {
    const [type] = [...types];
    if (type === 'number' || type === 'boolean' || type === 'string') {
      return { type };
    }
    if (type === 'array') {
      return { items: {}, type: 'array' };
    }
    if (type === 'object') {
      return { type: 'object' };
    }
  }

  return { type: 'string' };
}

function buildInputSchema(
  suggestedInputs: string[],
  inputPreviews: Map<string, string[]>
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const key of suggestedInputs) {
    const previews = inputPreviews.get(key) ?? [];
    properties[key] =
      previews.length > 0 ? inferJsonSchemaType(previews) : { type: 'string' };
  }
  return {
    properties,
    required: suggestedInputs,
    type: 'object',
  };
}

function extractSandboxSource(trace: ExecutionTrace): string | undefined {
  const sandboxCall = [...trace.calls]
    .toReversed()
    .find(
      (call) => call.toolId === 'fn_execute_code' && call.status === 'succeeded'
    );
  const source = sandboxCall?.arguments.source;
  return typeof source === 'string' ? source : undefined;
}

function formatToolAccess(toolId: string): string {
  const { serverId, toolName } = parseToolId(toolId);
  return `ctx.tools.${serverId}.${toolName}`;
}

function serializeConstant(value: unknown): string {
  return JSON.stringify(value);
}

export function buildCompileBrief(
  trace: ExecutionTrace,
  options: { description?: string; name: string }
): CompileBrief {
  const analysis = analyzeDataflow(trace);
  const warnings: string[] = [];
  const constants: Record<string, unknown> = {};
  const suggestedInputs = new Set<string>();
  const inputPreviews = new Map<string, string[]>();

  if (!analysis.readOnly) {
    warnings.push(
      'Trace includes write or unknown side-effect tools. Live replay is not allowed without explicit approval.'
    );
  }

  for (const call of trace.calls) {
    if (call.truncated) {
      warnings.push(
        `Call ${call.address} (${call.toolId}) was truncated. Compilation may be incomplete.`
      );
    }
  }

  warnings.push(
    'Repeated read-only flows are auto-crystallized by the gateway when the same pattern occurs twice.'
  );

  const existingSource = extractSandboxSource(trace);
  if (existingSource) {
    warnings.push(
      'Trace includes fn_execute_code source. Using that source as the compiled skeleton.'
    );
  }

  for (const callSummary of analysis.calls) {
    for (const arg of callSummary.arguments) {
      if (arg.classification === 'input') {
        suggestedInputs.add(arg.key);
        if (arg.valuePreview) {
          const previews = inputPreviews.get(arg.key) ?? [];
          previews.push(arg.valuePreview);
          inputPreviews.set(arg.key, previews);
        }
      }
      if (arg.classification === 'constant' && arg.valuePreview) {
        try {
          constants[arg.key] = JSON.parse(arg.valuePreview);
        } catch {
          // skip non-json constants
        }
      }
      if (arg.classification === 'unknown') {
        warnings.push(
          `Argument "${arg.key}" on ${callSummary.address} could not be classified. Review manually.`
        );
      }
    }
  }

  const allowedTools = [...new Set(analysis.toolSequence)];
  const inputKeys = [...suggestedInputs];
  const varNames = new Map<string, string>();
  const lines: string[] = ['export default async function(ctx, input) {'];

  for (const callSummary of analysis.calls) {
    const traceCall = trace.calls.find(
      (entry) => entry.address === callSummary.address
    );
    if (!traceCall) {
      continue;
    }

    const varName = `step_${callSummary.address.slice(1)}`;
    varNames.set(callSummary.address, varName);
    const args: string[] = [];

    for (const arg of callSummary.arguments) {
      if (arg.classification === 'input') {
        args.push(`${arg.key}: input.${arg.key}`);
      } else if (arg.classification === 'constant' && arg.valuePreview) {
        args.push(`${arg.key}: ${arg.valuePreview}`);
      } else if (
        arg.classification === 'fromPrior' &&
        arg.priorAddress &&
        arg.priorPath
      ) {
        const priorVar =
          varNames.get(arg.priorAddress) ?? `step_${arg.priorAddress.slice(1)}`;
        args.push(`${arg.key}: ${priorVar}.${arg.priorPath}`);
      } else if (
        arg.classification === 'fromPrior' &&
        arg.priorAddress &&
        !arg.priorPath
      ) {
        const priorVar =
          varNames.get(arg.priorAddress) ?? `step_${arg.priorAddress.slice(1)}`;
        args.push(`${arg.key}: ${priorVar}`);
      } else if (traceCall.arguments[arg.key] !== undefined) {
        args.push(
          `${arg.key}: ${serializeConstant(traceCall.arguments[arg.key])}`
        );
        warnings.push(
          `Inlined literal for "${arg.key}" on ${callSummary.address}. Consider promoting to input.`
        );
      }
    }

    lines.push(
      `  const ${varName} = await ${formatToolAccess(callSummary.toolId)}({ ${args.join(', ')} });`
    );
  }

  const finalVar =
    analysis.finalOutputAddress && varNames.get(analysis.finalOutputAddress);
  if (finalVar) {
    lines.push(`  return ${finalVar};`);
  } else if (varNames.size > 0) {
    const lastVar = [...varNames.values()].at(-1);
    lines.push(`  return ${lastVar};`);
  } else {
    lines.push('  return input;');
  }
  lines.push('}');

  const skeleton = existingSource ?? lines.join('\n');
  const description =
    options.description ??
    `Compiled from trace ${trace.id} (${allowedTools.join(', ')})`;

  return {
    allowedTools,
    capabilities: analysis.capabilities.map((entry) => ({
      sideEffect: entry.sideEffect,
      toolId: entry.toolId,
    })),
    constants,
    description,
    inputSchema: buildInputSchema(inputKeys, inputPreviews),
    name: options.name,
    readOnly: analysis.readOnly,
    runId: trace.id,
    skeleton,
    suggestedInputs: inputKeys,
    toolSequence: analysis.toolSequence,
    warnings,
  };
}

export async function compileTrace(
  configDir: string,
  runId: string,
  options: { description?: string; name: string }
): Promise<CompileBrief> {
  const trace = await loadTrace(configDir, runId);
  const upstreamCalls = trace.calls.filter((call) =>
    isUpstreamCall(call.toolId)
  );
  if (upstreamCalls.length === 0) {
    throw new Error(
      `Run "${runId}" has no upstream MCP tool calls to compile.`
    );
  }
  if (!upstreamCalls.every((call) => call.status === 'succeeded')) {
    throw new Error(
      `Run "${runId}" includes failed upstream calls. Compile only successful traces.`
    );
  }
  return buildCompileBrief(trace, options);
}
