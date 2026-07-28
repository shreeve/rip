#!/usr/bin/env bun
// Package the Rip VS Code extension into a .vsix via a staged,
// self-contained copy.
//
// Why staging: vsce expects a self-contained directory — a real
// node_modules, a lockfile npm recognizes, and no monorepo context for
// its `npm ls` walk to trip over. The workspace install symlinks each
// dependency into bun's central store, which vsce cannot follow, so we
// stage a clean copy in a temp directory: the extension sources, each
// budget dependency dereferenced from the store (typescript plus its
// sibling native @typescript/* tsgo binary), the COMPILER copied from
// the repository's src/ (the extension embeds the compiler it versions
// with — never fetched), a stripped package.json with `catalog:`
// resolved to the real version, and a stub package-lock.json so vsce
// installs nothing. Run vsce there; move the .vsix back.

const { spawnSync } = require('child_process');
const { createRequire } = require('node:module');
const fs = require('fs');
const path = require('path');
const os = require('os');

const pkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgDir, '..', '..');
const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const rootJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const req = createRequire(path.join(pkgDir, 'package.json'));

// Resolve each dependency spec to a concrete version — the shipped vsix
// is standalone, so a workspace `catalog:` reference must become the
// real number from the root catalog.
const resolvedDeps = {};
for (const [name, spec] of Object.entries(pkgJson.dependencies)) {
  if (spec === 'catalog:') {
    const v = rootJson.catalog?.[name];
    if (!v) { console.error(`no catalog entry for "${name}" in the root package.json`); process.exit(1); }
    resolvedDeps[name] = v;
  } else {
    resolvedDeps[name] = spec;
  }
}

// Fail fast if the workspace isn't installed (stageClosure below also
// exits on any missing required dep; this is the clearest up-front signal).
try { req.resolve('typescript/package.json'); }
catch { console.error('dependencies not installed — run `bun install` at the repo root'); process.exit(1); }

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

// Dependencies: the full closure, each package dereferenced from its
// real directory in bun's store into a flat node_modules the vsix can
// carry (vsce cannot follow the workspace's node_modules symlinks).
// Optional deps are followed too — that is how typescript@7's native
// @typescript/typescript-<os>-<arch> tsgo binary (an optional dep, the
// LSP engine) comes along, and only the installed platform resolves.
fs.mkdirSync(path.join(stage, 'node_modules'), { recursive: true });
const staged = new Set();
const stageClosure = (name, fromDir, optional) => {
  if (staged.has(name)) return;
  let pkgPath;
  try { pkgPath = createRequire(path.join(fromDir, 'package.json')).resolve(`${name}/package.json`); }
  catch {
    // An optional dep absent for this platform is expected (typescript
    // lists every OS/arch tsgo binary as an optional dep); a missing
    // REQUIRED dep is a broken install that must not ship a half-empty
    // vsix — fail loudly rather than silently drop it.
    if (optional) return;
    console.error(`required dependency "${name}" is not installed — run \`bun install\` at the repo root`);
    process.exit(1);
  }
  staged.add(name);
  const dir = path.dirname(pkgPath);
  const dest = path.join(stage, 'node_modules', name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(dir, dest, { recursive: true, dereference: true });
  const dj = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const d of Object.keys(dj.dependencies ?? {})) stageClosure(d, dir, false);
  for (const d of Object.keys(dj.optionalDependencies ?? {})) stageClosure(d, dir, true);
};
for (const name of Object.keys(pkgJson.dependencies)) stageClosure(name, pkgDir, false);

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
  dependencies: resolvedDeps,
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagedPkg, null, 2));

// Stub lockfile so vsce's npm-ls sees a valid install and skips its own —
// every staged package (the whole closure) enumerated with its version.
const lockPackages = { '': { name: pkgJson.name, version: pkgJson.version, dependencies: resolvedDeps } };
for (const name of staged) {
  const version = JSON.parse(fs.readFileSync(path.join(stage, 'node_modules', name, 'package.json'), 'utf8')).version;
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
