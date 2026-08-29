import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import {
  findPackageRoot,
  fixtureServerPath,
  invocationForScript,
} from '../src/paths';
import type { UpstreamsConfig } from '../src/storage/config';

const packageRoot = findPackageRoot(import.meta.url);

export function testUpstreamConfig(): UpstreamsConfig {
  const catalog = invocationForScript(
    fixtureServerPath(packageRoot, 'catalog')
  );
  const readonly = invocationForScript(
    fixtureServerPath(packageRoot, 'readonly')
  );

  return {
    upstreams: [
      {
        args: catalog.args,
        command: catalog.command,
        enabled: true,
        id: 'catalog',
        label: 'Test catalog',
        transport: 'stdio',
      },
      {
        args: readonly.args,
        command: readonly.command,
        enabled: true,
        id: 'readonly',
        label: 'Test readonly',
        transport: 'stdio',
      },
    ],
    version: 1,
  };
}

export async function withTempConfigDir(
  fn: (dir: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'functhis-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

export async function withIntegrationConfigDir(
  fn: (dir: string) => Promise<void>
): Promise<void> {
  await withTempConfigDir(async (dir) => {
    await writeFuncthisSettings(dir, { enabled: false });
    await fn(dir);
  });
}

export function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = join(packageRoot, 'src', 'cli.ts');
  const invocation = invocationForScript(cliPath);

  return new Promise((resolve, reject) => {
    const proc = spawn(invocation.command, [...invocation.args, ...args], {
      cwd: packageRoot,
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stderr, stdout });
    });
  });
}

function parseToolText(result: {
  content: { type: string; text?: string }[];
}): unknown {
  const text = result.content.find((entry) => entry.type === 'text')?.text;
  if (!text) {
    throw new Error('Tool result missing text content');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Tool result was not JSON: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`,
      { cause: error }
    );
  }
}

export async function withGatewayClient(
  options: {
    configPath: string;
    packagesDir?: string;
    cwd?: string;
  },
  fn: (client: Client) => Promise<void>
): Promise<void> {
  const cliPath = join(packageRoot, 'src', 'cli.ts');
  const invocation = invocationForScript(cliPath);
  const args = ['serve', '--config', options.configPath];
  if (options.packagesDir) {
    args.push('--packages-dir', options.packagesDir);
  }

  const transport = new StdioClientTransport({
    args: [...invocation.args, ...args],
    command: invocation.command,
    cwd: options.cwd ?? packageRoot,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'functhis-test', version: '0.1.0' });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

export { parseToolText };

export const TWO_STEP_SANDBOX_SOURCE = `
export default async function(ctx, input) {
  const user = await ctx.tools.readonly.get_user({ userId: input.userId });
  const issues = await ctx.tools.readonly.list_issues({
    owner: 'openenvx',
    repo: 'functhis',
  });
  return { issueCount: issues.issues.length, userId: user.userId };
}
`;

export async function writeFuncthisSettings(
  configDir: string,
  learning: Record<string, unknown> = {}
): Promise<void> {
  await writeFile(
    join(configDir, 'settings.json'),
    `${JSON.stringify(
      {
        learning: {
          enabled: true,
          minOccurrences: 2,
          ...learning,
        },
        version: 1,
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
}

export async function runTwoStepSandboxFlow(
  client: Client,
  userId: string
): Promise<void> {
  const result = await client.callTool({
    arguments: {
      allowedTools: ['readonly.get_user', 'readonly.list_issues'],
      full: true,
      input: { userId },
      newRun: true,
      source: TWO_STEP_SANDBOX_SOURCE,
    },
    name: 'fn_execute_code',
  });
  const body = parseToolText(result) as {
    error?: string;
    result?: { issueCount: number; userId: string };
  };
  if (!body.result?.userId) {
    throw new Error(body.error ?? 'sandbox two-step flow failed');
  }
}

export async function waitForCrystallizedAutoPackage(
  client: Client,
  timeoutMs = 45_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.callTool({
      arguments: {},
      name: 'fn_learning_status',
    });
    const body = parseToolText(result) as {
      crystallized: { name: string; status: string }[];
    };
    const hit = body.crystallized?.find(
      (entry) => entry.name.startsWith('auto-') && entry.status === 'promoted'
    );
    if (hit) {
      return hit.name;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  throw new Error('Timed out waiting for auto-learned package');
}
