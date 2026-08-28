import { search as jmespathSearch } from 'jmespath';

export function applyJmesPath(data: unknown, expression: string): unknown {
  try {
    return jmespathSearch(data, expression);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`JMESPath select failed: ${message}`, { cause: error });
  }
}
