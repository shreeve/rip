// The zero-dependency policy as a standing gate: the
// repository's dependency graph is empty, runtime AND dev — needed
// functionality is built in-repo, and external tools reviewers use
// ephemerally never enter package.json.
import { test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

test('package.json declares no dependencies of any kind', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
  // The compiler package is also not a workspace root: packages/vscode is
  // standalone, never hoisted into the compiler's dependency graph.
  expect(pkg.workspaces).toBeUndefined();
});

// The editor-integration package carries a minimal, pinned,
// ledger-enumerated dependency budget. Anything beyond the budget
// is a new ledger decision, never a quiet `bun add`; every version is an
// EXACT pin so an upgrade is a visible, reviewed act.
const VSCODE_DEPENDENCY_BUDGET = new Set([
  'typescript',
  'vscode-languageclient',
  'vscode-languageserver',
  'vscode-languageserver-textdocument',
]);
