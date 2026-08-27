const MIN_BYTES = 60 * 1024;
const MAX_BYTES = 95 * 1024;

export function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8');
}

/** Grow filler until the serialized payload sits in the 60–95 KB band. */
export function padPayload<T extends Record<string, unknown>>(
  build: (fillerCount: number) => T,
  options?: { minBytes?: number; maxBytes?: number }
): T {
  const minBytes = options?.minBytes ?? MIN_BYTES;
  const maxBytes = options?.maxBytes ?? MAX_BYTES;
  let fillerCount = 200;
  let payload = build(fillerCount);
  while (utf8Bytes(payload) < minBytes && fillerCount < 20_000) {
    fillerCount += 200;
    payload = build(fillerCount);
  }
  if (utf8Bytes(payload) > maxBytes) {
    throw new Error(
      `Payload exceeded ${maxBytes} bytes at fillerCount=${fillerCount}`
    );
  }
  return payload;
}

export function noiseLine(index: number, prefix: string): string {
  return `${prefix} line ${index} status=ok latency_ms=${(index % 97) + 12} trace_id=tr-${index.toString(16).padStart(8, '0')}`;
}
