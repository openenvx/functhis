const SEPARATOR = '.';

export function makeToolId(serverId: string, toolName: string): string {
  const escapedName = toolName.replaceAll(SEPARATOR, '\\.');
  return `${serverId}${SEPARATOR}${escapedName}`;
}

export function parseToolId(id: string): {
  serverId: string;
  toolName: string;
} {
  const dotIndex = id.indexOf(SEPARATOR);
  if (dotIndex === -1) {
    throw new Error(`Invalid tool id: ${id}`);
  }
  const serverId = id.slice(0, dotIndex);
  const escapedName = id.slice(dotIndex + 1);
  const toolName = escapedName.replaceAll('\\.', SEPARATOR);
  return { serverId, toolName };
}
