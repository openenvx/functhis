import { GraphService } from '../graph/service';
import type { IndexReport } from '../graph/types';
import { resolveConfigDir } from '../storage/paths';

export interface RunIndexOptions {
  dir?: string;
  force?: boolean;
  include?: string[];
  root?: string;
}

export async function runIndex(
  options: RunIndexOptions = {}
): Promise<{ report: IndexReport; configDir: string }> {
  const configDir = resolveConfigDir(options.dir);
  const graph = new GraphService(configDir);
  try {
    const report = graph.indexRepo({
      force: options.force,
      include: options.include ?? ['src'],
      root: options.root,
    });
    return { configDir, report };
  } finally {
    graph.close();
  }
}

export function formatIndexReport(report: IndexReport): string {
  return [
    `Indexed ${report.filesIndexed} file(s), skipped ${report.filesSkipped}, removed ${report.filesRemoved}`,
    `Symbols added: ${report.symbolsAdded}`,
    `Duration: ${report.durationMs}ms`,
  ].join('\n');
}
