export function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeJson(record[key])])
    );
  }
  return value;
}

export function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeJson(a)) === JSON.stringify(normalizeJson(b));
}

export function extractJsonObject(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const candidate = fenceMatch?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Assistant reply did not contain a JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

export function evaluateOracle(
  assistantText: string,
  oracle: Record<string, unknown>
): { passed: boolean; parsed?: unknown; error?: string } {
  try {
    const parsed = extractJsonObject(assistantText);
    return {
      parsed,
      passed: deepEqualJson(parsed, oracle),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message, passed: false };
  }
}
