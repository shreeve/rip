// The v1/v2 emitter differential. Each program is parsed once per face
// and emitted by both engines with the same options, and the pair lands
// in one of four outcomes:
//
//   identical      the whole emit record matches (code, mapping rows,
//                  every editor field), or both engines reject with the
//                  same message and span;
//   unimplemented  v2 reached a construct it has no lowering for
//                  (EmitUnimplemented), so the program is not covered yet;
//   explained      the records differ and the ledger
//                  (test/corpus/emit-v2-explained.json) carries an entry
//                  for this program and option set whose hashes match
//                  both records exactly;
//   different      anything else. A difference with no entry stops the
//                  change that caused it (AGENTS.md rule 7).
//
// `stores` is left out of the comparison: both engines wrap the same
// parse stores in a Stores of their own, and what a consumer reads
// through it (node rows, roles) is the parse's, not the engine's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSource } from '../../src/compiler.js';
import { emit as emitV1 } from '../../src/emitter.js';
import { emit as emitV2, EmitUnimplemented } from '../../src/emit/index.js';
import { CodeBuilder } from '../../src/builder.js';
import { Stores } from '../../src/stores.js';
import { Builder } from '../../src/emit/builder.js';
import { MappingBuilder } from '../../src/emit/mapping.js';

// The option sets real callers emit with: compile() and the loader on
// the JS face, the browser (with and without watch-mode hmr), the
// browser's classic scripts, the Sites bundle, the REPL, and the
// editor's strict and tolerant TS faces.
export const OPTION_SETS = {
  'js-inline': { runtimeDelivery: 'inline' },
  'js-import': { runtimeDelivery: 'import' },
  'js-none': { runtimeDelivery: 'none' },
  'js-repl': { runtimeDelivery: 'none', repl: true },
  'js-browser': { runtimeDelivery: 'import', browserModule: true },
  'js-browser-hmr': { runtimeDelivery: 'import', browserModule: true, hmr: true },
  'js-script': { runtimeDelivery: 'none', script: true },
  'js-sites': { runtimeDelivery: 'none', browserModule: true },
  'ts-import': { face: 'ts', runtimeDelivery: 'import' },
  'ts-tolerant': { face: 'ts', runtimeDelivery: 'import', tolerant: true },
};

export const LEDGER = 'test/corpus/emit-v2-explained.json';

export const loadLedger = (root) => JSON.parse(readFileSync(join(root, LEDGER), 'utf8'));

const replacer = (_key, value) => {
  if (value instanceof Set) return { Set: [...value] };
  if (value instanceof Map) return { Map: [...value] };
  return value;
};

// The one definition of a record's identity: every field but `stores`,
// with Sets and Maps spelled out. The bench and the harness both use it.
export const canonical = (record) => {
  const { stores, ...rest } = record;
  return JSON.stringify(rest, replacer);
};

export const recordHash = (text) => Bun.hash(text).toString(36);

// One engine's emission of one parse: { text } for a record, { error }
// for a rejection, { unimplemented: kind } for v2's not-covered marker.
function run(emit, parsed, options) {
  const { face = 'js', tolerant = false, ...rest } = options;
  try {
    const record = emit(parsed.result, {
      ...rest, face, tolerant,
      source: parsed.source, dataPayload: parsed.dataPayload, modulePath: parsed.path,
    });
    return { text: canonical(record), record };
  } catch (err) {
    if (err instanceof EmitUnimplemented) return { unimplemented: err.kind };
    return { error: `${err.message} @${err.start ?? '-'}:${err.end ?? '-'}` };
  }
}

// The first top-level record field the two engines disagree on, for a
// readable report; the hashes in the ledger cover the whole record.
function firstDifference(a, b) {
  if (a.error !== undefined || b.error !== undefined) return `v1 ${a.error ?? 'emitted'} | v2 ${b.error ?? 'emitted'}`;
  for (const key of Object.keys(a.record)) {
    if (key === 'stores') continue;
    const x = JSON.stringify(a.record[key], replacer);
    const y = JSON.stringify(b.record[key], replacer);
    if (x !== y) return `${key}: v1 ${x.slice(0, 120)} | v2 ${String(y).slice(0, 120)}`;
  }
  return 'records differ';
}

// Runs every input through the named option sets. Inputs the parser
// rejects are counted apart: neither engine sees them.
export function differential(inputs, { sets = Object.keys(OPTION_SETS), ledger = [] } = {}) {
  // A parse depends only on the face and tolerance, so sets that share
  // both share it; emission never mutates the parse it reads.
  const parses = new Map();
  const parseOnce = (key, src, path, { face = 'js', tolerant = false }) => {
    const at = `${face}\0${tolerant}\0${key}`;
    if (!parses.has(at)) {
      let parsed = null;
      try { parsed = parseSource(src, { path, face, tolerant }); } catch { /* the parser rejects it */ }
      parses.set(at, parsed);
    }
    return parses.get(at);
  };
  const explainedBy = new Map(ledger.map((e) => [`${e.key}\0${e.set}`, e]));
  const usedEntries = new Set();
  const summary = {};
  const different = [];
  const unimplementedKinds = new Map();
  for (const set of sets) {
    const options = OPTION_SETS[set];
    if (!options) throw new Error(`emit-diff: unknown option set '${set}'`);
    const counts = { identical: 0, unimplemented: 0, explained: 0, different: 0, parseRejected: 0 };
    for (const { key, src, path } of inputs) {
      const parsed = parseOnce(key, src, path, options);
      if (parsed === null) {
        counts.parseRejected++;
        continue;
      }
      const b = run(emitV2, parsed, options);
      if (b.unimplemented !== undefined) {
        counts.unimplemented++;
        unimplementedKinds.set(b.unimplemented, (unimplementedKinds.get(b.unimplemented) ?? 0) + 1);
        continue;
      }
      const a = run(emitV1, parsed, options);
      const textA = a.text ?? `ERR ${a.error}`;
      const textB = b.text ?? `ERR ${b.error}`;
      if (textA === textB) {
        counts.identical++;
        continue;
      }
      const entry = explainedBy.get(`${key}\0${set}`);
      if (entry && entry.v1 === recordHash(textA) && entry.v2 === recordHash(textB)) {
        counts.explained++;
        usedEntries.add(entry);
        continue;
      }
      counts.different++;
      different.push({ key, set, v1: recordHash(textA), v2: recordHash(textB), detail: firstDifference(a, b) });
    }
    summary[set] = counts;
  }
  // An entry is stale when it names no option set or no program
  // namespace (`pkg ` or `row `), or when this run could have used it
  // and did not: its option set ran, and its program is in this run's
  // population, or should be (its namespace is here but the key is not).
  const keys = new Set(inputs.map((i) => i.key));
  const namespaces = new Set(inputs.map((i) => i.key.split(' ')[0]));
  const namespaceOf = (key) => /^(pkg|row) /.exec(String(key))?.[1] ?? null;
  const stale = ledger.filter((e) => {
    if (!Object.hasOwn(OPTION_SETS, e.set) || namespaceOf(e.key) === null) return true;
    if (!sets.includes(e.set) || usedEntries.has(e)) return false;
    return keys.has(e.key) || namespaces.has(namespaceOf(e.key));
  });
  return { summary, different, stale, unimplementedKinds };
}

// ── the builder differential ─────────────────────────────────────────
// v2's Builder against v1's CodeBuilder on the calls v1 really makes:
// each program's emission by v1, recorded as the sequence of calls on
// the builder whose rows its record returns, replayed through both
// builders. A replay through v1's builder must give back v1's code, so
// no emitted text escaped the trace (the rows v1's emit() adds after the
// build are not the builder's, and are compared nowhere here); v2's
// MappingBuilder must then give the same code, rows, TS-only regions and
// echoes as that replay, and its plain Builder the same code, regions and
// echoes. v1 records leaves as caller-span marks, so leaf() is not
// exercised here: its rows are pinned in emit-v2.test.js.

// The ops: [EMIT, text], [BEGIN, nodeId, role], [SPAN, nodeId, role,
// start, end], [TS], [ECHO], each frame closed by [END].
const EMIT = 0, BEGIN = 1, SPAN = 2, TS = 3, ECHO = 4, END = 5;

// v1's emission of one parse with its main builder's trace, or null when
// v1 rejects it. A crash inside v1 (a TypeError, a RangeError, a
// ReferenceError) is no rejection and propagates.
export function builderTrace(parsed, options) {
  const P = CodeBuilder.prototype;
  const saved = { emit: P.emit, beginMark: P.beginMark, endMark: P.endMark, markSpan: P.markSpan, tsOnly: P.tsOnly, echo: P.echo };
  const traces = new Map();
  const opsOf = (b) => {
    let ops = traces.get(b);
    if (ops === undefined) traces.set(b, ops = []);
    return ops;
  };
  // markSpan closes through endMark, which records its END.
  P.emit = function (text) { opsOf(this).push(EMIT, text); return saved.emit.call(this, text); };
  P.beginMark = function (id, role) { opsOf(this).push(BEGIN, id, role); return saved.beginMark.call(this, id, role); };
  P.endMark = function () { opsOf(this).push(END); return saved.endMark.call(this); };
  P.markSpan = function (id, role, s, e, fn) { opsOf(this).push(SPAN, id, role, s, e); return saved.markSpan.call(this, id, role, s, e, fn); };
  P.tsOnly = function (fn) { const ops = opsOf(this); ops.push(TS); return saved.tsOnly.call(this, () => { fn(); ops.push(END); }); };
  P.echo = function (fn) { const ops = opsOf(this); ops.push(ECHO); return saved.echo.call(this, () => { fn(); ops.push(END); }); };
  const { face = 'js', tolerant = false, ...rest } = options;
  try {
    const record = emitV1(parsed.result, { ...rest, face, tolerant, source: parsed.source, dataPayload: parsed.dataPayload, modulePath: parsed.path });
    for (const [b, ops] of traces) if (b.rows === record.mappings) return { ops, record };
    throw new Error(`emit-diff: v1's record names no traced builder (${parsed.path})`);
  } catch (err) {
    if (err.message.startsWith('emit-diff:') || err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError) throw err;
    return null;
  } finally {
    Object.assign(P, saved);
  }
}

// Replays ops from `i` into builder `b`, up to the END closing the
// current frame; returns the index past it.
export function replay(b, ops, i = 0) {
  while (i < ops.length) {
    switch (ops[i]) {
      case EMIT: b.emit(ops[i + 1]); i += 2; break;
      case BEGIN: b.beginMark(ops[i + 1], ops[i + 2]); i = replay(b, ops, i + 3); b.endMark(); break;
      case SPAN: { let j; b.markSpan(ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], () => { j = replay(b, ops, i + 5); }); i = j; break; }
      case TS: { let j; b.tsOnly(() => { j = replay(b, ops, i + 1); }); i = j; break; }
      case ECHO: { let j; b.echo(() => { j = replay(b, ops, i + 1); }); i = j; break; }
      default: return i + 1;
    }
  }
  return i;
}

// Every input through every named option set: the programs compared, the
// rows they hold, and each program whose replays disagree.
export function builderDifferential(inputs, { sets = ['js-inline', 'ts-import'] } = {}) {
  let programs = 0, rows = 0;
  const different = [];
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  for (const set of sets) {
    const options = OPTION_SETS[set];
    const { face = 'js', tolerant = false } = options;
    for (const { key, src, path } of inputs) {
      let parsed;
      try { parsed = parseSource(src, { path, face, tolerant }); } catch { continue; }
      const trace = builderTrace(parsed, options);
      if (trace === null) continue;
      const stores = new Stores(parsed.result.stores);
      const v1 = new CodeBuilder(stores, { source: parsed.source, primitives: face === 'ts' });
      replay(v1, trace.ops);
      const on = new MappingBuilder(stores, parsed.source, { leaves: face === 'ts' });
      replay(on, trace.ops);
      const off = new Builder();
      replay(off, trace.ops);
      programs++;
      rows += v1.rows.length;
      const why = v1.code !== trace.record.code ? 'the trace does not reproduce v1\'s code'
        : on.code !== v1.code || off.code !== v1.code ? 'code'
        : !same(on.rows, v1.rows) ? 'mapping rows'
        : !same(on.tsRegions, v1.tsRegions) || !same(off.tsRegions, v1.tsRegions) ? 'TS-only regions'
        : !same(on.echoSpans, v1.echoSpans) || !same(off.echoSpans, v1.echoSpans) ? 'echo spans'
        : null;
      if (why !== null) different.push({ key, set, why });
    }
  }
  return { programs, rows, different };
}
