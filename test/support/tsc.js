// The pinned TypeScript for the tsc-spawning validation gates.
//
// TypeScript is a DEV dependency of the repository root — the test
// toolchain, provisioned by `bun install`. The compiler core ships
// nothing: the purity gate in test/toolchain/dependencies.test.js
// proves src/ and bin/ import no package. So the gates resolve the
// repo's own pinned TS here, not a tsc floating on PATH — one oracle,
// the same version CI pins.
//
// The platform-binary resolution (typescript@7's `tsc` IS the native
// tsgo binary in @typescript/typescript-<os>-<arch>) already lives in
// tsgoBinaryPath(); reuse it rather than keep a second copy in sync, and
// wrap only the error with the repo-root install hint the gates want.
import fs from 'node:fs';
import path from 'node:path';
import { tsgoBinaryPath } from '../../packages/vscode/src/tsgo.js';

export function resolveTsc() {
  try {
    return tsgoBinaryPath();
  } catch {
    throw new Error(
      'typescript is not installed — run `bun install` at the repository root ' +
      '(the tsc-spawning validation gates need the repo\'s pinned TypeScript).',
    );
  }
}

// The pinned lib's own lib.dom.d.ts — the DOM oracle for gates that read
// the standard library as DATA rather than spawning the compiler. It sits
// beside the binary in the platform package, and the resolution goes
// through the real path so the node_modules/.bin shim lands in the same
// directory the direct hit would.
export function resolveDomLib() {
  const lib = path.join(path.dirname(fs.realpathSync(resolveTsc())), 'lib.dom.d.ts');
  if (!fs.existsSync(lib)) {
    throw new Error(
      `the pinned TypeScript has no lib.dom.d.ts at ${lib} — run \`bun install\` at the repository root.`,
    );
  }
  return lib;
}
