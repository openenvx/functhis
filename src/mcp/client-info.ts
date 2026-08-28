import type { McpServer } from '@modelcontextprotocol/server';

interface McpClientVersion {
  name: string;
  version?: string;
}

export function resolveMcpClientLabel(
  server: McpServer | undefined
): string | undefined {
  if (!server) {
    return undefined;
  }

  const clientVersion = (server.server as { _clientVersion?: McpClientVersion })
    ._clientVersion;
  if (!clientVersion?.name) {
    return undefined;
  }

  return clientVersion.version
    ? `${clientVersion.name}@${clientVersion.version}`
    : clientVersion.name;
}
