import { resolveConfigDir } from '../storage/paths';
import { compileCandidateGroup, detectCandidates } from '../trace/candidates';
import { compileTrace } from '../trace/compile';
import { formatInspectReport, formatTraceListReport } from '../trace/inspect';

export async function runTracesList(options?: {
  dir?: string;
  limit?: number;
}): Promise<string> {
  const configDir = resolveConfigDir(options?.dir);
  return formatTraceListReport(configDir, options?.limit ?? 20);
}

export async function runTracesInspect(options: {
  dir?: string;
  runId: string;
}): Promise<string> {
  const configDir = resolveConfigDir(options.dir);
  return formatInspectReport(options.runId, configDir);
}

export async function runTracesCompile(options: {
  description?: string;
  dir?: string;
  name: string;
  runId: string;
}): Promise<string> {
  const configDir = resolveConfigDir(options.dir);
  const brief = await compileTrace(configDir, options.runId, {
    description: options.description,
    name: options.name,
  });
  return JSON.stringify(brief, null, 2);
}

export async function runTracesCandidates(options?: {
  dir?: string;
  limit?: number;
  minOccurrences?: number;
}): Promise<string> {
  const configDir = resolveConfigDir(options?.dir);
  const candidates = await detectCandidates(configDir, {
    limit: options?.limit ?? 20,
    minOccurrences: options?.minOccurrences,
  });
  return JSON.stringify({ candidates, total: candidates.length }, null, 2);
}

export async function runTracesCompileGroup(options: {
  candidateId: string;
  description?: string;
  dir?: string;
  name: string;
}): Promise<string> {
  const configDir = resolveConfigDir(options.dir);
  const result = await compileCandidateGroup(configDir, options.candidateId, {
    description: options.description,
    name: options.name,
  });
  return JSON.stringify(result, null, 2);
}
