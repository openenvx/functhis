import { createHash } from 'node:crypto';

export function fingerprintTool(
  name: string,
  description: string,
  schema: unknown
): string {
  return createHash('sha256')
    .update(JSON.stringify({ description, name, schema }))
    .digest('hex')
    .slice(0, 16);
}

export function schemaHash(schema: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(schema))
    .digest('hex')
    .slice(0, 16);
}
