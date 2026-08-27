import { search as jmespathSearch } from 'jmespath';

export function applyJmesPath(data: unknown, expression: string): unknown {
  try {
    return jmespathSearch(data, expression);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`JMESPath select failed: ${message}`, { cause: error });
  }
}

export function isJmesPathOutput(template: string): boolean {
  return (
    !template.startsWith('$input.') &&
    !template.startsWith('$step.') &&
    template.length > 0
  );
}
