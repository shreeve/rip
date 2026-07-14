// Preflight for the extended tier. The tsc-spawning validity gates and
// the tsgo-driven editor tests need the workspace's pinned TypeScript
// (resolved from node_modules). On a fresh checkout with no `bun install`
// that surfaces as a scatter of confusing failures across the suite —
// so fail fast here with ONE clear, actionable message instead.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
try {
  require.resolve('typescript/package.json');
} catch {
  console.error(
    '\n✗ Dependencies are not installed.\n\n' +
    '  Run `bun install` at the repository root, then re-run this command.\n' +
    '  (The extended tier spawns the workspace\'s pinned TypeScript / tsgo;\n' +
    '   the default `bun test` loop needs no install.)\n',
  );
  process.exit(1);
}
