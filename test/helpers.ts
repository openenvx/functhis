import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
  return JSON.parse(text) as unknown;
}

export async function withGatewayClient(
  options: {
    configPath: string;
    functionsDir?: string;
    cwd?: string;
  },
  fn: (client: Client) => Promise<void>
): Promise<void> {
  const cliPath = join(packageRoot, 'src', 'cli.ts');
  const invocation = invocationForScript(cliPath);
  const args = ['serve', '--config', options.configPath];
  if (options.functionsDir) {
    args.push('--functions-dir', options.functionsDir);
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
