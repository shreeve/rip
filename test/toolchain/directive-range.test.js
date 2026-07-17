// A `# @ts-expect-error` governs the next SOURCE STATEMENT'S HEAD LINE only —
// not its indented block. That is tsc's next-line rule; rip must not be
// stronger and swallow body errors the marker never contemplated.
//
// The type-audit `verdict` cannot see over-suppression: zero Errors looks
// like a pass. This gate drives `rip check --json` on an inline fixture.
import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeExtended } from '../support/extended.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const BIN = path.join(ROOT, 'bin/rip');
const TSCONFIG = path.join(ROOT, 'test/type-audit/tsconfig.json');

function workspace(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-directive-range-'));
  fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

function checkJson(dir) {
  const r = spawnSync('bun', [BIN, 'check', '--json'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000,
  });
  return { status: r.status, diags: JSON.parse(r.stdout || '[]'), stderr: r.stderr };
}

describeExtended('directive range is head-line-only (tsc next-line parity)', () => {
  test('a directive above a def does NOT absorb a body type error', () => {
    const dir = workspace({
      'block.rip': [
        '# @ts-expect-error — head line only; body must stay loud',
        'def f(x: number)',
        '  y: string = x',
        '  console.log y',
        '',
      ].join('\n'),
    });
    try {
      const { status, diags } = checkJson(dir);
      const codes = diags.map((d) => d.code);
      // Body mismatch stays loud; unused directive self-reports (TS2578).
      expect(status).toBe(1);
      expect(codes).toContain(2322);
      expect(codes).toContain(2578);
      expect(codes.filter((c) => c === 2322)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('a directive over a single-line statement still absorbs (intended use)', () => {
    const dir = workspace({
      'ok.rip': [
        '# @ts-expect-error — deliberately wrong, acknowledged',
        "n: number = 'oops'",
        'console.log n',
        '',
      ].join('\n'),
    });
    try {
      const { status, diags } = checkJson(dir);
      expect(status).toBe(0);
      expect(diags).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
