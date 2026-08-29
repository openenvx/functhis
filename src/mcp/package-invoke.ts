import { resolvesWriteApproval } from '../packages/capabilities';
import { packageFingerprint } from '../packages/fingerprint';
import { runPackage } from '../packages/run';
import { loadPackage } from '../packages/save';
import {
  buildGatewayErrorResponse,
  recordGatewayCallAndEnvelope,
} from './invoke';
import type { GatewayDependencies } from './package-tools';

export interface InvokePackageOptions {
  approveWrites?: boolean;
  full?: boolean;
  newRun?: boolean;
  runId?: string;
}

export async function invokePackageFunction(
  packageDir: string,
  args: Record<string, unknown>,
  deps: GatewayDependencies,
  options: InvokePackageOptions = {}
) {
  try {
    await deps.recorder.ensureRun({
      newRun: options.newRun,
      runId: options.runId,
    });
    deps.recorder.assertRunActive();
  } catch (error) {
    return buildGatewayErrorResponse(
      error instanceof Error ? error.message : String(error)
    );
  }

  const { arguments: resolvedArgs, refs } =
    deps.recorder.resolveArguments(args);
  const { lock, manifest } = await loadPackage(packageDir);
  const packageFp = packageFingerprint(lock);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const effectiveApproveWrites = resolvesWriteApproval(
    manifest,
    options.approveWrites
  );

  if (
    manifest.capabilities.writes === 'review-required' &&
    !effectiveApproveWrites
  ) {
    return recordGatewayCallAndEnvelope(
      deps.recorder,
      {
        arguments: args,
        durationMs: Date.now() - startMs,
        endedAt: new Date().toISOString(),
        error:
          'Write-capable package requires approveWrites: true. Autonomous write packages are invoked without approval when promoted under learning policy.',
        refs,
        startedAt,
        status: 'denied',
        toolFingerprint: packageFp,
        toolId: manifest.name,
      },
      { full: options.full }
    );
  }

  const result = await runPackage(deps.manager, {
    approveWrites: effectiveApproveWrites,
    input: resolvedArgs,
    packageDir,
    recorder: deps.recorder,
    signal: deps.abortSignal,
  });

  const toolId = result.manifest.name;
  const endedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  if (result.status !== 'succeeded') {
    const status =
      result.status === 'timeout'
        ? 'timeout'
        : result.status === 'denied'
          ? 'denied'
          : 'failed';
    return recordGatewayCallAndEnvelope(
      deps.recorder,
      {
        arguments: args,
        durationMs,
        endedAt,
        error: result.error,
        refs,
        startedAt,
        status,
        toolFingerprint: packageFp,
        toolId,
      },
      { full: options.full }
    );
  }

  return recordGatewayCallAndEnvelope(
    deps.recorder,
    {
      arguments: args,
      durationMs,
      endedAt,
      output: result.output,
      refs,
      startedAt,
      status: 'succeeded',
      toolFingerprint: packageFp,
      toolId,
    },
    { full: options.full }
  );
}
