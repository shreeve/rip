// Process pins for the reactive runtime: clean-process import, two-heap
// sentinels, and the loader path. In-process bulk lives in
// test/ui/runtime-reactive.test.js.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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
const RT_PATH = resolve(import.meta.dir, '../../../src/runtime/reactive.js');
const SRC = 'n = __state(1)\nstop = __effect(-> console.log(n.value))\nn.value = 7\nstop()';

describe('reactive runtime: process pins', () => {
  test('importing the module touches globalThis at the sentinel ONLY — no __rip bridge, no getEffectSignal global', () => {
    // A fresh process: this test file imports the runtime template above,
    // which DOES write the bridge globals, so the assertion needs an
    // unpolluted globalThis.
    const code = [
      `await import(${JSON.stringify(pathToFileURL(RT_PATH).href)});`,
      `if (globalThis.__rip !== undefined) throw new Error('bridge object leaked');`,
      `if (globalThis.getEffectSignal !== undefined) throw new Error('getEffectSignal global leaked');`,
      `if (globalThis[Symbol.for('rip.runtime.reactive')] !== true) throw new Error('sentinel missing');`,
      `console.log('clean');`,
    ].join('\n');
    const r = spawnSync('bun', ['-e', code], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('clean');
  });

  test('the sentinel: two standalone copies in one process reject loudly', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-rsentinel-'));
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

  test('the sentinel: a standalone copy meeting the shared module rejects too', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-rsentinel2-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'main.js'), `import ${JSON.stringify(RT_PATH)};\nimport './one.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip reactive runtime');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path end to end: a .rip file with hand-written references runs through the shared module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-loaderpath-'));
    try {
      writeFileSync(join(dir, 'main.rip'), 'counter = __state(10)\nstop = __effect(-> console.log("saw " + counter.value))\ncounter.value = 11\nstop()\n');
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['saw 10', 'saw 11']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
