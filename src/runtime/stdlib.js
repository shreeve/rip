// The stdlib runtime (shared helpers) — the small set of
// helpers every Rip program can reference without an import: p, pp,
// pj, pr, kind, sleep, rand, zip, assert, abort, raise, todo, warn,
// noop, exit. One architectural choice: instead of prepending
// `globalThis.*` assignments to EVERY emitted
// file; this compiler delivers this module DEMAND-DRIVEN through RUNTIME_TABLE
// (a program that references no stdlib name carries zero
// stdlib bytes, and the names bind as module-scope consts, never
// globals). A user binding that shadows a helper name suppresses its
// delivery (the `bound` filter), exactly like the other runtimes.
//
// `pr` is the Rip-syntax debug printer: values with a faithful
// Rip-literal form print as Rip source; everything else falls back to
// console.dir so a debug session never crashes on whatever it's
// handed (the rule — the strict, throwing serializer is the separate
// importable `stringify`, deliberately NOT a stdlib global).

// abort/exit end the PROCESS where one exists; in a browser there is
// no process to end, so both throw with their own names instead of a
// bare ReferenceError.
const abort = (msg) => { if (msg) console.error(msg); if (typeof process !== 'undefined') process.exit(1); throw new Error(msg || 'abort'); };
const assert = (v, msg) => { if (!v) throw new Error(msg || 'Assertion failed'); };
const exit = (code) => { if (typeof process !== 'undefined') process.exit(code || 0); throw new Error(`exit(${code || 0}) outside a process`); };
const kind = (v) => v != null ? (v.constructor?.name || Object.prototype.toString.call(v).slice(8, -1)).toLowerCase() : String(v);
const noop = () => {};
const p = console.log;
const pp = (v) => { console.dir(v, { depth: null, colors: true }); return v; };
const pj = (v) => { console.log(JSON.stringify(v, null, 2)); return v; };
const pr = (() => {
  const BARE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const esc = (s, q) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(new RegExp(q, 'g'), '\\' + q);
  const qs = (s) => !s.includes("'") ? "'" + esc(s, "'") + "'" : !s.includes('"') ? '"' + esc(s, '"').split('#{').join('\\#{') + '"' : "'" + esc(s, "'") + "'";
  const ks = (k) => { if (typeof k === 'symbol') { const n = Symbol.keyFor(k); return n && BARE.test(n) ? ':' + n : qs(String(k)); } return BARE.test(k) ? k : qs(k); };
  const fmt = (v, d) => {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    const t = typeof v;
    if (t === 'number' || t === 'boolean') return String(v);
    if (t === 'string') return qs(v);
    if (t === 'symbol') { const n = Symbol.keyFor(v); return n && BARE.test(n) ? ':' + n : null; }
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const pad = '  '.repeat(d + 1), end = '  '.repeat(d);
      const parts = v.map((x) => fmt(x, d + 1));
      if (parts.some((x) => x === null)) return null;
      return '[\n' + pad + parts.join('\n' + pad) + '\n' + end + ']';
    }
    if (t === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return null;
      const keys = Object.keys(v);
      if (keys.length === 0) return '{}';
      const pad = '  '.repeat(d + 1), end = '  '.repeat(d);
      const parts = keys.map((k) => {
        const value = fmt(v[k], d + 1);
        return value === null ? null : ks(k) + ': ' + value;
      });
      if (parts.some((x) => x === null)) return null;
      return '{\n' + pad + parts.join('\n' + pad) + '\n' + end + '}';
    }
    return null;
  };
  return (v) => { const s = fmt(v, 0); if (s !== null) console.log(s); else console.dir(v, { depth: null, colors: true }); return v; };
})();
const raise = (a, b) => { throw (b !== undefined ? new a(b) : new Error(a)); };
const rand = (a, b) => b !== undefined ? (a > b && ([a, b] = [b, a]), Math.floor(Math.random() * (b - a + 1) + a)) : a ? Math.floor(Math.random() * a) : Math.random();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todo = (msg) => { throw new Error(msg || 'Not implemented'); };
const warn = console.warn;
const zip = (...a) => a[0].map((_, i) => a.map((b) => b[i]));
// The match operator's receiver coercion: anything reasonable becomes
// a string to match against. A multi-line string matches only under
// /m (anchors mislead across embedded newlines otherwise) — without
// it the coercion yields null and the match throws loudly rather
// than anchoring wrong.
const toMatchable = (v, allowNewlines) => {
  if (typeof v === 'string') return !allowNewlines && /[\n\r]/.test(v) ? null : v;
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  if (typeof v === 'symbol') return v.description || '';
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
    return new TextDecoder().decode(v instanceof Uint8Array ? v : new Uint8Array(v));
  }
  if (Array.isArray(v)) return v.join(',');
  if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
    try { return v.toString(); } catch { return ''; }
  }
  return '';
};

export { abort, assert, exit, kind, noop, p, pp, pj, pr, raise, rand, sleep, toMatchable, todo, warn, zip };
