#!/usr/bin/env bun
// Package the Rip VS Code extension into a .vsix via a staged,
// self-contained copy.
//
// Why staging: vsce expects a self-contained directory — a real
// node_modules, a lockfile npm recognizes, and no monorepo context for
// its `npm ls` walk to trip over. The workspace install symlinks each
// dependency into bun's central store, which vsce cannot follow, so we
// stage a clean copy in a temp directory: the two entry points BUNDLED
// with Bun, the tsgo engine dereferenced from the store, the COMPILER
// copied from the repository's src/ (the extension embeds the compiler
// it versions with — never fetched), a stripped package.json with
// `catalog:` resolved to the real version, and a stub package-lock.json
// so vsce installs nothing. Run vsce there; move the .vsix back.
//
// Bundling is a PACKAGING step only. In development the extension runs
// straight from source and its dependencies resolve from this package's
// own node_modules, with no bundler in the loop — that is what
// src/extension.js documents and it stays true. The vsix is the one
// artifact that must be self-contained, so only it is bundled.
//
// What is NOT bundled, and must not be: the compiler. server.js reaches
// it through `import()` of a URL computed at runtime, so a bundler
// cannot inline it — which is exactly the property that lets the
// compiler ship as a plain tree at compiler/src/. The bundles land at
// src/ so those `../compiler/src/…` URLs resolve from the bundle's own
// import.meta.url, unchanged.

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

// The vsix is PLATFORM-SPECIFIC, because the tsgo engine is a native
// binary: typescript lists one per OS/arch as an optional dependency and
// only the installed one resolves. Declaring the target makes that a
// contract instead of an accident — an undeclared vsix built here would
// install on Linux and find no engine. Cross-building needs the other
// platform's package installed, so a target we cannot satisfy fails
// loudly below rather than shipping an engine-less extension.
const targetArg = process.argv.indexOf('--target');
const TARGET = targetArg >= 0 ? process.argv[targetArg + 1] : `${process.platform}-${process.arch}`;
if (!TARGET || TARGET.startsWith('--')) { console.error('--target needs a value, e.g. darwin-arm64'); process.exit(1); }
const TSGO_PKG = `@typescript/typescript-${TARGET}`;

// Dependencies the bundles ABSORB. Each is inlined by Bun.build, so the
// vsix carries no copy and the manifest must not claim one — a declared
// dependency with no node_modules entry is what makes vsce's `npm ls`
// walk fail. typescript is deliberately absent from this set: tsgo.js
// resolves `typescript/package.json` at runtime to locate the platform
// package beside it, so that one directory must stay real.
const BUNDLED = new Set([
  'vscode-languageclient',
  'vscode-languageserver',
  'vscode-languageserver-textdocument',
]);

// Resolve each dependency spec to a concrete version — the shipped vsix
// is standalone, so a workspace `catalog:` reference must become the
// real number from the root catalog.
const resolvedDeps = {};
for (const [name, spec] of Object.entries(pkgJson.dependencies)) {
  if (BUNDLED.has(name)) continue;
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

// Extension assets. src/ is not copied — it is bundled, below.
for (const name of ['README.md', 'icon.png', 'language-configuration.json', 'syntaxes']) {
  const src = path.join(pkgDir, name);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(stage, name), { recursive: true, dereference: true });
}

// The two entry points, each bundled for the runtime that actually runs
// it: extension.js is required by the VS Code extension host (Node, and
// CommonJS on purpose — `vscode` stays external because the host injects
// it), while server.js is spawned on Bun by extension.js. Every other
// file in src/ is reached from one of these two and is inlined.
fs.mkdirSync(path.join(stage, 'src'), { recursive: true });
const bundle = async (entry, out, opts) => {
  const built = await Bun.build({ entrypoints: [path.join(pkgDir, 'src', entry)], ...opts });
  if (!built.success) {
    for (const log of built.logs) console.error(String(log));
    console.error(`bundling ${entry} failed`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(stage, 'src', out), await built.outputs[0].text());
};
await bundle('extension.js', 'extension.js', { target: 'node', format: 'cjs', external: ['vscode'] });
await bundle('server.js', 'server.js', { target: 'bun', format: 'esm' });

// The compiler, as a tree (server.js resolves compiler/src/compile.js at
// runtime, and the emitter reads its runtime modules relative to its own
// URL, so the layout must stay intact). Two subtrees are never reached
// from it and have no business in a published artifact: grammar/ holds
// the .rip grammar sources and their tests — parser.js is generated from
// them and is what actually ships — and browser.js is the browser
// bundle's entry point, which nothing here imports.
const compilerSrc = path.join(repoRoot, 'src');
fs.cpSync(compilerSrc, path.join(stage, 'compiler', 'src'), {
  recursive: true,
  dereference: true,
  filter: (from) => {
    const rel = path.relative(compilerSrc, from);
    if (rel === 'grammar' || rel.startsWith(`grammar${path.sep}`)) return false;
    if (rel === 'browser.js') return false;
    return true;
  },
});

// Dependencies: the closure of what the bundles did NOT absorb, each
// package dereferenced from its real directory in bun's store into a
// flat node_modules the vsix can carry (vsce cannot follow the
// workspace's node_modules symlinks). Optional deps are followed too —
// that is how the native @typescript/typescript-<os>-<arch> tsgo binary
// (the LSP engine) comes along.
//
// typescript ships ~400 files of TypeScript's own JS implementation that
// nothing here loads: tsgo.js reads only its package.json, to locate the
// platform package beside it. The directory stays (it is the resolution
// anchor); its payload does not.
const SKIP_WITHIN = new Map([['typescript', new Set(['dist', 'vendor'])]]);
fs.mkdirSync(path.join(stage, 'node_modules'), { recursive: true });
const staged = new Set();
const stageClosure = (name, fromDir, optional) => {
  if (staged.has(name) || BUNDLED.has(name)) return;
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
  const skip = SKIP_WITHIN.get(name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(dir, dest, {
    recursive: true,
    dereference: true,
    filter: skip ? (from) => !skip.has(path.relative(dir, from).split(path.sep)[0]) : undefined,
  });
  const dj = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const d of Object.keys(dj.dependencies ?? {})) stageClosure(d, dir, false);
  for (const d of Object.keys(dj.optionalDependencies ?? {})) stageClosure(d, dir, true);
};
for (const name of Object.keys(pkgJson.dependencies)) stageClosure(name, pkgDir, false);

// The engine is the whole point of the vsix; shipping one without it
// produces an extension that installs cleanly and then does nothing.
if (!staged.has(TSGO_PKG)) {
  console.error(`no tsgo engine for --target ${TARGET}: ${TSGO_PKG} is not installed.`);
  console.error(`this machine is ${process.platform}-${process.arch}; cross-building needs that package installed first.`);
  process.exit(1);
}

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

// The build identity, stamped from the SOURCE trees this vsix was built
// from — not from the staged copies, which are bundled and trimmed and
// so would hash to something no other tool can reproduce. `rip check
// --build` prints the same hash over the same two source trees, and the
// server logs what is stamped here, so comparing them answers the
// question the identity exists for: is the installed extension built
// from this working tree? Hashing the artifact instead would make that
// comparison permanently, uselessly false.
const { cacheIdentityOf } = await import(path.join(pkgDir, 'src', 'hash.js'));
fs.writeFileSync(
  path.join(stage, 'build-identity'),
  cacheIdentityOf(path.join(repoRoot, 'src'), path.join(pkgDir, 'src')) + '\n',
);

fs.writeFileSync(path.join(stage, '.vscodeignore'), '.vscode/**\n');

const result = spawnSync('bunx', ['@vscode/vsce', 'package', '--skip-license', '--target', TARGET], {
  cwd: stage,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

const vsix = fs.readdirSync(stage).find((f) => f.endsWith('.vsix'));
if (!vsix) { console.error('no .vsix produced'); process.exit(1); }
// Clear every previous build, not just the same-named one: the target is
// part of the filename now, so a stale vsix for another platform would
// otherwise linger and the installer picks by mtime.
for (const old of fs.readdirSync(pkgDir).filter((f) => f.endsWith('.vsix'))) {
  fs.rmSync(path.join(pkgDir, old), { force: true });
}
fs.renameSync(path.join(stage, vsix), path.join(pkgDir, vsix));
fs.rmSync(stage, { recursive: true, force: true });
console.log(`packaged ${vsix}`);
