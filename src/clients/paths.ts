import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ClientTarget = 'cursor' | 'claude' | 'opencode';

export type ClientScope = 'global' | 'project';

export interface ClientPathRef {
  client: ClientTarget;
  path: string;
  scope: ClientScope;
}

export interface ClientConfigTarget {
  label: string;
  path: string;
  scope: ClientScope;
}

const CLIENT_LABELS: Record<ClientTarget, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

export function cursorGlobalMcpPath(): string {
  return join(homedir(), '.cursor', 'mcp.json');
}

export function cursorProjectMcpPath(cwd: string): string {
  return join(cwd, '.cursor', 'mcp.json');
}

export function claudeGlobalMcpPath(): string {
  return join(homedir(), '.claude', 'mcp.json');
}

export function claudeProjectMcpPath(cwd: string): string {
  return join(cwd, '.mcp.json');
}

export function opencodeGlobalConfigCandidates(): string[] {
  const globalDir = join(homedir(), '.config', 'opencode');
  return [join(globalDir, 'opencode.json'), join(globalDir, 'opencode.jsonc')];
}

export function opencodeProjectConfigCandidates(cwd: string): string[] {
  return [
    join(cwd, 'opencode.json'),
    join(cwd, 'opencode.jsonc'),
    join(cwd, '.opencode', 'opencode.json'),
    join(cwd, '.opencode', 'opencode.jsonc'),
  ];
}

function firstExistingPath(candidates: string[]): string | undefined {
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

function toConfigTarget(ref: ClientPathRef): ClientConfigTarget {
  return {
    label: `${CLIENT_LABELS[ref.client]} ${ref.scope}`,
    path: ref.path,
    scope: ref.scope,
  };
}

export function detectClient(cwd = process.cwd()): ClientTarget {
  if (existsSync(cursorProjectMcpPath(cwd))) {
    return 'cursor';
  }
  if (existsSync(claudeProjectMcpPath(cwd))) {
    return 'claude';
  }
  if (firstExistingPath(opencodeProjectConfigCandidates(cwd))) {
    return 'opencode';
  }
  if (existsSync(cursorGlobalMcpPath())) {
    return 'cursor';
  }
  if (existsSync(claudeGlobalMcpPath())) {
    return 'claude';
  }
  if (firstExistingPath(opencodeGlobalConfigCandidates())) {
    return 'opencode';
  }
  return 'cursor';
}

function cursorPathRefs(cwd: string): ClientPathRef[] {
  return [
    { client: 'cursor', path: cursorGlobalMcpPath(), scope: 'global' },
    { client: 'cursor', path: cursorProjectMcpPath(cwd), scope: 'project' },
  ];
}

function claudePathRefs(cwd: string): ClientPathRef[] {
  return [
    { client: 'claude', path: claudeGlobalMcpPath(), scope: 'global' },
    { client: 'claude', path: claudeProjectMcpPath(cwd), scope: 'project' },
  ];
}

function opencodePathRefs(cwd: string): ClientPathRef[] {
  const refs: ClientPathRef[] = [];
  const globalPath = firstExistingPath(opencodeGlobalConfigCandidates());
  if (globalPath) {
    refs.push({ client: 'opencode', path: globalPath, scope: 'global' });
  }
  const projectPath = firstExistingPath(opencodeProjectConfigCandidates(cwd));
  if (projectPath) {
    refs.push({ client: 'opencode', path: projectPath, scope: 'project' });
  }
  return refs;
}

function cursorExistingPathRefs(cwd: string): ClientPathRef[] {
  return cursorPathRefs(cwd).filter((ref) => existsSync(ref.path));
}

function claudeExistingPathRefs(cwd: string): ClientPathRef[] {
  return claudePathRefs(cwd).filter((ref) => existsSync(ref.path));
}

export function discoverExistingClientPaths(
  cwd = process.cwd()
): ClientPathRef[] {
  return [
    ...cursorExistingPathRefs(cwd),
    ...claudeExistingPathRefs(cwd),
    ...opencodePathRefs(cwd),
  ];
}

export function discoverWriteTargets(
  client: ClientTarget,
  cwd = process.cwd()
): ClientConfigTarget[] {
  const refs =
    client === 'cursor'
      ? cursorPathRefs(cwd).filter((ref) => existsSync(ref.path))
      : client === 'claude'
        ? claudePathRefs(cwd).filter((ref) => existsSync(ref.path))
        : opencodePathRefs(cwd);

  if (refs.length > 0) {
    return refs.map(toConfigTarget);
  }

  if (client === 'cursor') {
    return [
      toConfigTarget({ client, path: cursorGlobalMcpPath(), scope: 'global' }),
    ];
  }
  if (client === 'claude') {
    return [
      toConfigTarget({ client, path: claudeGlobalMcpPath(), scope: 'global' }),
    ];
  }
  return [
    toConfigTarget({
      client,
      path: join(homedir(), '.config', 'opencode', 'opencode.jsonc'),
      scope: 'global',
    }),
  ];
}
