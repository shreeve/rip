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
//   importSpecs, exportedConst) and the authoritative declarations the
//   redeclaration check settled.
import { parseSource } from '../../src/compiler.js';
import { emit as emitV1 } from '../../src/emitter.js';
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
];
const inFamily = (message) => FAMILY.some((re) => re.test(message));

const sortedNames = (xs) => [...xs].sort();
const errText = (err) => `${err.message} @${err.start ?? '-'}:${err.end ?? '-'}`;

const scopeKey = (ownerId, stmtIds) => (ownerId !== null ? `o${ownerId}` : `s${stmtIds.join(',')}`);

// v1's facts for one parse, through the sink.
export function v1Facts(parsed, options) {
  const stores = new Stores(parsed.result.stores);
  const idOf = (x) => (Array.isArray(x) ? stores.idOf(x) : null);
  const facts = { frames: new Map(), decls: new Map(), trees: [] };
  const sink = (kind, key, value) => {
    switch (kind) {
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
        const text = JSON.stringify(frameText({
          reactive: [...value.reactive], computed: [...value.computed], readonly: [...value.readonly],
          handles: [...value.handles], own: new Set([...key.declared, ...value.handles, ...value.readonly]),
          classes: [...value.classes], importSpecs: [...value.importSpecs], exportedConst: [...value.exportedConst],
        }));
        const prior = facts.frames.get(k);
        facts.frames.set(k, prior !== undefined && prior !== text ? `CONFLICT ${prior} | ${text}` : text);
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
      source: parsed.source, dataPayload: parsed.dataPayload, modulePath: parsed.path, facts: sink,
    });
    return { record, facts };
  } catch (err) {
    return { error: err };
  }
}

// One frame's sets in a comparable spelling.
function frameText(f) {
  return {
    reactive: f.reactive, computed: f.computed, readonly: f.readonly, handles: f.handles,
    own: sortedNames(f.own), classes: f.classes,
    importSpecs: f.importSpecs.map(([n, s]) => [n, s.specifier, s.importedName]), exportedConst: f.exportedConst,
  };
}

export function v2Facts(parsed, options) {
  try {
    const a = analyze(parsed.result, { source: parsed.source, face: options.face, ambientBindings: options.ambientBindings ?? null });
    return { analysis: a };
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
        reactive: [...s.reactive.keys()], computed: [...s.computed.keys()], readonly: [...s.readonly.keys()],
        handles: [...s.handles.keys()], own: new Set(s.own.keys()), classes: [...s.classes.keys()],
        importSpecs: [...s.importSpecs], exportedConst: [...s.exportedConst.keys()],
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
    ?? compareScopes('decls', facts.decls, decls);
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
      try { parsed = parseSource(src, { path, face }); } catch { /* the parser rejects it */ }
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
