// compile() behind an on-disk cache of its emission, so a process that
// loads .rip modules (the loader plugin, the sites bundler) pays the
// compiler only for sources it has not seen. Entries are <key>.json in
// <checkout>/.rip/cache/compile/ (or RIP_CACHE_DIR), where
//
//   key = sha256(fingerprint, path, runtimeDelivery, source)
//
// and the fingerprint hashes every src/**/*.js plus the checkout root
// (emitted runtime imports are absolute paths into it), so editing any
// compiler file invalidates the whole cache. Only successful compiles
// are written, temp-then-rename: concurrent writers each land a whole
// file or nothing, and a torn or foreign entry reads as a miss. Writes
// are best effort; a read-only disk means no caching. RIP_NO_CACHE=1
// disables reads and writes. Removing the directory is the whole reset.

import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// The compiler loads on the first miss: a process whose every .rip is a
// hit never parses parser.js and emitter.js at all.
let compiler = null;
const compile = (source, options) => (compiler ??= require('./compiler.js').compile)(source, options);

const root = join(import.meta.dir, '..');
const disabled = /^(1|true|yes)$/i.test(process.env.RIP_NO_CACHE ?? '');
const dir = process.env.RIP_CACHE_DIR || join(root, '.rip', 'cache', 'compile');

let fingerprint = null;
const computeFingerprint = () => {
  const src = join(root, 'src');
  const h = new Bun.CryptoHasher('sha256').update(`rip-compile-cache/1\0${root}\0`);
  for (const file of readdirSync(src, { recursive: true }).filter((name) => name.endsWith('.js')).sort()) {
    h.update(`${file}\0`).update(readFileSync(join(src, file))).update('\0');
  }
  return h.digest('hex');
};

const read = (at) => {
  try {
    const entry = JSON.parse(readFileSync(at, 'utf8'));
    if (typeof entry.code === 'string' && entry.map && typeof entry.map === 'object' && Array.isArray(entry.runtimes)) return entry;
  } catch { /* missing, torn, or foreign */ }
  return null;
};

const write = (at, entry) => {
  const temp = `${at}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(temp, JSON.stringify(entry));
    renameSync(temp, at);
  } catch {
    try { unlinkSync(temp); } catch { /* never landed */ }
  }
};

const triple = ({ code, map, runtimes }) => ({ code, map, runtimes: new Set(runtimes) });

export const compileCached = (source, { path, runtimeDelivery }) => {
  if (disabled) return triple(compile(source, { path, runtimeDelivery }));
  fingerprint ??= computeFingerprint();
  const key = new Bun.CryptoHasher('sha256').update(`${fingerprint}\0${path}\0${runtimeDelivery}\0`).update(source).digest('hex');
  const at = join(dir, `${key}.json`);
  const hit = read(at);
  if (hit) return triple(hit);
  const out = triple(compile(source, { path, runtimeDelivery }));
  write(at, { code: out.code, map: out.map, runtimes: [...out.runtimes] });
  return out;
};
