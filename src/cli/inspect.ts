import { resolveConfigDir } from '../storage/paths';
import { formatInspectReport } from '../trace/inspect';

export { formatInspectReport } from '../trace/inspect';

export async function runInspect(options: {
  runId: string;
  dir?: string;
}): Promise<string> {
  const configDir = resolveConfigDir(options.dir);
  return formatInspectReport(options.runId, configDir);
}
