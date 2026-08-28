import { createHash } from 'node:crypto';

import { compileTrace } from './compile';
import type { CompileBrief } from './compile';
import { analyzeDataflow } from './dataflow';
import type { ExecutionTrace } from './schema';
import { listTraces } from './store';

const DEFAULT_MIN_OCCURRENCES = 2;

export interface TraceCandidate {
  id: string;
  occurrenceCount: number;
  runIds: string[];
  schemaFingerprints: string[];
  signals: {
    normalizedSequence: string;
    sharedInputShape: boolean;
    sharedToolFingerprints: boolean;
  };
  similarInputKeys: string[];
  toolSequence: string[];
}

export interface CandidateCompileResult {
  candidateId: string;
  occurrenceCount: number;
  suggestions: { brief: CompileBrief; runId: string }[];
  toolSequence: string[];
  warnings: string[];
}

function hashSignature(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function upstreamSequence(trace: ExecutionTrace): string[] {
  return analyzeDataflow(trace).toolSequence;
}

function inputKeysForTrace(trace: ExecutionTrace): string[] {
  const analysis = analyzeDataflow(trace);
  const keys = new Set<string>();
  for (const call of analysis.calls) {
    for (const arg of call.arguments) {
      if (arg.classification === 'input') {
        keys.add(arg.key);
      }
    }
  }
  return [...keys].sort();
}

function fingerprintSignature(
  trace: ExecutionTrace,
  sequence: string[]
): string {
  return sequence
    .map((toolId) => trace.toolFingerprints[toolId] ?? 'unknown')
    .join('|');
}

export async function detectCandidates(
  configDir: string,
  options: { limit?: number; minOccurrences?: number } = {}
): Promise<TraceCandidate[]> {
  const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const traces = await listTraces(configDir);
  const groups = new Map<
    string,
    {
      fingerprints: Set<string>;
      inputShapes: Set<string>;
      runIds: string[];
      toolSequence: string[];
    }
  >();

  for (const trace of traces) {
    if (trace.status !== 'succeeded') {
      continue;
    }
    const sequence = upstreamSequence(trace);
    if (sequence.length === 0) {
      continue;
    }

    const signature = sequence.join('→');
    const group = groups.get(signature) ?? {
      fingerprints: new Set<string>(),
      inputShapes: new Set<string>(),
      runIds: [],
      toolSequence: sequence,
    };
    group.runIds.push(trace.id);
    group.inputShapes.add(inputKeysForTrace(trace).join(','));
    group.fingerprints.add(fingerprintSignature(trace, sequence));
    groups.set(signature, group);
  }

  const candidates: TraceCandidate[] = [];
  for (const [signature, group] of groups) {
    if (group.runIds.length < minOccurrences) {
      continue;
    }

    const inputShapes = [...group.inputShapes].filter(
      (shape) => shape.length > 0
    );
    candidates.push({
      id: `cand-${hashSignature(signature)}`,
      occurrenceCount: group.runIds.length,
      runIds: group.runIds,
      schemaFingerprints: [...group.fingerprints],
      signals: {
        normalizedSequence: signature,
        sharedInputShape: inputShapes.length <= 1,
        sharedToolFingerprints: group.fingerprints.size <= 1,
      },
      similarInputKeys: inputShapes,
      toolSequence: group.toolSequence,
    });
  }

  return candidates
    .sort((left, right) => right.occurrenceCount - left.occurrenceCount)
    .slice(0, options.limit ?? 20);
}

export async function findCandidate(
  configDir: string,
  candidateId: string
): Promise<TraceCandidate | undefined> {
  const candidates = await detectCandidates(configDir, { limit: 200 });
  return candidates.find((candidate) => candidate.id === candidateId);
}

export async function compileCandidateGroup(
  configDir: string,
  candidateId: string,
  options: { description?: string; name: string }
): Promise<CandidateCompileResult> {
  const candidate = await findCandidate(configDir, candidateId);
  if (!candidate) {
    throw new Error(
      `Unknown candidate "${candidateId}". Run fn_candidates first.`
    );
  }

  const suggestions: CandidateCompileResult['suggestions'] = [];
  for (const runId of candidate.runIds) {
    const brief = await compileTrace(configDir, runId, {
      description: options.description,
      name: options.name,
    });
    suggestions.push({ brief, runId });
  }

  return {
    candidateId,
    occurrenceCount: candidate.occurrenceCount,
    suggestions,
    toolSequence: candidate.toolSequence,
    warnings: [
      'Suggestions only — review each brief before saving. Functhis does not auto-save compiled functions.',
    ],
  };
}
