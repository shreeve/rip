// The shared harness behind the `rip check` gates (test/spawn/cli/check-*.test.js).
//
// `rip check` is the headless type-checker. The editor server is the only
// place type diagnostics are computed; `rip check` drives that same server
// in batch, so these gates spawn the REAL CLI against real temp workspaces
// and assert the mapped-back diagnostics, the exit status, and that config
// (rip.strict / rip.noCheck) and `@ts-expect-error` govern exactly as they
// do in the editor.
//
// The type cases need tsgo (they assert TS diagnostics), so they ride the
// EXTENDED tier alongside strict-modes.test.js. The argv/usage cases touch
// no server and stay always-on. The gates are split across files so
// `bun test --parallel` can schedule them on separate workers — each
// `check()` is a synchronous spawn, so one file is one serial lane.
//
// Everything here is stateless: each helper builds a fresh temp workspace
// per call and the caller removes it. Nothing is shared between files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from '../../../support/spawn.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '../../../..');
export const BIN = path.join(ROOT, 'bin/rip');
export const TSCONFIG = path.join(ROOT, 'test/audit/tsconfig.json');

// A fresh workspace: the fixtures' tsconfig (so tsgo runs the same
// posture the audit does — strictness riding tsgo's strict-by-default)
// plus whatever files/config the case needs.
export function workspace(files, ripConfig = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-'));
  fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(ripConfig ? { rip: ripConfig } : {}, null, 2));
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return dir;
}

// A TWO-PACKAGE workspace: a loose root beside a nested project with its
// own `tsconfig.json`. Every other fixture here is single-package, where a
// flat mirror root is indistinguishable from a correct per-project one —
// which is exactly why the per-project gap went unseen. `strict` is the
// discriminator because it changes an ANSWER (TS2322 on `x: string = null`)
// rather than merely a setting, so the assertion cannot pass by accident.
export function monorepo({ rootStrict = false, nestedStrict = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-mono-'));
  const base = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
  delete base.include;                       // the audit's own file set means nothing here
  delete base.exclude;
  base.compilerOptions.strict = rootStrict;
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(base, null, 2));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({}, null, 2));
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: nestedStrict } }, null, 2));
  fs.writeFileSync(path.join(dir, 'root.rip'), 'x: string = null\nconsole.log x\n');
  fs.writeFileSync(path.join(dir, 'pkg', 'a.rip'), 'y: string = null\nconsole.log y\n');
  return dir;
}

// A FRESH PROJECT: what a newcomer has after `bun init` plus a .rip
// file — a tsconfig, and @types/bun installed. `withTypes:false` is the
// same project before anything is installed, which is the posture the
// host floor exists for.
//
// The source is deliberately ordinary: the idioms rip encourages, not a
// minimal case. `(opts = {}) ->` is the shape that produced 329 of the
// 1,657 errors in a survey of packages/ (2026-07-31), and `import.meta.dir`
// another 143 — between them a fifth of everything a newcomer would see.
export const FRESH = [
  'greet = (name, opts = {}) ->',
  "  suffix = opts.suffix ?? ''",
  '  name + suffix',
  '',
  'here = import.meta.dir',
  "console.log greet('world', { suffix: '!' }), here",
  '',
].join('\n');

export function freshProject({ withTypes = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-fresh-'));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ESNext', module: 'preserve', moduleDetection: 'force', noEmit: true, skipLibCheck: true },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fresh', devDependencies: withTypes ? { '@types/bun': 'latest' } : {} }, null, 2));
  if (withTypes) {
    const t = path.join(dir, 'node_modules', '@types', 'bun');
    fs.mkdirSync(t, { recursive: true });
    fs.writeFileSync(path.join(t, 'package.json'), JSON.stringify({ name: '@types/bun', version: '1.0.0', types: 'index.d.ts' }));
    fs.writeFileSync(path.join(t, 'index.d.ts'),
      'declare var Bun: any;\ndeclare var process: any;\ninterface ImportMeta { dir: string; file: string; path: string }\n');
  }
  fs.writeFileSync(path.join(dir, 'app.rip'), FRESH);
  return dir;
}

export function check(dir, args = []) {
  const r = spawnSync('bun', [BIN, 'check', ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

// Mode-000 `file` for the duration of fn(). Returns false WITHOUT running
// fn on root/owner-override filesystems where the file stays readable
// anyway — callers bail, the scenario cannot exist there. The restore
// lives here so no failure path leaves an unreadable file for the
// caller's cleanup rmSync to trip on.
export function withUnreadable(file, fn) {
  fs.chmodSync(file, 0o000);
  try {
    try { fs.readFileSync(file, 'utf8'); return false; } catch { /* unreadable, as intended */ }
    fn();
    return true;
  } finally {
    try { fs.chmodSync(file, 0o644); } catch { /* gone with the fixture */ }
  }
}
