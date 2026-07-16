#!/usr/bin/env bun

// scripts/link-global.mjs — make THIS checkout the machine's global rip.
//
// Run once per machine (re-run safely — it's idempotent). Symlinks:
//
//   ~/.bun/bin/rip                       -> $REPO/bin/rip
//   ~/.bun/bin/<bin>                     -> $REPO/packages/<pkg>/<entry>
//                                           (every "bin" a package declares)
//   ~/node_modules/@rip-lang/<pkg>       -> $REPO/packages/<pkg>
//   ~/.bun/install/global/node_modules/@rip-lang/<pkg>  (same, when present)
//   ~/.bun/install/global/node_modules/.bin/<bin>       (same, when present —
//                                           this dir sits FIRST on a bun PATH,
//                                           so it must agree or v3 wins)
//
// Also strips any npm-installed rip-lang claim from bun's global manifest
// so `bun i -g <anything>` won't silently reinstall it and shadow these
// links. Running the OTHER checkout's link-global flips ownership back —
// whichever repo ran it last owns the machine.
//
// Scope: writes only under ~/. This repo's ./node_modules is the
// installer's job (postinstall + scripts/link-check.mjs guard it).

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const home = homedir();
const short = (path) => path.replace(home, '~');

const userMod = join(home, 'node_modules');
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

// Strip a prior npm-installed rip-lang from bun's global manifest so a
// later `bun i -g <anything>` can't resurrect it over these links.
for (const manifestPath of [join(home, 'package.json'), join(home, '.bun/install/global/package.json')]) {
  if (!existsSync(manifestPath)) continue;
  if (/"rip-lang"|"@rip-lang\//.test(readFileSync(manifestPath, 'utf8'))) {
    spawnSync('bun', ['remove', '-g', 'rip-lang'], { stdio: 'ignore' });
    changes.push('cleaned bun global manifest (rip-lang)');
    break;
  }
}

// @rip-lang/<pkg> -> $REPO/packages/<pkg> in both module scopes, derived
// from the live packages/ directory.
const pkgs = readdirSync(join(repoRoot, 'packages')).filter((name) => {
  try { return statSync(join(repoRoot, 'packages', name, 'package.json')).isFile(); } catch { return false; }
});
const pkgSet = new Set(pkgs);

for (const name of pkgs) {
  const target = join(repoRoot, 'packages', name);
  for (const scope of [userMod, globMod]) {
    if (linkTo(join(scope, '@rip-lang', name), target)) {
      changes.push(`linked  ${short(join(scope, '@rip-lang', name))} -> ${short(target)}`);
    }
  }
}

// Sweep @rip-lang/<pkg> symlinks whose package left this repo (or that
// still point at another checkout — the cutover claims them all).
for (const scope of [userMod, globMod]) {
  const dir = join(scope, '@rip-lang');
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir)) {
    if (pkgSet.has(entry)) continue;
    const path = join(dir, entry);
    try {
      if (!lstatSync(path).isSymbolicLink()) continue;
      rmSync(path, { force: true });
      changes.push(`removed ${short(path)} (no such package here)`);
    } catch {}
  }
}

// CLI binaries: the compiler plus every "bin" a package declares (the
// entry .rip files are themselves the binaries — no wrapper scripts).
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
  if (!process.argv.includes('--quiet')) console.log(`[rip] link-global: already up to date (${pkgs.length} packages, ${bins.length} bins)`);
  process.exit(0);
}

for (const line of changes) console.log(`  ${line}`);
console.log('\nDone. Verify with: rip --version');
