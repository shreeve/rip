#!/usr/bin/env bun
// Package the Rip VS Code extension into a .vsix via a staged,
// self-contained copy.
//
// Why staging: vsce expects a self-contained directory — a real
// node_modules, a lockfile npm recognizes, and no monorepo context for
// its `npm ls` walk to trip over. We stage a clean copy in a temp
// directory: the extension sources, a dereferenced node_modules carrying
// exactly the enumerated dependency budget, the COMPILER copied from the
// repository's src/ (the extension embeds the compiler it versions with
// — never fetched), a stripped package.json, and a stub
// package-lock.json so vsce doesn't try to install anything. Run vsce
// there; move the .vsix back.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const pkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgDir, '..', '..');
const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

// Prefer a package-local node_modules. Under the repo's hoisted Bun
// workspaces, `bun install` in packages/vscode lands deps at the repo
// root instead — materialize a standalone tree in a temp dir so the
// staged .vsix stays self-contained and free of the monorepo's
// unrelated packages. Use the package lockfile when present; otherwise
// install from package.json (exact pins) — the workspace root lockfile
// owns resolution and packages/vscode/bun.lock may be absent.
function resolveModulesRoot() {
  const local = path.join(pkgDir, 'node_modules');
  if (fs.existsSync(local)) return { root: local, cleanup: null };

  const deps = Object.keys(pkgJson.dependencies || {});
  const rootNm = path.join(repoRoot, 'node_modules');
  const rootHasDeps = deps.length > 0 && deps.every((dep) =>
    fs.existsSync(path.join(rootNm, ...dep.split('/'))));
  if (!rootHasDeps && deps.length > 0) {
    console.error('node_modules missing — run `bun install` in packages/vscode (or the repo root) first');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-vscode-deps-'));
  fs.copyFileSync(path.join(pkgDir, 'package.json'), path.join(tmp, 'package.json'));
  const lock = path.join(pkgDir, 'bun.lock');
  const installArgs = ['install'];
  if (fs.existsSync(lock)) {
    fs.copyFileSync(lock, path.join(tmp, 'bun.lock'));
    installArgs.push('--frozen-lockfile');
  }
  console.log('→ materializing standalone node_modules for packaging (workspace install is hoisted)');
  const r = spawnSync('bun', installArgs, { cwd: tmp, stdio: 'inherit' });
  if (r.status !== 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(r.status ?? 1);
  }
  return { root: path.join(tmp, 'node_modules'), cleanup: tmp };
}

const { root: modulesRoot, cleanup: modulesCleanup } = resolveModulesRoot();
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-vscode-'));
const cleanup = () => {
  fs.rmSync(stage, { recursive: true, force: true });
  if (modulesCleanup) fs.rmSync(modulesCleanup, { recursive: true, force: true });
};

// Extension sources.
for (const name of ['README.md', 'icon.png', 'language-configuration.json', 'src', 'syntaxes']) {
  const src = path.join(pkgDir, name);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(stage, name), { recursive: true, dereference: true });
}

// The compiler, whole (src/server.js resolves compiler/src/compile.js in
// this layout; the emitter reads its runtime modules relative to its own
// URL, so the tree must stay intact).
fs.cpSync(path.join(repoRoot, 'src'), path.join(stage, 'compiler', 'src'), {
  recursive: true, dereference: true,
});

// Dependencies: the enumerated budget, dereferenced (real directories,
// no store links) from the package-local or materialized install.
fs.cpSync(modulesRoot, path.join(stage, 'node_modules'), {
  recursive: true, dereference: true,
});

// Stripped manifest — everything the extension host needs, nothing else.
const stagedPkg = {
  name: pkgJson.name,
  displayName: pkgJson.displayName,
  description: pkgJson.description,
  version: pkgJson.version,
  publisher: pkgJson.publisher,
  license: pkgJson.license,
  repository: pkgJson.repository,
  engines: pkgJson.engines,
  icon: pkgJson.icon,
  categories: pkgJson.categories,
  keywords: pkgJson.keywords,
  main: pkgJson.main,
  activationEvents: pkgJson.activationEvents,
  contributes: pkgJson.contributes,
  dependencies: pkgJson.dependencies,
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagedPkg, null, 2));

// Stub lockfile so vsce's npm-ls sees a valid install and skips its own.
const lockPackages = { '': { name: pkgJson.name, version: pkgJson.version, dependencies: pkgJson.dependencies } };
for (const [name, version] of Object.entries(pkgJson.dependencies)) {
  lockPackages[`node_modules/${name}`] = { version };
}
fs.writeFileSync(path.join(stage, 'package-lock.json'), JSON.stringify({
  name: pkgJson.name,
  version: pkgJson.version,
  lockfileVersion: 3,
  requires: true,
  packages: lockPackages,
}, null, 2));

fs.writeFileSync(path.join(stage, '.vscodeignore'), '.vscode/**\n');

const result = spawnSync('bunx', ['@vscode/vsce', 'package', '--skip-license'], {
  cwd: stage,
  stdio: 'inherit',
});
if (result.status !== 0) { cleanup(); process.exit(result.status ?? 1); }

const vsix = fs.readdirSync(stage).find((f) => f.endsWith('.vsix'));
if (!vsix) { console.error('no .vsix produced'); cleanup(); process.exit(1); }
fs.rmSync(path.join(pkgDir, vsix), { force: true });
fs.renameSync(path.join(stage, vsix), path.join(pkgDir, vsix));
cleanup();
console.log(`packaged ${vsix}`);
