import * as z from 'zod/v4';

export const PACKAGE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/u;

export const packageCapabilitiesSchema = z.object({
  repo: z.enum(['none', 'read']).default('none'),
  tools: z.array(z.string()).min(1),
  writes: z.enum(['deny', 'review-required']).default('deny'),
});

export const packageRuntimeSchema = z.object({
  functhis: z.string().default('>=0.2.0'),
  maxCalls: z.number().int().positive().default(20),
  maxOutputBytes: z.number().int().positive().default(6 * 1024),
  timeoutMs: z.number().int().positive().default(30_000),
});

export const packageManifestSchema = z.object({
  apiVersion: z.literal('functhis.dev/v1'),
  capabilities: packageCapabilitiesSchema,
  description: z.string(),
  entrypoint: z.string().default('function.ts'),
  inputSchema: z.record(z.string(), z.unknown()),
  name: z.string().regex(PACKAGE_NAME_PATTERN),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  runtime: packageRuntimeSchema,
});

export const packageLockEntrySchema = z.object({
  name: z.string(),
  schemaHash: z.string(),
  server: z.string(),
});

export const packageLockSchema = z.object({
  tools: z.record(z.string(), packageLockEntrySchema),
  version: z.literal(1),
});

export type PackageManifest = z.infer<typeof packageManifestSchema>;
export type PackageLock = z.infer<typeof packageLockSchema>;

export interface SavedPackage {
  dir: string;
  lock: PackageLock;
  manifest: PackageManifest;
  source: string;
}

export interface LockDriftIssue {
  kind: 'missing' | 'schema-changed';
  message: string;
  toolId: string;
}

export interface LockInspection {
  issues: LockDriftIssue[];
  ok: boolean;
}
