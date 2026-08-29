import { createHash } from 'node:crypto';

import { compileTrace } from './compile';
import type { CompileBrief } from './compile';
import { analyzeDataflow } from './dataflow';
import type { ExecutionTrace } from './schema';
import { listTraces } from './store';

const DEFAULT_MIN_OCCURRENCES = 2;

export type CandidateMatchKind = 'exact' | 'normalized';

export interface TraceCandidate {
  id: string;
  occurrenceCount: number;
  runIds: string[];
  schemaFingerprints: string[];
  signals: {
    matchKind: CandidateMatchKind;
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

function normalizeSequence(sequence: string[]): string[] {
  const normalized: string[] = [];
  for (const toolId of sequence) {
    if (normalized.at(-1) !== toolId) {
      normalized.push(toolId);
    }
  }
  return normalized;
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

function pickRepresentativeSequence(sequences: string[][]): string[] {
  const counts = new Map<string, { count: number; sequence: string[] }>();
  for (const sequence of sequences) {
    const key = sequence.join('→');
    const entry = counts.get(key) ?? { count: 0, sequence };
    entry.count += 1;
    counts.set(key, entry);
  }

  return (
    [...counts.values()].sort((left, right) => right.count - left.count)[0]
      ?.sequence ??
    sequences[0] ??
    []
  );
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
      exactSignatures: Set<string>;
      fingerprints: Set<string>;
      inputShapes: Set<string>;
      runIds: string[];
      sequences: string[][];
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

    const exactSignature = sequence.join('→');
    const normalized = normalizeSequence(sequence);
    const normalizedSignature = normalized.join('→');
    const groupKey = normalizedSignature;

    const group = groups.get(groupKey) ?? {
      exactSignatures: new Set<string>(),
      fingerprints: new Set<string>(),
      inputShapes: new Set<string>(),
      runIds: [],
      sequences: [],
    };
    group.runIds.push(trace.id);
    group.sequences.push(sequence);
    group.exactSignatures.add(exactSignature);
    group.inputShapes.add(inputKeysForTrace(trace).join(','));
    group.fingerprints.add(fingerprintSignature(trace, sequence));
    groups.set(groupKey, group);
  }

  const candidates: TraceCandidate[] = [];
  for (const [signature, group] of groups) {
    if (group.runIds.length < minOccurrences) {
      continue;
    }

    const inputShapes = [...group.inputShapes].filter(
      (shape) => shape.length > 0
    );
    const matchKind: CandidateMatchKind =
      group.exactSignatures.size === 1 ? 'exact' : 'normalized';

    candidates.push({
      id: `cand-${hashSignature(signature)}`,
      occurrenceCount: group.runIds.length,
      runIds: group.runIds,
      schemaFingerprints: [...group.fingerprints],
      signals: {
        matchKind,
        normalizedSequence: signature,
        sharedInputShape: inputShapes.length <= 1,
        sharedToolFingerprints: group.fingerprints.size <= 1,
      },
      similarInputKeys: inputShapes,
      toolSequence: pickRepresentativeSequence(group.sequences),
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
      'Functhis autonomously crystallizes read-only candidate groups when they repeat. Manual saves still work via fn_save_function.',
    ],
  };
}
