#!/usr/bin/env bun

// scripts/local.mjs — point THIS checkout's @rip-lang/* at packages/*.
//
//   bun run local
//
// Idempotent. Plants ./node_modules/@rip-lang/<name> -> ../../packages/<dir>
// for every @rip-lang/* workspace package, then fails loudly if any name
// still resolves outside this repo (a sibling tree under ~/node_modules).
// Does not touch ~/. That is `bun run global`.
//
// postinstall and test:all run this with --quiet.

import { createRequire } from 'node:module';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, rmSync, statSync, symlinkSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
const quiet = process.argv.includes('--quiet');
const require = createRequire(join(repoRoot, 'package.json'));
const scopeDir = join(repoRoot, 'node_modules', '@rip-lang');

const linkTo = (path, target) => {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() && readlinkSync(path) === target) return false;
    rmSync(path, { recursive: true, force: true });
  } catch {}
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
  return true;
};

const pkgs = readdirSync(join(repoRoot, 'packages')).filter((name) => {
  try { return statSync(join(repoRoot, 'packages', name, 'package.json')).isFile(); } catch { return false; }
});

const changes = [];
const expected = new Map(); // @rip-lang/name -> absolute package.json path

for (const dir of pkgs) {
  const pkgRoot = join(repoRoot, 'packages', dir);
  const manifestPath = join(pkgRoot, 'package.json');
  const name = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
  if (!name?.startsWith('@rip-lang/')) continue;
  const short = name.slice('@rip-lang/'.length);
  const linkPath = join(scopeDir, short);
  const rel = relative(dirname(linkPath), pkgRoot) || '.';
  if (linkTo(linkPath, rel)) changes.push(`linked  node_modules/@rip-lang/${short} -> ${rel}`);
  expected.set(name, manifestPath);
}

// Drop stale @rip-lang/* entries that are not packages in this checkout.
if (existsSync(scopeDir)) {
  const keep = new Set([...expected.keys()].map((n) => n.slice('@rip-lang/'.length)));
  for (const entry of readdirSync(scopeDir)) {
    if (keep.has(entry)) continue;
    const path = join(scopeDir, entry);
    try {
      if (!lstatSync(path).isSymbolicLink()) continue;
      rmSync(path, { force: true });
      changes.push(`removed node_modules/@rip-lang/${entry}`);
    } catch {}
  }
}

const wrong = [];
let checked = 0;
for (const [name, manifestPath] of expected) {
  let resolved;
  try {
    resolved = realpathSync(require.resolve(`${name}/package.json`));
  } catch {
    wrong.push({ name, resolved: '(unresolvable)', expected: manifestPath });
    continue;
  }
  checked += 1;
  if (resolved !== manifestPath) wrong.push({ name, resolved, expected: manifestPath });
}

if (wrong.length > 0) {
  console.error('');
  console.error('  FATAL: @rip-lang/* still resolves outside this repo after local link.');
  for (const { name, resolved, expected: want } of wrong) {
    console.error(`    ${name}`);
    console.error(`      found:    ${resolved}`);
    console.error(`      expected: ${want}`);
  }
  console.error('');
  console.error('  Fix with: rm -rf node_modules bun.lock && bun install && bun run local');
  console.error('');
  process.exit(1);
}

if (!quiet) {
  if (changes.length) {
    for (const line of changes) console.log(`  ${line}`);
  }
  console.log(`[rip] local: ${checked} @rip-lang/* packages -> ${repoRoot}/packages`);
}
