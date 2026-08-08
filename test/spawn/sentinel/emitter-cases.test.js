// Process pins: concurrent async `_` and schema-body strict-module hoist.
import { describe, test, expect } from 'bun:test';
import { spawnSync } from '../../support/spawn.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve(import.meta.dir, '../../../bin/rip');

describe('match reads deliver the stdlib runtime', () => {
  test('concurrent async invocations keep their own `_` across await interleavings', () => {
    // Real module: concurrent async `_` must not share one binding.
    const src = [
      '"seed" =~ /s(e)ed/',
      'f = (s, ms) ->',
      '  s =~ /x(\\w+)/',
      '  await sleep ms',
      '  _[1]',
      'main = ->',
      '  [a, b] = await Promise.all [f("xAAA", 30), f("xBBB", 5)]',
      '  console.log "#{a} #{b}"',
      'main()',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'rip-match-'));
    try {
      const file = join(dir, 'probe.rip');
      writeFileSync(file, src);
      const run = spawnSync('bun', [BIN, file], { encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(run.stdout).toBe('AAA BBB\n');
      expect(run.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a single-statement schema body hoists its targets like a multi-statement one', () => {
    // The battery evaluates in sloppy eval where an undeclared write
    // leaks to the global — only a real (strict) module exposes a
    // missing declaration, so this pin runs via bin/rip. Byte pins for
    // the hoist live in test/lang/emitter-cases.test.js.
    const src = [
      'X = schema :shape',
      '  name! string',
      '  tail: -> ("abc" =~ /b(c)/) and _[1]',
      '  five: -> (y = 5) and y',
      'x = X.parse({name: "n"})',
      'console.log x.tail(), x.five()',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'rip-match-'));
    try {
      const file = join(dir, 'probe.rip');
      writeFileSync(file, src);
      const run = spawnSync('bun', [BIN, file], { encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(run.stdout).toBe('c 5\n');
      expect(run.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
