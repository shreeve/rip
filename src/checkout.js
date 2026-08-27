// Which rip checkout owns a path — the one question the stdlib's
// location turns on, spelled ONCE for the runtime loader (src/resolve.js)
// and for the editor and `rip check` mirror (packages/vscode/src/mirror.js).
// Two spellings that drift put a file's types and its execution in
// different trees, and nothing warns: the checker reads one copy of a
// package while the runtime loads another.

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

// What makes a `packages` directory a stdlib rather than any other
// directory of that name: rip's OWN editor package sits in it. The test
// reads the manifest's name — a monorepo that merely has a
// `packages/vscode/` of its own (a common way to ship an extension) is
// not a rip checkout, and serving it its own `packages` as the stdlib
// would strand every `rip/*` name it imports.
export const holdsStdlib = (packagesDir) => {
  try { return JSON.parse(readFileSync(join(packagesDir, 'vscode', 'package.json'), 'utf8')).name === 'vscode-rip'; }
  catch { return false; }
};

// The stdlib of the checkout enclosing `from`, or null when none does —
// every consumer app, which is served the stdlib the running binary
// carries instead.
export const enclosingStdlib = (from) => {
  if (typeof from !== 'string' || from === '') return null;
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const packagesDir = join(dir, 'packages');
    if (holdsStdlib(packagesDir)) return packagesDir;
    if (dirname(dir) === dir) return null;
  }
};
