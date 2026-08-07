// Browser-facing compile seam: always Rip→JavaScript. The TypeScript
// face, declaration emission, and editor metadata belong to CLI check
// and packages/vscode — never to the in-page compiler.
import { compile as compileSource } from './compile.js';

export function compile(source, options = {}) {
  if (options.face === 'ts') {
    throw new Error('rip: TypeScript face is unavailable in the browser');
  }
  return compileSource(source, { ...options, face: 'js' });
}
