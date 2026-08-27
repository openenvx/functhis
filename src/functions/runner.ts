import type { ToolCatalog } from '../catalog/index';
import { shapeCallResult } from '../output';
import { assertToolAllowed, isToolAllowed } from '../policy/access';
import type { UpstreamManager } from '../upstream/manager';
import { assertNoDrift, checkDrift } from './drift';
import { resolveArgs, resolveTemplate } from './interpolate';
import {
  canParallelizeWave,
  planExecutionWaves,
  resolveStepDependencies,
} from './plan';
import type {
  ExecuteFunctionOptions,
  Fixture,
  FunctionDefinition,
  FunctionResult,
  TestReport,
} from './schema';
import { applyJmesPath, isJmesPathOutput } from './select';

const DEFAULT_MAX_CONCURRENCY = 4;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function estimateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8');
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Function run was cancelled');
  }
}

function validateDefinitionPolicy(
  definition: FunctionDefinition,
  options: ExecuteFunctionOptions
): void {
  if (
    definition.policy.writes === 'review-required' &&
    !options.approveWrites
  ) {
    throw new Error(
      'Function requires write approval. Re-run with --approve-writes or set policy.writes to "deny".'
    );
  }
  if (definition.plan.steps.length > definition.policy.maxCalls) {
    throw new Error('Function exceeds policy maxCalls');
  }
  for (const step of definition.plan.steps) {
    if (!definition.policy.allowedTools.includes(step.tool)) {
      throw new Error(`Step "${step.id}" uses disallowed tool "${step.tool}"`);
    }
  }
}

function resolvePlanOutput(
  template: string,
  context: { input: Record<string, unknown>; steps: Record<string, unknown> }
): unknown {
  if (template.startsWith('$')) {
    return resolveTemplate(template, context);
  }
  if (isJmesPathOutput(template)) {
    return applyJmesPath(context, template);
  }
  return template;
}

async function executeStep(
  step: FunctionDefinition['plan']['steps'][number],
  definition: FunctionDefinition,
  input: Record<string, unknown>,
  stepResults: Record<string, unknown>,
  manager: UpstreamManager,
  options: ExecuteFunctionOptions,
  budgets: { totalBytes: number }
): Promise<void> {
  assertNotCancelled(options.signal);

  const tool = manager.catalog.getTool(step.tool);
  if (!tool) {
    throw new Error(`Unknown tool "${step.tool}"`);
  }

  const accessPolicy = {
    denyUnknown: true,
    denyWrite:
      definition.policy.writes === 'deny' ||
      (definition.policy.writes === 'review-required' &&
        !options.approveWrites),
  };
  if (!isToolAllowed(tool, accessPolicy)) {
    assertToolAllowed(tool, accessPolicy);
  }

  const resolvedArgs = resolveArgs(step.args, { input, steps: stepResults });
  const maxAttempts =
    step.retry?.mode === 'safe-idempotent' && tool.risk === 'read'
      ? (step.retry.maxAttempts ?? 1)
      : 1;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertNotCancelled(options.signal);
    try {
      const rawResult = await manager.callTool(step.tool, resolvedArgs, {
        signal: options.signal,
        timeoutMs: step.timeoutMs,
      });
      const shapedResult = shapeCallResult(
        rawResult,
        definition.runtime.maxOutputBytes
      );
      const shaped = step.select
        ? applyJmesPath(shapedResult.output, step.select)
        : shapedResult.output;
      budgets.totalBytes += estimateBytes(shaped);
      const maxTotal =
        definition.runtime.maxTotalOutputBytes ??
        definition.runtime.maxOutputBytes * 8;
      if (budgets.totalBytes > maxTotal) {
        throw new Error(
          `Function exceeded max total output bytes (${maxTotal})`
        );
      }
      stepResults[step.id] = shaped;
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxAttempts) {
        throw lastError;
      }
    }
  }
}

export async function executeFunction(
  definition: FunctionDefinition,
  input: Record<string, unknown>,
  manager: UpstreamManager,
  options: ExecuteFunctionOptions = {}
): Promise<FunctionResult> {
  validateDefinitionPolicy(definition, options);
  assertNoDrift(definition, manager.catalog);

  const startedAt = Date.now();
  const stepResults: Record<string, unknown> = {};
  const budgets = { totalBytes: 0 };
  const planned = resolveStepDependencies(definition.plan.steps);
  const waves = planExecutionWaves(planned);
  const maxConcurrency =
    definition.runtime.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  for (const wave of waves) {
    if (Date.now() - startedAt > definition.runtime.maxDurationMs) {
      throw new Error(
        `Function exceeded max duration (${definition.runtime.maxDurationMs}ms)`
      );
    }
    assertNotCancelled(options.signal);

    const parallel = canParallelizeWave(
      wave,
      definition.policy.writes,
      (toolId) => manager.catalog.getTool(toolId)?.risk
    );

    if (parallel && wave.length > 1) {
      const chunkSize = Math.min(maxConcurrency, wave.length);
      for (let index = 0; index < wave.length; index += chunkSize) {
        const chunk = wave.slice(index, index + chunkSize);
        await Promise.all(
          chunk.map((step) =>
            executeStep(
              step,
              definition,
              input,
              stepResults,
              manager,
              options,
              budgets
            )
          )
        );
      }
    } else {
      for (const step of wave) {
        await executeStep(
          step,
          definition,
          input,
          stepResults,
          manager,
          options,
          budgets
        );
      }
    }
  }

  const output = resolvePlanOutput(definition.plan.output, {
    input,
    steps: stepResults,
  });

  return { output, stepResults };
}

export async function runFunction(
  definition: FunctionDefinition,
  input: Record<string, unknown>,
  manager: UpstreamManager,
  options?: ExecuteFunctionOptions
): Promise<FunctionResult> {
  return executeFunction(definition, input, manager, options);
}

export async function testFunction(
  definition: FunctionDefinition,
  fixture: Fixture,
  manager: UpstreamManager,
  repeats = 1
): Promise<TestReport> {
  const failures: string[] = [];
  const drift = checkDrift(definition, manager.catalog);

  if (!drift.ok) {
    return {
      drift,
      failures: drift.issues.map((issue) => `drift: ${issue}`),
      passed: false,
      repeats,
    };
  }

  for (let attempt = 0; attempt < repeats; attempt += 1) {
    try {
      const result = await executeFunction(definition, fixture.input, manager);

      if (fixture.assertions?.output !== undefined) {
        if (!deepEqual(result.output, fixture.assertions.output)) {
          failures.push(
            `repeat ${attempt + 1}: output mismatch (expected fixture assertion)`
          );
        }
      }

      const expectedSteps = fixture.assertions?.stepStatuses?.length ?? 0;
      if (
        expectedSteps > 0 &&
        Object.keys(result.stepResults).length !== expectedSteps
      ) {
        failures.push(
          `repeat ${attempt + 1}: expected ${expectedSteps} step results, got ${Object.keys(result.stepResults).length}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`repeat ${attempt + 1}: ${message}`);
    }
  }

  return {
    drift,
    failures,
    passed: failures.length === 0,
    repeats,
  };
}

export function assertCatalogReady(
  definition: FunctionDefinition,
  catalog: ToolCatalog
): void {
  assertNoDrift(definition, catalog);
}
