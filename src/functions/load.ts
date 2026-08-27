import { readFile } from 'node:fs/promises';

import {
  assertValidFunctionName,
  getFixturePath,
  getFunctionSourcePath,
} from './paths';
import { fixtureSchema, functionDefinitionSchema } from './schema';
import type { Fixture, FunctionDefinition } from './schema';

const EXPORT_DEFAULT_PATTERN = /export\s+default\s+/u;

export function extractDefaultExport(source: string): unknown {
  const withoutComments = source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .replaceAll(/^\s*\/\/.*$/gmu, '')
    .trim();

  const exportIndex = withoutComments.search(EXPORT_DEFAULT_PATTERN);
  if (exportIndex === -1) {
    throw new Error(
      'Function file must contain a single export default object'
    );
  }

  const afterExport = withoutComments
    .slice(exportIndex)
    .replace(/^export\s+default\s+/u, '')
    .trim();

  const jsonStart = afterExport.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('Function export default must be a JSON object');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let jsonEnd = -1;

  for (let index = jsonStart; index < afterExport.length; index += 1) {
    const char = afterExport[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        jsonEnd = index + 1;
        break;
      }
    }
  }

  if (jsonEnd === -1) {
    throw new Error('Function export default object is not closed');
  }

  let jsonText = afterExport.slice(jsonStart, jsonEnd);
  // Oxfmt may rewrite JSON numbers with numeric separators (262_144); JSON.parse rejects those.
  jsonText = jsonText.replaceAll(/\d+(?:_\d+)+/gu, (match) =>
    match.replaceAll('_', '')
  );

  const trailing = afterExport.slice(jsonEnd).trim();
  if (trailing.length > 0 && trailing !== ';') {
    throw new Error(
      'Function file must contain only comments and export default JSON'
    );
  }

  return JSON.parse(jsonText) as unknown;
}

export async function loadFunctionDefinitionFromSource(
  sourcePath: string
): Promise<FunctionDefinition> {
  const source = await readFile(sourcePath, 'utf-8');
  const parsed = extractDefaultExport(source);
  return functionDefinitionSchema.parse(parsed);
}

export async function loadFunctionDefinition(
  functionsRoot: string,
  name: string
): Promise<FunctionDefinition> {
  assertValidFunctionName(name);
  const sourcePath = getFunctionSourcePath(functionsRoot, name);
  const definition = await loadFunctionDefinitionFromSource(sourcePath);
  if (definition.name !== name) {
    throw new Error(
      `Function name mismatch: file is "${definition.name}", requested "${name}"`
    );
  }
  return definition;
}

export async function loadFixture(
  functionsRoot: string,
  name: string
): Promise<Fixture> {
  assertValidFunctionName(name);
  const path = getFixturePath(functionsRoot, name);
  const raw = await readFile(path, 'utf-8');
  return fixtureSchema.parse(JSON.parse(raw));
}
