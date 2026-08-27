// Which checkout's stdlib a run serves.
//
// `rip/<pkg>` is local-first: the checkout enclosing the ENTRY serves it,
// so `rip <file>` and `rip check <file>` name the same copy of a package
// two checkouts both hold. Anchoring on the resolver's own location
// instead answers by which binary was invoked — a worktree file run under
// the PATH `rip` loaded the main checkout's copy while `rip check` read
// the worktree's, and nothing said so.
//
// A name present in only ONE checkout cannot show this: the other
// resolver fails to find it and the right copy answers by default. Every
// case here uses a package BOTH fixtures carry, differing only in what it
// exports.
import { test, expect, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { holdsStdlib, enclosingStdlib } from '../../../src/checkout.js';

const RIP = path.resolve(import.meta.dir, '..', '..', '..', 'bin', 'rip');
const NEUTRAL = fs.realpathSync(os.tmpdir());

const made = [];
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

// A checkout is known by rip's own editor package; `marker` is what the
// two fixtures disagree about.
function makeCheckout(marker) {
  const root = tmp('rip-anchor-');
  fs.mkdirSync(path.join(root, 'packages', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'vscode', 'package.json'), JSON.stringify({ name: 'vscode-rip' }));
  const pkg = path.join(root, 'packages', 'zzdual');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@rip/zzdual', exports: { '.': './zzdual.rip' } }));
  fs.writeFileSync(path.join(pkg, 'zzdual.rip'), `export origin = '${marker}'\n`);
  fs.writeFileSync(path.join(root, 'entry.rip'), "import { origin } from 'rip/zzdual'\nconsole.log origin\n");
  return root;
}

// Run from a cwd that is NOT either fixture, so only the entry can decide.
const runEntry = (root) => spawnSync(RIP, [path.join(root, 'entry.rip')], {
  cwd: NEUTRAL, encoding: 'utf8', env: process.env,
}).stdout.trim();

test('a checkout is known by rip\'s own editor package, not by the path', () => {
  const real = path.resolve(import.meta.dir, '..', '..', '..', 'packages');
  expect(holdsStdlib(real)).toBe(true);

  const lookalike = tmp('rip-lookalike-');
  fs.mkdirSync(path.join(lookalike, 'packages', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(lookalike, 'packages', 'vscode', 'package.json'), JSON.stringify({ name: '@acme/vscode' }));
  expect(holdsStdlib(path.join(lookalike, 'packages'))).toBe(false);
  expect(enclosingStdlib(lookalike)).toBe(null);
});

test('enclosingStdlib walks up, and answers null outside any checkout', () => {
  const root = makeCheckout('a');
  expect(enclosingStdlib(root)).toBe(path.join(root, 'packages'));
  expect(enclosingStdlib(path.join(root, 'packages', 'zzdual'))).toBe(path.join(root, 'packages'));
  expect(enclosingStdlib(tmp('rip-bare-'))).toBe(null);
});

test('one binary, one cwd, two entries — each serves its own checkout', () => {
  const a = makeCheckout('alpha');
  const b = makeCheckout('bravo');
  expect(runEntry(a)).toBe('alpha');
  expect(runEntry(b)).toBe('bravo');
}, 30000);

// The anchor is spent by the process it was aimed at. Left in the
// environment it outranks the cwd checkout's own resolver in every
// process the program goes on to spawn — a nested `bun test` or
// `rip sites` would serve this entry's stdlib instead of its own. Only a
// spawn that names an anchor gets one, so the nested view must be unset.
test('the anchor does not outlive the entry it was set for', () => {
  const a = makeCheckout('alpha');
  const outer = path.join(a, 'outer.rip');
  fs.writeFileSync(outer, [
    "import { spawnSync } from 'child_process'",
    "r = spawnSync 'bun', ['-e', \"console.log(process.env.RIP_STDLIB_ANCHOR ?? '<unset>')\"], { encoding: 'utf8' }",
    "console.log r.stdout.trim()",
  ].join('\n') + '\n');
  const out = spawnSync(RIP, [outer], { cwd: NEUTRAL, encoding: 'utf8', env: process.env });
  expect(out.stdout.trim()).toBe('<unset>');
}, 30000);

test('an entry outside any checkout runs against the binary\'s stdlib', () => {
  const outside = tmp('rip-consumer-');
  fs.writeFileSync(path.join(outside, 'entry.rip'), "import { check } from 'rip/validate'\nconsole.log check('7', 'int')\n");
  const out = spawnSync(RIP, [path.join(outside, 'entry.rip')], {
    cwd: NEUTRAL, encoding: 'utf8', env: process.env,
  });
  expect(out.stdout.trim()).toBe('7');
}, 30000);
