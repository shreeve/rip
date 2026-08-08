// Process pins for effects: stack remap via loader, multi-file loader,
// async stack remap, and reactive-free session sentinel. In-process bulk
// lives in test/ui/effects.test.js.
import { test, expect, beforeAll, afterAll, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from '../../support/spawn.js';
import { compile as fullCompile } from '../../../src/compile.js';

const BIN = resolve(import.meta.dir, '../../../bin/rip');

const schemaFxSrc = [
  'count := 0',
  'S = schema :shape',
  '  a! integer',
  '  watch: -> ~> console.log "sum #{@a + count}"',
  'v = S.parse {a: 1}',
  'stop = v.watch()',
  'count = 1',
  'stop()',
  'count = 2',
  '',
].join('\n');


describe('the stack-trace showcase: an error in reactive code points at source', () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'rip-m9c-stack-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test('a throw INSIDE an effect body resolves to the .rip line:col end-to-end', () => {
    const src = [
 'count := 0',            // 1
 'armed = false',         // 2
 '~>',                    // 3
 '  probe = count',       // 4
 '  throw new Error "effect kapow #{probe}" if armed', // 5 — `Error` at col 13
 'armed = true',          // 6
 'count = 1',             // 7 — the write that triggers the flush
 '',
    ].join('\n');
    const path = join(dir, 'fx.rip');
    writeFileSync(path, src);
    // The generated line of the throw differs from the source line
    // (hoist + wrapper shift) — assert the remap is real.
    const { code } = fullCompile(src, { path: 'fx.rip' });
    const genLine = code.slice(0, code.indexOf('throw new Error')).split('\n').length;
    expect(genLine).not.toBe(5);
    const r = spawnSync('bun', [BIN, path], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('effect kapow 1');
    // The throw frame: source line 5, the `Error` construction column.
    expect(r.stderr).toMatch(/fx\.rip:5:13/);
    // The triggering write's frame resolves to source line 7.
    expect(r.stderr).toMatch(/fx\.rip:7(?![.\d])/);
    // No frame leaks the generated coordinates for the throw.
    expect(r.stderr).not.toMatch(new RegExp(`fx\\.rip:${genLine}:`));
  });
});

describe('effects: loader multi-file', () => {
  test('the loader path end to end: an exported handle disposes a cross-module effect', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9c-loader-'));
    try {
      writeFileSync(join(dir, 'store.rip'), [
 'export count := 0',
 'export watch ~> console.log "count is #{count}"',
 'def bump()',
 '  count += 1',
 'export { bump }',
 '',
      ].join('\n'));
      writeFileSync(join(dir, 'main.rip'), [
 'import { count, watch, bump } from "./store.rip"',
 'bump()',
 'watch()',
 'bump()',
 'console.log "final #{count.value}"',
 '',
      ].join('\n'));
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['count is 0', 'count is 1', 'final 2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('schema callable bodies: loader path', () => {
  const src = schemaFxSrc;
  test("end-to-end 'import': the loader path executes the same program", () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9c-schemafx-loader-'));
    try {
      writeFileSync(join(dir, 'main.rip'), src);
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['sum 1', 'sum 2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('async effect errors resolve to .rip coordinates', () => {
  test('the reported stack carries true source line:col through the loader reporter; exit stays 0 (report-and-continue)', () => {
    // Line-shifted (hoist + wrapper push the throw down in the
    // generated JS), so an unmapped frame cannot pass.
    const src = [
 'pad = 1',                                          // 1
 'count := 0',                                       // 2
 '~> =>',                                            // 3
 '  v = count',                                      // 4
 '  await Promise.resolve()',                        // 5
 '  throw new Error "async kapow #{v}" if v > 0',    // 6 — `Error` at col 13
 'count = 1',                                        // 7
 '',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9c-asyncerr-'));
    try {
      const path = join(dir, 'afx.rip');
      writeFileSync(path, src);
      const { code } = fullCompile(src, { path: 'afx.rip' });
      const genLine = code.slice(0, code.indexOf('throw new Error')).split('\n').length;
      expect(genLine).not.toBe(6);
      const r = spawnSync('bun', [BIN, path], { encoding: 'utf8' });
      // Report-and-continue: the rejection is handled by the runtime
      // (no synchronous caller exists to rethrow to — the design,
      // recorded in ), so the process completes normally…
      expect(r.status).toBe(0);
      // …and the report tells the truth about the source position.
      expect(r.stderr).toContain('[Rip] async effect error:');
      expect(r.stderr).toContain('async kapow 1');
      expect(r.stderr).toMatch(/afx\.rip:6:13/);
      expect(r.stderr).not.toMatch(new RegExp(`afx\\.rip:${genLine}:`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a reactive-free session never evaluates the runtime module (the sentinel stays unset)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9c-nosentinel-'));
    try {
      writeFileSync(join(dir, 'plain.rip'),
 'x = 1 + 2\nif globalThis[Symbol.for("rip.runtime.reactive")]\n  console.log "loaded"\nelse\n  console.log "unset"\n');
      const r = spawnSync('bun', [BIN, 'plain.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('unset');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
