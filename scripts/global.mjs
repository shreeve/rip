#!/usr/bin/env bun

// scripts/global.mjs — make THIS checkout the machine's global Rip.
//
//   bun run global
//
// Idempotent. Symlinks:
//
//   ~/.bun/bin/rip                       -> $REPO/bin/rip
//   ~/.bun/bin/<bin>                     -> $REPO/packages/<pkg>/<entry>
//   ~/.bun/install/global/node_modules/.bin/<bin>       (same, when present)
//
// Module resolution needs no links: the loader's `rip/<pkg>` stdlib
// namespace resolves from whichever checkout owns the `rip` bin.
// Running another checkout's `bun run global` flips ownership.
//
// Scope: writes only under ~/.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const home = homedir();
const short = (path) => path.replace(home, '~');
const quiet = process.argv.includes('--quiet');

const globMod = join(home, '.bun/install/global/node_modules');
const binDirs = [join(home, '.bun/bin'), join(globMod, '.bin')].filter((dir, i) => i === 0 || existsSync(dir));

const changes = [];

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

const bins = [['rip', join(repoRoot, 'bin/rip')]];
for (const name of pkgs) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages', name, 'package.json'), 'utf8'));
  for (const [binName, relPath] of Object.entries(manifest.bin ?? {})) {
    bins.push([binName, join(repoRoot, 'packages', name, relPath)]);
  }
}

for (const [binName, source] of bins) {
  if (!existsSync(source)) continue;
  for (const dir of binDirs) {
    if (linkTo(join(dir, binName), source)) changes.push(`linked  ${short(join(dir, binName))} -> ${short(source)}`);
  }
}

if (changes.length === 0) {
  if (!quiet) console.log(`[rip] global: already up to date (${pkgs.length} packages, ${bins.length} bins)`);
  process.exit(0);
}

if (!quiet) {
  for (const line of changes) console.log(`  ${line}`);
  console.log('\nDone. Verify with: rip --version');
}
