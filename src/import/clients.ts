import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import * as z from 'zod/v4';

import type { UpstreamServer, UpstreamsConfig } from '../storage/config';

const mcpStdioServerSchema = z.object({
  args: z.array(z.string()).optional(),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
});

const mcpServersFileSchema = z.object({
  mcpServers: z.record(z.string(), mcpStdioServerSchema),
});

const opencodeLocalServerSchema = z.object({
  command: z.union([z.array(z.string()), z.string()]).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  type: z.string().optional(),
  url: z.string().optional(),
});

export interface ClientImportSource {
  client: 'cursor' | 'claude' | 'opencode' | 'mcp-json';
  path: string;
  scope: 'project' | 'global';
}

export interface ClientImportResult {
  upstreams: UpstreamServer[];
  imported: { name: string; id: string; source: string }[];
  skipped: { name: string; reason: string; source: string }[];
}

export function sanitizeUpstreamId(name: string): string {
  const normalized = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .replaceAll(/-+/g, '-');
  const id = /^[a-z]/.test(normalized) ? normalized : `srv-${normalized}`;
  return id.slice(0, 64) || 'server';
}

function mergeKey(sourcePath: string, name: string): string {
  return `${sourcePath}\0${name}`;
}

function setMergedEntry(
  merged: Map<
    string,
    {
      clientLabel: string;
      kind: 'mcp' | 'opencode';
      name: string;
      server:
        | z.infer<typeof mcpStdioServerSchema>
        | z.infer<typeof opencodeLocalServerSchema>;
      source: string;
    }
  >,
  entry: {
    clientLabel: string;
    kind: 'mcp' | 'opencode';
    name: string;
    server:
      | z.infer<typeof mcpStdioServerSchema>
      | z.infer<typeof opencodeLocalServerSchema>;
    source: string;
  }
): void {
  const existing = merged.get(entry.name);
  if (
    existing &&
    existing.source !== entry.source &&
    existing.clientLabel !== entry.clientLabel
  ) {
    merged.set(mergeKey(entry.source, entry.name), entry);
    return;
  }
  merged.set(entry.name, entry);
}

function allocateUniqueUpstreamId(
  baseId: string,
  usedIds: Set<string>,
  hint: string
): string {
  const suffix = sanitizeUpstreamId(hint).slice(0, 24);
  let candidate = `${baseId}-${suffix}`.slice(0, 64);
  if (!usedIds.has(candidate)) {
    return candidate;
  }
  for (let n = 2; n < 1000; n += 1) {
    candidate = `${baseId}-${suffix}-${n}`.slice(0, 64);
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not allocate unique upstream id for ${baseId}`);
}

const TRAILING_COMMA_RE = /,(\s*[}\]])/g;

export function parseJsonc(raw: string): unknown {
  const withoutBlock = raw.replaceAll(/\/\*[\s\S]*?\*/g, '');
  const withoutLine = withoutBlock.replaceAll(/^\s*\/\/.*$/gm, '');
  const withoutTrailingCommas = withoutLine.replaceAll(TRAILING_COMMA_RE, '$1');
  return JSON.parse(withoutTrailingCommas);
}

function isFuncthisServerName(name: string): boolean {
  return name.toLowerCase() === 'functhis';
}

function isFuncthisCommand(command: string | string[]): boolean {
  const parts = Array.isArray(command) ? command : [command];
  return parts[0] === 'fn' || parts.includes('functhis');
}

export function discoverCursorMcpPaths(
  cwd = process.cwd()
): ClientImportSource[] {
  const paths: ClientImportSource[] = [];
  const globalPath = join(homedir(), '.cursor', 'mcp.json');
  const projectPath = join(cwd, '.cursor', 'mcp.json');

  if (existsSync(globalPath)) {
    paths.push({ client: 'cursor', path: globalPath, scope: 'global' });
  }
  if (existsSync(projectPath)) {
    paths.push({ client: 'cursor', path: projectPath, scope: 'project' });
  }
  return paths;
}

export function discoverClaudeMcpPaths(
  cwd = process.cwd()
): ClientImportSource[] {
  const paths: ClientImportSource[] = [];
  const globalPath = join(homedir(), '.claude', 'mcp.json');
  const projectPath = join(cwd, '.mcp.json');

  if (existsSync(globalPath)) {
    paths.push({ client: 'claude', path: globalPath, scope: 'global' });
  }
  if (existsSync(projectPath)) {
    paths.push({ client: 'claude', path: projectPath, scope: 'project' });
  }
  return paths;
}

function discoverOpenCodeConfigPaths(
  cwd = process.cwd()
): ClientImportSource[] {
  const paths: ClientImportSource[] = [];
  const globalDir = join(homedir(), '.config', 'opencode');
  const globalCandidates = [
    join(globalDir, 'opencode.json'),
    join(globalDir, 'opencode.jsonc'),
  ];
  for (const path of globalCandidates) {
    if (existsSync(path)) {
      paths.push({ client: 'opencode', path, scope: 'global' });
      break;
    }
  }

  const projectCandidates = [
    join(cwd, 'opencode.json'),
    join(cwd, 'opencode.jsonc'),
    join(cwd, '.opencode', 'opencode.json'),
    join(cwd, '.opencode', 'opencode.jsonc'),
  ];
  for (const path of projectCandidates) {
    if (existsSync(path)) {
      paths.push({ client: 'opencode', path, scope: 'project' });
      break;
    }
  }
  return paths;
}

export function discoverAllImportSources(
  cwd = process.cwd()
): ClientImportSource[] {
  return [
    ...discoverCursorMcpPaths(cwd),
    ...discoverClaudeMcpPaths(cwd),
    ...discoverOpenCodeConfigPaths(cwd),
  ];
}

export function loadMcpServersFile(
  path: string
): Record<string, z.infer<typeof mcpStdioServerSchema>> {
  const raw = readFileSync(path, 'utf-8');
  const parsed = mcpServersFileSchema.parse(JSON.parse(raw));
  return parsed.mcpServers;
}

export function loadOpenCodeMcpFile(
  path: string
): Record<string, z.infer<typeof opencodeLocalServerSchema>> {
  const raw = readFileSync(path, 'utf-8');
  const parsed = path.endsWith('.jsonc')
    ? (parseJsonc(raw) as { mcp?: Record<string, unknown> })
    : (JSON.parse(raw) as { mcp?: Record<string, unknown> });
  const servers = parsed.mcp ?? {};
  const result: Record<string, z.infer<typeof opencodeLocalServerSchema>> = {};
  for (const [name, server] of Object.entries(servers)) {
    const validated = opencodeLocalServerSchema.safeParse(server);
    if (validated.success) {
      result[name] = validated.data;
    }
  }
  return result;
}

export function mcpServerToUpstream(
  name: string,
  server: z.infer<typeof mcpStdioServerSchema>,
  clientLabel: string
): { upstream?: UpstreamServer; skip?: string } {
  if (isFuncthisServerName(name)) {
    return { skip: 'Skipped Functhis gateway entry (avoid recursion)' };
  }
  if (server.url) {
    return {
      skip: 'HTTP/SSE MCP servers are not supported yet (stdio only)',
    };
  }
  if (!server.command) {
    return { skip: 'Missing command (not a stdio server)' };
  }
  if (isFuncthisCommand(server.command)) {
    return { skip: 'Skipped Functhis gateway entry (avoid recursion)' };
  }

  const id = sanitizeUpstreamId(name);
  return {
    upstream: {
      args: server.args ?? [],
      command: server.command,
      cwd: server.cwd,
      enabled: true,
      env: server.env,
      id,
      label: `Imported from ${clientLabel}: ${name}`,
      transport: 'stdio',
    },
  };
}

export function opencodeServerToUpstream(
  name: string,
  server: z.infer<typeof opencodeLocalServerSchema>
): { upstream?: UpstreamServer; skip?: string } {
  if (isFuncthisServerName(name)) {
    return { skip: 'Skipped Functhis gateway entry (avoid recursion)' };
  }
  if (server.enabled === false) {
    return { skip: 'Server is disabled in OpenCode config' };
  }
  if (server.url || server.type === 'remote') {
    return { skip: 'Remote MCP servers are not supported yet (stdio only)' };
  }
  if (!server.command) {
    return { skip: 'Missing command (not a stdio server)' };
  }

  const commandParts = Array.isArray(server.command)
    ? server.command
    : [server.command];
  if (isFuncthisCommand(commandParts)) {
    return { skip: 'Skipped Functhis gateway entry (avoid recursion)' };
  }

  const id = sanitizeUpstreamId(name);
  const env = server.environment ?? server.env;
  return {
    upstream: {
      args: commandParts.slice(1),
      command: commandParts[0],
      cwd: server.cwd,
      enabled: true,
      env,
      id,
      label: `Imported from OpenCode: ${name}`,
      transport: 'stdio',
    },
  };
}

export function importFromSources(
  sources: ClientImportSource[]
): ClientImportResult {
  const merged = new Map<
    string,
    {
      clientLabel: string;
      kind: 'mcp' | 'opencode';
      name: string;
      server:
        | z.infer<typeof mcpStdioServerSchema>
        | z.infer<typeof opencodeLocalServerSchema>;
      source: string;
    }
  >();
  const skipped: ClientImportResult['skipped'] = [];

  for (const source of sources) {
    try {
      if (source.client === 'opencode') {
        const servers = loadOpenCodeMcpFile(source.path);
        for (const [name, server] of Object.entries(servers)) {
          setMergedEntry(merged, {
            clientLabel: 'OpenCode',
            kind: 'opencode',
            name,
            server,
            source: source.path,
          });
        }
        continue;
      }

      const clientLabel =
        source.client === 'cursor'
          ? 'Cursor'
          : source.client === 'claude'
            ? 'Claude'
            : 'MCP';
      const servers = loadMcpServersFile(source.path);
      for (const [name, server] of Object.entries(servers)) {
        setMergedEntry(merged, {
          clientLabel,
          kind: 'mcp',
          name,
          server,
          source: source.path,
        });
      }
    } catch (error) {
      skipped.push({
        name: source.path,
        reason: `Failed to parse config: ${
          error instanceof Error ? error.message : String(error)
        }`,
        source: source.path,
      });
    }
  }

  const upstreams: UpstreamServer[] = [];
  const imported: ClientImportResult['imported'] = [];
  const usedIds = new Set<string>();

  for (const entry of merged.values()) {
    const converted =
      entry.kind === 'opencode'
        ? opencodeServerToUpstream(
            entry.name,
            entry.server as z.infer<typeof opencodeLocalServerSchema>
          )
        : mcpServerToUpstream(
            entry.name,
            entry.server as z.infer<typeof mcpStdioServerSchema>,
            entry.clientLabel
          );

    if (converted.skip || !converted.upstream) {
      skipped.push({
        name: entry.name,
        reason: converted.skip ?? 'Unknown',
        source: entry.source,
      });
      continue;
    }

    let { upstream } = converted;
    if (usedIds.has(upstream.id)) {
      upstream = {
        ...upstream,
        id: allocateUniqueUpstreamId(
          upstream.id,
          usedIds,
          `${entry.source}:${entry.name}`
        ),
      };
    }
    usedIds.add(upstream.id);
    upstreams.push(upstream);
    imported.push({ id: upstream.id, name: entry.name, source: entry.source });
  }

  return { imported, skipped, upstreams };
}

export function importFromAllClients(cwd = process.cwd()): ClientImportResult {
  const sources = discoverAllImportSources(cwd);
  if (sources.length === 0) {
    return { imported: [], skipped: [], upstreams: [] };
  }
  return importFromSources(sources);
}

export function importFromCursor(cwd = process.cwd()): ClientImportResult {
  const sources = discoverCursorMcpPaths(cwd);
  if (sources.length === 0) {
    throw new Error(
      'No Cursor MCP config found. Expected ~/.cursor/mcp.json or .cursor/mcp.json in the project.'
    );
  }
  return importFromSources(sources);
}

export function importFromCursorFiles(
  sources: ClientImportSource[]
): ClientImportResult {
  return importFromSources(sources);
}

export function mergeUpstreamsConfig(
  existing: UpstreamsConfig,
  imported: UpstreamServer[],
  mode: 'merge' | 'replace'
): UpstreamsConfig {
  if (mode === 'replace') {
    return { upstreams: imported, version: 1 };
  }

  const byId = new Map(existing.upstreams.map((u) => [u.id, u]));
  for (const upstream of imported) {
    byId.set(upstream.id, upstream);
  }
  return { upstreams: [...byId.values()], version: 1 };
}

export function formatImportReport(result: ClientImportResult): string {
  const lines: string[] = [];
  if (result.imported.length > 0) {
    lines.push('Imported stdio upstreams:');
    for (const item of result.imported) {
      lines.push(`  ✓ ${item.name} → ${item.id}`, `    from ${item.source}`);
    }
  }
  if (result.skipped.length > 0) {
    lines.push('', 'Skipped:');
    for (const item of result.skipped) {
      lines.push(`  - ${item.name}: ${item.reason}`);
    }
  }
  lines.push('', `Total importable upstreams: ${result.upstreams.length}`);
  return lines.join('\n');
}

// Backward-compatible aliases
export type CursorImportSource = ClientImportSource;
export type CursorImportResult = ClientImportResult;

export function cursorServerToUpstream(
  name: string,
  server: z.infer<typeof mcpStdioServerSchema>,
  _source: string
): { upstream?: UpstreamServer; skip?: string } {
  return mcpServerToUpstream(name, server, 'Cursor');
}

export function loadCursorMcpFile(
  path: string
): Record<string, z.infer<typeof mcpStdioServerSchema>> {
  return loadMcpServersFile(path);
}
