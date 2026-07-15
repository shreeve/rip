import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { binPath, fixtures, run, stubbedEnv } from './helpers.js';

// Flag handling and error paths, pinned by running the v3
// implementation as the oracle. These paths never start the server.

describe('rip-print CLI', () => {
  test('-v prints the version and exits 0', () => {
    const r = run(['-v']);
    expect(r.exitCode).toBe(0);
    // v3 wart, pinned: the hard-coded CLI version string lags the
    // v3 package.json version (1.1.127). Byte-for-byte v3 output.
    expect(r.stdout.toString()).toBe('rip-print 1.1.59\n');
  });

  test('--version matches -v', () => {
    const r = run(['--version']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe('rip-print 1.1.59\n');
  });

  test('-h prints usage and exits 0', () => {
    const r = run(['-h']);
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain('usage: rip-print [options] <paths ...>');
    expect(out).toContain('-b, --bypass     Strip leading comment blocks from files');
    expect(out).toContain('-d, --dark       Use dark theme (default: light)');
    expect(out).toContain('-x <exts>        Comma list of extensions to exclude');
    expect(out).toContain('rip-print -x lock,map src/  # Exclude .lock and .map files');
  });

  test('a missing path reports Not found and exits 1', () => {
    const r = run(['/nonexistent-path-zzz']);
    expect(r.exitCode).toBe(1);
    const err = r.stderr.toString();
    expect(err).toContain('Not found: /nonexistent-path-zzz');
    expect(err).toContain('No files found');
  });

  test('bin/rip-print forwards argv and exit status', () => {
    const v = spawnSync(process.execPath, [binPath, '-v'], { encoding: 'utf8', env: stubbedEnv });
    expect(v.status).toBe(0);
    expect(v.stdout).toBe('rip-print 1.1.59\n');

    const nf = spawnSync(process.execPath, [binPath, '/nonexistent-path-zzz'], {
      encoding: 'utf8',
      env: stubbedEnv,
      cwd: fixtures,
    });
    expect(nf.status).toBe(1);
    expect(nf.stderr).toContain('Not found: /nonexistent-path-zzz');
  });
});
