import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { estimateUtf8Bytes } from '../output';

const execAsync = promisify(exec);

export interface SystemCapabilityOptions {
  allowedReadPaths?: string[];
  allowedWritePaths?: string[];
  cwd?: string;
  maxOutputBytes?: number;
}

function normalizePath(base: string, target: string): string {
  const resolved = resolve(base, target);
  if (!resolved.startsWith(resolve(base))) {
    throw new Error(`Path "${target}" escapes allowed workspace`);
  }
  return resolved;
}

export async function systemReadFile(
  options: SystemCapabilityOptions,
  args: { path: string }
): Promise<{ bytes: number; content: string }> {
  const base = options.cwd ?? process.cwd();
  const path = normalizePath(base, args.path);
  const content = await readFile(path, 'utf-8');
  const bytes = estimateUtf8Bytes(content);
  const max = options.maxOutputBytes ?? 256 * 1024;
  if (bytes > max) {
    throw new Error(`Read output exceeds maxOutputBytes (${bytes} > ${max})`);
  }
  if (options.allowedReadPaths?.length) {
    const allowed = options.allowedReadPaths.some((entry) =>
      path.startsWith(resolve(base, entry))
    );
    if (!allowed) {
      throw new Error(`Read path "${args.path}" is not allowed by policy`);
    }
  }
  return { bytes, content };
}

export async function systemWriteFile(
  options: SystemCapabilityOptions,
  args: { content: string; path: string }
): Promise<{ bytes: number; path: string }> {
  const base = options.cwd ?? process.cwd();
  const path = normalizePath(base, args.path);
  if (options.allowedWritePaths?.length) {
    const allowed = options.allowedWritePaths.some((entry) =>
      path.startsWith(resolve(base, entry))
    );
    if (!allowed) {
      throw new Error(`Write path "${args.path}" is not allowed by policy`);
    }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, args.content, 'utf-8');
  return { bytes: estimateUtf8Bytes(args.content), path };
}

export async function systemExec(
  options: SystemCapabilityOptions,
  args: { command: string }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const allowedPrefixes = ['git ', 'bun ', 'npm ', 'node '];
  if (!allowedPrefixes.some((prefix) => args.command.startsWith(prefix))) {
    throw new Error(`Shell command not allowed by policy: ${args.command}`);
  }

  try {
    const { stderr, stdout } = await execAsync(args.command, {
      cwd: options.cwd ?? process.cwd(),
      maxBuffer: options.maxOutputBytes ?? 256 * 1024,
    });
    return { exitCode: 0, stderr, stdout };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      'stdout' in error &&
      'stderr' in error
    ) {
      const execError = error as {
        code?: number | string;
        stderr?: string;
        stdout?: string;
      };
      return {
        exitCode: Number(execError.code ?? 1),
        stderr: execError.stderr ?? '',
        stdout: execError.stdout ?? '',
      };
    }
    throw error;
  }
}

export const SYSTEM_CAPABILITY_IDS = [
  'system.read_file',
  'system.write_file',
  'system.exec',
] as const;
