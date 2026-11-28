// The analysis differential: src/emit/analyze.js against the v1
// emitter's verdict on the same parse. v1 calls analyze.js before it
// emits, so an analysis rejection is v1's too, and v1 reads every program
// and scope fact — the predicate bits included — from it. What remains to
// compare is v1's own rejections where analysis accepts: a rejection in
// the family analysis owns means analysis missed it.
//
// Each program and option set lands in one outcome:
//
//   identical   both accept, or both reject alike;
//   masked      v1 rejected during emission with a message no analysis
//               fact produces;
//   different   anything else.
import { parseSource, CompileError } from '../../src/compiler.js';
import { emit as emitV1 } from '../../src/emit/emitter.js';
import { analyze } from '../../src/emit/analyze.js';
import { Stores } from '../../src/stores.js';

// The option sets that change what analysis computes: the two faces,
// and the REPL with an ambient seed (the program's own inventory plus
// names that shadow runtime names).
export const OPTION_SETS = {
  js: { face: 'js' },
  ts: { face: 'ts' },
  repl: { face: 'js', repl: true, ambient: true },
};

const AMBIENT_FIXED = [
  { name: 'p', kind: 'plain' },
  { name: '__state', kind: 'plain' },
  { name: 'schema', kind: 'plain' },
];

// Messages an analysis fact produces. A v1 rejection with any other
// message, when analyze.js accepts, is a rejection analysis does not
// own (emission met it first).
const FAMILY = [
  /was already declared as/,
  /is bound twice in one/,
  /must sit at module or function scope/,
  /cannot be a destructuring target/,
  /Cannot use 'rest' expression/,
  /a parameter default cannot write the last-match binding/,
  /cannot sit inside a rest or a destructuring pattern/,
  /bare `it` has no binding here/,
  /a parameter pattern binds names only/,
  /a loop variable binds names only/,
  /before this (def|class) in the same block/,
  /is updated (on line \d+ )?before its/,
];
const inFamily = (message) => FAMILY.some((re) => re.test(message));

const errText = (err) => `${err.message} @${err.start ?? '-'}:${err.end ?? '-'}`;

// v1's verdict on one parse: its record, or its rejection.
export function emitVerdict(parsed, options) {
  try {
    const record = emitV1(parsed.result, {
      face: options.face, repl: options.repl ?? false, ambientBindings: options.ambientBindings ?? null,
      source: parsed.source, dataPayload: parsed.dataPayload, dataLine: parsed.dataLine, modulePath: parsed.path,
    });
    return { record };
  } catch (err) {
    return { error: err };
  }
}

// Analysis's verdict on one parse: its facts, or its rejection.
export function analyzeVerdict(parsed, options) {
  try {
    const stores = new Stores(parsed.result.stores);
    const a = analyze(parsed.result, { source: parsed.source, face: options.face, ambientBindings: options.ambientBindings ?? null, repl: options.repl ?? false, stores, dataLine: parsed.dataLine });
    return { analysis: a };
  } catch (err) {
    return { error: err };
  }
}

// The first verdict the two disagree on, or null.
export function compareVerdicts(v1, v2) {
  if (v2.error !== undefined) {
    if (v1.error === undefined) return `analyze rejects, v1 emits: ${errText(v2.error)}`;
    if (errText(v1.error) === errText(v2.error)) return null;
    return `rejections differ: v1 ${errText(v1.error)} | analyze ${errText(v2.error)}`;
  }
  if (v1.error !== undefined) {
    if (inFamily(v1.error.message)) return `v1 rejects, analyze accepts: ${errText(v1.error)}`;
    return 'masked';
  }
  return null;
}

// Runs every input through the named option sets.
export function differential(inputs, { sets = Object.keys(OPTION_SETS) } = {}) {
  const summary = {};
  const different = [];
  const parses = new Map();
  const parseOnce = (key, src, path, face) => {
    const at = `${face}\0${key}`;
    if (!parses.has(at)) {
      let parsed = null;
      try {
        parsed = parseSource(src, { path, face });
      } catch (err) {
        if (!(err instanceof CompileError)) throw err;
      }
      parses.set(at, parsed);
    }
    return parses.get(at);
  };
  const ownBindings = new Map();
  for (const set of sets) {
    const spec = OPTION_SETS[set];
    if (!spec) throw new Error(`analyze-diff: unknown option set '${set}'`);
    const counts = { identical: 0, masked: 0, different: 0, parseRejected: 0, skipped: 0 };
    for (const { key, src, path } of inputs) {
      const parsed = parseOnce(key, src, path, spec.face);
      if (parsed === null) { counts.parseRejected++; continue; }
      const options = { face: spec.face, repl: spec.repl ?? false };
      if (spec.ambient) {
        const own = ownBindings.get(key);
        if (own === undefined) { counts.skipped++; continue; }
        const seen = new Set();
        options.ambientBindings = [...AMBIENT_FIXED, ...own].filter((b) => !seen.has(b.name) && seen.add(b.name));
      }
      const v1 = emitVerdict(parsed, options);
      if (set === 'js' && v1.record) ownBindings.set(key, v1.record.bindings);
      const v2 = analyzeVerdict(parsed, options);
      const d = compareVerdicts(v1, v2);
      if (d === null) counts.identical++;
      else if (d === 'masked') counts.masked++;
      else {
        counts.different++;
        different.push({ key, set, detail: d });
      }
    }
    summary[set] = counts;
  }
  return { summary, different };
}
