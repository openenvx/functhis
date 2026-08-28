export function validateJsonSchemaValue(
  value: unknown,
  schema: Record<string, unknown>,
  path = 'output'
): string[] {
  const errors: string[] = [];
  const type = schema.type;

  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return errors;
    }

    const record = value as Record<string, unknown>;
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in record)) {
          errors.push(`${path} missing required property "${key}"`);
        }
      }
    }

    const properties = schema.properties;
    if (properties && typeof properties === 'object') {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in record && childSchema && typeof childSchema === 'object') {
          errors.push(
            ...validateJsonSchemaValue(
              record[key],
              childSchema as Record<string, unknown>,
              `${path}.${key}`
            )
          );
        }
      }
    }
    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return errors;
    }
    const items = schema.items;
    if (items && typeof items === 'object') {
      for (let index = 0; index < value.length; index += 1) {
        errors.push(
          ...validateJsonSchemaValue(
            value[index],
            items as Record<string, unknown>,
            `${path}[${index}]`
          )
        );
      }
    }
    return errors;
  }

  if (type === 'string' && typeof value !== 'string') {
    errors.push(`${path} must be a string`);
  }
  if (type === 'number' && typeof value !== 'number') {
    errors.push(`${path} must be a number`);
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean`);
  }
  if (
    type === 'integer' &&
    (!Number.isInteger(value) || typeof value !== 'number')
  ) {
    errors.push(`${path} must be an integer`);
  }

  return errors;
}
