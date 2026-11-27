// The analysis differential: src/emit/analyze.js against the facts the
// v1 emitter computes for the same parse. v1 reports its facts through
// emit()'s internal `facts` sink (FACTS in src/emitter.js), which hands
// over values v1 has already computed and moves no output byte.
//
// Each program and option set lands in one outcome:
//
//   identical   every fact matches, or both reject with the same
//               message and span;
//   masked      v1 rejected first with a message no analysis fact
//               produces, before reaching anything analyze.js rejects;
//   different   anything else.
//
// The facts compared, each keyed by node id (a name fact by the owning
// node's id and the name, since v1's tree spells names as bare
// strings):
//   the emit record's bindings, bindingNames and runtimes;
//   atoms (the used-name registry's seed), the program-scope bound set
//   (temps aside), the program hoist's target names with their
//   declaring nodes, typeOnlyImports, appAccessors, the schema bodies
//   walked as delivery trees;
//   per scope v1 opens: the frame sets (reactive, computed, readonly,
//   handles, the scope's own const and declaration bindings, classes,
//   importSpecs, exportedConst), each name with its declaring node id,
//   and the authoritative declarations the redeclaration check settled;
//   per scope v1 hoists (keyed by its statement list's ids): the hoist
//   entries with their declaring nodes, the match-write flag, the TS
//   face's annotations, the temp sites (chain mid operands, reference
//   plans with the slots that capture) and, where the declare-in-place
//   scan ran, each target's scan facts, the targets that declare in
//   place, the class bindings and the pin candidates;
//   each class field value's reference plans;
//   every predicate v1 asks about a node with an id (await, yield, bare
//   `it`, return, control flow), against analyze.js's bits for it.
// A scope that hoists nothing and declares no temp is compared by its
// absence on both sides.
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
];
const inFamily = (message) => FAMILY.some((re) => re.test(message));

const sortedNames = (xs) => [...xs].sort();
const errText = (err) => `${err.message} @${err.start ?? '-'}:${err.end ?? '-'}`;

const scopeKey = (ownerId, stmtIds) => (ownerId !== null ? `o${ownerId}` : `s${stmtIds.join(',')}`);

// v1's facts for one parse, through the sink.
export function v1Facts(parsed, options) {
  const stores = new Stores(parsed.result.stores);
  const idOf = (x) => (Array.isArray(x) ? stores.idOf(x) : null);
  const facts = { frames: new Map(), decls: new Map(), trees: [], hoists: new Map(), captures: new Map(), plans: new Map(), planTemps: new Map(), fieldPlans: new Map(), predicates: new Map() };
  const keep = (map, k, text) => {
    const prior = map.get(k);
    map.set(k, prior !== undefined && prior !== text ? `CONFLICT ${prior} | ${text}` : text);
  };
  // Each collector call's declaring nodes, name → node id (the first
  // declaration of a name, as the collector's set keeps it).
  const declaring = new Map();
  const sink = (kind, key, value) => {
    switch (kind) {
      case 'collect': declaring.set(key, new Map()); break;
      case 'declares': {
        const [node, name] = value;
        const into = declaring.get(key);
        if (!into.has(name)) into.set(name, idOf(node));
        break;
      }
      case 'atoms': facts.atoms = sortedNames(value); break;
      case 'trees':
        facts.trees = value.slice(1).map((t) => ({ stmtIds: t.tree.slice(1).map(idOf), atoms: [...t.atoms] }));
        break;
      case 'programHoist':
        facts.programHoist = value.filter(([, , role]) => role === 'target').map(([n, node]) => [n, idOf(node)]);
        facts.temps = value.filter(([, , role]) => role !== 'target').map(([n]) => n);
        break;
      case 'programScopeNames': facts.bound = new Set(value); break;
      case 'typeOnlyImports': facts.typeOnlyImports = sortedNames(value); break;
      case 'appAccessors': facts.appAccessors = { ...value }; break;
      case 'frame': {
        const k = scopeKey(idOf(key.owner), key.stmts.map(idOf));
        const ids = (set, collector) => [...set].map((n) => [n, declaring.get(collector)?.get(n) ?? null]);
        const own = new Map();
        for (const [n, id] of ids(key.declared, 'declared')) own.set(n, id);
        for (const [n, id] of ids(value.handles, 'handles')) own.set(n, id);
        for (const [n, id] of ids(value.readonly, 'readonly')) own.set(n, id);
        const text = JSON.stringify(frameText({
          reactive: ids(value.reactive, 'reactive'), computed: ids(value.computed, 'computed'), readonly: ids(value.readonly, 'readonly'),
          handles: ids(value.handles, 'handles'), own,
          classes: ids(value.classes, 'classes'), importSpecs: [...value.importSpecs], exportedConst: ids(value.exportedConst, 'exportedConst'),
        }));
        const prior = facts.frames.get(k);
        facts.frames.set(k, prior !== undefined && prior !== text ? `CONFLICT ${prior} | ${text}` : text);
        break;
      }
      case 'hoist': {
        const k = key === null ? 'P' : listKey(key, idOf);
        const h = hoistText(value, facts, idOf, options.face);
        if (!emptyHoist(h)) keep(facts.hoists, k, JSON.stringify(h));
        break;
      }
      case 'declareInPlace': keep(facts.captures, listKey(key, idOf), JSON.stringify(captureText(value, idOf))); break;
      case 'plan':
        keep(facts.plans, idOf(key), JSON.stringify(slots(value)));
        facts.planTemps.set(idOf(key), [value.recv, value.obj, value.key].filter((n) => n !== null).length);
        break;
      case 'fieldPlan': {
        const ids = [...new Set(value.map(([, n]) => idOf(n)))].sort((x, y) => x - y);
        if (ids.length) keep(facts.fieldPlans, idOf(key), JSON.stringify(ids.map((id) => [id, JSON.parse(facts.plans.get(id))])));
        break;
      }
      case 'predicate': {
        const [node, verdict] = value;
        const id = idOf(node);
        if (id !== null) keep(facts.predicates, `${key}:${id}`, String(verdict));
        break;
      }
      case 'decls': {
        const k = scopeKey(idOf(key.owner), key.stmts.map(idOf));
        const text = JSON.stringify([...value].filter(([, f]) => f.auth).map(([n, f]) => [n, f.kind, idOf(f.node)]));
        const prior = facts.decls.get(k);
        facts.decls.set(k, prior !== undefined && prior !== text ? `CONFLICT ${prior} | ${text}` : text);
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

// A statement list's key: its statements' node ids (null for a bare
// word, which has none).
const listKey = (stmts, idOf) => stmts.map((s) => idOf(s)).join(',');
const emptyHoist = (h) => !h.matchWrite && h.targets.length === 0 && h.annotations.length === 0 && h.chains.length === 0 && h.plans.length === 0;
const PREDICATE_BITS = { await: 1, yield: 2, bareIt: 4, return: 8, ctrl: 16 };
const slots = (p) => [p.recv !== null, p.obj !== null, p.key !== null];
const byName = ([x], [y]) => (x < y ? -1 : x > y ? 1 : 0);

// A scope's hoist entries before declare-in-place: each target with
// its declaring node, the match-write flag, the TS face's annotation
// owners, and the temp sites — chain mid nodes and reference-plan
// assignments with the slots that capture. The sites are read before
// the scope's name filter: they compare as sites, never by the temp
// names that filter reads.
function hoistText({ entries, sites, matchWrite, declareInPlace }, facts, idOf, face) {
  const targets = entries.filter(([, , role]) => role === 'target').map(([n, node]) => [n, idOf(node)]);
  // A node can be both a chain's mid operand and a plan site: a plan
  // contributes one entry per capturing slot, and an entry beyond those
  // is the chain's (the temps' names may coincide, so they are not
  // compared).
  const counts = new Map();
  for (const [, node, role] of sites) {
    if (role !== '$self') continue;
    const id = idOf(node);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const chains = [];
  const planned = new Map();
  for (const [id, n] of counts) {
    const slots = facts.planTemps.get(id) ?? 0;
    if (slots > 0) planned.set(id, JSON.parse(facts.plans.get(id)));
    if (n > slots) chains.push(id);
  }
  const annotations = face === 'ts' && entries.annotations ? [...entries.annotations].map(([n, node]) => [n, idOf(node)]).sort(byName) : [];
  return {
    targets, matchWrite: matchWrite === true, declareInPlace, annotations,
    chains: chains.sort((x, y) => x - y),
    plans: [...planned].sort(([x], [y]) => x - y),
  };
}

// A declare-in-place decision: the capture facts of each target the
// scope hoists, the targets that declare in place (with their declaring
// statement), and the kept targets' class bindings and pin candidates.
function captureText({ entries, captures, kept }, idOf) {
  const targets = entries.filter(([, , role]) => role === 'target').map(([n]) => n);
  const keptNames = new Set(kept.filter(([, , role]) => role === 'target').map(([n]) => n));
  const fact = (n) => {
    const f = captures.get(n);
    if (f === undefined) return [n, null];
    return [n, idOf(f.decl), f.nested, f.nestedWrite, f.inDef, idOf(f.annotated), idOf(f.firstWrite), f.firstWritePath];
  };
  return {
    captures: targets.map(fact),
    declared: targets.filter((n) => !keptNames.has(n)).map((n) => [n, idOf(captures.get(n).decl)]),
    classBindings: [...kept.classBindings].sort(),
    pinnable: [...kept.pinnable].map(([n, p]) => [n, idOf(p.node)]).sort(byName),
  };
}

// One frame's sets in a comparable spelling: each name with its
// declaring node id, in the set's order (own sorted by name).
function frameText(f) {
  return {
    reactive: f.reactive, computed: f.computed, readonly: f.readonly, handles: f.handles,
    own: [...f.own].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)), classes: f.classes,
    importSpecs: f.importSpecs.map(([n, s]) => [n, s.specifier, s.importedName]), exportedConst: f.exportedConst,
  };
}

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
  const { record, facts } = v1;
  const a = v2.analysis;
  const eq = (name, x, y) => {
    const tx = JSON.stringify(x);
    const ty = JSON.stringify(y);
    return tx === ty ? null : `${name}: v1 ${tx.slice(0, 300)} | analyze ${ty.slice(0, 300)}`;
  };
  const temps = new Set(facts.temps);
  const frames = new Map();
  const decls = new Map();
  for (const s of a.scopes) {
    const k = scopeKey(s.ownerId, s.stmtIds);
    if (!s.checkOnly) {
      frames.set(k, JSON.stringify(frameText({
        reactive: [...s.reactive], computed: [...s.computed], readonly: [...s.readonly],
        handles: [...s.handles], own: s.own, classes: [...s.classes],
        importSpecs: [...s.importSpecs], exportedConst: [...s.exportedConst],
      })));
    }
    decls.set(k, JSON.stringify([...s.decls].map(([n, d]) => [n, d.kind, d.nodeId])));
  }
  return eq('bindings', record.bindings, a.bindings)
    ?? eq('bindingNames', record.bindingNames, a.bindingNames)
    ?? eq('runtimes', [...record.runtimes], [...a.runtimes])
    ?? eq('atoms', facts.atoms, sortedNames(a.atoms))
    ?? eq('bound', sortedNames([...facts.bound].filter((n) => !temps.has(n))), sortedNames(a.bound))
    ?? eq('programHoist', facts.programHoist, a.programHoist)
    ?? eq('typeOnlyImports', facts.typeOnlyImports, sortedNames(a.typeOnlyImports))
    ?? eq('appAccessors', facts.appAccessors, a.appAccessors)
    ?? eq('schemaTrees', facts.trees, a.schemaTrees)
    ?? compareScopes('frame', facts.frames, frames)
    ?? compareScopes('decls', facts.decls, decls)
    ?? compareHoists(facts, a, v2.idOf)
    ?? comparePredicates(facts.predicates, a.predicateBits);
}

// The scope facts: each hoisting scope's entries, temp sites and
// declare-in-place decision, and the class field plans.
function compareHoists(facts, a, idOf) {
  const hoists = new Map();
  const captures = new Map();
  const named = (pairs) => [...pairs].map(([n, node]) => [n, idOf(node)]);
  const plan = (p) => [idOf(p.node), [p.recv, p.obj, p.key]];
  for (const s of a.hoists) {
    const h = {
      targets: named(s.entries), matchWrite: s.matchWrite, declareInPlace: s.declareInPlace,
      annotations: named(s.annotations).sort(byName), chains: s.chains.map(idOf).sort((x, y) => x - y),
      plans: s.plans.map(plan).sort(([x], [y]) => x - y),
    };
    const key = s.list === null ? 'P' : listKey(s.list, idOf);
    if (!emptyHoist(h)) {
      const text = JSON.stringify(h);
      const prior = hoists.get(key);
      hoists.set(key, prior !== undefined && prior !== text ? `CONFLICT ${prior} | ${text}` : text);
    }
    if (s.captures !== null) {
      const fact = ([n]) => {
        const c = s.captures.get(n);
        if (c === undefined) return [n, null];
        return [n, idOf(c.decl), c.nested, c.nestedWrite, c.inDef, idOf(c.annotated), idOf(c.firstWrite), c.firstWritePath];
      };
      captures.set(listKey(s.raw, idOf), JSON.stringify({
        captures: s.entries.map(fact), declared: named(s.inPlace), classBindings: [...s.classBindings].sort(),
        pinnable: s.pinnable.map(([n, node]) => [n, idOf(node)]).sort(byName),
      }));
    }
  }
  const fieldPlans = new Map(a.fieldPlans.map((f) => [idOf(f.value), JSON.stringify(f.plans.map(plan).sort(([x], [y]) => x - y))]));
  return compareScopes('hoist', facts.hoists, hoists)
    ?? compareScopes('declare-in-place', facts.captures, captures)
    ?? compareScopes('field plan', new Map([...facts.fieldPlans].map(([k, v]) => [k, v])), fieldPlans);
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

// v1 records a scope only when it emits it; analyze.js records every
// scope. Each v1 scope must match, and a scope analyze.js holds that v1
// never opened is a difference.
function compareScopes(name, v1, v2) {
  for (const [k, text] of v1) {
    if (text.startsWith('CONFLICT')) return `${name} ${k}: v1 recorded two values: ${text.slice(0, 300)}`;
    const other = v2.get(k);
    if (other === undefined) return `${name} ${k}: analyze has no such scope; v1 ${text.slice(0, 200)}`;
    if (other !== text) return `${name} ${k}: v1 ${text.slice(0, 300)} | analyze ${other.slice(0, 300)}`;
  }
  for (const [k, text] of v2) {
    if (!v1.has(k)) return `${name} ${k}: v1 never opened this scope; analyze ${text.slice(0, 200)}`;
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
