import { applyJmesPath } from '../functions/select';

/** Hard cap for trace storage — prevents unbounded disk growth. */
export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

/** Default bytes returned to the model before switching to a pointer envelope. */
export const DEFAULT_CONTEXT_BUDGET_BYTES = 6 * 1024;

export interface TruncatedResult<T> {
  data: T;
  truncated: boolean;
  originalBytes?: number;
  maxBytes: number;
}

export interface ValueShape {
  type:
    | 'object'
    | 'array'
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'unknown';
  keys?: string[];
  length?: number;
}

export interface ResultEnvelope {
  address?: string;
  bytes: number;
  estimatedTokens: number;
  hint?: string;
  preview?: unknown;
  result?: unknown;
  runId?: string;
  shape: ValueShape;
  truncated: boolean;
}

export interface ShapeEvidenceOptions {
  address?: string;
  contextBudgetBytes?: number;
  full?: boolean;
  limit?: number;
  offset?: number;
  runId?: string;
  select?: string;
}

export function estimateUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8');
}

export function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export function describeValueShape(value: unknown): ValueShape {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return { length: value.length, type: 'array' };
  }
  if (typeof value === 'object') {
    return {
      keys: Object.keys(value).slice(0, 20),
      type: 'object',
    };
  }
  if (typeof value === 'string') {
    return { length: value.length, type: 'string' };
  }
  if (typeof value === 'number') {
    return { type: 'number' };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }
  return { type: 'unknown' };
}

export function truncateText(
  text: string,
  maxBytes = DEFAULT_MAX_OUTPUT_BYTES
): TruncatedResult<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) {
    return { data: text, maxBytes, truncated: false };
  }
  const slice = bytes.slice(0, maxBytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return {
    data: `${decoder.decode(slice)}… [truncated: ${bytes.length} bytes, limit ${maxBytes}]`,
    maxBytes,
    originalBytes: bytes.length,
    truncated: true,
  };
}

export function truncateCallResult(
  result: unknown,
  maxBytes = DEFAULT_MAX_OUTPUT_BYTES
): TruncatedResult<unknown> {
  const serialized = JSON.stringify(result);
  const truncated = truncateText(serialized, maxBytes);
  if (!truncated.truncated) {
    return { data: result, maxBytes, truncated: false };
  }
  return {
    data: {
      _functhis: {
        maxBytes,
        originalBytes: truncated.originalBytes,
        preview: truncated.data,
        truncated: true,
      },
    },
    maxBytes,
    originalBytes: truncated.originalBytes,
    truncated: true,
  };
}

function buildStructuredPreview(value: unknown, maxBytes: number): unknown {
  if (estimateUtf8Bytes(value) <= maxBytes) {
    return value;
  }

  if (Array.isArray(value)) {
    const preview: unknown[] = [];
    let used = 2;
    for (const item of value) {
      const itemBytes = estimateUtf8Bytes(item);
      if (used + itemBytes > maxBytes) {
        break;
      }
      preview.push(item);
      used += itemBytes;
    }
    return preview;
  }

  if (typeof value === 'object' && value !== null) {
    const preview: Record<string, unknown> = {};
    let used = 2;
    for (const [key, entry] of Object.entries(value)) {
      const entryBytes = estimateUtf8Bytes({ [key]: entry });
      if (used + entryBytes > maxBytes) {
        break;
      }
      preview[key] = entry;
      used += entryBytes;
    }
    return preview;
  }

  if (typeof value === 'string') {
    return truncateText(value, maxBytes).data;
  }

  return value;
}

export function pageValue(
  value: unknown,
  offset: number,
  limit?: number
): unknown {
  if (Array.isArray(value)) {
    const end = limit === undefined ? undefined : offset + limit;
    return value.slice(offset, end);
  }
  if (typeof value === 'string') {
    const end = limit === undefined ? undefined : offset + limit;
    return value.slice(offset, end);
  }
  return value;
}

export function buildResultEnvelope(
  value: unknown,
  options?: {
    address?: string;
    contextBudgetBytes?: number;
    full?: boolean;
    runId?: string;
  }
): { envelope: ResultEnvelope; returnedBytes: number } {
  const bytes = estimateUtf8Bytes(value);
  const budget = options?.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
  const truncated = !options?.full && bytes > budget;

  const envelope: ResultEnvelope = {
    address: options?.address,
    bytes,
    estimatedTokens: estimateTokensFromBytes(bytes),
    runId: options?.runId,
    shape: describeValueShape(value),
    truncated,
  };

  if (truncated) {
    envelope.preview = buildStructuredPreview(value, budget);
    envelope.hint =
      'Full body stored on disk. Use fn_recall with select, offset, and limit. Pass full: true only when you need the entire payload.';
    const returnedBytes = estimateUtf8Bytes(envelope);
    return { envelope, returnedBytes };
  }

  envelope.result = value;
  const returnedBytes = estimateUtf8Bytes(envelope);
  return { envelope, returnedBytes };
}

export function shapeEvidenceOutput(
  value: unknown,
  options: ShapeEvidenceOptions
): { output: unknown; returnedBytes: number; storedBytes: number } {
  let shaped = value;
  if (options.select) {
    shaped = applyJmesPath(shaped, options.select);
  }
  if (options.offset !== undefined || options.limit !== undefined) {
    shaped = pageValue(shaped, options.offset ?? 0, options.limit);
  }

  const storedBytes = estimateUtf8Bytes(shaped);
  if (options.full) {
    const output = {
      address: options.address,
      evidence: shaped,
      runId: options.runId,
    };
    return {
      output,
      returnedBytes: estimateUtf8Bytes(output),
      storedBytes,
    };
  }

  const { envelope, returnedBytes } = buildResultEnvelope(shaped, {
    address: options.address,
    contextBudgetBytes: options.contextBudgetBytes,
    runId: options.runId,
  });
  return {
    output: envelope,
    returnedBytes,
    storedBytes,
  };
}
