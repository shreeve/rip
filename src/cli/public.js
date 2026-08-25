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

// The `.rip` modules a package publishes: every subpath in its `exports`
// map, else `index.rip`.
export function publicEntriesOf(pkgDir) {
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); } catch { return []; }
  const out = [];
  const take = (v) => {
    if (typeof v === 'string') { if (v.endsWith('.rip')) out.push(path.resolve(pkgDir, v)); return; }
    if (v && typeof v === 'object') for (const inner of Object.values(v)) take(inner);
  };
  take(pkg.exports);
  if (typeof pkg.module === 'string') take(pkg.module);
  if (typeof pkg.main === 'string') take(pkg.main);
  if (out.length === 0) {
    const index = path.join(pkgDir, 'index.rip');
    if (fs.existsSync(index)) out.push(index);
  }
  return [...new Set(out)].filter((f) => fs.existsSync(f));
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
