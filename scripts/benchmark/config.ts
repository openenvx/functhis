import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fixtureServerPath,
  findPackageRoot,
  invocationForScript,
} from '../../src/paths';
import type { UpstreamsConfig } from '../../src/storage/config';
import { saveConfig } from '../../src/storage/config';

export function getPackageRoot(): string {
  return findPackageRoot(import.meta.url);
}

export function buildFnbenchUpstreamConfig(
  packageRoot: string
): UpstreamsConfig {
  const script = fixtureServerPath(packageRoot, 'fnbench');
  const invocation = invocationForScript(script);
  return {
    upstreams: [
      {
        args: invocation.args,
        command: invocation.command,
        cwd: packageRoot,
        enabled: true,
        id: 'fnbench',
        label: 'FnBench read-only fixtures',
        transport: 'stdio',
      },
    ],
    version: 1,
  };
}

export async function withBenchmarkConfigDir(
  fn: (paths: { configDir: string; configPath: string }) => Promise<void>
): Promise<void> {
  const packageRoot = getPackageRoot();
  const configDir = await mkdtemp(join(tmpdir(), 'functhis-bench-'));
  const configPath = join(configDir, 'upstreams.json');
  try {
    await mkdir(configDir, { recursive: true });
    await saveConfig(configPath, buildFnbenchUpstreamConfig(packageRoot));
    await fn({ configDir, configPath });
  } finally {
    await rm(configDir, { force: true, recursive: true });
  }
}

export function fnbenchMcpServer(packageRoot: string) {
  const script = fixtureServerPath(packageRoot, 'fnbench');
  const invocation = invocationForScript(script);
  return {
    args: invocation.args,
    command: invocation.command,
    cwd: packageRoot,
    type: 'stdio' as const,
  };
}

export function functhisMcpServer(
  packageRoot: string,
  configPath: string,
  functionsDir?: string
) {
  const cliPath = join(packageRoot, 'src', 'cli.ts');
  const invocation = invocationForScript(cliPath);
  const args = [...invocation.args, 'serve', '--config', configPath];
  if (functionsDir) {
    args.push('--functions-dir', functionsDir);
  }
  return {
    args,
    command: invocation.command,
    cwd: packageRoot,
    type: 'stdio' as const,
  };
}

export const DIRECT_SYSTEM_PROMPT = [
  'You are running a controlled benchmark.',
  'Use only the provided MCP tools — do not use shell, file edits, or web search.',
  'Call the requested tool exactly once, then reply with only the JSON object asked for.',
  'No markdown fences, no explanation.',
].join(' ');

export const FUNCTHIS_SYSTEM_PROMPT = [
  'You are running a controlled benchmark through the Functhis MCP gateway.',
  'Use fn_search, fn_describe, fn_call, and fn_select only.',
  'Large tool results return pointer envelopes — use fn_select with JMESPath to read fields.',
  'Do not use full:true on large payloads.',
  'Call the upstream tool exactly once, then reply with only the JSON object asked for.',
  'No markdown fences, no explanation.',
].join(' ');

export const COMPILED_SYSTEM_PROMPT = [
  'You are running a controlled benchmark through the Functhis MCP gateway with precompiled Functions.',
  'Each case has a Function tool named after the case id (for example sre-log-needle).',
  'Call that Function exactly once with no arguments.',
  'Reply with only the JSON object asked for in the task — no markdown fences, no explanation.',
].join(' ');
