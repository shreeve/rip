// The zero-dependency policy as a standing gate: the
// repository's dependency graph is empty, runtime AND dev — needed
// functionality is built in-repo, and external tools reviewers use
// ephemerally never enter package.json.
import { test, expect } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(import.meta.dir, '../..');
const packagesDir = join(repoRoot, 'packages');

test('package.json declares no dependencies of any kind', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
  // The root IS the packages/* workspace root (owner decision: in-tree
  // @rip-lang/* resolution, hoisted linker) — but the workspace brings
  // the compiler itself no dependencies: the fields above stay empty.
  expect(pkg.workspaces).toEqual(['packages/*']);
});

// Workspace packages must not carry a sibling bun.lock. Under
// linker=hoisted, `bun install` from a package directory still resolves
// against the ROOT lockfile — a package-local lock is not isolation, and
// CI's frozen-lockfile gate is root-only. Nested quarantine trees that
// are their own package (csv/bench, print/vscode) may keep a lock.
test('workspace package roots do not carry a local bun.lock', () => {
  const offenders = [];
  for (const name of readdirSync(packagesDir)) {
    const pkgJson = join(packagesDir, name, 'package.json');
    if (!existsSync(pkgJson)) continue;
    const lock = join(packagesDir, name, 'bun.lock');
    if (existsSync(lock)) offenders.push(`packages/${name}/bun.lock`);
  }
  expect(offenders).toEqual([]);
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

test('packages/vscode stays inside the dependency budget, exact pins only', () => {
  const pkg = JSON.parse(readFileSync(join(packagesDir, 'vscode/package.json'), 'utf8'));
  const deps = pkg.dependencies ?? {};
  const allowed = new Set(['typescript', 'vscode-languageclient', 'vscode-languageserver', 'vscode-languageserver-textdocument']);
  for (const [name, version] of Object.entries(deps)) {
    expect(allowed.has(name)).toBe(true);
    expect(version).toMatch(/^\d/); // exact pin, no range sigils
  }
  expect(pkg.devDependencies ?? null).toBeNull();
});

test('packages/ui isolates an exact Tailwind dependency budget', () => {
  const pkg = JSON.parse(readFileSync(join(packagesDir, 'ui/package.json'), 'utf8'));
  const deps = pkg.dependencies ?? {};
  expect(Object.keys(deps).sort()).toEqual(['css-tree', 'tailwindcss']);
  for (const version of Object.values(deps)) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  for (const field of ['devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
});

test('packages/app remains dependency-free', () => {
  const pkg = JSON.parse(readFileSync(join(packagesDir, 'app/package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
});
