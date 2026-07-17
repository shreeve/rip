// Per-file nearest-tsconfig: a nested package's strict:true must govern
// its .rip faces. Today one mirror-root wrapper extends only the workspace
// root tsconfig, so nested compilerOptions are ignored. Assert the CORRECT
// split (strict package → TS2322; loose root → clean). Red until wrappers land.
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
// No ambient globals — keep the only Error the nullability split.
const PROBE = 'x: string = null\nexport { x }\n';

function monorepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-tsconfig-projects-'));
  const write = (rel, text) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  write('package.json', '{}\n');
  write('tsconfig.json', JSON.stringify({
    compilerOptions: {
      strict: false, target: 'ES2022', module: 'ESNext', lib: ['ES2022'], noEmit: true,
    },
  }, null, 2));
  write('packages/strict/tsconfig.json', JSON.stringify({
    compilerOptions: {
      strict: true, target: 'ES2022', module: 'ESNext', lib: ['ES2022'], noEmit: true,
    },
  }, null, 2));
  write('root.rip', PROBE);
  write('packages/strict/a.rip', PROBE);
  return dir;
}

function checkJson(dir) {
  const r = spawnSync('bun', [BIN, 'check', '--json'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000,
  });
  return { status: r.status, diags: JSON.parse(r.stdout || '[]'), stderr: r.stderr };
}

function codesFor(diags, file) {
  return diags
    .filter((d) => d.file === file || d.file?.endsWith(file) || d.file?.endsWith(file.replaceAll('/', path.sep)))
    .map((d) => d.code);
}

describeExtended('per-project tsconfig resolution', () => {
  test('null→string is TS2322 only under the nearest strict package tsconfig', () => {
    const dir = monorepo();
    try {
      const { status, diags } = checkJson(dir);
      const nested = codesFor(diags, 'packages/strict/a.rip');
      const root = codesFor(diags, 'root.rip');

      expect(nested).toContain(2322);   // FAIL today: nested inherits loose root
      expect(root).not.toContain(2322); // stays true today and after
      expect(status).toBe(1);           // at least the nested error
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
