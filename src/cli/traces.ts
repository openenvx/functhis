import { resolveConfigDir } from '../storage/paths';
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
