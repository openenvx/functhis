export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /^(password|secret|token|api[_-]?key|authorization|auth|credential|credentials|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)$/i;

const VALUE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /fn_canary_[A-Za-z0-9_-]+/g, replacement: REDACTED },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: REDACTED },
  { pattern: /ghp_[A-Za-z0-9]{20,}/g, replacement: REDACTED },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: REDACTED },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: REDACTED },
  {
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: `Bearer ${REDACTED}`,
  },
  {
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: REDACTED,
  },
  {
    pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
    replacement: REDACTED,
  },
];

export function redactString(value: string): string {
  let result = value;
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === 'object') {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

export function redactObject(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactValue(value);
  }
  return result;
}

export function containsCanary(value: unknown, canary: string): boolean {
  const serialized = JSON.stringify(value);
  return serialized.includes(canary);
}
