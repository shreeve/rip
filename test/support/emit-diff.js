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
import { emit as emitV1 } from '../../src/emit/emitter.js';
import { emit as emitV2, EmitUnimplemented } from '../../src/emit/index.js';

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

