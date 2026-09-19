// `rip check` — the argv/usage surface. These cases touch no server
// and stay always-on (no extended gate). The runner and workspace
// builders live in ./support/check-harness.js.

import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from '../../support/spawn.js';
import { BIN, check } from './support/check-harness.js';

describe('rip check: usage surface (no server)', () => {
  test('--help prints usage and exits 0', () => {
    const r = spawnSync('bun', [BIN, 'check', '--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('rip check');
    expect(r.stdout).toContain('Usage:');
  });

  test('a directory with no .rip files is clean (exit 0)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-empty-'));
    try {
      const r = check(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('no .rip files found');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // The build hash makes CLI-vs-editor skew diagnosable at a glance: the
  // editor logs the same identity in its ready line, computed over the
  // same two trees (compiler + server) by content, so an installed
  // extension and a worktree CLI agree exactly when their code does.
  test('--build prints the build identity and exits 0', () => {
    const r = spawnSync('bun', [BIN, 'check', '--build'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^rip check build [0-9a-f]+\n  compiler  .+\n  server    .+\n$/);
  });

  test('an unknown flag exits 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-flag-'));
    try {
      const r = check(dir, ['--nope']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('unknown option');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
