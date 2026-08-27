import type { FnbenchCase } from '../../fixtures/benchmark/cases';
import { generateFunctionSource } from '../../src/functions/generate';
import { DEFAULT_FUNCTION_RUNTIME } from '../../src/functions/schema';
import type { FunctionDefinition } from '../../src/functions/schema';
import { runFunction } from '../../src/functions/runner';
import { loadConfig } from '../../src/storage/config';
import { UpstreamManager } from '../../src/upstream/manager';
import { deepEqualJson } from './oracle';

function buildFunctionDefinition(
  caseDef: FnbenchCase,
  fingerprint: string,
  name: string
): FunctionDefinition {
  return {
    apiVersion: 'functhis.dev/v2',
    description: `Benchmark replay for ${caseDef.id}`,
    inputs: {},
    name,
    plan: {
      output: '$step.fetch',
      steps: [
        {
          args: {},
          id: 'fetch',
          select: caseDef.replaySelect,
          tool: caseDef.upstreamId,
        },
      ],
      version: 1,
    },
    policy: {
      allowNetwork: 'upstream-only',
      allowedTools: [caseDef.upstreamId],
      maxBytesPerResult: 262_144,
      maxCalls: 1,
      writes: 'deny',
    },
    provenance: {
      createdAt: new Date().toISOString(),
      sourceRunId: 'benchmark-replay',
    },
    requiredTools: [caseDef.upstreamId],
    runtime: DEFAULT_FUNCTION_RUNTIME,
    sourcePath: `functions/${name}.ts`,
    toolFingerprints: {
      [caseDef.upstreamId]: fingerprint,
    },
  };
}

export function buildReplayDefinition(
  caseDef: FnbenchCase,
  fingerprint: string
): FunctionDefinition {
  return buildFunctionDefinition(
    caseDef,
    fingerprint,
    `replay_${caseDef.id.replaceAll('-', '_')}`
  );
}

export function buildBenchmarkFunctionDefinition(
  caseDef: FnbenchCase,
  fingerprint: string
): FunctionDefinition {
  return buildFunctionDefinition(caseDef, fingerprint, caseDef.id);
}

export function benchmarkFunctionSource(
  caseDef: FnbenchCase,
  fingerprint: string
): string {
  return generateFunctionSource(
    buildBenchmarkFunctionDefinition(caseDef, fingerprint)
  );
}

export async function runReplayCase(
  caseDef: FnbenchCase,
  configPath: string
): Promise<{ latencyMs: number; passed: boolean; error?: string }> {
  const config = await loadConfig(configPath);
  const manager = new UpstreamManager();
  const startMs = performance.now();
  try {
    await manager.connectAll(config.upstreams);
    const tool = manager.catalog.getTool(caseDef.upstreamId);
    if (!tool) {
      return {
        error: `Tool not found: ${caseDef.upstreamId}`,
        latencyMs: performance.now() - startMs,
        passed: false,
      };
    }
    const definition = buildReplayDefinition(caseDef, tool.fingerprint);
    const result = await runFunction(definition, {}, manager);
    return {
      latencyMs: performance.now() - startMs,
      passed: deepEqualJson(result.output, caseDef.oracle),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: message,
      latencyMs: performance.now() - startMs,
      passed: false,
    };
  } finally {
    await manager.closeAll();
  }
}
