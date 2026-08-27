import * as z from 'zod/v4';

import { DEFAULT_MAX_OUTPUT_BYTES } from '../output';
import { WHOLE_RUN_DEADLINE_MS } from '../trace/recorder';
import { FUNCTION_NAME_PATTERN } from './paths';

export const inputDeclarationSchema = z.object({
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean']),
});

export const executionStepRetrySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5),
  mode: z.enum(['none', 'safe-idempotent']),
});

export const executionStepSchema = z.object({
  args: z.record(z.string(), z.unknown()),
  dependsOn: z.array(z.string()).optional(),
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/u),
  retry: executionStepRetrySchema.optional(),
  select: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  tool: z.string().min(1),
});

export const executionPlanSchema = z.object({
  output: z.string().min(1),
  steps: z.array(executionStepSchema).min(1),
  version: z.literal(1),
});

export const functionAccessPolicySchema = z.object({
  allowNetwork: z.literal('upstream-only'),
  allowedTools: z.array(z.string()).min(1),
  maxBytesPerResult: z.number().int().positive(),
  maxCalls: z.number().int().positive(),
  writes: z.enum(['deny', 'review-required']),
});

export const functionDefinitionSchema = z.object({
  apiVersion: z.literal('functhis.dev/v2'),
  description: z.string(),
  inputs: z.record(z.string(), inputDeclarationSchema),
  name: z.string().regex(FUNCTION_NAME_PATTERN),
  plan: executionPlanSchema,
  policy: functionAccessPolicySchema,
  provenance: z.object({
    createdAt: z.string(),
    sourceRunId: z.string(),
  }),
  requiredTools: z.array(z.string()).min(1),
  runtime: z.object({
    maxConcurrency: z.number().int().positive().max(8).optional(),
    maxDurationMs: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    maxTotalOutputBytes: z.number().int().positive().optional(),
  }),
  sourcePath: z.string(),
  toolFingerprints: z.record(z.string(), z.string()),
});

export const sanitizedCallSchema = z.object({
  arguments: z.record(z.string(), z.unknown()),
  output: z.unknown().optional(),
  status: z.literal('succeeded'),
  stepId: z.string(),
  toolFingerprint: z.string(),
  toolId: z.string(),
});

export const fixtureSchema = z.object({
  assertions: z
    .object({
      output: z.unknown().optional(),
      stepStatuses: z.array(z.literal('succeeded')).optional(),
    })
    .optional(),
  containsSecrets: z.literal(false),
  input: z.record(z.string(), z.unknown()),
  recordedCalls: z.array(sanitizedCallSchema),
  version: z.literal(1),
});

export type InputDeclaration = z.infer<typeof inputDeclarationSchema>;
export type ExecutionStep = z.infer<typeof executionStepSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type FunctionAccessPolicy = z.infer<typeof functionAccessPolicySchema>;
export type FunctionDefinition = z.infer<typeof functionDefinitionSchema>;
export type SanitizedCall = z.infer<typeof sanitizedCallSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;

export const DEFAULT_FUNCTION_RUNTIME = {
  maxConcurrency: 1,
  maxDurationMs: WHOLE_RUN_DEADLINE_MS,
  maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  maxTotalOutputBytes: DEFAULT_MAX_OUTPUT_BYTES * 8,
} as const;

export interface TestReport {
  drift?: {
    issues: {
      kind:
        | 'missing'
        | 'schema-changed'
        | 'description-changed'
        | 'missing-fingerprint';
      message: string;
      toolId: string;
    }[];
    ok: boolean;
  };
  failures: string[];
  passed: boolean;
  repeats: number;
}

export interface FunctionResult {
  output: unknown;
  stepResults: Record<string, unknown>;
}

export interface ExecuteFunctionOptions {
  approveWrites?: boolean;
  signal?: AbortSignal;
}

function inputTypeToZod(
  declaration: InputDeclaration
): z.ZodString | z.ZodNumber | z.ZodBoolean {
  switch (declaration.type) {
    case 'number': {
      return z.number();
    }
    case 'boolean': {
      return z.boolean();
    }
    default: {
      return z.string();
    }
  }
}

export function functionInputsToZod(
  inputs: Record<string, InputDeclaration>
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, declaration] of Object.entries(inputs)) {
    let fieldSchema: z.ZodType = inputTypeToZod(declaration);
    if (declaration.description) {
      fieldSchema = fieldSchema.describe(declaration.description);
    }
    shape[name] = fieldSchema;
  }
  return z.object(shape).strict();
}

export function functionInputsToJsonSchema(
  inputs: Record<string, InputDeclaration>
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, declaration] of Object.entries(inputs)) {
    properties[name] = {
      type: declaration.type,
      ...(declaration.description
        ? { description: declaration.description }
        : {}),
    };
    required.push(name);
  }

  return {
    additionalProperties: false,
    properties,
    required,
    type: 'object',
  };
}
