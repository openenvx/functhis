import type { McpCallResult } from './types';

export function normalizeCallResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const candidate = result as McpCallResult;
  if (candidate.structuredContent !== undefined) {
    return candidate.structuredContent;
  }

  if (!Array.isArray(candidate.content) || candidate.content.length === 0) {
    return result;
  }

  if (candidate.content.length === 1) {
    const block = candidate.content[0];
    if (block?.type === 'text' && typeof block.text === 'string') {
      try {
        return JSON.parse(block.text) as unknown;
      } catch {
        return block.text;
      }
    }
  }

  return result;
}
