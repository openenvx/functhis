import {
  buildResultEnvelope,
  estimateUtf8Bytes,
  shapeEvidenceOutput,
} from '../output';
import type { ShapeEvidenceOptions } from '../output';
import type { TraceRecorder } from '../trace/recorder';
import type { TraceCallStatus } from '../trace/schema';

export function buildCallResponse(payload: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(payload, null, 2),
        type: 'text' as const,
      },
    ],
  };
}

export function buildGatewayErrorResponse(message: string) {
  return {
    content: [{ text: message, type: 'text' as const }],
    isError: true,
  };
}

export function buildSuccessPayload(
  storedOutput: unknown,
  options: {
    address: string;
    full?: boolean;
    runId: string;
    safetyTruncated?: boolean;
    safetyOriginalBytes?: number;
  }
): {
  payload: Record<string, unknown>;
  returnedBytes: number;
  storedBytes: number;
} {
  const storedBytes = estimateUtf8Bytes(storedOutput);
  const { envelope, returnedBytes } = buildResultEnvelope(storedOutput, {
    address: options.address,
    full: options.full,
    runId: options.runId,
  });

  const payload: Record<string, unknown> = { ...envelope };
  if (options.safetyTruncated) {
    payload.safetyTruncated = true;
    payload.safetyOriginalBytes = options.safetyOriginalBytes;
  }

  return { payload, returnedBytes, storedBytes };
}

export async function readStoredEvidence(
  recorder: TraceRecorder,
  args: ShapeEvidenceOptions & { runId: string; address: string }
): Promise<unknown> {
  const evidence = await recorder.recall(args.runId, args.address);
  const shaped = shapeEvidenceOutput(evidence, args);
  return shaped.output;
}

export async function respondWithStoredEvidence(
  recorder: TraceRecorder,
  args: ShapeEvidenceOptions & { runId: string; address: string }
): Promise<
  | ReturnType<typeof buildCallResponse>
  | ReturnType<typeof buildGatewayErrorResponse>
> {
  try {
    const output = await readStoredEvidence(recorder, args);
    return buildCallResponse(output);
  } catch (error) {
    return buildGatewayErrorResponse(
      error instanceof Error ? error.message : String(error)
    );
  }
}

export interface RecordGatewayCallInput {
  arguments: Record<string, unknown>;
  durationMs: number;
  endedAt: string;
  error?: string;
  originalBytes?: number;
  output?: unknown;
  refs?: string[];
  sideEffect?: 'read' | 'write' | 'unknown';
  startedAt: string;
  status: TraceCallStatus;
  toolFingerprint: string;
  toolId: string;
  truncated?: boolean;
}

export async function recordGatewayCallAndEnvelope(
  recorder: TraceRecorder,
  input: RecordGatewayCallInput,
  options: { full?: boolean }
): Promise<ReturnType<typeof buildCallResponse>> {
  const { address, runId } = await recorder.recordCall(input);

  if (input.status !== 'succeeded') {
    return buildCallResponse({
      address,
      error: input.error,
      runId,
    });
  }

  const { payload, returnedBytes, storedBytes } = buildSuccessPayload(
    input.output ?? null,
    {
      address,
      full: options.full,
      runId,
      safetyOriginalBytes: input.originalBytes,
      safetyTruncated: input.truncated,
    }
  );

  await recorder.updateLastCallMetrics({
    returnedBytes,
    storedBytes,
  });

  return buildCallResponse(payload);
}
