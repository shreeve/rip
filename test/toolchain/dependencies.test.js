// The dependency policy as a standing gate.
//
// The compiler core ships nothing: the root declares no runtime
// dependencies. Dev dependencies are TypeScript (the tsc-spawning
// validity oracle in test/support/tsc.js) and the exact pin of
// `@tailwindcss/browser` that `bun run tailwind` vendors into
// dist/@rip/. That the SHIPPED compiler stays free of both is proven
// by the purity gate below, not by an empty graph: every import in
// src/ and bin/ resolves to a relative path or a runtime builtin,
// never a package that would enter node_modules.
//
// TypeScript's VERSION is spelled once — in the workspace catalog. The
// two packages that own it as their own concern reference it as
// `catalog:` (the root's test toolchain, and the shipped editor
// extension, whose vsix carries and declares it). The audit
// harness never ships and only borrows the editor's resolver, so it
// declares no TypeScript at all. The editor-integration package stays
// inside a minimal, enumerated dependency budget — anything beyond it is
// a deliberate change, never a quiet `bun add`.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { builtinModules } from 'module';

const ROOT = join(import.meta.dir, '../..');
const readPkg = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

test('root declares no runtime dependencies; TypeScript lives once in the workspace catalog', () => {
  const pkg = readPkg('package.json');
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
  // Dev graph: TypeScript from the catalog, plus the exact Tailwind
  // browser pin consumed only by scripts/tailwind-bundle.mjs.
  expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual(
    ['@tailwindcss/browser', 'typescript'].sort(),
  );
  expect(pkg.devDependencies.typescript).toBe('catalog:');
  expect(pkg.devDependencies['@tailwindcss/browser']).toMatch(/^\d/);
  // The TypeScript version — the ONE place it is spelled — is an exact pin.
  expect(pkg.catalog?.typescript).toMatch(/^\d/); // no range sigils
  // The root is the workspace root (owner decision: in-tree rip/*
  // resolution, hoisted linker). Playwright lives under test/browser as
  // its own workspace member — not a packages/* lane.
  expect(pkg.workspaces).toEqual(['packages/*', 'test/browser']);
});

test('the cart demo\'s @types/bun rides the Bun pin', () => {
  // The demo installs its own host types (it is not a workspace member, so
  // nothing hoists), and the version is the Bun pin spelled once more —
  // this gate keeps it in lockstep so a Bun upgrade cannot strand the
  // demo's types on the version it left. The pin is read from
  // `.bun-version`, the ONE place it is spelled: the workflows reach it
  // through `bun-version-file` and test/toolchain/bun-pin.test.js refuses
  // a literal `bun-version:` anywhere, so scraping a workflow here would
  // assert the very spelling that gate forbids.
  const pin = readFileSync(join(ROOT, '.bun-version'), 'utf8').trim();
  expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  const cart = readPkg('packages/sites/demos/cart/package.json');
  expect(cart.devDependencies['@types/bun']).toBe(pin);
});

// Workspace packages must not carry a sibling bun.lock. Under
// linker=hoisted, `bun install` from a package directory still resolves
// against the ROOT lockfile — a package-local lock is not isolation, and
// CI's frozen-lockfile gate is root-only. Nested quarantine trees that
// are their own package (csv/bench, print/vscode) may keep a lock.
test('workspace package roots do not carry a local bun.lock', () => {
  const packagesDir = join(ROOT, 'packages');
  const offenders = [];
  for (const name of readdirSync(packagesDir)) {
    const pkgJson = join(packagesDir, name, 'package.json');
    if (!existsSync(pkgJson)) continue;
    const lock = join(packagesDir, name, 'bun.lock');
    if (existsSync(lock)) offenders.push(`packages/${name}/bun.lock`);
  }
  expect(offenders).toEqual([]);
});

test('packages/vscode stays inside the dependency budget; every pin is exact or the catalog', () => {
  const pkg = readPkg('packages/vscode/package.json');
  const allowed = new Set(['typescript', 'vscode-languageclient', 'vscode-languageserver', 'vscode-languageserver-textdocument']);
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    expect(allowed.has(name)).toBe(true);
    // typescript rides the catalog; the rest are exact pins, no range sigils.
    expect(name === 'typescript' ? version === 'catalog:' : /^\d/.test(version)).toBe(true);
  }
  expect(pkg.devDependencies ?? null).toBeNull();
});

test('TypeScript is declared once — every reference is `catalog:`, no literal pin, and non-shipping harnesses declare none', () => {
  const version = readPkg('package.json').catalog.typescript;
  expect(version).toMatch(/^\d/);
  // The two owners reference the catalog.
  expect(readPkg('package.json').devDependencies.typescript).toBe('catalog:');
  expect(readPkg('packages/vscode/package.json').dependencies.typescript).toBe('catalog:');
  // audit only borrows the editor's resolver — it declares no TypeScript.
  const audit = readPkg('test/audit/package.json');
  expect(audit.dependencies?.typescript).toBeUndefined();
  expect(audit.devDependencies?.typescript).toBeUndefined();
  // No manifest spells a literal TS version anywhere but the catalog.
  for (const rel of ['package.json', 'packages/vscode/package.json', 'test/audit/package.json']) {
    const p = readPkg(rel);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const v = p[field]?.typescript;
      if (v !== undefined) expect(v).toBe('catalog:');
    }
  }
});

// The purity gate: the shipped compiler imports nothing from
// node_modules. Bun.Transpiler.scan reads the REAL imports (import
// syntax the compiler manipulates as string data is not miscounted),
// and each specifier must be a relative path or a runtime builtin
// (node:, bun:, or a bare builtin) — never a package name. This is the
// invariant "root declares no deps" used to stand in for; asserting it
// directly is what lets TypeScript sit in the workspace honestly.
const RUNTIME_BUILTINS = new Set([...builtinModules, 'bun']);
const isPure = (spec) =>
  spec.startsWith('.') || spec.startsWith('/') ||
  spec.startsWith('node:') || spec.startsWith('bun:') ||
  RUNTIME_BUILTINS.has(spec) || RUNTIME_BUILTINS.has(spec.split('/')[0]);

const collectJs = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectJs(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
};

test('the shipped compiler imports no package — src/ and bin/ carry only relative paths and runtime builtins', () => {
  const transpiler = new Bun.Transpiler({ loader: 'js' });
  const files = [...collectJs(join(ROOT, 'src')), join(ROOT, 'bin/rip')];
  const violations = [];
  for (const file of files) {
    let code = readFileSync(file, 'utf8');
    if (code.startsWith('#!')) code = code.slice(code.indexOf('\n') + 1); // strip shebang
    for (const imp of transpiler.scan(code).imports) {
      if (!isPure(imp.path)) violations.push(`${file.replace(`${ROOT}/`, '')}: ${imp.kind} '${imp.path}'`);
    }
  }
  expect(files.length).toBeGreaterThan(20); // not vacuous
  expect(violations, `the compiler source imports a package:\n${violations.join('\n')}`).toEqual([]);
});

test('packages/ui isolates an exact Tailwind dependency budget', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../../packages/ui/package.json'), 'utf8'));
  const deps = pkg.dependencies ?? {};
  expect(Object.keys(deps).sort()).toEqual(['css-tree', 'tailwindcss']);
  for (const version of Object.values(deps)) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  for (const field of ['devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
});

test('packages/app remains dependency-free', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../../packages/app/package.json'), 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
  // Its tests import rip/testing through the loader's stdlib
  // namespace; nothing is declared, nothing ships.
  expect(pkg.devDependencies).toBeUndefined();
});
