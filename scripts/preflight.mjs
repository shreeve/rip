// Preflight for the extended tier. The tsc-spawning validity gates and
// the tsgo-driven editor tests need the workspace's pinned TypeScript —
// specifically the platform-native tsgo binary, which ships as an
// OPTIONAL dependency of typescript@7 (`@typescript/typescript-<os>-<arch>`).
// Because it is optional, a `--omit=optional` install, a cross-arch cache,
// or an unlisted platform can leave it absent while `bun install` still
// reports success — and on a fresh checkout with no install it is gone
// entirely. Either way the tsgo tests scatter confusing failures across
// the suite, so resolve the binary here and fail fast with ONE clear,
// actionable message instead.
import { tsgoBinaryPath } from '../packages/vscode/src/tsgo.js';

try {
  tsgoBinaryPath();
} catch (e) {
  console.error(
    '\n✗ The tsgo binary is not available.\n\n' +
    '  Run `bun install` at the repository root, then re-run this command.\n' +
    '  (The extended tier spawns the workspace\'s pinned TypeScript / tsgo;\n' +
    '   the native binary ships as an optional dependency of typescript@7,\n' +
    '   so a partial install can drop it. The default `bun test` loop needs\n' +
    '   no install.)\n\n' +
    `  Underlying error: ${e?.message ?? e}\n`,
  );
  process.exit(1);
}
