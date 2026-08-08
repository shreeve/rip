// Process pins for the component runtime: clean/no-DOM imports, two
// sentinel meetings, and the loader path. In-process bulk lives in
// test/ui/runtime-components.test.js.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from '../../support/spawn.js';
import parser from '../../../src/parser.js';
import { makeParserLexer } from '../../../src/lexer.js';
import { emit } from '../../../src/emitter.js';

parser.lexer = makeParserLexer();

const compile = (src, opts = {}) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src, ...opts });
};

const BIN = resolve(import.meta.dir, '../../../bin/rip');
const CRT_PATH = resolve(import.meta.dir, '../../../src/runtime/components.js');
const RRT_PATH = resolve(import.meta.dir, '../../../src/runtime/reactive.js');

const RUN_SRC = [
  'c = {_parent: null}',
  'prev = __pushComponent(c)',
  'setContext("theme", "dark")',
  'console.log(getContext("theme"))',
  'console.log(__clsx("a", {b: true}, ["c"]))',
  '__popComponent(prev)',
].join('\n');

describe('component runtime: process pins', () => {
  test('importing the module touches globalThis at the two sentinels ONLY — no __ripComponent, no __rip bridge', () => {
    // A fresh process: this test file imports the runtime templates above,
    // which DO write the bridge globals, so the assertion needs an
    // unpolluted globalThis. Importing components.js evaluates
    // reactive.js too (the module import), so both sentinels land.
    const code = [
      `await import(${JSON.stringify(pathToFileURL(CRT_PATH).href)});`,
      `if (globalThis.__ripComponent !== undefined) throw new Error('component bridge leaked');`,
      `if (globalThis.__rip !== undefined) throw new Error('reactive bridge leaked');`,
      `if (globalThis.getEffectSignal !== undefined) throw new Error('getEffectSignal global leaked');`,
      `if (globalThis[Symbol.for('rip.runtime.components')] !== true) throw new Error('components sentinel missing');`,
      `if (globalThis[Symbol.for('rip.runtime.reactive')] !== true) throw new Error('reactive sentinel missing');`,
      `console.log('clean');`,
    ].join('\n');
    const r = spawnSync('bun', ['-e', code], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('clean');
  });

  test('importing the module without a DOM is legal (document is touched only inside methods)', () => {
    const code = [
      `const m = await import(${JSON.stringify(pathToFileURL(CRT_PATH).href)});`,
      `if (typeof m.__Component !== 'function') throw new Error('no class');`,
      `console.log(m.__clsx('a', { b: true }));`,
    ].join('\n');
    const r = spawnSync('bun', ['-e', code], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('a b');
  });

  test('the practical sentinel meeting: two standalone fused copies reject loudly (the reactive tripwire fires first — the fused body evaluates reactive first)', () => {
    const { code } = compile(RUN_SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-csentinel-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'two.js'), code);
      writeFileSync(join(dir, 'main.js'), `import './one.js';\nimport './two.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip reactive runtime');
      expect(r.stderr).toContain('rip CLI/loader');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the components sentinel itself: a second components body meeting the shared module rejects with the component message", () => {
    // The shared modules evaluate first (module cache absorbs the
    // copy's reactive import), so the copy's COMPONENTS sentinel is
    // the tripwire that fires.
    const copySource = readFileSync(CRT_PATH, 'utf8')
      .replace("from './reactive.js'", `from ${JSON.stringify(pathToFileURL(RRT_PATH).href)}`);
    const dir = mkdtempSync(join(tmpdir(), 'rip-csentinel2-'));
    try {
      writeFileSync(join(dir, 'copy.js'), copySource);
      writeFileSync(join(dir, 'main.js'),
        `import ${JSON.stringify(pathToFileURL(CRT_PATH).href)};\nimport './copy.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip component runtime');
      expect(r.stderr).toContain('rip CLI/loader');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path end to end: a .rip file with hand-written references runs through the shared modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-cloaderpath-'));
    try {
      writeFileSync(join(dir, 'main.rip'), RUN_SRC + '\n');
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['dark', 'a b c']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
