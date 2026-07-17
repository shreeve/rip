#!/usr/bin/env bun

// scripts/link-check.mjs — guardrail: fail fast if @rip-lang/* resolves
// outside this repo.
//
// The canonical failure this catches: the workspace links in
// ./node_modules/@rip-lang are missing (fresh clone, partial install,
// wiped node_modules), so bare specifiers walk UP past the repo and
// silently land on another checkout's packages — ~/node_modules/@rip-lang
// planted by a sibling rip-lang's link-global. v4 source compiled against
// v3 packages mostly WORKS, which is exactly why it must fail loudly here
// instead.
//
// Used by postinstall and available standalone via `bun run link-check`.

// Every workspace member is swept: packages the lockfile happens to
// reference resolve through bun's catalog even without their link, but
// UNREFERENCED members are served only by the node_modules symlink —
// exactly the ones that fall through when it goes missing.

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
const require = createRequire(join(repoRoot, 'package.json'));

const pkgs = readdirSync(join(repoRoot, 'packages')).filter((name) => {
  try { return statSync(join(repoRoot, 'packages', name, 'package.json')).isFile(); } catch { return false; }
});

const wrong = [];
let checked = 0;
for (const dir of pkgs) {
  const manifestPath = join(repoRoot, 'packages', dir, 'package.json');
  const name = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
  if (!name?.startsWith('@rip-lang/')) continue;
  let resolved;
  try {
    resolved = realpathSync(require.resolve(`${name}/package.json`));
  } catch {
    // Unresolvable is the loud state already: any import of it fails by
    // name at the site. Only a WRONG resolution is silent.
    continue;
  }
  checked += 1;
  if (resolved !== manifestPath) wrong.push({ name, resolved, expected: manifestPath });
}

if (wrong.length > 0) {
  console.error('');
  console.error('  FATAL: @rip-lang/* resolves outside this repo.');
  for (const { name, resolved, expected } of wrong) {
    console.error(`    ${name}`);
    console.error(`      found:    ${resolved}`);
    console.error(`      expected: ${expected}`);
  }
  console.error('');
  console.error('  The workspace links are missing or shadowed (often by a');
  console.error("  sibling checkout's global links). Fix with:");
  console.error('');
  console.error('    rm -rf node_modules bun.lock && bun install');
  console.error('');
  process.exit(1);
}

if (!process.argv.includes('--quiet')) {
  console.log(`[rip] link-check: ${checked} @rip-lang/* packages -> ${repoRoot}/packages`);
}
