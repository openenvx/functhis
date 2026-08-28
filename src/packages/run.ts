import { CapabilityBroker } from '../sandbox/broker';
import type { SandboxExecuteResult } from '../sandbox/protocol';
import { executeSandboxCode } from '../sandbox/runner';
import type { TraceRecorder } from '../trace/recorder';
import type { UpstreamManager } from '../upstream/manager';
import { inspectLockDrift } from './install';
import { loadPackage } from './save';
import type { PackageManifest } from './schema';

export interface RunPackageOptions {
  approveWrites?: boolean;
  input?: Record<string, unknown>;
  packageDir: string;
  recorder?: TraceRecorder;
  signal?: AbortSignal;
}

export async function runPackage(
  manager: UpstreamManager,
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
    maxBytesPerResult: 256 * 1024,
    maxCalls: manifest.runtime.maxCalls,
    recorder: options.recorder,
    signal: options.signal,
  });

  const result = await executeSandboxCode(broker, {
    allowedTools: manifest.capabilities.tools,
    approveWrites: options.approveWrites,
    input: options.input,
    maxCalls: manifest.runtime.maxCalls,
    maxOutputBytes: manifest.runtime.maxOutputBytes,
    source,
    timeoutMs: manifest.runtime.timeoutMs,
  });

  return { ...result, manifest };
}
