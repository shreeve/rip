// `rip lint` — the CLI over the lint rules. The rules themselves are pinned
// in-process (test/toolchain/lint-calls.test.js); these pin the command:
// dispatch, config, the rows and their positions, the exit status, and
// `--fix`.
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from '../../support/spawn.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BIN = path.join(ROOT, 'bin/rip');
const SOURCE = 'x = f a, b\ny = g(key: v)\nz = h(1)\n';

function workspace(files, rip = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-lint-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(rip ? { rip } : {}));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

function lint(dir, args = []) {
  return spawnSync('bun', [BIN, 'lint', ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
}

describe('rip lint', () => {
  test('a package without the key is not linted, and says so', () => {
    const dir = workspace({ 'a.rip': SOURCE });
    try {
      const r = lint(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('no package in these paths sets rip.lint');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a package with the key reports each finding at its source position and exits 1', () => {
    const dir = workspace({ 'a.rip': SOURCE }, { lint: { calls: 'explicit' } });
    try {
      const r = lint(dir, ['--no-frame']);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('a.rip:1:5 - error lint/calls: implicit call — write `f(a, b)`');
      expect(r.stdout).toContain('a.rip:2:5 - error lint/calls: keyword arguments without braces — write `g({ key: v })`');
      expect(r.stdout).toContain('Found 2 problems in 1 file (1 linted).');
      const rows = JSON.parse(lint(dir, ['--json']).stdout);
      expect(rows.map((row) => [row.line, row.column, row.endColumn, row.rule])).toEqual([[1, 5, 11, 'lint/calls'], [2, 5, 14, 'lint/calls']]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('--fix rewrites the file to the reported forms, then reports it clean', () => {
    const dir = workspace({ 'a.rip': SOURCE }, { lint: { calls: 'explicit' } });
    try {
      const r = lint(dir, ['--fix']);
      expect(fs.readFileSync(path.join(dir, 'a.rip'), 'utf8')).toBe('x = f(a, b)\ny = g({ key: v })\nz = h(1)\n');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('✓ No lint problems (1 file linted)');
      expect(r.stdout).toContain('1 file rewritten by --fix');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a file that does not compile is reported, not skipped', () => {
    const dir = workspace({ 'a.rip': 'x = (\n' }, { lint: { calls: 'explicit' } });
    try {
      const r = lint(dir, ['--no-frame']);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/^a\.rip:\d+:\d+ - error: /m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a malformed lint block ends the run naming the package.json and the key', () => {
    const dir = workspace({ 'a.rip': SOURCE }, { lint: { cals: true } });
    try {
      const r = lint(dir);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`${path.join(fs.realpathSync(dir), 'package.json')}: rip.lint: unknown rule \`cals\``);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('an unknown option exits 2', () => {
    const dir = workspace({ 'a.rip': SOURCE }, { lint: { calls: 'explicit' } });
    try {
      const r = lint(dir, ['--nope']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('unknown option: --nope');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
