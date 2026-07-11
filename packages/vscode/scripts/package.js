#!/usr/bin/env bun
// Package the Rip VS Code extension into a .vsix via a staged,
// self-contained copy.
//
// Why staging: vsce expects a self-contained directory — a real
// node_modules, a lockfile npm recognizes, and no monorepo context for
// its `npm ls` walk to trip over. We stage a clean copy in a temp
// directory: the extension sources, a dereferenced node_modules carrying
// exactly the the settled rule dependency budget, the COMPILER copied from the
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

if (!fs.existsSync(path.join(pkgDir, 'node_modules'))) {
  console.error('node_modules missing — run `bun install` in packages/vscode first');
  process.exit(1);
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-vscode-'));

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

// Dependencies: the the dependency budget, dereferenced from this package's own
// install (a standalone bun install — real directories, no store links).
fs.cpSync(path.join(pkgDir, 'node_modules'), path.join(stage, 'node_modules'), {
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
if (result.status !== 0) process.exit(result.status ?? 1);

const vsix = fs.readdirSync(stage).find((f) => f.endsWith('.vsix'));
if (!vsix) { console.error('no .vsix produced'); process.exit(1); }
fs.rmSync(path.join(pkgDir, vsix), { force: true });
fs.renameSync(path.join(stage, vsix), path.join(pkgDir, vsix));
fs.rmSync(stage, { recursive: true, force: true });
console.log(`packaged ${vsix}`);
