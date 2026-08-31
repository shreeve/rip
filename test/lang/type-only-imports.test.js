// Type-only import elision, judged by RUNNING the emission.
//
// The defect this guards against was invisible to every compile-only
// check: the face type-checked, `rip check` reported no errors, the JS
// looked reasonable — and the module died at load with `SyntaxError:
// Export named 'X' not found`, because the import named a binding the
// module exports only as a type. Nothing short of loading the emitted
// module can see that, so this test writes both files and imports one.
import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';

// Compile each .rip to .js beside it and return the entry's URL.
const build = (files, entry) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-typeimport-'));
  for (const [name, text] of Object.entries(files)) {
    const src = path.join(dir, name);
    fs.writeFileSync(src, text);
    fs.writeFileSync(src.replace(/\.rip$/, '.js'),
      compile(text, { path: src }).code.replace(/(from\s*|import\s*)(['"])(\.[^'"]*)\.rip\2/g, '$1$2$3.js$2'));
  }
  return { dir, url: 'file://' + path.join(dir, entry.replace(/\.rip$/, '.js')) };
};

const LIB = [
  'export type Shape = { form?: string }',
  'export val = 41',
  "console.log('lib ran')",
].join('\n') + '\n';

test('a module importing a type-only name loads', async () => {
  const { dir, url } = build({
    'lib.rip': LIB,
    'use.rip': [
      "import { val, Shape } from './lib.rip'",
      'errors: Shape = {}',
      'export answer = val + 1',
      'export seen = errors',
    ].join('\n') + '\n',
  }, 'use.rip');
  try {
    // The import is the assertion: a surviving `Shape` specifier throws
    // SyntaxError here, before any of this runs.
    const mod = await import(url);
    expect(mod.answer).toBe(42);
    expect(mod.seen).toEqual({});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a type used only in a parameter annotation elides', async () => {
  // The annotation rides the tree as a typed-var's text slot, not a side
  // table — the one type position a value-tree walk can mistake for a use.
  const { dir, url } = build({
    'lib.rip': LIB,
    'use.rip': [
      "import { val, Shape } from './lib.rip'",
      'export label = (s: Shape) -> val',
      'export answer = label({})',
    ].join('\n') + '\n',
  }, 'use.rip');
  try {
    const mod = await import(url);
    expect(mod.answer).toBe(41);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a type used only in a def param, alias body, and def-sig return elides', async () => {
  const { dir, url } = build({
    'lib.rip': LIB,
    'use.rip': [
      "import { Shape } from './lib.rip'",
      'type Local = Shape',
      'def f(s: Shape): Shape',
      'def f(s)',
      '  s',
      'export seen = f({})',
    ].join('\n') + '\n',
  }, 'use.rip');
  try {
    const mod = await import(url);
    expect(mod.seen).toEqual({});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a module whose whole clause is types still RUNS the module it imported", async () => {
  const { dir, url } = build({
    'lib.rip': LIB,
    'use.rip': [
      "import { Shape } from './lib.rip'",
      'errors: Shape = {}',
      'export seen = errors',
    ].join('\n') + '\n',
  }, 'use.rip');
  const logged = [];
  const realLog = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    const mod = await import(url);
    expect(mod.seen).toEqual({});
    // The side effect is the point: eliding every name must not take the
    // statement with it, or the module never runs.
    expect(logged).toContain('lib ran');
  } finally {
    console.log = realLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── `import type` — the author-declared whole-statement erasure ─────
//
// Per-name elision above can never drop the STATEMENT: the emitter
// cannot know the module carries no side effect the program needs.
// `import type` is the author supplying that knowledge, so the JS
// loses the statement whole — module load included.

test('an `import type` clause erases the whole statement — the module never runs', async () => {
  const { dir, url } = build({
    'lib.rip': LIB,
    'use.rip': [
      "import type { Shape } from './lib.rip'",
      'errors: Shape = {}',
      'export seen = errors',
    ].join('\n') + '\n',
  }, 'use.rip');
  const logged = [];
  const realLog = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    const mod = await import(url);
    expect(mod.seen).toEqual({});
    expect(logged).not.toContain('lib ran');
  } finally {
    console.log = realLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a type-only import of a module with NO runtime face still loads', async () => {
  // A consumer (a test runner, a browser) parses whatever module the
  // emission imports, so a type-only import of a module that exists
  // only as .rip source must leave the JS with nothing to resolve.
  const { dir, url } = build({
    'use.rip': [
      "import type { Shape } from './missing.rip'",
      'errors: Shape = {}',
      'export seen = errors',
    ].join('\n') + '\n',
  }, 'use.rip');
  try {
    const mod = await import(url);
    expect(mod.seen).toEqual({});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the two plain readings of `type` keep their statements', () => {
  // TypeScript's lookahead rule, applied at the lexer: `type` followed
  // by `from` is a default binding named `type`; `type` inside braces
  // is a named binding. Both are value imports and emit as written.
  const one = compile("import type from 'mod'\nexport use = type\n", { runtimeDelivery: 'none' });
  expect(one.code).toContain("import type from 'mod';");
  const two = compile("import { type } from 'mod'\nexport use = type\n", { runtimeDelivery: 'none' });
  expect(two.code).toContain("import { type } from 'mod';");
});

test('every type-only clause form erases from the JS and rides the TS face', () => {
  const src = [
    "import type Big from './big.rip'",
    "import type * as NS from './ns.rip'",
    "import type {} from './empty.rip'",
    "import type { Shape, Form as F } from './lib.rip'",
    // Every clause name USED in a type position: a type-only
    // statement's bindings stay out of the per-name elision set, so
    // the shared clause path prints them plainly — an all-classified
    // clause would print its names unseparated.
    'x: Shape = 1',
    'y: F = 2',
  ].join('\n') + '\n';
  const js = compile(src, { runtimeDelivery: 'none' });
  expect(js.code).toBe('let x = 1;\nlet y = 2;');
  const ts = compile(src, { runtimeDelivery: 'none', face: 'ts' });
  expect(ts.code).toContain("import type Big from './big.rip';");
  expect(ts.code).toContain("import type * as NS from './ns.rip';");
  expect(ts.code).toContain("import type {} from './empty.rip';");
  expect(ts.code).toContain("import type { Shape, Form as F } from './lib.rip';");
  // The strip gate: deleting the TS-only regions reproduces the JS.
  expect(stripFace(ts.code, ts.tsRegions)).toBe(js.code);
});
