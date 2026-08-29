import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { schemaHash } from '../catalog/fingerprint';
import type { GraphService } from '../graph/service';
import { classifyPackageWrites } from '../packages/capabilities';
import { loadPackage } from '../packages/save';
import type { PackageLock, PackageManifest } from '../packages/schema';
import { packageLockSchema } from '../packages/schema';
import {
  promoteStagedPackage,
  quarantineStagedPackage,
  stagePackage,
} from '../packages/stage';
import { testFunction } from '../packages/test';
import { loadSettings } from '../storage/settings';
import { detectCandidates } from '../trace/candidates';
import { compileTrace } from '../trace/compile';
import { analyzeDataflow } from '../trace/dataflow';
import type { ExecutionTrace } from '../trace/schema';
import { loadTrace } from '../trace/store';
import type { UpstreamManager } from '../upstream/manager';
import { isLearningPaused } from './control';
import { createLearningJob, updateLearningJob } from './jobs';
import { evaluateAutonomousPolicy } from './policy';
import {
  findJobByCandidate,
  hasCrystallizedCandidate,
  loadLearningState,
  markCandidateCrystallized,
  saveLearningState,
  upsertJob,
} from './state';

export interface AutonomousLearningDeps {
  configDir: string;
  graph?: GraphService;
  manager: UpstreamManager;
  onPackageSaved?: (name: string) => Promise<void>;
  packagesDir: string;
}

export interface AutonomousLearningResult {
  candidateId: string;
  name: string;
  reason?: string;
  runId: string;
  saved: boolean;
  status: 'promoted' | 'quarantined' | 'skipped';
  verified: boolean;
}

const DEFAULT_MIN_OCCURRENCES = 2;

function packageNameFromSequence(sequence: string[]): string {
  const parts = sequence
    .map((toolId) => toolId.split('.').pop() ?? toolId)
    .join('-')
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return `auto-${parts || 'flow'}`.slice(0, 48);
}

async function resolveUniquePackageName(
  packagesDir: string,
  baseName: string
): Promise<string> {
  let candidate = baseName;
  let suffix = 2;
  while (true) {
    try {
      await access(join(packagesDir, candidate, 'functhis.json'));
      candidate = `${baseName}-${suffix}`;
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

function extractReplayInput(
  trace: ExecutionTrace,
  suggestedInputs: string[]
): Record<string, unknown> {
  const analysis = analyzeDataflow(trace);
  const input: Record<string, unknown> = {};
  for (const call of analysis.calls) {
    for (const arg of call.arguments) {
      if (
        arg.classification === 'input' &&
        suggestedInputs.includes(arg.key) &&
        arg.valuePreview
      ) {
        try {
          input[arg.key] = JSON.parse(arg.valuePreview);
        } catch {
          // skip non-json previews
        }
      }
    }
  }
  return input;
}

function upstreamCallCount(trace: ExecutionTrace): number {
  return analyzeDataflow(trace).toolSequence.length;
}

function buildLock(
  manager: UpstreamManager,
  allowedTools: string[]
): PackageLock {
  const lockTools: PackageLock['tools'] = {};
  for (const toolId of allowedTools) {
    const tool = manager.catalog.getTool(toolId);
    if (!tool) {
      throw new Error(`Cannot save package: unknown tool ${toolId}`);
    }
    const dot = toolId.indexOf('.');
    lockTools[toolId] = {
      name: tool.name,
      schemaHash: schemaHash(tool.inputSchema),
      server: dot === -1 ? tool.serverId : toolId.slice(0, dot),
    };
  }
  return packageLockSchema.parse({ tools: lockTools, version: 1 });
}

async function quarantineCandidate(
  deps: AutonomousLearningDeps,
  input: {
    candidateId: string;
    name: string;
    reason: string;
    runId: string;
  }
): Promise<AutonomousLearningResult> {
  let state = await loadLearningState(deps.configDir);
  state = markCandidateCrystallized(state, {
    candidateId: input.candidateId,
    name: input.name,
    runId: input.runId,
    status: 'quarantined',
  });
  const existing = findJobByCandidate(state, input.candidateId);
  const job = updateLearningJob(
    existing ??
      createLearningJob({
        candidateFingerprint: input.candidateId,
        candidateId: input.candidateId,
        runId: input.runId,
      }),
    {
      error: input.reason,
      name: input.name,
      status: 'quarantined',
    }
  );
  state = upsertJob(state, job);
  await saveLearningState(deps.configDir, state);

  return {
    candidateId: input.candidateId,
    name: input.name,
    reason: input.reason,
    runId: input.runId,
    saved: false,
    status: 'quarantined',
    verified: false,
  };
}

export async function processAutonomousLearning(
  deps: AutonomousLearningDeps,
  trace: ExecutionTrace
): Promise<AutonomousLearningResult[]> {
  if (await isLearningPaused(deps.configDir)) {
    return [];
  }

  const settings = await loadSettings(deps.configDir);
  const learning = settings.learning;
  if (learning?.enabled === false) {
    return [];
  }

  if (trace.status !== 'succeeded' || upstreamCallCount(trace) < 2) {
    return [];
  }

  const minOccurrences = learning?.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const candidates = await detectCandidates(deps.configDir, {
    limit: 50,
    minOccurrences,
  });

  const results: AutonomousLearningResult[] = [];

  for (const candidate of candidates) {
    if (!candidate.runIds.includes(trace.id)) {
      continue;
    }

    let state = await loadLearningState(deps.configDir);
    if (hasCrystallizedCandidate(state, candidate.id)) {
      results.push({
        candidateId: candidate.id,
        name: packageNameFromSequence(candidate.toolSequence),
        reason: 'Already crystallized',
        runId: trace.id,
        saved: true,
        status: 'skipped',
        verified: true,
      });
      continue;
    }

    const runId = candidate.runIds.at(-1) ?? trace.id;
    const baseName = packageNameFromSequence(candidate.toolSequence);
    const name = await resolveUniquePackageName(deps.packagesDir, baseName);

    let job =
      findJobByCandidate(state, candidate.id) ??
      createLearningJob({
        candidateFingerprint: candidate.id,
        candidateId: candidate.id,
        runId,
      });
    job = updateLearningJob(job, { name, status: 'candidate' });
    state = upsertJob(state, job);
    await saveLearningState(deps.configDir, state);

    let brief;
    try {
      brief = await compileTrace(deps.configDir, runId, {
        description: `Autonomously learned from repeated flow (${candidate.toolSequence.join(' → ')})`,
        name,
      });
      job = updateLearningJob(job, { status: 'compiled' });
    } catch (error) {
      results.push(
        await quarantineCandidate(deps, {
          candidateId: candidate.id,
          name,
          reason: error instanceof Error ? error.message : String(error),
          runId,
        })
      );
      continue;
    }

    const policy = evaluateAutonomousPolicy(
      deps.manager,
      brief.allowedTools,
      learning
    );
    job = updateLearningJob(job, { status: 'policy_evaluated' });
    state = upsertJob(state, job);
    await saveLearningState(deps.configDir, state);

    if (policy.decision === 'quarantine') {
      results.push(
        await quarantineCandidate(deps, {
          candidateId: candidate.id,
          name,
          reason: policy.reason ?? 'Policy denied autonomous promotion',
          runId,
        })
      );
      continue;
    }

    const sourceTrace = await loadTrace(deps.configDir, runId);
    const replayInput = extractReplayInput(sourceTrace, brief.suggestedInputs);
    const verification = await testFunction(deps.manager, {
      allowedTools: brief.allowedTools,
      approveWrites: policy.writes === 'review-required',
      compiledFrom: runId,
      configDir: deps.configDir,
      input: replayInput,
      inputSchema: brief.inputSchema,
      mode: 'replay',
      name,
      source: brief.skeleton,
    });

    if (verification.status !== 'verified locally') {
      results.push(
        await quarantineCandidate(deps, {
          candidateId: candidate.id,
          name,
          reason: `Verification failed: ${verification.status}`,
          runId,
        })
      );
      continue;
    }

    job = updateLearningJob(job, { status: 'verified' });
    state = upsertJob(state, job);
    await saveLearningState(deps.configDir, state);

    const writes =
      policy.writes === 'review-required'
        ? 'review-required'
        : classifyPackageWrites(deps.manager, brief.allowedTools);

    const manifest: PackageManifest = {
      autonomousOrigin: true,
      capabilities: { tools: brief.allowedTools, writes },
      compiledFrom: runId,
      description: brief.description,
      entrypoint: 'function.ts',
      inputSchema: brief.inputSchema,
      name,
      runtime: {
        execution: 'sandbox',
        maxCalls: 20,
        maxOutputBytes: 6 * 1024,
        timeoutMs: 30_000,
      },
    };

    const lock = buildLock(deps.manager, brief.allowedTools);
    const analysis = analyzeDataflow(sourceTrace);
    const replayFixture = {
      compiledFrom: runId,
      input: replayInput,
      output: sourceTrace.calls.find(
        (call) => call.address === analysis.finalOutputAddress
      )?.output,
      toolSequence: analysis.toolSequence,
    };

    let stageDir: string;
    try {
      stageDir = await stagePackage(deps.packagesDir, {
        functionSource: brief.skeleton,
        lock,
        manifest,
        replayFixture,
      });
      job = updateLearningJob(job, { status: 'staged' });
    } catch (error) {
      results.push(
        await quarantineCandidate(deps, {
          candidateId: candidate.id,
          name,
          reason: error instanceof Error ? error.message : String(error),
          runId,
        })
      );
      continue;
    }

    try {
      const packageDir = await promoteStagedPackage(
        deps.packagesDir,
        stageDir,
        'active'
      );
      const { lock: savedLock, manifest: savedManifest } =
        await loadPackage(packageDir);
      deps.graph?.indexFunction(savedManifest, savedLock, {
        compiledFrom: runId,
        packageDir,
      });
      await deps.onPackageSaved?.(name);

      state = await loadLearningState(deps.configDir);
      state = markCandidateCrystallized(state, {
        candidateId: candidate.id,
        name,
        runId,
        status: 'promoted',
      });
      job = updateLearningJob(job, {
        packageName: name,
        status: 'promoted',
      });
      state = upsertJob(state, job);
      await saveLearningState(deps.configDir, state);

      results.push({
        candidateId: candidate.id,
        name,
        runId,
        saved: true,
        status: 'promoted',
        verified: true,
      });
    } catch (error) {
      await quarantineStagedPackage(
        deps.packagesDir,
        stageDir,
        error instanceof Error ? error.message : String(error)
      );
      results.push(
        await quarantineCandidate(deps, {
          candidateId: candidate.id,
          name,
          reason: error instanceof Error ? error.message : String(error),
          runId,
        })
      );
    }
  }

  return results;
}
