import { crystallizeRun } from '../functions/crystallize';
import type { CrystallizeResult } from '../functions/crystallize';
import { getFunctionsDir } from '../functions/paths';
import { resolveConfigDir } from '../storage/paths';

export type ThisResult = CrystallizeResult;

export { crystallizeRun } from '../functions/crystallize';

export async function runThis(options: {
  runId: string;
  name: string;
  dir?: string;
  functionsDir?: string;
  calls?: string[];
  description?: string;
  force?: boolean;
}): Promise<CrystallizeResult> {
  const configDir = resolveConfigDir(options.dir);
  const functionsRoot = getFunctionsDir(process.cwd(), options.functionsDir);
  return crystallizeRun({
    calls: options.calls,
    configDir,
    description: options.description,
    force: options.force,
    functionsDir: functionsRoot,
    name: options.name,
    runId: options.runId,
  });
}

export function formatThisReport(result: CrystallizeResult): string {
  return result.report;
}
