import * as esbuild from 'esbuild';

const FORBIDDEN_PATTERNS = [
  /\bimport\s+/u,
  /\brequire\s*\(/u,
  /\bprocess\./u,
  /\bBun\./u,
  /\bfetch\s*\(/u,
  /\bDeno\./u,
];

export interface TranspileResult {
  code: string;
}

export function transpileGuestSource(source: string): TranspileResult {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(source)) {
      throw new Error(
        `Guest source contains forbidden construct: ${pattern.source}`
      );
    }
  }

  const result = esbuild.transformSync(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'neutral',
    target: 'es2022',
  });

  if (result.warnings.length > 0) {
    const importWarning = result.warnings.find((warning) =>
      warning.text.includes('import')
    );
    if (importWarning) {
      throw new Error(
        `Guest source must not use imports: ${importWarning.text}`
      );
    }
  }

  return { code: result.code };
}

export function wrapGuestModule(transpiledCode: string): string {
  let code = transpiledCode
    .replace(/export\s+default\s+/u, 'const __guestRun = ')
    .replaceAll(/export\s*\{[^}]*\}\s*;?/gu, '');

  if (!code.includes('__guestRun')) {
    const match = code.match(/async function (\w+)\s*\(/u);
    if (match) {
      code += `\nconst __guestRun = ${match[1]};\n`;
    }
  }

  return `
${code}
if (typeof __guestRun !== 'function') {
  throw new Error('Guest module must export default async function');
}
`;
}
