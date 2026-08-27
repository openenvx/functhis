import type { DiscoveredTool, ToolRisk } from '../upstream/types';

export interface AccessPolicy {
  denyUnknown: boolean;
  denyWrite: boolean;
}

export const DEFAULT_POLICY: AccessPolicy = {
  denyUnknown: true,
  denyWrite: true,
};

export function classifyToolRisk(name: string, description: string): ToolRisk {
  const text = `${name} ${description}`.toLowerCase();
  const writePatterns =
    /\b(create|update|delete|remove|write|send|post|put|patch|destroy|drop|insert|modify|set_|mutate|publish|deploy|push|merge|commit|upload)\b/;
  const readPatterns =
    /\b(get|list|fetch|read|search|find|lookup|describe|query|inspect|show|view|download|export)\b/;

  if (writePatterns.test(text)) {
    return 'write';
  }
  if (readPatterns.test(text)) {
    return 'read';
  }
  return 'unknown';
}

export function isToolAllowed(
  tool: DiscoveredTool,
  policy: AccessPolicy = DEFAULT_POLICY
): boolean {
  if (policy.denyWrite && tool.risk === 'write') {
    return false;
  }
  if (policy.denyUnknown && tool.risk === 'unknown') {
    return false;
  }
  return true;
}

export function assertToolAllowed(
  tool: DiscoveredTool,
  policy: AccessPolicy = DEFAULT_POLICY
): void {
  if (!isToolAllowed(tool, policy)) {
    throw new Error(
      `Tool "${tool.id}" is not allowed (risk: ${tool.risk}). Functhis denies unknown and write tools by default.`
    );
  }
}
