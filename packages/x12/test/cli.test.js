import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// The CLI lives in x12.rip behind import.meta.main; bin/rip-x12 runs
// the module as a main script under the repository loader. Both entry
// points are exercised as real subprocesses.

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const x12Rip = join(pkgDir, 'x12.rip');
const loader = join(pkgDir, '..', '..', 'src', 'loader.js');
const binPath = join(pkgDir, 'bin', 'rip-x12');
const fixture = join(pkgDir, 'test', 'fixtures', '270.x12');

const cli = (...args) =>
  spawnSync(process.execPath, ['--preload', loader, x12Rip, ...args], { encoding: 'utf8' });
const bin = (...args) => spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8' });

describe('rip-x12 CLI', () => {
  test('-v prints the version', () => {
    const r = cli('-v');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('rip-x12 0.1.0\n');
  });

  test('-h prints usage', () => {
    const r = cli('-h');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('usage: rip-x12 [options] <file> <file> ...');
    expect(r.stdout).toContain('-q, --query <val>');
  });

  test('no files is an error', () => {
    const r = cli();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage: rip-x12');
  });

  test('-q queries selectors, pipe-separated', () => {
    const r = cli('-q', 'TRN-2,NM1-3', fixture);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('8675309-001|EXAMPLE HEALTH PLAN\n');
  });

  test('-q with -t emits tab-separated values', () => {
    const r = cli('-q', 'TRN-2, ST-1', '-t', fixture);
    expect(r.stdout).toBe('8675309-001\t270\n');
  });

  test('-f lists fields', () => {
    const r = cli('-f', fixture);
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('ISA-1          00');
    expect(lines).toContain('TRN-2          8675309-001');
    expect(lines).toContain('NM1(3)-3       DOE');
  });

  test('-F lists fields without occurrence indicators', () => {
    const r = cli('-F', fixture);
    expect(r.stdout).not.toContain('NM1(3)');
    expect(r.stdout).toContain('NM1-3          DOE');
  });

  test('no options shows the full message body', () => {
    const r = cli(fixture);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')[0]).toMatch(/^ISA\*00\*/);
    expect(r.stdout).toContain('IEA*1*100000001~');
  });

  test('-l lowercases segment tags', () => {
    const r = cli('-f', '-l', fixture);
    expect(r.stdout.split('\n')[0]).toBe('isa-1          00');
  });

  test('-c appends a message count', () => {
    const r = cli('-f', '-c', fixture);
    expect(r.stdout).toContain('\nTotal messages: 1\n');
  });

  test('a malformed file reports an error, silenced by -i', () => {
    const dir = mkdtempSync(join(tmpdir(), 'x12-'));
    const bad = join(dir, 'bad.x12');
    writeFileSync(bad, 'NOT X12 AT ALL');
    const loud = cli('-f', bad);
    expect(loud.stderr).toContain('malformed X12');
    const quiet = cli('-f', '-i', bad);
    expect(quiet.stderr).toBe('');
  });

  test('a missing path reports unknown and continues', () => {
    const r = cli('-q', 'TRN-2', '/nonexistent/nope.x12', fixture);
    expect(r.stderr).toContain('unknown: /nonexistent/nope.x12');
    expect(r.stdout).toBe('8675309-001\n');
  });
});

describe('bin/rip-x12', () => {
  test('forwards argv and stdout', () => {
    const r = bin('-q', 'TRN-2,GS-2', fixture);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('8675309-001|OFFALLY\n');
  });

  test('forwards the exit status', () => {
    expect(bin().status).toBe(1);
  });
});
