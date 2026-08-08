// Process pins for the schema runtime: two-heap sentinels and
// multi-file loader paths. In-process bulk lives in test/schema/schema.test.js.
import { describe, test, expect } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

const SRC = 'S = schema\n  a! integer\nconsole.log(S.parse({a: 4}).a)';

describe('schema runtime: process pins', () => {
  test('the sentinel: two standalone copies in one process reject loudly', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-sentinel-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'two.js'), code);
      writeFileSync(join(dir, 'main.js'), `import './one.js';\nimport './two.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip schema runtime');
      expect(r.stderr).toContain('rip CLI/loader');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the sentinel: a standalone copy meeting the shared module rejects too', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const runtimePath = new URL('../../../src/runtime/schema.js', import.meta.url).pathname;
    const dir = mkdtempSync(join(tmpdir(), 'rip-sentinel2-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'main.js'), `import ${JSON.stringify(runtimePath)};\nimport './one.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip schema runtime');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('registration-only module feeds a schema-using module through the loader (end to end)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-regmod-'));
    try {
      writeFileSync(join(dir, 'coercers.rip'), 'registerCoercer "cents", (v) ->\n  n = Number(v)\n  if isNaN(n) then null else Math.round(n * 100)\n');
      writeFileSync(join(dir, 'main.rip'), 'import "./coercers.rip"\nPrice = schema\n  amount! ~:cents\nconsole.log(Price.parse({amount: "12.34"}).amount)\n');
      const rip = join(import.meta.dir, '../../../bin/rip');
      const r = spawnSync('bun', [rip, join(dir, 'main.rip')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('1234');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path runs schemas through the shared module (end to end)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-loader-'));
    try {
      writeFileSync(join(dir, 'mod.rip'), 'export Point = schema :shape\n  x! integer\n  y! integer\n');
      writeFileSync(join(dir, 'main.rip'), 'import { Point } from "./mod.rip"\np = Point.parse({x: 1, y: 2})\nconsole.log(p.x + p.y)\n');
      const rip = join(import.meta.dir, '../../../bin/rip');
      const r = spawnSync('bun', [rip, join(dir, 'main.rip')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('3');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
