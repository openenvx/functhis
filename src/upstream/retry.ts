import { setTimeout as delay } from 'node:timers/promises';

const TRANSIENT_PATTERNS = [
  /timed out/i,
  /ECONNRESET/i,
  /EPIPE/i,
  /temporarily unavailable/i,
  /503/,
  /502/,
];

export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

export async function withReadRetries<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 100;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === maxAttempts) {
        throw error;
      }
      await delay(baseDelayMs * attempt);
    }
  }

  throw lastError;
}
