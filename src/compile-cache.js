// compile() behind an on-disk cache of its emission. Every process
// that loads .rip modules — the loader plugin under `rip file.rip` and
// `rip test`, the sites bundler's Bun.build plugin — pays the whole
// compiler (parse + emit + JIT warm-up) for every module it touches,
// and a test lane that fans out a few hundred children pays it a few
// hundred times over for sources that never changed between spawns.
// The emission is a pure function of (compiler, options, source), so
// this caches that function on disk: a hit is byte-identical to the
// compile it replaces.
//
//   key = sha256( fingerprint ‖ options ‖ source )
//
//   fingerprint — the compiler's own bytes: every src/**/*.js in this
//     checkout (the parser, the emitter, the runtime files inline
//     delivery embeds, this module), hashed once per process on first
//     use; the cache format; and the checkout root, because emitted
//     runtime imports are absolute paths into THIS checkout (the
//     emitter's RUNTIME_TABLE URLs) — an identical compiler at another
//     path emits different bytes. Coarse on purpose: editing ANY
//     compiler-side file invalidates every entry. A miss costs one
//     compile; a false hit would cost correctness.
//   options — the compile options, canonicalized (sorted keys) so
//     spelling order cannot split entries. `path` is among them: the
//     module path is compile input (diagnostics, the source map's
//     `sources`), so two copies of one source at two paths are two
//     entries. Options that cannot be spelled as plain JSON (a
//     function, a Map, a class instance) cannot be keyed, so such a
//     compile bypasses the cache rather than risk a key that hides
//     an input.
//
// What is cached is the emission triple — `code`, `map`, `runtimes` —
// the fields every process-level consumer reads. compileCached returns
// exactly that triple on a hit AND on a miss, so a caller can never
// come to depend on a field only a miss would carry; the editor-facing
// fields (tokens, mappings, stores, ...) belong to compile().
//
// Only SUCCESSFUL compiles are cached: a CompileError throws before
// the write, so a failing module recompiles — and re-reports — in
// every process, exactly as an uncached one. The compiler is pure (no
// env, cwd, clock, or randomness reaches the emission), so nothing
// outside the key can change what a compile yields.
//
// Entries are JSON files written temp-then-rename: concurrent spawns
// (the norm — a test lane fans out) race to write the same key and
// each lands a whole file or nothing; a reader never sees a torn
// entry, and anything unparseable is unlinked and treated as a miss.
// Writes are best effort — a read-only or full disk degrades to no
// caching, silently.
//
// Location: <checkout>/.rip/cache/compile/ (the gitignored .rip/ the
// checker's mirror already lives under — never the cwd or a user
// project), or RIP_CACHE_DIR. RIP_NO_CACHE=1 disables both reads and
// writes. RIP_CACHE_DEBUG=1 prints a hit/miss summary to stderr at
// exit. Removing the directory is the whole reset.
//
// Growth is bounded by age, not size: every edit of a .rip source mints
// a new entry (~1-3x the source's size), so a writer occasionally
// sweeps the directory — entries unread for a week go, as do temp
// files a crashed writer left behind. A hit touches its entry's mtime,
// so what is actually in use never ages out.

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { compile } from './compile.js';

const FORMAT = 1;
const checkoutRoot = join(import.meta.dir, '..');
const flag = (name) => /^(1|true|yes)$/i.test(process.env[name] ?? '');

const cacheDisabled = flag('RIP_NO_CACHE');
const cacheDir = process.env.RIP_CACHE_DIR || join(checkoutRoot, '.rip', 'cache', 'compile');
const cacheStats = { hits: 0, misses: 0, bypasses: 0, writeFailures: 0 };

let fingerprint = null;
const computeFingerprint = () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = join(dir, entry.name);
      if (entry.isDirectory()) walk(at);
      else if (entry.name.endsWith('.js')) files.push(at);
    }
  };
  walk(join(checkoutRoot, 'src'));
  files.sort();
  const h = new Bun.CryptoHasher('sha256');
  h.update(`rip-compile-cache/${FORMAT}\0${checkoutRoot}\0`);
  for (const file of files) {
    h.update(`${relative(checkoutRoot, file)}\0`);
    h.update(readFileSync(file));
    h.update('\0');
  }
  return h.digest('hex');
};

// The canonical spelling of an options object, or null when a value
// has no faithful JSON form — JSON.stringify would silently drop or
// flatten it, and a key that omits an input is exactly the false hit
// the fingerprint exists to prevent.
const canonical = (value) => {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return String(value);
    case 'number': return Number.isFinite(value) ? String(value) : null;
    case 'object': break;
    default: return null;
  }
  if (Array.isArray(value)) {
    const items = [];
    for (const item of value) {
      const spelled = item === undefined ? 'null' : canonical(item);
      if (spelled === null) return null;
      items.push(spelled);
    }
    return `[${items.join(',')}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    const spelled = canonical(value[key]);
    if (spelled === null) return null;
    parts.push(`${JSON.stringify(key)}:${spelled}`);
  }
  return `{${parts.join(',')}}`;
};

const entryPath = (key) => join(cacheDir, `${key}.json`);

const cacheRead = (key) => {
  let text;
  try {
    text = readFileSync(entryPath(key), 'utf8');
  } catch {
    return null;
  }
  try {
    const entry = JSON.parse(text);
    if (typeof entry?.code === 'string' && entry.map && typeof entry.map === 'object' && Array.isArray(entry.runtimes)) return entry;
  } catch { /* torn or foreign: fall through */ }
  try { unlinkSync(entryPath(key)); } catch { /* raced away */ }
  return null;
};

let cacheDirReady = false;
const cacheWrite = (key, entry) => {
  const final = entryPath(key);
  const temp = `${final}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    if (!cacheDirReady) { mkdirSync(cacheDir, { recursive: true }); cacheDirReady = true; }
    writeFileSync(temp, JSON.stringify(entry));
    renameSync(temp, final);
  } catch {
    cacheStats.writeFailures += 1;
    try { unlinkSync(temp); } catch { /* never landed */ }
    return;
  }
  if (Math.random() < 1 / 32) cachePrune();
};

const DAY = 86_400_000;
const cachePrune = () => {
  const now = Date.now();
  let names;
  try { names = readdirSync(cacheDir); } catch { return; }
  for (const name of names) {
    const limit = name.endsWith('.tmp') ? now - DAY / 24 : name.endsWith('.json') ? now - 7 * DAY : null;
    if (limit === null) continue;
    const at = join(cacheDir, name);
    try { if (statSync(at).mtimeMs < limit) unlinkSync(at); } catch { /* raced away */ }
  }
};

if (flag('RIP_CACHE_DEBUG')) {
  process.on('exit', () => {
    const { hits, misses, bypasses, writeFailures } = cacheStats;
    console.error(`[rip compile cache] ${cacheDisabled ? 'disabled' : cacheDir}: ${hits} hits, ${misses} misses, ${bypasses} bypasses, ${writeFailures} write failures`);
  });
}

const triple = ({ code, map, runtimes }) => ({ code, map, runtimes: new Set(runtimes) });

export const compileCached = (source, options = {}) => {
  const spelled = cacheDisabled ? null : canonical(options);
  if (spelled === null) {
    cacheStats.bypasses += 1;
    return triple(compile(source, options));
  }
  fingerprint ??= computeFingerprint();
  const key = new Bun.CryptoHasher('sha256')
    .update(`${fingerprint}\0${spelled}\0`)
    .update(source)
    .digest('hex');
  const hit = cacheRead(key);
  if (hit !== null) {
    cacheStats.hits += 1;
    try { utimesSync(entryPath(key), new Date(), new Date()); } catch { /* best effort */ }
    return triple(hit);
  }
  const out = triple(compile(source, options));
  cacheStats.misses += 1;
  cacheWrite(key, { code: out.code, map: out.map, runtimes: [...out.runtimes] });
  return out;
};
