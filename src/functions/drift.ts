import type { ToolCatalog } from '../catalog/index';
import type { FunctionDefinition } from './schema';

export interface DriftIssue {
  kind:
    | 'missing'
    | 'schema-changed'
    | 'description-changed'
    | 'missing-fingerprint';
  message: string;
  toolId: string;
}

export interface DriftReport {
  issues: DriftIssue[];
  ok: boolean;
}

export function checkDrift(
  definition: FunctionDefinition,
  catalog: ToolCatalog
): DriftReport {
  const issues: DriftIssue[] = [];

  for (const toolId of definition.requiredTools) {
    const tool = catalog.getTool(toolId);
    const expectedFingerprint = definition.toolFingerprints[toolId];
    if (!tool) {
      issues.push({
        kind: 'missing',
        message: `Missing tool "${toolId}" in catalog`,
        toolId,
      });
      continue;
    }
    if (!expectedFingerprint) {
      issues.push({
        kind: 'missing-fingerprint',
        message: `Function is missing fingerprint for "${toolId}"`,
        toolId,
      });
      continue;
    }
    if (tool.fingerprint !== expectedFingerprint) {
      issues.push({
        kind: 'schema-changed',
        message: `Tool "${toolId}" fingerprint changed (expected ${expectedFingerprint}, got ${tool.fingerprint})`,
        toolId,
      });
    }
  }

  return { issues, ok: issues.length === 0 };
}

export function assertNoDrift(
  definition: FunctionDefinition,
  catalog: ToolCatalog
): void {
  const report = checkDrift(definition, catalog);
  if (!report.ok) {
    throw new Error(
      `Function drift detected:\n- ${report.issues.map((issue) => issue.message).join('\n- ')}`
    );
  }
}

export function formatDriftReport(report: DriftReport): string[] {
  if (report.ok) {
    return ['Tool fingerprints: OK'];
  }
  return report.issues.map(
    (issue) => `[${issue.kind}] ${issue.toolId}: ${issue.message}`
  );
}
