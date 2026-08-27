import type { ToolCatalog } from '../catalog/index';
import { classifyToolRisk } from '../policy/access';
import type { ExecutionTrace, TraceCall } from '../trace/schema';
import { ADDRESS_PATTERN } from '../trace/schema';
import { DEFAULT_FUNCTION_RUNTIME } from './schema';
import type {
  ExecutionStep,
  Fixture,
  FunctionDefinition,
  InputDeclaration,
  SanitizedCall,
} from './schema';

export interface CompileOptions {
  name: string;
  description?: string;
  calls?: string[];
  sourceRunId: string;
  catalog?: ToolCatalog;
}

function inferInputType(value: unknown): InputDeclaration['type'] {
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'string';
}

function makeStepId(call: TraceCall, index: number): string {
  const base = call.toolId.split('.').pop() ?? `step_${index + 1}`;
  const sanitized = base.replaceAll(/[^a-z0-9_]/giu, '_').toLowerCase();
  return /^[a-z]/u.test(sanitized) ? sanitized : `step_${sanitized}`;
}

function resolveToolRisk(
  toolId: string,
  catalog?: ToolCatalog
): 'read' | 'write' | 'unknown' {
  const fromCatalog = catalog?.getTool(toolId)?.risk;
  if (fromCatalog) {
    return fromCatalog;
  }
  const toolName = toolId.split('.').pop() ?? toolId;
  if (
    /^(get|list|fetch|read|search|find|lookup|describe|query|inspect|show|view|download|export)_/iu.test(
      toolName
    )
  ) {
    return 'read';
  }
  if (
    /^(create|update|delete|remove|write|send|post|put|patch|destroy|drop|insert|modify|set|mutate|publish|deploy|push|merge|commit|upload)_/iu.test(
      toolName
    )
  ) {
    return 'write';
  }
  return classifyToolRisk(toolName, toolId);
}

function assertToolSafe(toolId: string, catalog?: ToolCatalog): void {
  const risk = resolveToolRisk(toolId, catalog);
  if (risk !== 'read') {
    throw new Error(
      `Tool "${toolId}" is classified as "${risk}". Only read tools can be compiled.`
    );
  }
}

function selectCalls(trace: ExecutionTrace, addresses?: string[]): TraceCall[] {
  if (addresses && addresses.length > 0) {
    const selected: TraceCall[] = [];
    for (const address of addresses) {
      const call = trace.calls.find((entry) => entry.address === address);
      if (!call) {
        throw new Error(`Address ${address} not found in run ${trace.id}`);
      }
      if (call.status !== 'succeeded') {
        throw new Error(
          `Address ${address} has status "${call.status}"; only succeeded calls can be compiled`
        );
      }
      selected.push(call);
    }
    return selected;
  }

  const succeeded = trace.calls.filter((call) => call.status === 'succeeded');
  if (succeeded.length === 0) {
    throw new Error(`Run "${trace.id}" has no succeeded calls to compile`);
  }
  return succeeded;
}

function addressToStepId(
  address: string,
  callToStepId: Map<string, string>
): string {
  const stepId = callToStepId.get(address);
  if (!stepId) {
    throw new Error(`No step mapped for evidence address ${address}`);
  }
  return stepId;
}

function collectStepDependencies(
  call: TraceCall,
  callToStepId: Map<string, string>
): string[] {
  const dependencies = new Set<string>();
  for (const ref of call.refs ?? []) {
    dependencies.add(addressToStepId(ref, callToStepId));
  }
  for (const argValue of Object.values(call.arguments)) {
    if (typeof argValue === 'string' && ADDRESS_PATTERN.test(argValue)) {
      dependencies.add(addressToStepId(argValue, callToStepId));
    }
  }
  return [...dependencies];
}

export function compileTraceToFunction(
  trace: ExecutionTrace,
  options: CompileOptions
): { definition: FunctionDefinition; fixture: Fixture } {
  const selectedCalls = selectCalls(trace, options.calls);
  const stepIds: string[] = [];
  const usedStepIds = new Set<string>();

  for (const [index, call] of selectedCalls.entries()) {
    assertToolSafe(call.toolId, options.catalog);
    let stepId = makeStepId(call, index);
    while (usedStepIds.has(stepId)) {
      stepId = `${stepId}_${index + 1}`;
    }
    usedStepIds.add(stepId);
    stepIds.push(stepId);
  }

  const callToStepId = new Map<string, string>();
  for (const [index, call] of selectedCalls.entries()) {
    callToStepId.set(call.address, stepIds[index] ?? `step_${index + 1}`);
  }

  const inputValues = new Map<string, unknown>();
  const inputTypes = new Map<string, InputDeclaration['type']>();
  const steps: ExecutionStep[] = [];
  const recordedCalls: SanitizedCall[] = [];
  const requiredTools: string[] = [];
  const toolFingerprints: Record<string, string> = {};

  for (const [index, call] of selectedCalls.entries()) {
    const stepId = stepIds[index] ?? `step_${index + 1}`;
    const args: Record<string, unknown> = {};

    for (const [argName, argValue] of Object.entries(call.arguments)) {
      if (typeof argValue === 'string' && ADDRESS_PATTERN.test(argValue)) {
        args[argName] = `$step.${addressToStepId(argValue, callToStepId)}`;
        continue;
      }

      if (
        argValue !== null &&
        typeof argValue === 'object' &&
        !Array.isArray(argValue)
      ) {
        throw new Error(
          `Nested argument "${argName}" in ${call.address} is not supported in M3`
        );
      }

      if (
        typeof argValue === 'string' ||
        typeof argValue === 'number' ||
        typeof argValue === 'boolean'
      ) {
        const existing = inputValues.get(argName);
        if (existing !== undefined && existing !== argValue) {
          throw new Error(
            `Argument "${argName}" has conflicting values across steps; edit bindings manually after compile`
          );
        }
        inputValues.set(argName, argValue);
        inputTypes.set(argName, inferInputType(argValue));
        args[argName] = `$input.${argName}`;
        continue;
      }

      args[argName] = argValue;
    }

    const dependsOn = collectStepDependencies(call, callToStepId);

    steps.push({
      args,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      id: stepId,
      tool: call.toolId,
    });

    recordedCalls.push({
      arguments: call.arguments,
      output: call.output,
      status: 'succeeded',
      stepId,
      toolFingerprint: call.toolFingerprint,
      toolId: call.toolId,
    });

    if (!requiredTools.includes(call.toolId)) {
      requiredTools.push(call.toolId);
    }
    toolFingerprints[call.toolId] =
      trace.toolFingerprints[call.toolId] ?? call.toolFingerprint;
  }

  const lastStepId = steps.at(-1)?.id;
  if (!lastStepId) {
    throw new Error('No steps compiled');
  }

  const inputs: Record<string, InputDeclaration> = {};
  for (const [name, type] of inputTypes.entries()) {
    inputs[name] = { type };
  }

  const fixtureInput: Record<string, unknown> = {};
  for (const [name, value] of inputValues.entries()) {
    fixtureInput[name] = value;
  }

  const lastCall = selectedCalls.at(-1);
  const definition: FunctionDefinition = {
    apiVersion: 'functhis.dev/v2',
    description:
      options.description ??
      `Compiled from run ${options.sourceRunId} (${selectedCalls.length} steps)`,
    inputs,
    name: options.name,
    plan: {
      output: `$step.${lastStepId}`,
      steps,
      version: 1,
    },
    policy: {
      allowNetwork: 'upstream-only',
      allowedTools: requiredTools,
      maxBytesPerResult: DEFAULT_FUNCTION_RUNTIME.maxOutputBytes,
      maxCalls: steps.length,
      writes: 'deny',
    },
    provenance: {
      createdAt: new Date().toISOString(),
      sourceRunId: options.sourceRunId,
    },
    requiredTools,
    runtime: { ...DEFAULT_FUNCTION_RUNTIME },
    sourcePath: `functions/${options.name}.ts`,
    toolFingerprints,
  };

  const fixture: Fixture = {
    assertions: {
      output: lastCall?.output,
      stepStatuses: steps.map(() => 'succeeded' as const),
    },
    containsSecrets: false,
    input: fixtureInput,
    recordedCalls,
    version: 1,
  };

  return { definition, fixture };
}

export { getSuccessfulPath } from '../trace/path';
