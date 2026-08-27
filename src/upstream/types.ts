export type ToolRisk = 'read' | 'write' | 'unknown';

export interface DiscoveredTool {
  id: string;
  serverId: string;
  name: string;
  description: string;
  inputSchema: unknown;
  risk: ToolRisk;
  fingerprint: string;
  discoveredAt: string;
}
