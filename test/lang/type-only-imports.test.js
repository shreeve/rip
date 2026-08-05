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
