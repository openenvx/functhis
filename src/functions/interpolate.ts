const INPUT_TEMPLATE = /^\$input(?:\.([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*))?$/u;
const STEP_TEMPLATE =
  /^\$step\.([a-z][a-z0-9_]*)(?:\.([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*))?$/u;

export interface InterpolationContext {
  input: Record<string, unknown>;
  steps: Record<string, unknown>;
}

function getPathValue(root: unknown, path: string | undefined): unknown {
  if (path === undefined || path.length === 0) {
    return root;
  }
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      throw new Error(
        `Cannot read property "${segment}" from ${typeof current}`
      );
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) {
      throw new Error(`Missing path segment "${segment}"`);
    }
  }
  return current;
}

export function resolveTemplate(
  template: string,
  context: InterpolationContext
): unknown {
  const inputMatch = INPUT_TEMPLATE.exec(template);
  if (inputMatch) {
    const path = inputMatch[1];
    if (!path) {
      throw new Error('Bare $input is not supported; use $input.field');
    }
    return getPathValue(context.input, path);
  }

  const stepMatch = STEP_TEMPLATE.exec(template);
  if (stepMatch) {
    const stepId = stepMatch[1];
    const path = stepMatch[2];
    const stepOutput = context.steps[stepId];
    if (stepOutput === undefined) {
      throw new Error(`Step "${stepId}" has no output yet`);
    }
    return getPathValue(stepOutput, path);
  }

  return template;
}

export function isTemplate(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$');
}

export function resolveArgs(
  args: Record<string, unknown>,
  context: InterpolationContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      resolved[key] = resolveTemplate(value, context);
      continue;
    }
    if (Array.isArray(value)) {
      resolved[key] = value.map((item) =>
        typeof item === 'string' && item.startsWith('$')
          ? resolveTemplate(item, context)
          : item
      );
      continue;
    }
    if (value !== null && typeof value === 'object') {
      resolved[key] = resolveArgs(value as Record<string, unknown>, context);
      continue;
    }
    resolved[key] = value;
  }
  return resolved;
}
