// The grammar toolchain regenerates src/parser.js byte-identically —
// the committed file is always current with src/grammar/grammar.rip.
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');

test('`bun run parser` regenerates src/parser.js byte-identically (the committed file is current)', () => {
  const committed = readFileSync(join(root, 'src/parser.js'));
  const out = join(mkdtempSync(join(tmpdir(), 'rip-parser-')), 'parser.js');
  const r = spawnSync('bun', ['src/grammar/solar.rip', '-o', out, 'src/grammar/grammar.rip'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  expect(readFileSync(out).equals(committed)).toBe(true);
});
