// The analysis differential: src/emit/analyze.js against the facts the
// v1 emitter computes for the same parse. v1 reports its facts through
// emit()'s internal `facts` sink (FACTS in src/emitter.js), which hands
// over values v1 has already computed and moves no output byte.
//
// Each program and option set lands in one outcome:
//
//   identical   every fact matches, or both reject;
//   masked      v1 rejected during emission with a message no analysis
//               fact produces;
//   different   anything else.
//
// v1 calls analyze.js before it emits, so an analysis rejection is v1's
// too, and v1 reads the program facts (bindings, atoms, the delivery
// decision, typeOnlyImports, appAccessors), the scope facts (hoists,
// temp sites, declare-in-place, class field plans, reactive frames) and
// the redeclaration check from it. What remains to compare is every
// predicate v1 asks about a node with an id (await, yield, bare `it`,
// return, control flow), against analyze.js's bits for it, and v1's own
// rejections where analysis accepts.
import { parseSource, CompileError } from '../../src/compiler.js';
import { emit as emitV1 } from '../../src/emitter.js';
import { analyze } from '../../src/emit/analyze.js';
import { Stores } from '../../src/stores.js';
import { isAttrs, LEAF_KINDS } from '../../src/sexpr.js';

// A parser leaf or type value: a word in v1's tree.
const isWord = (x) => typeof x[0] === 'string' && isAttrs(x[1]) &&
  ((x.length === 3 && LEAF_KINDS.has(x[0])) || (x.length === 4 && x[0] === 'type' && typeof x[2] === 'string'));

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
  /is declared by a destructuring pattern, which cannot carry this annotation/,
  /cannot sit inside a rest or a destructuring pattern/,
  /bare `it` has no binding here/,
  /a parameter pattern binds names only/,
  /a loop variable binds names only/,
  /before this (def|class) in the same block/,
  /is updated (on line \d+ )?before its/,
];
const inFamily = (message) => FAMILY.some((re) => re.test(message));

const errText = (err) => `${err.message} @${err.start ?? '-'}:${err.end ?? '-'}`;

// v1's facts for one parse, through the sink.
export function v1Facts(parsed, options) {
  const stores = new Stores(parsed.result.stores);
  const idOf = (x) => (Array.isArray(x) ? stores.idOf(x) : null);
  const facts = { predicates: new Map() };
  const keep = (map, k, text) => {
    const prior = map.get(k);
    map.set(k, prior !== undefined && prior !== text ? `CONFLICT ${prior} | ${text}` : text);
  };
  const sink = (kind, key, value) => {
    switch (kind) {
      case 'predicate': {
        const [node, verdict] = value;
        const id = idOf(node);
        if (id !== null) keep(facts.predicates, `${key}:${id}`, String(verdict));
        break;
      }
    }
  };
  try {
    const record = emitV1(parsed.result, {
      face: options.face, repl: options.repl ?? false, ambientBindings: options.ambientBindings ?? null,
      source: parsed.source, dataPayload: parsed.dataPayload, dataLine: parsed.dataLine, modulePath: parsed.path, facts: sink,
    });
    return { record, facts };
  } catch (err) {
    return { error: err };
  }
}

const PREDICATE_BITS = { await: 1, yield: 2, bareIt: 4, return: 8, ctrl: 16 };

export function v2Facts(parsed, options) {
  try {
    const stores = new Stores(parsed.result.stores);
    const a = analyze(parsed.result, { source: parsed.source, face: options.face, ambientBindings: options.ambientBindings ?? null, repl: options.repl ?? false, stores, dataLine: parsed.dataLine });
    // v1's tree spells a word as a string, with no id: a leaf's id is
    // not v1's to key by.
    const idOf = (x) => (Array.isArray(x) && !isWord(x) ? stores.idOf(x) : null);
    return { analysis: a, idOf };
  } catch (err) {
    return { error: err };
  }
}

// The first fact the two disagree on, or null.
export function compareFacts(v1, v2) {
  if (v2.error !== undefined) {
    if (v1.error === undefined) return `analyze rejects, v1 emits: ${errText(v2.error)}`;
    if (errText(v1.error) === errText(v2.error)) return null;
    return `rejections differ: v1 ${errText(v1.error)} | analyze ${errText(v2.error)}`;
  }
  if (v1.error !== undefined) {
    if (inFamily(v1.error.message)) return `v1 rejects, analyze accepts: ${errText(v1.error)}`;
    return 'masked';
  }
  return comparePredicates(v1.facts.predicates, v2.analysis.predicateBits);
}

// Every predicate v1 asked about a node with an id, against the bits
// analyze.js holds for it.
function comparePredicates(v1, bits) {
  for (const [k, verdict] of v1) {
    if (verdict.startsWith('CONFLICT')) return `predicate ${k}: v1 answered two ways`;
    const [kind, id] = k.split(':');
    const mine = (bits(Number(id)) & PREDICATE_BITS[kind]) !== 0;
    if (String(mine) !== verdict) return `predicate ${k}: v1 ${verdict} | analyze ${mine}`;
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
      const v1 = v1Facts(parsed, options);
      if (set === 'js' && v1.record) ownBindings.set(key, v1.record.bindings);
      const v2 = v2Facts(parsed, options);
      const d = compareFacts(v1, v2);
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
