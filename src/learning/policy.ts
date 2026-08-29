import { classifyPackageWrites } from '../packages/capabilities';
import type { LearningSettings } from '../storage/settings';
import type { UpstreamManager } from '../upstream/manager';

export type PolicyDecision = 'allow' | 'quarantine';

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reason?: string;
  writes: 'deny' | 'review-required';
}

export function evaluateAutonomousPolicy(
  manager: UpstreamManager,
  allowedTools: string[],
  learning?: LearningSettings
): PolicyEvaluation {
  const writes = classifyPackageWrites(manager, allowedTools);

  if (writes === 'deny') {
    return { decision: 'allow', writes };
  }

  const writePolicy = learning?.writePolicy ?? 'scoped';
  const allowedWriteTools = new Set(learning?.allowedWriteTools);

  if (writePolicy === 'deny') {
    return {
      decision: 'quarantine',
      reason: 'Write-capable flow blocked by learning.writePolicy=deny',
      writes,
    };
  }

  const disallowed = allowedTools.filter(
    (toolId) =>
      !allowedWriteTools.has(toolId) &&
      (manager.catalog.getTool(toolId)?.risk === 'write' ||
        manager.catalog.getTool(toolId)?.risk === 'unknown')
  );

  if (disallowed.length > 0) {
    return {
      decision: 'quarantine',
      reason: `Write tools not in learning.allowedWriteTools: ${disallowed.join(', ')}`,
      writes,
    };
  }

  return {
    decision: 'allow',
    reason: 'Write flow allowed by autonomous policy',
    writes,
  };
}
