// Process-lane tests live under test/spawn/. Outside that tree (and
// Philip's audit suite), suites must stay in-process — no child_process
// spawn, no Bun.spawn*. Hidden stdout-spawn is the defect this gate
// makes loud. `execSync('git …')` meta-gates are out of scope.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const TEST = join(ROOT, 'test');

const ALLOWED_PREFIX = [
  'test/spawn/',
  'test/audit/',
  'test/support/',
];

const FORBIDDEN = [
  /\bspawnSync\s*\(/,
  /\bBun\.spawn(?:Sync)?\s*\(/,
  /\bfrom\s+['"][^'"]*support\/spawn\.js['"]/,
  /\{\s*[^}]*\bspawn\b[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/,
];

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(?:js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
};

const allowed = (rel) => ALLOWED_PREFIX.some((p) => rel.startsWith(p));

describe('spawn boundary', () => {
  test('only test/spawn, test/audit, and test/support may spawn child processes', () => {
    const violations = [];
    for (const path of walk(TEST)) {
      const rel = relative(ROOT, path).split('\\').join('/');
      if (allowed(rel)) continue;
      if (rel === 'test/toolchain/spawn-boundary.test.js') continue;
      const text = readFileSync(path, 'utf8');
      for (const re of FORBIDDEN) {
        if (re.test(text)) {
          violations.push(`${rel} matches ${re}`);
          break;
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('the spawn tree exists with the process-lane areas', () => {
    for (const area of ['cli', 'sentinel', 'loader', 'tsc', 'bundle', 'repl']) {
      expect(existsSync(join(TEST, 'spawn', area))).toBe(true);
    }
  });
});
