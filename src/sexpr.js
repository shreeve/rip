// The s-expression validator: checks a parse tree against the kind
// registry the parser ships (`kinds` in src/parser.js, declared in
// grammar.rip). Every node the grammar built with a kind must fit one
// of that kind's forms: each element's value fits its slot's type, and
// each positional RoleStore row of the node names the slot it sits in.
// The root must be a program. Solar checks the grammar's templates
// against the registry by slot name and constant; the types of the
// values a template's refs carry are checked here, on the trees real
// programs produce.
//
// A tree node's kind comes from its NodeStore row. An unkinded array
// is plumbing (a list or scaffold), or an array an executable action
// built, which the registry cannot describe: such an array passes
// where a slot admits `expr`, and the walk still validates every
// kinded node inside it.

import { kinds as shippedKinds, executable as shippedExecutable, leafKinds } from './parser.js';

// ── leaves ──────────────────────────────────────────────────────────
// A leaf: [kind, {}, raw], a token's value as a node of its own (the
// grammar's `leaves` table names the kinds). leafValue reads its raw
// value (a `this` leaf spelled `@` reads "this") and passes any other
// value through.
export const LEAF_KINDS = new Set(leafKinds);
export const isLeaf = (x) => Array.isArray(x) && x.length === 3 && LEAF_KINDS.has(x[0]) && isAttrs(x[1]);
export const leafValue = (x) => (isLeaf(x) ? (x[0] === 'this' ? 'this' : x[2]) : x);

// ── reading the tree ────────────────────────────────────────────────
// A node: [head, attrs, ...children]. Leaves, type values and the
// absent marker are nodes too.
export const isNode = (x) => Array.isArray(x) && typeof x[0] === 'string' && isAttrs(x[1]);
// A plumbing list: an array without an attribute record. Its first
// element is a child like the rest, whatever head it spells.
export const isList = (x) => Array.isArray(x) && !isAttrs(x[1]);
// The marker of an absent slot: ["none", {}].
export const isNone = (x) => Array.isArray(x) && x[0] === 'none' && x.length === 2 && isAttrs(x[1]);
// The word a slot holds: a leaf's text (`this` for both spellings), a
// type value's text (["type", {}, raw, body]), or a keyword slot's
// string. Undefined for anything else.
export const wordOf = (x) => {
  if (typeof x === 'string') return x;
  if (!Array.isArray(x) || !isAttrs(x[1])) return undefined;
  if (x.length === 3 && LEAF_KINDS.has(x[0])) return x[0] === 'this' ? 'this' : x[2];
  if (x.length === 4 && x[0] === 'type' && typeof x[2] === 'string') return x[2];
  return undefined;
};
// A structure: an array that is neither a word nor the absent marker.
export const isStruct = (x) => Array.isArray(x) && wordOf(x) === undefined && !isNone(x);

// ── building the tree ───────────────────────────────────────────────
// A lowering's own node or word carries no NodeStore row, so it emits
// unmarked. mkNode('none') is the absent marker. A node with flags is
// written as a literal: ['=', { void: true }, target, value].
export const mkNode = (head, ...kids) => [head, {}, ...kids];
export const mkLeaf = (kind, raw) => [kind, {}, raw];

// ── call shapes ─────────────────────────────────────────────────────
// A call: ["call", attrs, callee, ...args]. The attribute record says
// whether the call is optional (`opt`) or awaited (`await`).
export const isAttrs = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const isCall = (x) => Array.isArray(x) && x[0] === 'call' && isAttrs(x[1]);
export const mkCall = (callee, ...args) => mkNode('call', callee, ...args);
// `super(…)` and `import(…)` are calls whose callee is the keyword.
export const isSuperCall = (x) => isCall(x) && x[2] === 'super';
export const isDynamicImport = (x) => isCall(x) && x[2] === 'import';
// `f!`: the awaited call of a callee with no arguments of its own.
export const isDammit = (x) => isCall(x) && x[1].await === true && x[1].opt !== true && x.length === 3 && !isDynamicImport(x);
// `f?!` / `f?! args`: the awaited optional call.
export const isMaybeDammit = (x) => isCall(x) && x[1].await === true && x[1].opt === true;
// A call that is neither optional nor awaited.
export const isPlainCall = (x) => isCall(x) && x[1].opt !== true && x[1].await !== true;
// `f?.(args)` / `f? args`.
export const isOptCall = (x) => isCall(x) && x[1].opt === true && x[1].await !== true;
// A call that emits `await …`: an awaited call, or a call whose callee
// is a dammit (`f! x` folds into `await f(x)`).
export const isAwaitedCall = (x) => isCall(x) && (x[1].await === true || isDammit(x[2]));

const describeValue = (value, kindOf) => {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return `leaf ${JSON.stringify(value)}`;
  if (Array.isArray(value)) {
    const kind = kindOf(value);
    return kind ? `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} node` : 'an unkinded array';
  }
  return typeof value === 'object' ? `the record ${JSON.stringify(value)}` : typeof value;
};

const typeText = (type) => {
  const alt = (a) => {
    switch (a.t) {
      case 'kind': return a.kind;
      case 'lit': return JSON.stringify(a.value);
      case 'list': return `[${typeText(a.of)}]`;
      case 'attrs': return `{${a.keys.map((k) => (a.values?.[k] ? `${k}:${a.values[k].map((v) => JSON.stringify(v)).join('|')}` : k)).join(' ')}}`;
      case 'none': return 'none';
      default: return a.t;
    }
  };
  return type.alts.map(alt).join('|') + (type.nullable ? '?' : '');
};

// Validate a parse result ({sexpr, stores}) against a registry. Returns
// the issues found, each {nodeId, kind, start, end, message}; an empty
// list means the tree fits the contract. The entry values are walked
// too: a type annotation a rule erases from the tree is held only there. A `coverage` Map, when given,
// collects kind → the indexes of every form some node fit.
export function validateSexpr(result, { kinds = shippedKinds, executable = shippedExecutable, coverage = null } = {}) {
  const { sexpr, stores } = result;
  const nodeIds = stores.nodeIds;
  const rows = new Map(stores.nodes.map((n) => [n.nodeId, n]));
  const rowOf = (node) => {
    const id = nodeIds.get(node);
    return id == null ? null : rows.get(id);
  };
  const kindOf = (node) => rowOf(node)?.semanticKind ?? null;
  const isExecutable = (node) => {
    const row = rowOf(node);
    return row != null && row.semanticKind == null && executable[row.ruleId] === true;
  };

  const fits = (value, type) => {
    if (value === null) return type.nullable === true || type.alts.some((a) => a.t === 'null' || a.t === 'any');
    return type.alts.some((a) => fitsAlt(value, a));
  };
  const fitsAlt = (value, alt) => {
    switch (alt.t) {
      case 'any': return value !== undefined;
      case 'leaf': return typeof value === 'string';
      case 'bool': return typeof value === 'boolean';
      case 'null': return false;
      case 'descriptor': return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'attrs': {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
        const flags = Object.keys(value).sort();
        return flags.join(' ') === alt.keys.join(' ') &&
          flags.every((k) => (alt.values?.[k] ? alt.values[k].includes(value[k]) : value[k] === true));
      }
      case 'none': return Array.isArray(value) && value.length === 2 && value[0] === 'none' && isAttrs(value[1]) && kindOf(value) == null;
      case 'lit': return value === alt.value;
      case 'expr': {
        if (!Array.isArray(value)) return false;
        const kind = kindOf(value);
        return kind != null ? kinds[kind]?.part !== true : isExecutable(value);
      }
      case 'kind': return Array.isArray(value) && kindOf(value) === alt.kind;
      case 'list':
        return Array.isArray(value) && kindOf(value) == null && value.every((v) => fits(v, alt.of));
    }
    return false;
  };

  // Fit a node to one form: null, or the first mismatch with how many
  // elements fit before it.
  const fitForm = (node, slots) => {
    let fixed = slots.findIndex((s) => s.spread);
    if (fixed < 0) fixed = slots.length;
    const slotFits = (value, slot) => (slot.lit ? slot.lit.includes(value) : fits(value, slot.type));
    const expect = (slot) => (slot.lit ? slot.lit.map((l) => JSON.stringify(l)).join('|') : `${slot.role}:${typeText(slot.type)}`);
    let run = fixed;
    for (let i = 0; i < node.length; i++) {
      if (i < fixed) {
        if (!slotFits(node[i], slots[i])) {
          return { depth: i, why: `element ${i} is ${describeValue(node[i], kindOf)}, the slot takes ${expect(slots[i])}` };
        }
        continue;
      }
      if (fixed === slots.length) return { depth: i, why: `element ${i} has no slot (the form has ${slots.length})` };
      // Trailing elements take the spread slots in order.
      const start = run;
      while (run < slots.length && !slotFits(node[i], slots[run])) run++;
      if (run === slots.length) {
        return { depth: i, why: `element ${i} is ${describeValue(node[i], kindOf)}, the run takes ${slots.slice(start).map(expect).join(' then ')}` };
      }
    }
    if (node.length < fixed) return { depth: node.length, why: `slot ${expect(slots[node.length])} has no element` };
    return null;
  };

  // A node's positional role rows (a ref, spread or named literal with a
  // known child slot) must name the slot they sit in.
  const rolesByNode = new Map();
  for (const role of stores.roles) {
    if (role.childSlot == null) continue;
    let list = rolesByNode.get(role.nodeId);
    if (!list) rolesByNode.set(role.nodeId, list = []);
    list.push(role);
  }
  const namesFit = (node, slots) => {
    const roles = rolesByNode.get(nodeIds.get(node)) ?? [];
    let fixed = slots.findIndex((sl) => sl.spread);
    if (fixed < 0) fixed = slots.length;
    for (const role of roles) {
      const named = role.childSlot < fixed
        ? slots[role.childSlot]?.role === role.role
        : slots.slice(fixed).some((sl) => sl.role === role.role);
      if (!named) return `role '${role.role}' sits at element ${role.childSlot}, which the form names ${role.childSlot < fixed ? (slots[role.childSlot]?.role ? `'${slots[role.childSlot].role}'` : 'a constant') : 'otherwise'}`;
    }
    return null;
  };

  const issues = [];
  const report = (node, kind, message) => {
    const row = rowOf(node);
    issues.push({ nodeId: row?.nodeId ?? null, kind, start: row?.sourceStart ?? null, end: row?.sourceEnd ?? null, message });
  };

  if (!Array.isArray(sexpr) || kindOf(sexpr) !== 'program') {
    report(Array.isArray(sexpr) ? sexpr : [], null, `the root is ${describeValue(sexpr, kindOf)}, not a program node`);
  }

  const seen = new Set();
  const walk = (node) => {
    if (!Array.isArray(node) || seen.has(node)) return;
    seen.add(node);
    const kind = kindOf(node);
    if (kind != null) {
      const entry = kinds[kind];
      if (!entry) {
        report(node, kind, `kind '${kind}' is not in the registry`);
      } else {
        let best = null;
        let fit = false;
        entry.forms.forEach((form, i) => {
          let miss = fitForm(node, form.slots);
          if (miss === null) {
            const why = namesFit(node, form.slots);
            if (why) miss = { depth: node.length, why };
          }
          if (miss === null) {
            fit = true;
            if (coverage) (coverage.get(kind) ?? coverage.set(kind, new Set()).get(kind)).add(i);
          } else {
            // Closest: the most elements fit, then a form whose arity
            // admits the node's length.
            const fixed = form.slots.findIndex((sl) => sl.spread);
            const arity = fixed >= 0 ? node.length >= fixed : node.length === form.slots.length;
            const score = miss.depth * 2 + (arity ? 1 : 0);
            if (!best || score > best.score) best = { miss, form, score };
          }
        });
        if (!fit) report(node, kind, `${kind} node fits no form; closest (${best.form.text}): ${best.miss.why}`);
      }
    }
    for (const child of node) walk(child);
  };
  walk(sexpr);
  for (const value of stores.entryValues ?? []) walk(value);
  return issues;
}
