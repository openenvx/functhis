import type { GraphStore } from '../graph/store';
import type { UpstreamManager } from '../upstream/manager';
import { CapabilityBroker } from '../sandbox/broker';
import { executeSandboxCode } from '../sandbox/runner';
import type { SandboxExecuteResult } from '../sandbox/protocol';
import { inspectLockDrift } from './install';
import { loadPackage } from './save';
import type { PackageManifest } from './schema';

export interface RunPackageOptions {
  approveWrites?: boolean;
  input?: Record<string, unknown>;
  packageDir: string;
  repoRoot?: string;
  signal?: AbortSignal;
}

export async function runPackage(
  manager: UpstreamManager,
  graphStore: GraphStore | undefined,
  options: RunPackageOptions
): Promise<SandboxExecuteResult & { manifest: PackageManifest }> {
  const { manifest, lock, source } = await loadPackage(options.packageDir);
  const drift = inspectLockDrift(manager, lock);
  if (!drift.ok) {
    return {
      calls: 0,
      durationMs: 0,
      error: drift.issues.map((issue) => issue.message).join('; '),
      manifest,
      status: 'denied',
    };
  }

  const broker = new CapabilityBroker(manager, {
    allowedTools: manifest.capabilities.tools,
    approveWrites: options.approveWrites,
    graphStore,
    maxBytesPerResult: 256 * 1024,
    maxCalls: manifest.runtime.maxCalls,
    repoRead: manifest.capabilities.repo === 'read',
    repoRoot: options.repoRoot,
    signal: options.signal,
  });

  const result = await executeSandboxCode(broker, {
    allowedTools: manifest.capabilities.tools,
    approveWrites: options.approveWrites,
    input: options.input,
    maxCalls: manifest.runtime.maxCalls,
    maxOutputBytes: manifest.runtime.maxOutputBytes,
    repoRead: manifest.capabilities.repo === 'read',
    source,
    timeoutMs: manifest.runtime.timeoutMs,
  });

  return { ...result, manifest };
}
