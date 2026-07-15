// The rip-db executable's host wrapper: argument dispatch, help, and
// version — the paths that don't need a harbor. The command logic itself
// is covered in cli.test.js.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/rip-db', import.meta.url));
const rip = (...args) => {
  const r = spawnSync('bun', [BIN, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

describe('rip-db host wrapper', () => {
  test('--help prints usage and exits 0', () => {
    const r = rip('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('rip-db dump');
    expect(r.stdout).toContain('checkpoint');
    expect(r.stdout).toContain('does not start a database server');
  });

  test('--version prints a version line', () => {
    const r = rip('--version');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^rip-db v/);
  });

  test('an unknown subcommand exits 1 naming it, then prints usage', () => {
    const r = rip('bogus');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown subcommand 'bogus'");
    expect(r.stdout).toContain('rip-db dump');
  });

  test('dump rejects extra arguments before touching harbor', () => {
    const r = rip('dump', 'a.tar.gz', 'b.tar.gz');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage: rip-db dump');
  });

  test('checkpoint rejects an unknown flag', () => {
    const r = rip('checkpoint', '--nope');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown argument: --nope');
  });

  test('each subcommand has its own --help that exits 0 without touching harbor', () => {
    for (const [cmd, needle] of [['dump', 'Export the running harbor'], ['load', 'Restore a tar.gz'], ['checkpoint', 'flush the WAL']]) {
      const r = rip(cmd, '--help');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(needle);
    }
  });
});
