import type { Fixture, FunctionDefinition } from './schema';

export const generateFunctionSource = (
  definition: FunctionDefinition
): string => {
  const lines = [
    '// Functhis Function — edit input bindings and review required tools before replay.',
    `// Source run: ${definition.provenance.sourceRunId}`,
    `// Created: ${definition.provenance.createdAt}`,
    '// This file is data for the Functhis runner; it is not executed as code.',
    '',
    'export default ',
    `${JSON.stringify(definition, null, 2)};`,
    '',
  ];
  return lines.join('\n');
};

export const generateFixtureSource = (fixture: Fixture): string =>
  `${JSON.stringify(fixture, null, 2)}\n`;
