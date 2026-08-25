// What a package PUBLISHES: the entries its manifest names, and whether
// each one can be compiled at all.
//
// The surface itself — the type a consumer resolves for every published
// name, and the path to the first `any` inside it — is walked against the
// type checker in packages/vscode/src/publicwalk.js. This file answers only
// the questions that precede it, which are about the manifest and the
// compiler rather than about types.

import fs from 'node:fs';
import path from 'node:path';
import { compile } from '../compile.js';
import { ripManifestTarget } from '../../packages/vscode/src/mirror.js';

// The `.rip` modules a package publishes, resolved the way the MIRROR
// resolves them — `ripManifestTarget` is the same function that decides
// which faces get built, so the audit and the compile cannot disagree about
// what a package is. A second reader of a manifest is a second answer.
//
// A subpath PATTERN (`"./*": "./src/*.rip"`) is counted, never resolved: it
// is real surface that cannot be enumerated from the manifest alone, which
// makes it a floor rather than an absence. `index.rip` is the conventional
// entry only when the manifest expresses no opinion at all — a manifest that
// names an entry has named it, and a named entry that is missing is an
// unreadable entry, not a licence to audit some other file.
export function publicEntriesOf(pkgDir) {
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); }
  catch { return { entries: [], patterns: 0, outside: [] }; }
  const exp = pkg?.exports;
  const subpaths = [];
  let patterns = 0;
  if (typeof exp === 'string') subpaths.push('.');
  else if (exp && typeof exp === 'object') {
    const bySubpath = Object.keys(exp).some((k) => k === '.' || k.startsWith('./'));
    if (bySubpath) {
      for (const key of Object.keys(exp)) {
        if (key.includes('*')) { patterns++; continue; }
        subpaths.push(key);
      }
    } else subpaths.push('.');            // a conditions-only object IS `.`
  } else if (typeof pkg?.main === 'string' || typeof pkg?.module === 'string') subpaths.push('.');
  const out = [];
  const outside = [];
  for (const sub of subpaths) {
    const target = ripManifestTarget(pkg, sub);
    if (target === null) continue;
    const abs = path.resolve(pkgDir, target);
    // A package publishes from inside itself. `npm pack` roots the tarball
    // at the package directory, so an entry above it is absent from the
    // shipped artifact — it resolves only inside a symlinked workspace, and
    // breaks for the consumer this audit exists to speak for.
    if (abs !== pkgDir && !abs.startsWith(pkgDir + path.sep)) { outside.push(target); continue; }
    out.push(abs);
  }
  if (out.length === 0 && patterns === 0 && outside.length === 0) {
    const index = path.join(pkgDir, 'index.rip');
    if (fs.existsSync(index)) out.push(index);
  }
  return { entries: [...new Set(out)], patterns, outside };
}

// Whether an entry compiles, and why not when it does not. The names it
// publishes are the checker's to report, not this function's: a name list
// read off generated declarations is a different set than the one a
// consumer's checker resolves, and only the latter is the surface.
export function compileFailureOf(file) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return `cannot be read (${e.message})`;
  }
  try {
    compile(source, { path: file, face: 'ts' });
    return null;
  } catch (e) {
    return String(e.message ?? e).split('\n')[0];
  }
}
