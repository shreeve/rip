// Bare-specifier resolution shared by the runtime loader (virtual
// modules) and the sites artifact generator (Bun.build onResolve):
// one enumeration, two consumers, so `rip/<pkg>` means the same file
// everywhere.
//
// Stdlib namespace: `rip/<pkg>` resolves to this checkout's
// packages/<pkg> — no node_modules, no per-project install: whoever
// has rip has the whole stdlib. Each package's manifest is
// honored: the exports map (string or import/default conditions, and
// every "./subpath" key becomes `rip/<pkg>/<subpath>`), then main,
// then <pkg>.rip / index.rip. Packages with no resolvable entry
// (editor extensions) are skipped.
//
// Global-install fallback: bare specifiers can also resolve from bun's
// global node_modules (`bun add -g <pkg>`), which Bun's own resolver
// never consults for imports — but only for names no local
// node_modules (walking up from the cwd) already provides: a project's
// own pinned dependency always wins over the global copy.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { builtinModules } from 'module';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';

const packagesDir = join(import.meta.dir, '..', 'packages');
const globalDir = join(process.env.BUN_INSTALL ?? join(homedir(), '.bun'), 'install', 'global', 'node_modules');

const packageEntries = (pkgDir, name) => {
  const entries = [];
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')); } catch { return entries; }
  const asFile = (target) => {
    if (target && typeof target === 'object') target = target.import ?? target.default;
    if (typeof target !== 'string') return null;
    const path = join(pkgDir, target);
    return existsSync(path) ? path : null;
  };
  const exp = manifest.exports;
  let root = null;
  if (typeof exp === 'string' || (exp && typeof exp === 'object' && !('.' in exp) && !Object.keys(exp).some((k) => k.startsWith('./')))) {
    root = asFile(exp);
  } else if (exp && typeof exp === 'object') {
    root = asFile(exp['.']);
    for (const [key, value] of Object.entries(exp)) {
      if (!key.startsWith('./') || key.includes('*')) continue;
      const path = asFile(value);
      if (path) entries.push([`${name}/${key.slice(2)}`, path]);
    }
  }
  root ??= [manifest.main, `${basename(pkgDir)}.rip`, 'index.rip', 'index.js'].map((f) => f && join(pkgDir, f)).find((p) => p && existsSync(p)) ?? null;
  if (root) entries.push([name, root]);
  return entries;
};

const stdlibEntries = () => {
  const entries = [];
  for (const name of readdirSync(packagesDir)) entries.push(...packageEntries(join(packagesDir, name), name));
  return entries;
};

const hasLocal = (name) => {
  let dir = process.cwd();
  while (true) {
    if (existsSync(join(dir, 'node_modules', name))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
};

const globalEntries = () => {
  const entries = [];
  let names;
  try { names = readdirSync(globalDir); } catch { return entries; }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) {
      let subs;
      try { subs = readdirSync(join(globalDir, name)); } catch { continue; }
      for (const sub of subs) entries.push(...packageEntries(join(globalDir, name, sub), `${name}/${sub}`));
    } else {
      entries.push(...packageEntries(join(globalDir, name), name));
    }
  }
  return entries;
};

// The full bare-specifier map: `rip/<entry>` for every stdlib entry,
// then the global fallback under its published name.
export const bareSpecifierMap = () => {
  const map = new Map();
  for (const [sub, path] of stdlibEntries()) map.set(`rip/${sub}`, path);
  const shadowed = new Map();
  for (const [name, path] of globalEntries()) {
    // npm shims of node builtins (string_decoder, buffer, …) ride in
    // as transitive deps; Bun refuses to override builtin names
    if (builtinModules.includes(name)) continue;
    if (map.has(name)) continue;
    const root = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/');
    if (!shadowed.has(root)) shadowed.set(root, hasLocal(root));
    if (shadowed.get(root)) continue;
    map.set(name, path);
  }
  return map;
};
