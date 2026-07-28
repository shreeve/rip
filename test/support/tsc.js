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
