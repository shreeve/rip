// Schema DSL — the reader: from a schema body's tree to its descriptor.
//
// `schema [:kind]` declarations are a small language of their own. The
// scanner reads a body in the schema alphabet (src/lexer.js, the `schema`
// mode frame) and cuts it from the tape: SCHEMA + SCHEMA_BODY stay, and
// SCHEMA_BODY's payload is the body, which the grammar's SchemaBody entry
// parses (src/grammar/grammar.rip). Embedded Rip — callable, scope and
// @ensure bodies, field transforms, the `on:` adapter — rides in the
// payload as SCHEMA_CODE islands that the program's own start symbol
// parses.
//
// SCHEMA_BODY's token VALUE is the descriptor. The scanner creates it
// with its span and primitive occurrences; once the parse accepts,
// finishSchemas reads each body's tree into it — kind, entries, adapter —
// applying every rule the grammar cannot: the kind capability matrix,
// the vocabulary (src/runtime/vocab.js) and its namespaces, literal
// values, cross-entry rules, the `schema.defaultMaxString` pragma. Its
// toJSON() returns the KIND string, so the s-expression serializes as
// `["schema", "input"]`. Every rejection is positioned, read from the
// tree's NodeStore rows.
//
// Kinds: :input (default), :shape, :mixin, :enum, :union, :model. The
// :model kind carries the persistence surface — directives (@times,
// @softDelete, relations, @unique/@index, @idStart, @tableWas),
// @scope/@defaultScope, lifecycle hook binding, field attrs ({was:}) and
// inline @unique, and the `on:` declaration option (a per-schema adapter
// expression). Every persistence spelling stays :model-only on the other
// kinds. The runtime (src/runtime/orm.js) re-rejects at the root, since a
// descriptor is hand-buildable.

const VALID_KINDS = new Set(['input', 'shape', 'mixin', 'enum', 'union', 'model']);
const KIND_DEFAULT = 'input';

// Lifecycle hook names — a `name: -> body` callable on a :model whose
// name is in this set binds as a hook (exact match; anything else is
// a plain method — a working reading, so no fuzzy near-miss guard).
// Mirrors the runtime's HOOK_NAMES.
const HOOK_NAMES = new Set([
  'beforeValidation', 'afterValidation',
  'beforeSave', 'afterSave',
  'beforeCreate', 'afterCreate',
  'beforeUpdate', 'afterUpdate',
  'beforeDestroy', 'afterDestroy',
  'afterCommit', 'afterRollback',
]);

// Wire-friendly built-ins the `~type` coercion marker accepts (each
// has a strict coercion table in the runtime).
const SCHEMA_COERCIBLE_TYPES = new Set(['integer', 'number', 'boolean', 'date', 'datetime']);

// `~:name` — NAMED coercers from the runtime registry
// (registerCoercer). The name is free-form (a missing registration is
// a runtime config error, not a parse error), but the coercer's
// OUTPUT type matters at compile time, so the shipped names carry a
// static output-type table; unknown (custom) names type as `any`.
const SCHEMA_NAMED_COERCER_TYPES = {
  __proto__: null,
  id: 'integer', int: 'integer', whole: 'integer',
  float: 'number', money: 'integer', money_even: 'integer',
  cents: 'integer', decimal: 'string',
  bool: 'boolean', truthy: 'boolean', falsy: 'boolean',
  json: 'json', hash: 'json', array: 'json',
  ids: { type: 'integer', array: true },
  string: 'string', text: 'string', name: 'string', address: 'string',
  date: 'string', time: 'string', time12: 'string',
  email: 'email', state: 'string', zip: 'zip', zipplus4: 'string',
  ssn: 'string', sex: 'string', phone: 'string', username: 'string',
  ip: 'string', mac: 'string', url: 'url', color: 'string',
  uuid: 'uuid', semver: 'string', slug: 'string',
};

// VARCHAR-like primitive types — the `schema.defaultMaxString` pragma
// applies a default `max` to these when no explicit range/regex/
// literals narrow the field. `text` stays uncapped by design.
const VARCHAR_TYPES = new Set(['string', 'email', 'url', 'phone', 'zip']);

export const SCHEMA_PRAGMA_KEYS = new Set(['defaultMaxString']);

// The words a literal position reads as values (the program's literal
// spellings).
const LITERAL_WORDS = { __proto__: null, true: true, yes: true, false: false, no: false, null: null };

import { isIdentifierName, identifierRunAt } from './ident.js';
import { isPlainCall, leafValue } from './sexpr.js';
import { normalizeTypeText } from './ts/types.js';
// The schema vocabulary and naming rules, shared verbatim with the two
// runtimes that also need them (src/runtime/schema.js validates
// declared names, src/runtime/orm.js validates hand-built descriptors).
// It is a leaf module with no imports of its own, so the compiler
// importing a runtime file creates no bootstrap cycle.
//
import {
  snakeCase, camelCase, fkName, pluralize, accessorOf,
  isCanonicalName, isCanonicalTarget,
  attrValueError,
  MODEL_DIRECTIVES, ONCE_DIRECTIVES, RELATION_DIRECTIVES,
  FIELD_ATTRS, RELATION_ATTRS,
} from './runtime/vocab.js';

// Face-only behavior object name for a schema (`ReturnType<typeof …>`
// and the JS face share this spelling). Lives here — not in
// ts/schema.js — so the browser compile graph can take the
// name without the IDE type machinery.
export const behaviorName = (name) => `__${name}__behavior`;

// What the scanner hands the reader beside the tree, on the descriptor
// (never enumerable): each island's tokens and each parameter list's
// tokens, keyed by source offset, the pragma state the body was read
// under, and where its `schema` word starts.
export const SCHEMA_SCAN = Symbol('schema scan');
// The tree of each code site, keyed by the token array the descriptor
// holds for it (schemaCodeSites); emitterShape reads it.
export const SCHEMA_TREES = Symbol('schema code trees');

// The embedded Rip code a descriptor carries, in the one order the
// emitter reads their trees: each callable, scope, @ensure predicate and
// field transform in entry order, then the `on:` adapter. `key` names the
// entry field holding the island's tokens; the adapter is a VALUE
// expression, not a function body.
export function schemaCodeSites(descriptor) {
  const out = [];
  descriptor.entries.forEach((entry, index) => {
    if (entry.tag === 'method' || entry.tag === 'computed' || entry.tag === 'derived' || entry.tag === 'ensure' ||
        entry.tag === 'hook' || entry.tag === 'scope' || entry.tag === 'defaultScope') {
      out.push({ entry, index, key: 'bodyTokens', tokens: entry.bodyTokens, value: false });
    } else if (entry.tag === 'field' && entry.transformTokens) {
      out.push({ entry, index, key: 'transformTokens', tokens: entry.transformTokens, value: false });
    }
  });
  if (descriptor.adapterTokens) {
    out.push({ entry: { tag: 'adapter' }, index: 'adapter', key: 'adapterTokens', tokens: descriptor.adapterTokens, value: true });
  }
  return out;
}

// ── reading the tree ─────────────────────────────────────────────────

const isNone = (x) => Array.isArray(x) && x[0] === 'none' && x.length === 2;
const headOf = (x) => (Array.isArray(x) ? x[0] : x);
// A directive argument's punctuation: `,`, `.`, or a tight `?`.
const isMark = (x, raw) => headOf(x) === 'schema-mark' && x[2] === raw;

// The token kind a message names for a node, in the program's vocabulary.
const kindName = (x) => {
  switch (headOf(x)) {
    case 'name': return 'IDENTIFIER';
    case 'num': return 'NUMBER';
    case 'string': return 'STRING';
    case 'regex': return 'REGEX';
    case 'sym': return ':';
    case 'schema-neg': return '-';
    case 'schema-bracket': return '[';
    case 'schema-attrs': return '{';
    case 'schema-mark': return x[2];
    default: return String(headOf(x));
  }
};

// The descriptors of every schema the accepted parse holds, filled in
// place, outer schemas first.
// A tolerant parse keeps a schema's face through a half-typed member: a
// callable line the reader rejects is recorded and dropped, as the
// scanner drops a malformed member head.
export function finishSchemas(result, source, path, tolerant = false) {
  const { stores } = result;
  const bodies = stores.entryValues.filter((v) => v[0] === 'schema-body' && headOf(v[3]) === 'schema-dsl');
  if (bodies.length === 0) return;
  const fail = (message, at, end = at) => {
    const { line, col } = source.lineColAt(at);
    const err = new Error(`${path}:${line + 1}:${col + 1}: ${message}`);
    err.reason = message;
    err.start = at;
    err.end = end;
    throw err;
  };
  const span = (node) => {
    const row = stores.nodes[stores.nodeIds.get(node) - 1];
    return row ? [row.sourceStart, row.sourceEnd] : [0, 0];
  };
  const tolerate = tolerant
    ? (err) => result.diagnostics.push({ message: err.reason, start: err.start, end: err.end, expected: [], got: '' })
    : null;
  bodies.sort((a, b) => a[2].start - b[2].start);
  for (const v of bodies) readSchema(v[2], v[3], { fail, span, at: (n) => span(n)[0], tolerate });
}

function readSchema(descriptor, dsl, ctx) {
  const { fail, at } = ctx;
  const scan = descriptor[SCHEMA_SCAN];
  const trees = new Map();
  Object.defineProperty(descriptor, SCHEMA_TREES, { value: trees, configurable: true });
  ctx.scan = scan;
  ctx.trees = trees;
  ctx.island = (code) => {
    const tokens = scan.islands.get(at(code)) ?? [];
    trees.set(tokens, code);
    return tokens;
  };
  ctx.params = (node) => (isNone(node) ? [] : scan.params.get(at(node)) ?? []);
  const [, , kindNode, adapter, ...lines] = dsl;

  let kind = KIND_DEFAULT;
  const kindTok = isNone(kindNode) ? null : kindNode;
  if (kindTok) {
    const k = kindTok[2];
    if (!VALID_KINDS.has(k)) {
      fail(`unknown schema kind :${k} — expected one of :input, :shape, :model, :mixin, :enum, :union`, at(kindTok));
    }
    kind = k;
  }
  if (!isNone(adapter)) {
    const [, , onLeaf, code] = adapter;
    if (kind !== 'model') {
      fail(`'on:' (the per-schema adapter) applies to :model only — :${kind} never queries a database`, at(onLeaf));
    }
    const tokens = ctx.island(code);
    if (!tokens.length) fail(`'on:' requires an adapter expression — 'schema :model, on: analytics'`, at(onLeaf));
    descriptor.adapterTokens = tokens;
  }
  // Kind inference: a default-kind body whose first line is a :symbol
  // member is unambiguously an enum (`schema` + `:draft` lines).
  if (kind === KIND_DEFAULT && !kindTok && headOf(lines[0]) === 'schema-member') kind = 'enum';
  ctx.kind = kind;
  ctx.defaultMaxString = scan.defaultMaxString;

  const entries = [];
  if (kind === 'enum') {
    for (const line of lines) readEnumLine(line, entries, ctx);
    checkEnumMembers(entries, fail);
  } else if (kind === 'union') {
    for (const line of lines) readUnionLine(line, entries, ctx);
    const onCount = entries.filter((e) => e.tag === 'directive' && e.name === 'on').length;
    const members = entries.filter((e) => e.tag === 'union-member');
    const schemaStart = scan.schemaStart;
    if (onCount !== 1) {
      fail(onCount === 0
        ? `:union requires an '@on :field' discriminator — untagged unions are not supported`
        : `:union takes exactly one '@on :field' discriminator (got ${onCount})`, schemaStart);
    }
    if (members.length < 2) {
      fail(`:union needs at least two constituent schemas (got ${members.length})`, schemaStart);
    }
  } else {
    for (const line of lines) readFieldedLine(line, entries, ctx);
    // Capability matrix by kind. `@mixin` adds fields, so every fielded
    // kind takes it; the persistence spellings are :model-only elsewhere.
    if (kind === 'model') {
      finishModelBody(entries, ctx);
    } else {
      for (const e of entries) {
        if (e.tag === 'scope' || e.tag === 'defaultScope') {
          fail(`:${kind} schemas don't accept query scopes — '@${e.tag === 'scope' ? 'scope' : 'defaultScope'}' is :model-only`, e.start);
        }
        if (kind === 'mixin' && (e.tag === 'method' || e.tag === 'computed' || e.tag === 'derived')) {
          fail(`:mixin schemas are fields-only — '${e.name}' is a ${e.tag}; move it to a :shape or :model`, e.start);
        }
        if (kind === 'mixin' && e.tag === 'ensure') {
          fail(`:mixin schemas don't accept @ensure refinements — move the invariant to a :shape or :model that composes this mixin`, e.start);
        }
        if (kind === 'input' && (e.tag === 'method' || e.tag === 'computed')) {
          fail(`:input schemas are fields-only — '${e.name}' is a ${e.tag}; use :shape or :model if you need behavior`, e.start);
        }
        if (e.tag === 'directive' && e.name !== 'mixin') {
          fail(`:${kind} schemas only accept '@mixin Name'${kind === 'input' ? " and '@ensure'" : ''} — '@${e.name}' is ${['times', 'softDelete', 'belongsTo', 'hasMany', 'hasOne', 'unique', 'index', 'idStart', 'table', 'tableWas', 'primary'].includes(e.name) ? ':model-only' : 'not a schema directive'}`, e.start);
        }
      }
    }
  }
  descriptor.kind = kind;
  descriptor.entries = entries;
}

// The argument nodes a directive entry was read from (its args parse in
// finishModelBody, once the whole body is known).
const argNodesOf = new WeakMap();

// A directive's arguments as the token run a hover and the emitter read
// (`argTokens`): each word the author wrote is an IDENTIFIER (an option's
// key a PROPERTY), at its own span; punctuation carries no span.
function argTokensOf(nodes, ctx) {
  const out = [];
  const mark = (kind, value = kind) => out.push({ kind, value, start: null, end: null });
  const node = (n) => {
    const [s, e] = ctx.span(n);
    switch (headOf(n)) {
      case 'name': out.push({ kind: 'IDENTIFIER', value: n[2], start: s, end: e }); break;
      case 'sym':
        out.push({ kind: ':', value: ':', start: s, end: s + 1 });
        out.push({ kind: 'IDENTIFIER', value: n[2], start: s + 1, end: e });
        break;
      case 'num': out.push({ kind: 'NUMBER', value: n[2], start: s, end: e }); break;
      case 'string': out.push({ kind: 'STRING', value: n[2], start: s, end: e }); break;
      case 'regex': out.push({ kind: 'REGEX', value: n[2], start: s, end: e }); break;
      case 'schema-neg': mark('-'); node(n[2]); break;
      case 'schema-bracket':
        out.push({ kind: '[', value: '[', start: s, end: s + 1 });
        n.slice(2).forEach((v, i) => { if (i) mark(','); node(v); });
        out.push({ kind: ']', value: ']', start: e - 1, end: e });
        break;
      case 'schema-attrs':
        out.push({ kind: '{', value: '{', start: s, end: s + 1 });
        n.slice(2).forEach((o, i) => {
          if (i) mark(',');
          const [ks, ke] = ctx.span(o[2]);
          out.push({ kind: 'PROPERTY', value: o[2][2], start: ks, end: ke });
          mark(':');
          node(o[3]);
        });
        out.push({ kind: '}', value: '}', start: e - 1, end: e });
        break;
      case 'schema-mark': out.push({ kind: n[2], value: n[2], start: s, end: e }); break;
    }
  };
  nodes.forEach(node);
  return out;
}

function readFieldedLine(line, entries, ctx) {
  if (line[0] === 'schema-callable' && ctx.tolerate) {
    try { readFieldedLine(line, entries, { ...ctx, tolerate: null }); } catch (err) {
      if (typeof err?.start !== 'number') throw err;
      ctx.tolerate(err);
    }
    return;
  }
  const { fail, at } = ctx;
  const start = at(line);
  switch (line[0]) {
    case 'schema-directive': {
      const [, , nameLeaf, ...args] = line;
      const name = nameLeaf[2];
      const entry = { tag: 'directive', name, args: null, argTokens: argTokensOf(args, ctx), start, nameStart: at(nameLeaf) + 1 };
      if (name === 'mixin') {
        if (headOf(args[0]) !== 'name') fail(`@mixin requires a target name — '@mixin Timestamps'`, start);
        if (args.length > 1) fail(`@mixin takes exactly one schema name`, at(args[1]));
        entry.args = [{ target: args[0][2] }];
      }
      argNodesOf.set(entry, args);
      entries.push(entry);
      return;
    }
    case 'schema-ensure': {
      const items = line.slice(2);
      for (const p of readEnsurePairs(items, start, ctx)) {
        entries.push({
          tag: 'ensure', name: 'ensure',
          message: p.message, field: p.field, fieldStart: p.fieldStart, async: line[1].async === true,
          paramTokens: p.paramTokens, bodyTokens: p.bodyTokens,
          start,
        });
      }
      return;
    }
    case 'schema-scope': {
      const [, attrs, sym, fn] = line;
      const [, , paramsNode, code] = fn;
      if (attrs.default === true) {
        if (!isNone(paramsNode)) fail(`@defaultScope takes no parameters — write '@defaultScope -> @where(...)'`, start);
        const bodyTokens = ctx.island(code);
        if (!bodyTokens.length) fail(`@defaultScope: function body is empty`, at(fn));
        entries.push({ tag: 'defaultScope', name: 'defaultScope', paramTokens: [], bodyTokens, start });
        return;
      }
      const name = sym[2];
      checkScopeName(name, at(sym) + 1, fail);
      const bodyTokens = ctx.island(code);
      if (!bodyTokens.length) fail(`@scope :${name}: function body is empty`, at(fn));
      entries.push({ tag: 'scope', name, paramTokens: ctx.params(paramsNode), bodyTokens, start });
      return;
    }
    case 'schema-callable': {
      const [, , nameLeaf, paramsNode, arrow, code] = line;
      const name = nameLeaf[2];
      // On a :model, a `->` callable whose name is a recognized lifecycle
      // hook binds as one (exact match — anything else stays a plain
      // method, a working reading).
      const tag = arrow === '~>' ? 'computed'
        : arrow === '!>' ? 'derived'
        : ctx.kind === 'model' && HOOK_NAMES.has(name) ? 'hook'
        : 'method';
      if (!isNone(paramsNode) && tag !== 'method') {
        fail(`'${name}': ${tag === 'computed' ? 'computed getters (~>)' : tag === 'derived' ? 'eager-derived fields (!>)' : 'lifecycle hooks'} take no parameters — only methods do`, ctx.span(nameLeaf)[1]);
      }
      entries.push({ tag, name, paramTokens: ctx.params(paramsNode), bodyTokens: ctx.island(code), start });
      return;
    }
    case 'schema-member':
      fail(`unexpected : at schema top level — allowed: fields ('name! type'), directives ('@name'), methods ('name: -> body'), computed getters ('name: ~> body')`, start);
      return;
    case 'schema-field':
      readField(line, entries, ctx);
  }
}

// `@scope` names chain as query-builder methods.
function checkScopeName(name, at, fail) {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
    fail(`@scope name ':${name}' must be a lowercase-first alphanumeric identifier — scopes chain as query-builder methods`, at);
  }
}

// ── fields ───────────────────────────────────────────────────────────
//
// Field-line grammar (locked):
//   name[!|?]*  [type]  [, range]  [, [default]]  [, /regex/]  [, -> transform]
// The `{…}` attrs bracket and inline `@unique` are persistence
// metadata — rejected with the :model surface.

function readField(line, entries, ctx) {
  const { fail, at, span, kind } = ctx;
  const [, , nameLeaf, modsNode, typeNode, partsNode] = line;
  const name = nameLeaf[2];
  const start = at(line);
  // A declared field named for the pk is checked in finishModelBody,
  // not here: whether it is a collision or a NATURAL KEY declaration
  // depends on an @primary elsewhere in the body.
  const modifiers = isNone(modsNode) ? [] : [...modsNode];

  // Type slot (optional; default `string`): identifier type, `~type` /
  // `~:name` coercion, or a string-literal union.
  let typeName = 'string';
  let literals = null;
  let coerce = false;
  let coercer = null;
  let coercerArray = false;
  let array = false;
  let typeSpan = null;
  let unionDefault;
  let unionDefaultSpan = null;
  if (!isNone(typeNode)) {
    const [, , core, ...arrays] = typeNode;
    const typeStart = at(typeNode);
    if (headOf(core) === 'name') {
      typeName = core[2];
    } else if (headOf(core) === 'schema-coerce') {
      const target = core[2];
      coerce = true;
      if (headOf(target) === 'sym') {
        coercer = target[2];
        const out = SCHEMA_NAMED_COERCER_TYPES[coercer];
        if (out && typeof out === 'object') {
          typeName = out.type;
          coercerArray = true;
        } else {
          typeName = out || 'any';
        }
      } else {
        const t = target[2];
        if (!SCHEMA_COERCIBLE_TYPES.has(t)) {
          fail(`'~${t}' is not coercible — built-in coercion exists for: ${[...SCHEMA_COERCIBLE_TYPES].join(', ')}; named coercers use a symbol ('~:${t}'); otherwise write a transform ('${name}, -> …')`, at(target));
        }
        typeName = t;
      }
    } else if (headOf(core) === 'schema-union') {
      // A union member is `"string"` or, bracketed, `["string"]` — the
      // default marked in place, so it can never name a value outside
      // the union.
      literals = [];
      for (const m of core.slice(2)) {
        if (headOf(m) === 'string') {
          literals.push(JSON.parse(m[2]));
          continue;
        }
        const values = m.slice(2);
        if (values.length !== 1 || headOf(values[0]) !== 'string') {
          fail(`literal unions contain string literals only — '${kindName(values.find((v) => headOf(v) !== 'string') ?? m)}' is not allowed as a union member; use the '?' modifier for nullability`, at(m));
        }
        const value = JSON.parse(values[0][2]);
        literals.push(value);
        if (unionDefaultSpan) {
          fail(`field '${name}' brackets more than one union member as its default — a field has one default`, at(m));
        }
        unionDefault = value;
        unionDefaultSpan = span(m);
      }
      typeName = 'literal-union';
    }
    if (arrays.length > 0) {
      array = true;
      // Nested arrays (`string[][]`) have no validation semantics here —
      // one array dimension validates element-wise; deeper nesting needs
      // `json` or a transform.
      if (arrays.length > 1) {
        fail(`field '${name}' — nested array types ('${typeName}[][]') are not supported: one '[]' validates element-wise; use 'json' or a '-> transform' for deeper nesting`, at(arrays[1]));
      }
    }
    if (coerce && array) {
      fail(`coercion ('~${typeName}') does not apply to array types — coerce per-element with a transform instead`, typeStart);
    }
    if (coercerArray) array = true;
    if (array && literals) {
      fail(`array-of-literal-union is not supported — use 'string[]' for an array of strings`, typeStart);
    }
    // The type slot's own span, whatever spelling filled it, with its
    // optional `[]`. The editor answers a hover here from the companion
    // member's annotation, so the span covers the whole slot — from the
    // WORD, not the `~` ahead of it.
    if (!isNone(core)) {
      const word = headOf(core) === 'schema-coerce' ? core[2] : core;
      typeSpan = [at(word), span(typeNode)[1]];
    }
  }

  let range = null;
  let bracketDefault;
  let hasDefault = false;
  // The default literal's own source span — the face marks its
  // `satisfies` there, so a wrong-typed default anchors on the value.
  let defaultSpan = null;
  if (unionDefaultSpan) {
    bracketDefault = unionDefault;
    hasDefault = true;
    defaultSpan = unionDefaultSpan;
  }
  let regex = null;
  let transformTokens = null;
  let attrs = null;
  let uniqueAttr = false;
  let primaryAttr = false;

  const parts = isNone(partsNode) ? [] : partsNode;
  const real = parts.filter((p) => p !== ',');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === ',') continue;
    const comma = parts[i - 1] === ',';
    const head = headOf(part);
    if (head === 'schema-transform') {
      if (!comma) {
        // `@primary -> …` / `@unique -> …`: after an inline attribute the
        // comma before the transform is optional, mirroring call syntax.
        const before = parts[i - 1];
        if (before === undefined && !isNone(typeNode) && !isNone(typeNode[2])) {
          fail(`field '${name}' has a transform after the type; a comma is required before '->' — write '${name} ${typeName}, -> …'`, at(part));
        }
        if (before !== undefined && headOf(before) !== 'schema-attr') {
          fail(`field '${name}' has a transform after other content; a comma is required before '->'`, at(part));
        }
      }
      if (part !== real[real.length - 1]) {
        fail(`transform '-> …' must be the last element on the field line for '${name}'`, at(part));
      }
      transformTokens = ctx.island(part[2]);
    } else if (head === 'schema-bracket') {
      if (hasDefault) fail(`field '${name}' has more than one '[…]' default bracket`, at(part));
      const values = part.slice(2);
      defaultSpan = [at(values[0]), span(values[values.length - 1])[1]];
      bracketDefault = readDefault(part, name, ctx);
      hasDefault = true;
    } else if (head === 'schema-attrs') {
      // Persistence metadata may also ride a :mixin field — it takes
      // effect when a :model includes the mixin; inclusion into any
      // other kind rejects at expansion (expandMixins).
      if (kind !== 'model' && kind !== 'mixin') {
        fail(`field attrs ('{…}') are persistence metadata — :model/:mixin-only ('{was: "old_column"}' annotates a column rename)`, at(part));
      }
      if (attrs) fail(`field '${name}' has more than one '{…}' attrs bracket`, at(part));
      attrs = readOptions(part, FIELD_ATTRS, `field '${name}'`, ctx);
    } else if (head === 'schema-range') {
      if (range) fail(`field '${name}' has more than one range constraint — one 'min..max' per field`, at(part));
      range = readRange(part, name, ctx);
    } else if (head === 'regex') {
      if (regex) fail(`field '${name}' has more than one regex constraint`, at(part));
      regex = readRegex(part[2], at(part), fail);
    } else if (head === 'schema-attr') {
      const attrName = part[2][2];
      if (kind !== 'model' && kind !== 'mixin') {
        fail(`inline '@${attrName}' on field '${name}' is persistence metadata — :model/:mixin-only ('@unique' marks single-column uniqueness)`, at(part));
      }
      if (attrName === 'unique') {
        if (uniqueAttr) fail(`field '${name}' has more than one '@unique'`, at(part));
        uniqueAttr = true;
      } else if (attrName === 'primary') {
        // Inline form of '@primary <name>': declaring the pk ON the field
        // it describes. :model-only — a mixin doesn't own a row identity.
        if (kind !== 'model') {
          fail(`inline '@primary' on field '${name}' is :model-only — a mixin cannot declare the primary key`, at(part));
        }
        if (primaryAttr) fail(`field '${name}' has more than one '@primary'`, at(part));
        primaryAttr = true;
      } else {
        fail(`unknown inline attribute '@${attrName}' on field '${name}' — the inline attributes are '@unique' and '@primary'`, at(part));
      }
    }
  }

  if (coerce && transformTokens) {
    fail(`field '${name}' has both '~${typeName}' coercion and a '->' transform — a transform replaces coercion; coerce inside it instead`, start);
  }

  // Merge constraints: the pragma default max fills only when nothing
  // narrowed the max; the `!` open-left sugar implies min=1.
  const c = {};
  if (range) {
    if (range.min !== undefined) c.min = range.min;
    if (range.max !== undefined) c.max = range.max;
    if (range.min === undefined && c.min === undefined && modifiers.includes('!')) c.min = 1;
  }
  if (regex) c.regex = regex;
  if (hasDefault) c.default = bracketDefault;
  // Either spelling of a literal-union default must name a member —
  // `["usr"]` beside "user" is a typo, not a policy.
  if (literals && c.default !== undefined && !literals.includes(c.default)) {
    fail(`field '${name}' defaults to ${JSON.stringify(c.default)}, which is not a member of its literal union (${literals.map((l) => JSON.stringify(l)).join(' | ')})`, start);
  }
  if (ctx.defaultMaxString != null && !regex && !literals && VARCHAR_TYPES.has(typeName) && c.max === undefined) {
    c.max = ctx.defaultMaxString;
  }
  if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
    fail(`field '${name}' would have impossible constraints min=${c.min} > max=${c.max} after sugar is applied — write an explicit range or drop the conflicting pragma`, start);
  }
  const constraints =
    c.min !== undefined || c.max !== undefined || c.default !== undefined || c.regex !== undefined ? c : null;

  entries.push({
    tag: 'field', name, modifiers, typeName, array,
    literals, coerce, coercer, constraints, transformTokens,
    unique: uniqueAttr, primary: primaryAttr, attrs,
    start, typeSpan,
    defaultSpan,
  });
}

// `[value]` — a single literal default.
function readDefault(bracket, fieldName, ctx) {
  const { fail, at } = ctx;
  const values = bracket.slice(2);
  if (values.length !== 1) {
    fail(values.length === 2
      ? `size/value ranges use 'min..max' syntax, not brackets — replace the bracket pair with a range`
      : `the constraint bracket takes a single default value (got ${values.length} elements)`, at(bracket));
  }
  const v = values[0];
  if (headOf(v) === 'regex') {
    fail(`regex constraints are written bare, not in brackets — replace '[${v[2]}]' with '${v[2]}'`, at(bracket));
  }
  if (headOf(v) === 'sym') return v[2];
  // `undefined` names no value: a field without a default already
  // defaults to nothing.
  if (headOf(v) === 'name' && v[2] === 'undefined') {
    fail(`field '${fieldName}': a default of undefined is no default; drop the bracket`, at(v));
  }
  return literalOf(v, `field '${fieldName}' default`, ctx);
}

// A `{key: value}` options bracket — one reader for both field attrs and
// relation options; only the vocabulary and the error wording differ.
//
// QUOTING PICKS THE NAMESPACE, exactly as it does for `@table`: bare
// identifiers live in Rip's naming, quoted strings live in the
// database's. `{as: author}` and `{through: Membership}` are Rip names,
// so they are written bare; `{foreignKey: "author_id"}` and
// `{column: "USER_NAME"}` are columns, so they are quoted. Each key's
// namespace is declared once, in vocab.js, and read here — writing a
// name in the wrong one is a positioned error, never a silent guess.
function readOptions(node, vocab, what, ctx) {
  const { fail, at } = ctx;
  const options = node.slice(2);
  if (options.length === 0) fail(`${what} has an empty '{…}' options bracket`, at(node));
  const attrs = {};
  for (const [, , keyLeaf, valNode] of options) {
    const key = keyLeaf[2];
    const kind = vocab[key];
    if (kind === undefined) {
      fail(`unknown ${what} option '${key}' — known options: ${Object.keys(vocab).join(', ')}`, at(keyLeaf));
    }
    if (key in attrs) fail(`${what} repeats option '${key}'`, at(keyLeaf));
    const bare = kind === 'property' || kind === 'model';
    let value;
    if (bare) {
      if (headOf(valNode) !== 'name') {
        // Echo their own word unquoted when that is the whole fix;
        // otherwise show the shape, so the suggestion is never a name
        // that would fail its own namespace check.
        const wrote = headOf(valNode) === 'string' ? JSON.parse(valNode[2]) : null;
        const shown = wrote && !attrValueError(kind, key, wrote)
          ? wrote : (kind === 'model' ? 'Membership' : 'author');
        fail(`${what} option '${key}' names ${kind === 'model' ? 'a model' : 'a property'}, ` +
          `so it is written BARE — '{${key}: ${shown}}', ` +
          `not ${headOf(valNode) === 'string' ? valNode[2] : `a ${kindName(valNode)}`}. ` +
          `Quoting would name a database identifier, which is a different thing`, at(valNode));
      }
      value = valNode[2];
    } else {
      if (headOf(valNode) !== 'string') {
        fail(`${what} option '${key}' names a database column, so it is QUOTED — ` +
          `'{${key}: "${headOf(valNode) === 'name' ? snakeCase(valNode[2]) : 'author_id'}"}'. ` +
          `A bare name would be a Rip name, which is a different thing`, at(valNode));
      }
      value = JSON.parse(valNode[2]);
    }
    const why = attrValueError(kind, key, value);
    if (why) fail(`${what} option ${why}; got '${value}'`, at(keyLeaf));
    attrs[key] = value;
  }
  return attrs;
}

function readRelationAttrs(node, directiveName, ctx) {
  const attrs = readOptions(node, RELATION_ATTRS, `@${directiveName}`, ctx);
  // `through:` names a hop the OWNER does not store, which is what
  // @hasMany and @hasOne both are. @belongsTo stores its key in its own
  // row, so a `through` on it is not a relation, it is a query.
  if (attrs.through && directiveName === 'belongsTo') {
    ctx.fail(`@belongsTo option 'through' is for @hasMany/@hasOne — a @belongsTo holds its key in its own row, so it has nothing to read through`, ctx.at(node));
  }
  // `targetKey:` names a column ON the join model, so without one there
  // is nothing for it to name.
  if (attrs.targetKey && !attrs.through) {
    ctx.fail(`@${directiveName} option 'targetKey' names a column on the join model, so it requires 'through' — '{through: Membership, targetKey: "team_id"}'`, ctx.at(node));
  }
  return attrs;
}

// ── @ensure ──────────────────────────────────────────────────────────
// Inline: `@ensure "msg"[, :field], (args) -> body`
// Array:  `@ensure ["msg", (u) -> body, "msg2", (u) -> body, …]`

function readEnsurePairs(items, start, ctx) {
  const { fail, at } = ctx;
  if (!items.length) {
    fail(`@ensure requires 'message, (x) -> body' or a '[…]' array of pairs`, start);
  }
  if (headOf(items[0]) === 'schema-ensure-list') {
    if (items.length > 1) fail(`@ensure […] must be the only argument — extra tokens after ']'`, at(items[1]));
    return consumeEnsureTuples(items[0].slice(2), items[0], ctx);
  }
  if (items.length < 2) {
    fail(`@ensure inline form must be 'message, (x) -> body' — did you forget the comma?`, at(items[0]));
  }
  if (items.length > 3 || (items.length === 3 && headOf(items[1]) !== 'sym')) {
    fail(`@ensure inline form takes 'message[, :field], fn' (got ${items.length} comma-separated parts) — use '@ensure […]' for multiple refinements`, at(items[0]));
  }
  return consumeEnsureTuples(items, items[0], ctx);
}

function consumeEnsureTuples(parts, anchor, ctx) {
  const { fail, at } = ctx;
  const pairs = [];
  let i = 0;
  while (i < parts.length) {
    const msg = parts[i++];
    const field = i < parts.length && headOf(parts[i]) === 'sym' ? parts[i++] : null;
    if (i >= parts.length) {
      fail(`@ensure: missing function after message${field ? ' and :field' : ''}`, at(msg));
    }
    const fn = parts[i++];
    if (headOf(msg) !== 'string') {
      fail(`@ensure: each refinement's first element must be a string literal message`, at(msg));
    }
    if (headOf(fn) !== 'schema-fn' || isNone(fn[2])) {
      fail(`@ensure: expected '(args) -> body' after the message — predicates declare their parameter explicitly ('(u) -> …')`, at(fn));
    }
    const bodyTokens = ctx.island(fn[3]);
    if (!bodyTokens.length) fail(`@ensure: predicate function body is empty`, at(fn));
    pairs.push({
      message: JSON.parse(msg[2]),
      field: field ? field[2] : null,
      fieldStart: field ? at(field) + 1 : null,
      paramTokens: ctx.params(fn[2]),
      bodyTokens,
    });
  }
  return pairs;
}

// ── :union and :enum lines ───────────────────────────────────────────

const directiveNameOf = (line) => (line[0] === 'schema-directive' ? line[2][2]
  : line[0] === 'schema-ensure' ? 'ensure'
  : line[1].default === true ? 'defaultScope' : 'scope');

function readUnionLine(line, entries, ctx) {
  const { fail, at } = ctx;
  const start = at(line);
  if (line[0] === 'schema-directive' || line[0] === 'schema-ensure' || line[0] === 'schema-scope') {
    const name = directiveNameOf(line);
    if (name !== 'on' || line[0] !== 'schema-directive') {
      fail(`:union bodies accept only '@on :field' and constituent schema names — '@${name}' is not allowed`, start + 1);
    }
    const args = line.slice(3);
    if (headOf(args[0]) !== 'sym') {
      fail(`@on requires the discriminator field as a symbol — '@on :kind'`, args[0] === undefined ? start + 1 : at(args[0]));
    }
    if (args.length > 1) fail(`@on takes exactly one :field symbol`, at(args[1]));
    entries.push({ tag: 'directive', name: 'on', args: [{ field: args[0][2] }], start });
    return;
  }
  if (line[0] === 'schema-field' && isNone(line[3]) && isNone(line[4]) && isNone(line[5])) {
    entries.push({ tag: 'union-member', name: line[2][2], start });
    return;
  }
  const [first, second] = line[0] === 'schema-field' ? ['IDENTIFIER', isNone(line[3]) ? (isNone(line[4]) ? kindName(line[5].find((p) => p !== ',')) : 'IDENTIFIER') : (line[3][0] === '!' ? 'DAMMIT' : '?')]
    : line[0] === 'schema-callable' ? ['PROPERTY', ':']
    : [':', 'IDENTIFIER'];
  fail(`:union bodies accept only '@on :field' and bare constituent schema names (one per line) — got ${first} followed by ${second}`, start);
}

function readEnumLine(line, entries, ctx) {
  const { fail, at } = ctx;
  const start = at(line);
  if (line[0] === 'schema-directive' || line[0] === 'schema-ensure' || line[0] === 'schema-scope') {
    fail(`:enum schemas don't accept '@${directiveNameOf(line)}' — enums hold only :symbol members`, start);
  }
  if (line[0] !== 'schema-member') {
    const word = line[2][2];
    fail(`enum member must be a :symbol — use ':${word}' for a bare member or ':${word} value' for a valued one`, start);
  }
  const [, , sym, valueNode] = line;
  const name = sym[2];
  const what = `enum member ':${name}' value`;
  const value = isNone(valueNode) ? undefined
    : headOf(valueNode) === 'name' && valueNode[2] === 'undefined' ? undefined
    : literalOf(valueNode, what, ctx);
  entries.push({ tag: 'enum-member', name, value, start });
}

// An input names a member by its name or by its value, so the two
// vocabularies must not cross: a value that is the name of a member
// holding a DIFFERENT value (`:a "b"` beside `:b "c"`) makes the input
// "b" resolve to two values. A member name declared twice is the same
// ambiguity. Values may repeat — two names for one value are aliases
// (`:active` beside `:enabled "active"`), and every input resolves to it.
function checkEnumMembers(entries, fail) {
  const members = entries.filter((e) => e.tag === 'enum-member');
  const byName = new Map();
  for (const m of members) {
    if (byName.has(m.name)) fail(`enum member ':${m.name}' is declared twice`, m.start);
    byName.set(m.name, m);
  }
  const valueOf = (m) => (m.value === undefined ? m.name : m.value);
  for (const m of members) {
    const other = typeof m.value === 'string' ? byName.get(m.value) : undefined;
    if (other && valueOf(other) !== m.value) {
      fail(`enum member ':${m.name}' has the value ${JSON.stringify(m.value)}, which is the name of member ':${other.name}' — an input ${JSON.stringify(m.value)} would name both`, m.start);
    }
  }
}

// ── literal values ───────────────────────────────────────────────────

function readRange(node, fieldName, ctx) {
  const { fail, at } = ctx;
  const [, , minNode, maxNode] = node;
  const min = isNone(minNode) ? undefined : signedNumber(minNode, 'a range endpoint', ctx);
  const max = isNone(maxNode) ? undefined : signedNumber(maxNode, 'a range endpoint', ctx);
  // A bare '..' constrains nothing — noise, not a range. Omitting the
  // trailer entirely says the same thing loudly less.
  if (min === undefined && max === undefined) {
    fail(`a bare '..' range constrains nothing on field '${fieldName}' — give an endpoint (1.., ..60, 1..60) or drop the range`, at(node));
  }
  if (min !== undefined && max !== undefined && min > max) {
    fail(`range '${min}..${max}' is reversed — write the smaller endpoint first`, at(node));
  }
  const out = {};
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  return out;
}

function readRegex(text, at, fail) {
  const m = /^\/((?:\\.|[^\\/])+)\/([a-z]*)$/.exec(text);
  if (!m) fail(`invalid regex literal ${JSON.stringify(text)}`, at);
  try {
    return new RegExp(m[1], m[2]);
  } catch (e) {
    fail(`invalid regex '${text}': ${e.message}`, at);
  }
}

// A NUMBER's value. Separators are spelling (`1_000`); a BigInt (`1n`)
// rejects, since a schema value serializes as a JSON number.
function numberOf(raw, what, at, fail) {
  const text = raw.replace(/_/g, '');
  if (text.endsWith('n')) fail(`${what} cannot be a BigInt (${raw}) — schema values are JSON numbers`, at);
  return Number(text);
}

function signedNumber(node, what, ctx) {
  if (headOf(node) === 'schema-neg') return -numberOf(node[2][2], what, ctx.at(node[2]), ctx.fail);
  return numberOf(node[2], what, ctx.at(node), ctx.fail);
}

function literalOf(node, what, ctx) {
  switch (headOf(node)) {
    case 'num': case 'schema-neg': return signedNumber(node, what, ctx);
    case 'string': return JSON.parse(node[2]);
    case 'name':
      if (node[2] in LITERAL_WORDS) return LITERAL_WORDS[node[2]];
  }
  ctx.fail(`${what} must be a literal (number, string, boolean, null) — got ${kindName(node)}`, ctx.at(node));
}

// ── syntax messages ──────────────────────────────────────────────────
// A rejection inside a schema body: the message the line's own shape
// calls for, or null to keep the parser's. `at` indexes the payload's
// offending token (the payload's length at its end).

const tokenKindName = (t) => {
  if (!t) return '<end>';
  switch (t.kind) {
    case 'S_WORD': return 'IDENTIFIER';
    case 'S_SYMBOL': case 'S_KIND': return ':';
    case 'S_BANG': return 'DAMMIT';
    case 'S_OPT': return '?';
    case 'S_TILDE': return 'UNARY_MATH';
    case 'S_ARRAY': return '[';
    case 'S_PARAMS': return '(';
    case 'S_DIRECTIVE': case 'S_ENSURE': case 'S_SCOPE': case 'S_DEFAULT_SCOPE': return '@';
    default: return t.kind;
  }
};

export function explainSchemaReject(payload, at) {
  // The body's lines: a header, then lines separated by the body's own
  // TERMINATORs (inside its INDENT for a block body).
  let depth = 0;
  let bodyDepth = null;
  let lineStart = -1;
  let line = null;
  for (let i = 0; i <= payload.length && line === null; i++) {
    const t = payload[i];
    const k = t?.kind;
    if (bodyDepth === null) {
      if (k === 'INDENT' || k === 'TERMINATOR') {
        bodyDepth = k === 'INDENT' ? 1 : 0;
        depth = bodyDepth;
        lineStart = i + 1;
      }
      if (i >= at) return null;
      continue;
    }
    const ends = t === undefined || (k === 'TERMINATOR' && depth === bodyDepth) ||
      ((k === 'OUTDENT' || k === ']' || k === '}') && depth === bodyDepth);
    if (ends) {
      if (at <= i) line = [lineStart, i];
      lineStart = i + 1;
      continue;
    }
    if (k === 'INDENT' || k === '[' || k === '{') depth++;
    else if (k === 'OUTDENT' || k === ']' || k === '}') depth--;
  }
  if (line === null || line[0] > at) return null;
  const toks = payload.slice(line[0], line[1]);
  const idx = at - line[0];
  const head = toks[0];
  const bad = toks[idx];
  const msg = (message, t) => ({ message, start: t.start, end: t.start });
  if (!head) return null;
  switch (head.kind) {
    case 'S_SCOPE': {
      const sym = toks[1];
      if (!sym) return msg(`@scope requires ':name, -> body' (or ':name, (args) -> body')`, head);
      if (sym.kind !== 'S_SYMBOL') return msg(`@scope name must be a :symbol — '@scope :active, -> @where(active: true)'`, sym);
      const named = { start: sym.start + 1 };
      if (!/^[a-z][a-zA-Z0-9]*$/.test(sym.value)) {
        return msg(`@scope name ':${sym.value}' must be a lowercase-first alphanumeric identifier — scopes chain as query-builder methods`, named);
      }
      const rest = toks.slice(toks[2]?.kind === ',' ? 3 : 2);
      if (!rest.length) return msg(`@scope :${sym.value} is missing its body — '@scope :${sym.value}, -> @where(...)'`, named);
      return fnMessage(rest, `@scope :${sym.value}`, msg);
    }
    case 'S_DEFAULT_SCOPE': {
      const rest = toks.slice(1);
      if (!rest.length) return msg(`@defaultScope: expected '-> body' or '(args) -> body'`, head);
      return fnMessage(rest, '@defaultScope', msg);
    }
    case 'S_SYMBOL': {
      const name = head.value;
      const v = toks[1];
      if (v?.kind === ':' || v?.kind === 'S_SYMBOL') return msg(`enum member ':${name}' — drop the ':' before the value; use ':${name} value'`, v);
      if (v && v.kind !== 'NUMBER' && v.kind !== '-' && v.kind !== 'STRING' && v.kind !== 'S_WORD') {
        return msg(`enum member ':${name}' value must be a literal (number, string, boolean, null) — got ${tokenKindName(v)}`, v);
      }
      const extra = toks[v?.kind === '-' ? 3 : 2];
      if (extra) return msg(`extra tokens after enum member ':${name}' value`, extra);
      return null;
    }
    case 'S_WORD': {
      if (toks[1]?.kind === ':') return null;
      const before = toks[idx - 1];
      if (before?.kind === '|') {
        return msg(`literal unions contain string literals only — '${tokenKindName(bad)}' is not allowed as a union member; use the '?' modifier for nullability`, before);
      }
      if (before?.kind === 'S_TILDE') {
        return msg(`'~' in the type slot marks coercion and needs a type name ('~integer', '~date', …) or a registered coercer symbol ('~:ssn', …)`, before);
      }
      let d = 0;
      let arrow = null;
      for (let k = 0; k < idx; k++) {
        const kk = toks[k].kind;
        if (kk === '[' || kk === '{' || kk === 'INDENT') d++;
        else if (kk === ']' || kk === '}' || kk === 'OUTDENT') d--;
        else if (kk === '->' && d === 0) arrow = toks[k];
      }
      // A transform's island ends at a comma, so what follows one is
      // another trailer, and a transform is the last.
      if (d === 0 && arrow !== null) {
        return msg(`transform '-> …' must be the last element on the field line for '${head.value}'`, arrow);
      }
      if (d === 0 && bad) {
        return msg(`unexpected trailer for field '${head.value}' — expected '[…]' default, '/regex/', 'min..max' range, or '-> transform'`, bad);
      }
      return null;
    }
    case 'S_ENSURE': case 'S_DIRECTIVE':
      return null;
  }
  if (idx === 0) {
    return msg(`unexpected ${tokenKindName(head)} at schema top level — allowed: fields ('name! type'), directives ('@name'), methods ('name: -> body'), computed getters ('name: ~> body')`, head);
  }
  return null;
}

// A scope function's shape: `-> body` or `(args) -> body`.
function fnMessage(rest, label, msg) {
  if (rest[0].kind === 'S_PARAMS') {
    if (rest[1]?.kind !== '->') return msg(`${label}: expected '->' after parameters`, rest[1] ?? rest[0]);
    return null;
  }
  if (rest[0].kind !== '->') return msg(`${label}: expected '->' to start the body`, rest[0]);
  return null;
}

// Each parameter of a captured `(a, b)` slice: a plain identifier,
// optionally typed (`other: Money`). The name is what the runtime
// spelling emits; the annotation is type-surface only and never reaches
// the emitted JS, exactly like annotations everywhere else in the
// language, so it reaches the face as a spliced segment instead. Its
// text is sliced from SOURCE rather than rebuilt from tokens, and
// lowers through normalizeTypeText like every other annotation — the
// rip boolean spellings, single-quoted literals, and a comment inside
// a wrapped annotation all read as TS on both roads.
export function paramsOf(paramTokens, what, fail, source = null) {
  if (!paramTokens.length) return [];
  const params = paramsRaw(paramTokens, what, fail, source);
  // JS ARITY, the same rule an ordinary function's parameters follow
  // (emitParams): a TRAILING run of parameters the author never
  // annotated is optional, because calling with fewer arguments is
  // legal in rip as in JavaScript. A run stops at the first annotated
  // parameter — TypeScript admits no required parameter after an
  // optional one.
  for (let i = params.length - 1; i >= 0 && params[i].type === null; i--) params[i].optional = true;
  return params;
}

function paramsRaw(paramTokens, what, fail, source) {
  const carries = (t) => t.kind !== 'TERMINATOR' && t.kind !== 'INDENT' && t.kind !== 'OUTDENT';
  return splitTopLevelByComma(paramTokens).map((part) => {
    const toks = part.filter((t) => carries(t) && t.kind !== 'TYPE');
    // A typed parameter's name arrives as PROPERTY (the lexer's
    // `word:` tagging) with the raw ':' following it.
    const typed = toks.length >= 3 && (toks[0].kind === 'IDENTIFIER' || toks[0].kind === 'PROPERTY') && toks[1].kind === ':';
    if (!typed && (toks.length !== 1 || toks[0].kind !== 'IDENTIFIER')) {
      fail(`${what}: parameters must be plain identifiers, optionally typed ('name' or 'name: Type')`, (toks[0] ?? part[0]).start);
    }
    // The span runs to the last token the PART carries, not the last
    // the filter kept — a TYPE token inside the annotation is dropped
    // from the scan but still occupies source.
    const last = typed ? [...part].filter(carries).pop() : null;
    const type = typed && source !== null ? normalizeTypeText(source.slice(toks[1].end, last.end)).trim() : null;
    return { name: toks[0].value, type, optional: false };
  });
}

// The :model post-pass — the capability matrix plus the parse-time
// rejections. Unknown directive names reject by name. Every
// directive's argument SHAPE validates
// (relations exactly one canonical target, column lists non-empty,
// idStart an integer, argless directives argless — trailing junk
// rejects at its own position). Relation targets must be
// canonical PascalCase. @index/@unique columns must exist on
// the table — validated here when the full column set is
// parse-visible (no @mixin; a mixin adds fields only the runtime can
// see, whose normalize re-checks the expanded set at the root).
function finishModelBody(entries, ctx) {
  const { fail } = ctx;
  // Single-occurrence directives: a second @idStart/@table/@tableWas would
  // silently last-win in the runtime's read loops — reject the
  // duplicate at its own position.
  const seenOnce = new Set();
  for (const e of entries) {
    if (e.tag !== 'directive') continue;
    const shape = MODEL_DIRECTIVES[e.name];
    if (shape === undefined) {
      fail(`unknown directive '@${e.name}' on :model — legal: ${Object.keys(MODEL_DIRECTIVES).map((n) => '@' + n).join(', ')}, @ensure, @scope, @defaultScope`, e.nameStart ?? e.start);
    }
    if (ONCE_DIRECTIVES.includes(e.name)) {
      if (seenOnce.has(e.name)) {
        // Argument-less once-directives (@times, @softDelete) have
        // no second value to override; the duplicate is still refused —
        // it declares itself once.
        fail(shape === 'none'
          ? `duplicate '@${e.name}' — declared twice; a :model declares it once`
          : `duplicate '@${e.name}' — a :model declares it at most once (the second would silently override the first)`, e.nameStart ?? e.start);
      }
      seenOnce.add(e.name);
    }
    if (e.name !== 'mixin') e.args = readModelDirectiveArgs(e, shape, ctx);
  }

  const hasMixin = entries.some((e) => e.tag === 'directive' && e.name === 'mixin');
  if (hasMixin) return;
  // Column OWNERSHIP (the parse-visible twin of the runtime's
  // normalize guard): two owners for one column is duplicate-column
  // DDL waiting for the database. `{column:}` is why fields have to
  // claim through the same gate as everything else — without it,
  // name → column was injective and fields could not collide.
  //
  // Each claimant enters in BOTH directions, so the gate refuses a
  // column with two owners AND a property that reads two columns —
  // `userId! integer, {column: "USER_REF"}` beside `@belongsTo User`
  // is one property over two columns, the same duplicate-column DDL
  // the column side refuses, hidden behind the rename. `columnOf` is
  // the compile-side half of the runtime's map of the same name, and
  // @index/@unique resolve through it.
  const known = new Set();
  const ownerOf = new Map();
  const columnOf = new Map();
  const propertyOwnerOf = new Map();
  const claim = (property, col, owner, at) => {
    if (known.has(col)) {
      fail(`${ownerOf.get(col)} and ${owner} both own column '${col}' — every table column has exactly one owner`, at);
    }
    if (columnOf.has(property)) {
      fail(`${propertyOwnerOf.get(property)} and ${owner} both own property '${property}' (columns '${columnOf.get(property)}' and '${col}') — every property reads exactly one column`, at);
    }
    known.add(col);
    ownerOf.set(col, owner);
    columnOf.set(property, col);
    propertyOwnerOf.set(property, owner);
  };
  let pkDirective = entries.find((e) => e.tag === 'directive' && e.name === 'primary');
  // Inline '@primary' on a field line is the same declaration made in
  // place; synthesize the directive so one resolution path judges both
  // spellings. Two inline marks, or inline + standalone, are two
  // answers to the one-identity question — refused.
  const inlinePks = entries.filter((e) => e.tag === 'field' && e.primary);
  if (inlinePks.length > 1) {
    fail(`both '${inlinePks[0].name}' and '${inlinePks[1].name}' declare '@primary' — a row has one identity`, inlinePks[1].start);
  }
  if (inlinePks.length === 1) {
    if (pkDirective) {
      fail(`'@primary ${pkDirective.args[0].name}' and inline '@primary' on field '${inlinePks[0].name}' are two answers to one question — state it once`, pkDirective.start);
    }
    pkDirective = { tag: 'directive', name: 'primary', args: [{ name: inlinePks[0].name }], start: inlinePks[0].start };
  }
  const pkColumn = pkDirective ? (pkDirective.args[0].column ?? snakeCase(pkDirective.args[0].name)) : 'id';
  const pkName = pkDirective ? pkDirective.args[0].name : 'id';
  // Declaring the pk as a field is what makes it a caller-supplied
  // NATURAL key — but only alongside an explicit @primary naming it
  // (standalone, or inline on the field line).
  // A bare `id! integer` is someone saying "I have an id", not "turn
  // off the sequence", so it stays the collision it always was. Judged
  // BEFORE any column is claimed, so the pk gets the message about the
  // pk instead of the generic two-owners one.
  const pkFieldEntry = entries.find((e) => e.tag === 'field' && e.name === pkName) ?? null;
  const naturalKey = !!(pkDirective && pkFieldEntry);
  if (!pkDirective && pkFieldEntry) {
    fail(`field '${pkName}' collides with the runtime-managed primary key — a :model's ${pkName} is sequence-assigned. Drop the declaration, or write '@primary ${pkName}' to make it a caller-supplied natural key instead`,
      pkFieldEntry.start);
  }
  // A natural key is the caller's to supply, so it must be one
  // required value, and there is no sequence behind it to seed.
  if (naturalKey) {
    if (!pkFieldEntry.modifiers?.includes('!')) {
      fail(`the primary key '${pkName}' is declared optional — a row's identity is never absent; declare it required ('${pkName}! string')`, pkFieldEntry.start);
    }
    if (pkFieldEntry.array) {
      fail(`the primary key '${pkName}' is declared as an array — a primary key is one value`, pkFieldEntry.start);
    }
    const idStart = entries.find((e) => e.tag === 'directive' && e.name === 'idStart');
    if (idStart) {
      fail(`@idStart seeds the sequence behind a runtime-managed primary key, but '${pkName}' is declared as a field, which makes it caller-supplied — there is no sequence to seed. Drop @idStart, or drop the field declaration`, idStart.start);
    }
    // The field's own `{column:}` is what the table has, so a second,
    // different one on the directive is two answers to one question.
    if (pkDirective.args[0].column !== undefined &&
        pkDirective.args[0].column !== (pkFieldEntry.attrs?.column ?? snakeCase(pkName))) {
      fail(`@primary names column '${pkDirective.args[0].column}' but field '${pkName}' reads a different one — state the column once, on the field`, pkDirective.start);
    }
  } else {
    claim(pkName, pkColumn, 'the primary key', pkDirective?.start ?? entries[0]?.start ?? 0);
  }
  for (const e of entries) {
    if (e.tag !== 'field') continue;
    claim(e.name, e.attrs?.column ?? snakeCase(e.name), `field '${e.name}'`, e.start);
  }
  for (const e of entries) {
    if (e.tag !== 'directive') continue;
    if (e.name === 'times') { claim('createdAt', 'created_at', '@times', e.start); claim('updatedAt', 'updated_at', '@times', e.start); }
    else if (e.name === 'softDelete') claim('deletedAt', 'deleted_at', '@softDelete', e.start);
    // The claimed column mirrors the runtime's derivation: an explicit
    // foreignKey names it directly; otherwise it derives from the
    // ACCESSOR (`as:` if present, else the target) — which is what
    // lets two relations to one model coexist with no explicit keys.
    // A `through` relation owns no column here at all: its foreign
    // keys live on the join model.
    else if (e.name === 'belongsTo') {
      const a = e.args[0];
      const fk = a.foreignKey ?? fkName(a.as ?? a.target);
      claim(camelCase(fk), fk,
        `the @belongsTo ${a.target}${a.as ? ` (as ${a.as})` : ''} relation`, e.start);
    }
  }
  for (const e of entries) {
    if (e.tag !== 'directive' || (e.name !== 'index' && e.name !== 'unique')) continue;
    // Written in field space, resolved exactly as the runtime's
    // columnFor resolves it: the property map first (the
    // surrogate primary key lives there like any field), then a
    // column's own name, then the snake_case derivation. A column's
    // own name is accepted because `known` is exactly the set the
    // failure message offers, and rejecting a name it lists as
    // present would be the message arguing with itself.
    const cols = e.args[0].fields.map((c) => columnOf.get(c) ?? (known.has(c) ? c : snakeCase(c)));
    // Two spellings of one column make DDL the database refuses — the
    // same rejection the runtime issues (and, as there, judged before
    // membership), at the duplicate's own position.
    cols.forEach((col, ci) => {
      if (cols.indexOf(col) !== ci) {
        fail(`@${e.name} columns must be distinct after canonicalization: ${cols.join(', ')}`, e.colTokens?.[ci]?.start ?? e.start);
      }
    });
    cols.forEach((col, ci) => {
      if (!known.has(col)) {
        fail(`@${e.name}: unknown column '${e.args[0].fields[ci]}' — the table has: ${[...known].sort().join(', ')}`, e.colTokens?.[ci]?.start ?? e.start);
      }
    });
  }
}

// One directive's arguments → the serialized args shape (the runtime's
// `_normalize` entry surface). The shape is the vocabulary's
// (MODEL_DIRECTIVES), so the grammar reads every directive's arguments as
// one list and this reads them by shape.
function readModelDirectiveArgs(e, shape, ctx) {
  const { fail, at } = ctx;
  const args = argNodesOf.get(e) ?? [];
  const pos = (n) => (n === undefined ? e.start : at(n));
  const junk = (n, why) => fail(`@${e.name}: ${why}`, pos(n));
  switch (shape) {
    case 'none': {
      if (args.length) junk(args[0], `takes no arguments`);
      return null;
    }
    case 'target': {
      const t0 = args[0];
      if (headOf(t0) !== 'name') {
        fail(`@${e.name} requires a target name — '@${e.name} User'`, pos(t0));
      }
      let optional = false;
      let i = 1;
      if (isMark(args[i], '?')) { optional = true; i++; }
      // `@belongsTo User, {as: author, foreignKey: "author_id"}`
      let relAttrs = null;
      if (isMark(args[i], ',') && headOf(args[i + 1]) === 'schema-attrs') {
        relAttrs = readRelationAttrs(args[i + 1], e.name, ctx);
        i += 2;
      }
      if (i < args.length) junk(args[i], `takes one target name and an optional '{…}' options bracket — unexpected ${kindName(args[i])} after '${t0[2]}${optional ? '?' : ''}'`);
      // The FK/accessor derivation rides the snake_case
      // bijection, which acronym-style names break.
      if (!isCanonicalTarget(t0[2])) {
        fail(`@${e.name}: target '${t0[2]}' is not canonical PascalCase — use an uppercase-first, alphanumeric name with no consecutive uppercase letters (e.g. 'MdmUser' not 'MDMUser'); the derived FK column and accessor names ride the snake_case bijection`, at(t0));
      }
      const arg = { target: t0[2] };
      if (optional) arg.optional = true;
      if (relAttrs?.as) arg.as = relAttrs.as;
      if (relAttrs?.foreignKey) arg.foreignKey = relAttrs.foreignKey;
      if (relAttrs?.through) arg.through = relAttrs.through;
      if (relAttrs?.targetKey) arg.targetKey = relAttrs.targetKey;
      return [arg];
    }
    case 'columns': {
      const fields = [];
      const colTokens = [];
      const column = (n) => {
        fields.push(n[2]);
        colTokens.push({ start: at(n) + (headOf(n) === 'sym' ? 1 : 0) });
      };
      const a0 = args[0];
      let i = 0;
      if (headOf(a0) === 'sym' || headOf(a0) === 'name') {
        column(a0);
        i = 1;
      } else if (headOf(a0) === 'schema-bracket') {
        for (const v of a0.slice(2)) {
          if (headOf(v) !== 'sym' && headOf(v) !== 'name') junk(v, `column names are bare identifiers or :symbols — '@${e.name} [:a, :b]'`);
          column(v);
        }
        i = 1;
      }
      if (!fields.length) {
        fail(`@${e.name} requires a field name or list — '@${e.name} :email' or '@${e.name} [:a, :b]'`, pos(a0));
      }
      if (i < args.length) junk(args[i], `unexpected ${kindName(args[i])} after the column list`);
      e.colTokens = colTokens;
      return [{ fields }];
    }
    case 'int': {
      const a0 = args[0];
      if (headOf(a0) !== 'num' && headOf(a0) !== 'schema-neg') {
        fail(`@${e.name} requires an integer literal — '@idStart 10001'`, pos(a0));
      }
      const n = signedNumber(a0, `@${e.name}`, ctx);
      if (!Number.isInteger(n)) {
        fail(`@${e.name} requires an integer literal; got ${headOf(a0) === 'schema-neg' ? a0[2][2] : a0[2]}`, at(a0));
      }
      if (args.length > 1) junk(args[1], `unexpected ${kindName(args[1])} after the integer`);
      return [{ value: n }];
    }
    // Quoting picks the NAMESPACE, and that is the whole point:
    //   @table UserProfile     — a logical name; snake_cased for you
    //   @table 'user_profile'  — the literal table, used verbatim
    // Same rule the field attrs already follow ({was: "first_name"} is
    // quoted because it names a column). Bare identifiers live in Rip's
    // naming; quoted strings live in the database's.
    case 'name': {
      const a0 = args[0];
      let name = null;
      let quoted = false;
      if (headOf(a0) === 'string') {
        name = JSON.parse(a0[2]);
        quoted = true;
      } else if (headOf(a0) === 'name') {
        name = a0[2];
      }
      const want = e.name === 'table'
        ? `a table name — '@table UserProfile' or '@table "user_profile"'`
        : `the previous table name — '@tableWas LegacyUsers' or '@tableWas "legacy_users"'`;
      if (name === null || !name.length) {
        fail(`@${e.name} requires ${want}`, pos(a0));
      }
      // A dot would ride through quoteIdent as ONE quoted
      // identifier — `"crm.accounts"` names a table literally called
      // that, not `accounts` in schema `crm`. Refuse rather than
      // silently target the wrong thing; qualified names need their own
      // representation through the differ and the catalog reads.
      if (name.includes('.')) {
        fail(`@${e.name} '${name}': schema-qualified table names are not supported yet — use a bare table name`, pos(a0));
      }
      if (args.length > 1) junk(args[1], `takes one table name — unexpected ${kindName(args[1])}`);
      if (!quoted) {
        // LOGICAL. Any identifier shape is fine and snake_cases the
        // same way — `UserProfile`, `userProfile`, and `user_profile`
        // all land on `user_profile`. The one guard is consecutive
        // capitals, which every other bare name in the language also
        // refuses: `MDMUser` would silently give `mdmuser`, not
        // `mdm_user`. Quote it, or spell it `MdmUser`. A quoted name is
        // VERBATIM: the literal form exists to reach a table Rip did not
        // name, so nothing beyond what would break the SQL is checked.
        if (/[A-Z]{2,}/.test(name)) {
          fail(`@${e.name} ${name}: a bare name is a LOGICAL name that Rip snake_cases, and consecutive capitals convert surprisingly ('${name}' → '${snakeCase(name)}'). Spell it 'MdmUser'-style, or name the table exactly by quoting it: '@${e.name} "${name}"'`, at(a0));
        }
        name = snakeCase(name);
      }
      return [{ name }];
    }
    // A PROPERTY and the column behind it — the same pair a declared
    // field spells, and written the same way: the name bare (it is a
    // Rip name), the column quoted in `{column:}` when the database
    // spells it something else.
    //
    //   @primary patientId                            → column patient_id
    //   @primary patientId, {column: "PATIENT_ID"}   → column PATIENT_ID
    case 'field': {
      const a0 = args[0];
      if (headOf(a0) !== 'name') {
        fail(`@${e.name} requires a property name — '@${e.name} patientId'`, pos(a0));
      }
      let i = 1;
      let attrs = null;
      if (isMark(args[i], ',') && headOf(args[i + 1]) === 'schema-attrs') {
        attrs = readOptions(args[i + 1], FIELD_ATTRS, `@${e.name}`, ctx);
        i += 2;
      }
      if (i < args.length) junk(args[i], `takes one property name and an optional '{…}' options bracket — unexpected ${kindName(args[i])} after '${a0[2]}'`);
      if (attrs?.was) {
        fail(`@${e.name} option 'was' is a field-rename annotation; a primary-key rename is not a supported migration`, e.start);
      }
      // The property is read back off every instance and every JSON
      // body, so it rides the same bijection every other property does.
      if (!isCanonicalName(a0[2])) {
        fail(`@${e.name} '${a0[2]}' is not canonical camelCase — lowercase-first, alphanumeric, no consecutive capitals ('patientId' not 'patientID'); the property, the snapshot key and the JSON key all ride the snake_case bijection`, at(a0));
      }
      // `column` is emitted only when the author WROTE one. The
      // derived default lives in the runtime, so a natural key (whose
      // column comes from the field) can tell "no column stated" from
      // "this column stated" and refuse only a real disagreement.
      const arg = { name: a0[2] };
      if (attrs?.column) arg.column = attrs.column;
      return [arg];
    }
  }
  return null;
}

// ── shared token-slice helpers ───────────────────────────────────────

export function splitTopLevelByComma(tokens) {
  const parts = [];
  let cur = [];
  let depth = 0;
  for (const t of tokens) {
    const tag = t.kind;
    if (tag === '(' || tag === '[' || tag === '{' ||
        tag === 'CALL_START' || tag === 'INDEX_START' ||
        tag === 'PARAM_START' || tag === 'INDENT') depth++;
    if (tag === ')' || tag === ']' || tag === '}' ||
        tag === 'CALL_END' || tag === 'INDEX_END' ||
        tag === 'PARAM_END' || tag === 'OUTDENT') depth--;
    if (tag === ',' && depth === 0) {
      if (cur.length) parts.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

// ── descriptor serialization (emission side) ─────────────────────────
// The `__schema({...})` literal — the validation-surface shape is
// pinned byte-for-byte by the tests. Callable/transform/ensure fn code is compiled by
// the emitter and passed in through `fns` (entry index → {code,
// thisAt}: the compiled function text plus the offset where a TS-face
// `this` parameter inserts — right after the parameter list opens).
//
// SEGMENTS are the one channel: descriptorSegments
// returns the literal as an ordered list of plain strings and
// `{ts: text}` face-only pieces — a callable whose entry index
// appears in `thisTypes` gains a `this: T` parameter as a face-only
// segment, and a field whose index appears in `defaultTypes` gains a
// `satisfies T` on its default value, so the builder records each as a
// TS-only region and the strip gate holds by construction. With both
// absent every segment is plain — the JS emission joins them to the
// pinned literal.

export function descriptorSegments(descriptor, schemaName, fns, adapterCode = null, thisTypes = null, tsFace = false, defaultTypes = null, ensureTypes = null) {
  const segs = [];
  const emit = (s) => {
    if (segs.length && typeof segs[segs.length - 1] === 'string') segs[segs.length - 1] += s;
    else segs.push(s);
  };
  const emitTs = (s, span = null) => segs.push({ ts: s, span });
  // Compiled BODY text — a callable's function, the adapter's expression
  // — rides its own segment kind: it is the author's code, where a `word:`
  // is an object key or a ternary arm, never the descriptor's vocabulary.
  // A callable's segments carry the names it binds (`bound`); the
  // adapter expression evaluates in the enclosing scope and binds none.
  const emitBody = (s, bound = null) => segs.push({ body: s, bound });
  emit(`{kind: ${JSON.stringify(descriptor.kind)}`);
  if (schemaName) emit(`, name: ${JSON.stringify(schemaName)}`);
  emit(`, entries: [`);
  descriptor.entries.forEach((e, i) => {
    if (i > 0) emit(', ');
    entrySegments(e, fns.get(i), thisTypes?.get(i) ?? null, emit, emitTs, tsFace, defaultTypes?.get(i) ?? null,
      ensureTypes?.get(i) ?? null, emitBody);
  });
  emit(']');
  // `schema :model, on: <expr>` — evaluated at declaration time in
  // the user's scope.
  if (adapterCode) { emit(', adapter: '); emitBody(adapterCode); }
  emit('}');
  return segs;
}

const fnText = (fnCode) => (typeof fnCode === 'string' ? fnCode : fnCode.code);

// The face-only behavior object: `const __X__behavior = {total: function
// (this: X) {…}, …};` — one property per callable entry, carrying the
// SAME compiled body the descriptor carries, so tsgo infers each
// callable's return type and the companion states it rather than
// minting `unknown`. Emitted after the binding statement (the
// companion-placement precedent); the whole line is a TS-only region,
// so the JS face never sees it. Null when the schema has no callable.
export function behaviorObjectText(descriptor, name, fns, thisTypes) {
  const props = [];
  descriptor.entries.forEach((e, i) => {
    if (e.tag !== 'derived' && e.tag !== 'computed' && e.tag !== 'method') return;
    const fnCode = fns.get(i);
    if (fnCode === undefined) return;
    const thisType = thisTypes?.get(i) ?? null;
    let code = fnText(fnCode);
    // The behavior object is a TS-only line whole, so the face-only
    // annotations go in as plain text — spliced from the back so each
    // recorded offset still addresses the code it was measured against.
    for (const [at, text] of tsInserts(fnCode, thisType).reverse()) {
      code = code.slice(0, at) + text + code.slice(at);
    }
    props.push(`${e.name}: ${code}`);
  });
  return props.length ? `const ${behaviorName(name)} = {${props.join(', ')}};` : null;
}

// Every face-only annotation a compiled callable carries, as
// [offset, text] into its own code, ascending: the `this` parameter its
// calling convention gives it, and each parameter type the author
// declared. Both are TypeScript the runtime spelling must not contain,
// so they are recorded rather than emitted, and spliced by whichever
// road can carry them.
function tsInserts(fnCode, thisType, annots = true) {
  if (typeof fnCode === 'string') return [];
  const inserts = annots ? (fnCode.annots ?? []).map(([at, text]) => [at, text]) : [];
  if (thisType !== null) {
    const { code, thisAt } = fnCode;
    inserts.push([thisAt, `this: ${thisType}${code[thisAt] === ')' ? '' : ', '}`]);
  }
  return inserts.sort((a, b) => a[0] - b[0]);
}

// A compiled callable's code with its face-only annotations spliced in
// as ts segments. Only the FACE produces them: `tsOnly` records a region
// for the strip gate but still emits, so a segment produced on the JS
// road would ship — the gate is a check on the face, not a filter.
function fnSegments(fnCode, thisType, emitBody, emitTs, tsFace = false) {
  const inserts = tsInserts(fnCode, thisType, tsFace);
  const bound = typeof fnCode === 'string' ? null : fnCode.bound ?? null;
  if (inserts.length === 0) {
    emitBody(fnText(fnCode), bound);
    return;
  }
  const { code } = fnCode;
  let prev = 0;
  for (const [at, text] of inserts) {
    emitBody(code.slice(prev, at), bound);
    emitTs(text);
    prev = at;
  }
  emitBody(code.slice(prev), bound);
}

function entrySegments(e, fnCode, thisType, emit, emitTs, tsFace = false, defaultType = null, ensureType = null, emitBody = emit) {
  switch (e.tag) {
    case 'computed':
    case 'method':
    case 'derived':
    case 'hook':
    case 'scope':
    case 'defaultScope':
      emit(`{tag: ${JSON.stringify(e.tag)}, name: ${JSON.stringify(e.name)}, fn: `);
      fnSegments(fnCode, thisType, emitBody, emitTs, tsFace);
      emit('}');
      return;
    default:
      // A field transform's `it` — the whole RAW input, pre-validation
      // — types face-only `any`, a declared boundary rather than an
      // omission: the wire shape is what the transform exists to
      // absorb, the DSL fixes the parameter list to `it` (nothing for
      // an author to annotate), and `unknown` would reject the DSL's
      // own idiom (`-> it.X`). The annotation splices as a ts segment
      // so the strip gate holds by construction; the transform is the
      // field literal's LAST property, so the splice offset is fixed
      // arithmetic off thisAt (the params open right there, and a
      // field's params are exactly `it` — schemaBodyParams).
      const marks = {};
      const whole = entryLiteral(e, fnCode, marks);
      // Face-only splices into the field literal, in offset order: the
      // default's `satisfies` (constraints come before the transform)
      // and the transform's `it: any`.
      const cuts = [];
      if (tsFace && defaultType !== null && marks.defaultEnd !== undefined) {
        cuts.push({ at: marks.defaultEnd, ts: ` satisfies ${defaultType}`, span: e.defaultSpan ?? null });
      }
      if (tsFace && e.tag === 'field' && fnCode !== undefined && typeof fnCode !== 'string' &&
          fnText(fnCode).startsWith('it', fnCode.thisAt)) {
        const fn = fnText(fnCode);
        cuts.push({ at: whole.length - 1 - fn.length + fnCode.thisAt + 'it'.length, ts: ': any' });
      }
      // `@ensure`'s predicate parameter — the DSL fixes the parameter
      // list to the author's own name with no annotation slot, so the
      // data type splices in after it.
      if (tsFace && e.tag === 'ensure' && ensureType !== null && marks.fnAt !== undefined &&
          typeof fnCode !== 'string' && fnCode !== undefined) {
        const p0 = identifierRunAt(fnText(fnCode), fnCode.thisAt)?.value;
        if (p0) cuts.push({ at: marks.fnAt + fnCode.thisAt + p0.length, ts: `: ${ensureType}` });
      }
      let pos = 0;
      for (const c of cuts) { emit(whole.slice(pos, c.at)); emitTs(c.ts, c.span ?? null); pos = c.at; }
      emit(whole.slice(pos));
  }
}

function entryLiteral(e, fnCode, marks = {}) {
  if (fnCode !== undefined) fnCode = fnText(fnCode);
  switch (e.tag) {
    case 'field': {
      const obj = [
        `tag: "field"`,
        `name: ${JSON.stringify(e.name)}`,
        `modifiers: ${JSON.stringify(e.modifiers)}`,
        `typeName: ${JSON.stringify(e.typeName)}`,
        `array: ${e.array ? 'true' : 'false'}`,
      ];
      if (e.unique) obj.push('unique: true');
      if (e.primary) obj.push('primary: true');
      if (e.literals) obj.push(`literals: ${JSON.stringify(e.literals)}`);
      if (e.coerce) {
        obj.push('coerce: true');
        if (e.coercer) obj.push(`coercer: ${JSON.stringify(e.coercer)}`);
      }
      if (e.constraints) {
        const c = [];
        if (e.constraints.min !== undefined) c.push(`min: ${serializeLiteral(e.constraints.min)}`);
        if (e.constraints.max !== undefined) c.push(`max: ${serializeLiteral(e.constraints.max)}`);
        // The default's END offset within the finished literal — the
        // face splices `satisfies T` there, so the relation the
        // runtime enforces at parse time is stated where the checker
        // can read it.
        let defaultInC = -1;
        if (e.constraints.default !== undefined) {
          defaultInC = c.length;
          c.push(`default: ${serializeLiteral(e.constraints.default)}`);
        }
        if (e.constraints.regex !== undefined) c.push(`regex: ${e.constraints.regex.toString()}`);
        if (c.length) {
          if (defaultInC >= 0) {
            const head = `{${obj.join(', ')}, constraints: {`;
            marks.defaultEnd = head.length + c.slice(0, defaultInC + 1).join(', ').length;
          }
          obj.push(`constraints: {${c.join(', ')}}`);
        }
      }
      if (e.attrs) {
        // Attr keys serialize in SORTED order, never source order —
        // descriptor diffs must reflect semantic change, not
        // key reordering. (Byte-neutral while `was` is the only key.)
        obj.push(`attrs: {${Object.keys(e.attrs).sort().map((k) => `${k}: ${serializeLiteral(e.attrs[k])}`).join(', ')}}`);
      }
      if (fnCode) obj.push(`transform: ${fnCode}`);
      return `{${obj.join(', ')}}`;
    }
    case 'directive': {
      const obj = [`tag: "directive"`, `name: ${JSON.stringify(e.name)}`];
      if (e.args) {
        if (e.name === 'mixin' || RELATION_DIRECTIVES.includes(e.name)) {
          const a = e.args[0];
          obj.push(`args: [{target: ${JSON.stringify(a.target)}${a.optional ? ', optional: true' : ''}` +
            `${a.as ? `, as: ${JSON.stringify(a.as)}` : ''}` +
            `${a.foreignKey ? `, foreignKey: ${JSON.stringify(a.foreignKey)}` : ''}` +
            `${a.through ? `, through: ${JSON.stringify(a.through)}` : ''}` +
            `${a.targetKey ? `, targetKey: ${JSON.stringify(a.targetKey)}` : ''}}]`);
        } else if (e.name === 'primary') {
          obj.push(`args: [{name: ${JSON.stringify(e.args[0].name)}` +
            `${e.args[0].column ? `, column: ${JSON.stringify(e.args[0].column)}` : ''}}]`);
        } else if (e.name === 'on') {
          obj.push(`args: [{field: ${JSON.stringify(e.args[0].field)}}]`);
        } else if (e.name === 'unique' || e.name === 'index') {
          obj.push(`args: [{fields: ${JSON.stringify(e.args[0].fields)}}]`);
        } else if (e.name === 'idStart') {
          obj.push(`args: [{value: ${e.args[0].value}}]`);
        } else if (e.name === 'table' || e.name === 'tableWas') {
          obj.push(`args: [{name: ${JSON.stringify(e.args[0].name)}}]`);
        }
      }
      return `{${obj.join(', ')}}`;
    }
    case 'ensure': {
      const head = [
        `tag: "ensure"`,
        `message: ${JSON.stringify(e.message)}`,
      ];
      // The predicate's offset within the finished literal — the face
      // splices its parameter annotation there.
      marks.fnAt = `{${head.join(', ')}, fn: `.length;
      const obj = [...head, `fn: ${fnCode}`];
      if (e.field) obj.push(`field: ${JSON.stringify(e.field)}`);
      if (e.async) obj.push('async: true');
      return `{${obj.join(', ')}}`;
    }
    case 'enum-member': {
      const obj = [`tag: "enum-member"`, `name: ${JSON.stringify(e.name)}`];
      if (e.value !== undefined) obj.push(`value: ${JSON.stringify(e.value)}`);
      return `{${obj.join(', ')}}`;
    }
    case 'union-member':
      return `{tag: "union-member", name: ${JSON.stringify(e.name)}}`;
    default:
      throw new Error(`schema: unknown entry tag '${e.tag}'`);
  }
}

function serializeLiteral(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

// ── Compile-time projection folding (opt-in: foldProjections) ──────────────
//
// A derived schema like `UserView = User.pick("id", "name")` normally
// compiles to a runtime method call, which (a) needs the source `User`
// loaded and (b) only yields a descriptor at load time. Folding statically
// evaluates the algebra against the source's descriptor and rewrites the
// assignment to a fresh, self-contained `['schema', {...}]` node — no
// reference to the source. That's what lets a projection cross the client
// bundle boundary (the bundler extracts the folded literal) without
// dragging the model's ORM/DDL along.
//
// Folding is intentionally conservative: it only fires for a same-file
// source schema and static string-literal keys, and it BAILS (leaving the
// runtime call untouched) on anything it can't prove — an unknown base,
// dynamic args, a field the source doesn't expose, an extend collision.
// The runtime path is always a correct fallback, so a bail is never a
// regression. Folding is OFF by default (server/CLI/check keep the runtime
// algebra, including its `_sourceModel` back-pointer); the browser-bundle
// extractor turns it on.

const FOLD_ALGEBRA = new Set(['pick', 'omit', 'partial', 'required', 'extend']);

function foldStr(n) { const v = leafValue(n); return v && v.valueOf ? v.valueOf() : v; }

// True when a descriptor pulls fields in via `@mixin`. The fold can't
// expand mixins (resolution is a runtime `_normalize` concern), so any
// projection over such a base must bail to the runtime call rather than
// silently emit a shape missing the mixin's fields.
function foldHasMixin(descriptor) {
  return descriptor.entries.some((e) => e.tag === 'directive' && e.name === 'mixin');
}

// The `@belongsTo` FK property name, computed exactly as the runtime
// does (`camelCase(rel.foreignKey)` in orm.js): an explicit
// foreignKey camelizes verbatim; otherwise the column derives from
// the ACCESSOR (`as:` if present, else the target).
function foldFkName(arg) {
  return camelCase(arg.foreignKey ?? fkName(arg.as ?? arg.target));
}

// The relation one directive entry declares, null for any other entry,
// with the names the runtime derives for it: `accessor`, the instance
// method (`as:`, else the target's accessor, pluralized for hasMany),
// which the type story renders and the emitter finds its type
// reference by. Shared by the compile-time passes and the face, so the
// browser bundle, which stubs the face, carries it too.
const RELATION_KINDS = { __proto__: null, belongsTo: 'belongsTo', hasOne: 'hasOne', hasMany: 'hasMany' };

export function relationOf(e) {
  const kind = e.tag === 'directive' ? RELATION_KINDS[e.name] : undefined;
  if (!kind) return null;
  const target = e.args?.[0]?.target;
  if (!target) return null;
  const a = e.args[0];
  const accessor = a.as ?? (kind === 'hasMany' ? pluralize(accessorOf(target)) : accessorOf(target));
  return {
    kind, target, accessor, optional: a.optional === true,
    as: a.as, foreignKey: a.foreignKey, through: a.through,
  };
}

// The projectable columns of a descriptor as an ordered Map(name → field
// entry): declared fields, then a :model's implicit id / @times /
// @softDelete / @belongsTo FK columns — matching `projectableFields` in
// runtime/orm.js so a fold yields the same field set the runtime
// would. Returns null (bail) when the base uses `@mixin`.
// A :model's entries carry `column: true`: each is a row column, which
// a loaded row holds as `null` when NULL, and the type story reads the
// flag. The literal never does — entryLiteral writes named keys only.
function foldProjectableMap(descriptor) {
  if (foldHasMixin(descriptor)) return null;
  const map = new Map();
  const column = descriptor.kind === 'model';
  for (const e of descriptor.entries) {
    if (e.tag === 'field') map.set(e.name, column ? { ...e, column } : e);
  }
  if (!column) return map;
  const synth = (name, typeName, required) => {
    if (!map.has(name)) map.set(name, { tag: 'field', name, modifiers: required ? ['!'] : ['?'], typeName, array: false, column });
  };
  let timestamps = false, softDelete = false;
  const fks = [];
  for (const e of descriptor.entries) {
    if (e.tag !== 'directive') continue;
    if (e.name === 'times') timestamps = true;
    else if (e.name === 'softDelete') softDelete = true;
    else if (e.name === 'belongsTo') {
      const a = e.args && e.args[0];
      if (a && a.target) fks.push({ fk: foldFkName(a), required: a.optional !== true });
    }
  }
  // Insertion order mirrors the runtime: id, timestamps, softDelete, then FKs.
  synth('id', 'integer', true);
  if (timestamps) { synth('createdAt', 'datetime', true); synth('updatedAt', 'datetime', true); }
  if (softDelete) synth('deletedAt', 'datetime', false);
  for (const { fk, required } of fks) synth(fk, 'integer', required);
  return map;
}

// Declared fields only (no implicit :model columns) — what runtime
// `.extend()` merges from its argument (`other._normalize().fields`).
// Returns null (bail) when the argument uses `@mixin`.
function foldDeclaredMap(descriptor) {
  if (foldHasMixin(descriptor)) return null;
  const map = new Map();
  for (const e of descriptor.entries) {
    if (e.tag === 'field') map.set(e.name, e);
  }
  return map;
}

// Rewrite a field entry's modifiers, preserving any constraint/transform
// token fields so emission stays faithful. `mode` is 'partial' (drop !,
// ensure ?) or 'required' (drop ?, ensure !).
function foldRemark(entry, mode) {
  let mods = entry.modifiers.filter((m) => m !== (mode === 'partial' ? '!' : '?'));
  const want = mode === 'partial' ? '?' : '!';
  if (!mods.includes(want)) mods = [...mods, want];
  return { ...entry, modifiers: mods };
}

// Apply one algebra op to an ordered field Map, returning a new Map or
// null (bail). `op` is { method, keys?, otherName?, otherDescriptor? }.
// `byName` resolves a same-file schema descriptor for extend's argument.
function foldApplyOp(map, op, byName) {
  switch (op.method) {
    case 'pick': {
      const out = new Map();
      for (const k of op.keys) {
        if (!map.has(k)) return null;
        out.set(k, map.get(k));
      }
      return out;
    }
    case 'omit': {
      const drop = new Set(op.keys);
      const out = new Map();
      for (const [k, v] of map) if (!drop.has(k)) out.set(k, v);
      return out;
    }
    case 'partial': {
      const out = new Map();
      for (const [k, v] of map) out.set(k, foldRemark(v, 'partial'));
      return out;
    }
    case 'required': {
      const req = new Set(op.keys);
      const out = new Map();
      for (const [k, v] of map) out.set(k, req.has(k) ? foldRemark(v, 'required') : v);
      return out;
    }
    case 'extend': {
      const other = op.otherDescriptor || byName.get(op.otherName);
      if (!other) return null;
      // Runtime `.extend()` merges the argument's DECLARED fields only —
      // not a :model's implicit id/timestamp/FK columns — so use the
      // declared map.
      const otherMap = foldDeclaredMap(other);
      if (!otherMap) return null; // @mixin in the argument — bail
      const out = new Map(map);
      for (const [k, v] of otherMap) {
        if (out.has(k)) return null; // collision — let the runtime throw
        out.set(k, v);
      }
      return out;
    }
    default:
      return null;
  }
}

// Evaluate an algebra chain against a base descriptor. Returns a folded
// `{kind:"shape", entries}` descriptor, or null to bail to the runtime call.
function foldProjectionDescriptor(baseDescriptor, ops, byName) {
  let map = foldProjectableMap(baseDescriptor);
  if (!map) return null; // base uses @mixin — bail to the runtime call
  for (const op of ops) {
    map = foldApplyOp(map, op, byName);
    if (!map) return null;
  }
  return { kind: 'shape', entries: [...map.values()] };
}

// Parse an assignment RHS s-expr into an algebra chain { base, ops } when
// it's `Base.pick(...)`/`.omit(...)`/… (including chains like
// `.pick(...).omit(...)`), else null. Keys must be static string literals
// (or arrays of them); extend's argument must be a bare identifier or an
// inline schema literal. Anything dynamic returns null → no fold.
function foldParseChain(rhs) {
  const ops = [];
  let node = rhs;
  while (true) {
    if (!isPlainCall(node)) return null;
    const callee = node[2];
    if (!Array.isArray(callee)) return null;
    if (foldStr(callee[0]) !== '.') return null;
    const method = foldStr(callee[3]);
    if (!FOLD_ALGEBRA.has(method)) return null;
    const argNodes = node.slice(3).map(leafValue);
    let op;
    if (method === 'partial') {
      if (argNodes.length) return null;
      op = { method };
    } else if (method === 'extend') {
      if (argNodes.length !== 1) return null;
      const a = argNodes[0];
      if (Array.isArray(a)) {
        // Inline anonymous schema as the argument (`Base.extend(schema
        // :shape …)`) — its descriptor rides on the node itself, so it
        // folds with no name resolution at all. Field-less kinds
        // (:enum/:union) bail like any other unfoldable argument.
        const inline = schemaLiteralOf(a);
        if (!inline || (inline.kind !== 'shape' && inline.kind !== 'input')) return null;
        op = { method, otherDescriptor: inline };
      } else {
        const name = foldStr(a);
        if (typeof name !== 'string' || !isIdentifierName(name)) return null;
        op = { method, otherName: name };
      }
    } else {
      const keys = foldLiteralKeys(argNodes);
      if (!keys || !keys.length) return null;
      op = { method, keys };
    }
    ops.unshift(op);
    const obj = leafValue(callee[2]);
    if (Array.isArray(obj)) { node = obj; continue; } // inner call in the chain
    const base = foldStr(obj);
    if (typeof base !== 'string') return null;
    return { base, ops };
  }
}

// Collect static string-literal keys from call args (each a string
// literal, or an array literal of string literals). Returns null on any
// non-literal arg.
function foldLiteralKeys(argNodes) {
  const keys = [];
  for (const a of argNodes) {
    if (Array.isArray(a)) {
      if (foldStr(a[0]) !== 'array') return null;
      for (let i = 2; i < a.length; i++) {
        const k = foldParseStrLit(a[i]);
        if (k == null) return null;
        keys.push(k);
      }
    } else {
      const k = foldParseStrLit(a);
      if (k == null) return null;
      keys.push(k);
    }
  }
  return keys;
}

// A string-literal node's value carries its surrounding quotes (e.g.
// `"id"`). Strip them; return null for anything that isn't a plain string
// literal.
function foldParseStrLit(node) {
  const v = foldStr(node);
  if (typeof v !== 'string' || v.length < 2) return null;
  const q = v[0];
  if ((q !== '"' && q !== "'") || v[v.length - 1] !== q) return null;
  const inner = v.slice(1, -1);
  // Keys are identifiers in practice; reject anything with escapes/interpolation.
  if (/[\\#]/.test(inner)) return null;
  return inner;
}

// A schema literal's descriptor (["schema", {}, ["schema-body", {},
// descriptor, dsl]]), or null.
export function schemaLiteralOf(node) {
  if (!Array.isArray(node) || foldStr(node[0]) !== 'schema' || node.length !== 3) return null;
  const body = node[2];
  return Array.isArray(body) && body[0] === 'schema-body' && body[2] && typeof body[2] === 'object' &&
    Array.isArray(body[2].entries) ? body[2] : null;
}

// Walk the program's top-level statements and evaluate every foldable
// derived-schema assignment, threading each result into the same-file
// schema map so a later `.extend`/chain can reference an already-folded
// projection. `onFolded` receives every one it proves; the walk itself
// never writes to the tree, so a caller that only wants to READ the
// projected shapes leaves the program alone.
function walkDerivedSchemas(sexpr, onFolded) {
  if (!Array.isArray(sexpr)) return;
  const head = foldStr(sexpr[0]);
  const stmts = (head === 'program' || head === 'block') ? sexpr.slice(2) : [sexpr];
  const byName = new Map();
  for (const stmt of stmts) {
    if (!Array.isArray(stmt)) continue;
    // Unwrap `export <assign>` to reach the assignment node.
    const exported = foldStr(stmt[0]) === 'export' && Array.isArray(stmt[2]);
    const assign = exported ? stmt[2] : stmt;
    if (foldStr(assign[0]) !== '=' || !Array.isArray(assign[3])) continue;
    const name = foldStr(assign[2]);
    if (typeof name !== 'string') continue;

    // Already a schema literal — register its descriptor and move on.
    const literal = schemaLiteralOf(assign[3]);
    if (literal !== null) {
      byName.set(name, literal);
      continue;
    }

    const chain = foldParseChain(assign[3]);
    if (!chain) continue;
    const baseDesc = byName.get(chain.base);
    if (!baseDesc) continue; // base not a same-file schema — leave the runtime call
    const folded = foldProjectionDescriptor(baseDesc, chain.ops, byName);
    if (!folded) continue;   // not statically foldable — leave the runtime call

    byName.set(name, folded);
    onFolded({ name, descriptor: folded, node: assign, exported });
  }
}

// Rewrite every foldable derived-schema assignment to a fresh,
// self-contained schema literal. Mutates `sexpr`. Called by compile()
// only when options.foldProjections is set.
export function foldDerivedSchemas(sexpr) {
  walkDerivedSchemas(sexpr, ({ descriptor, node }) => { node[3] = ['schema', {}, ['schema-body', {}, descriptor, ['none', {}]]]; });
}

// The same projections, READ rather than written: the shape each
// derived binding yields, for a consumer that wants the projected type
// while the JS keeps the runtime call (which carries the
// `_sourceModel` back-pointer folding drops). Declaration order.
export function derivedSchemaDescriptors(sexpr) {
  const out = [];
  walkDerivedSchemas(sexpr, (d) => out.push(d));
  return out;
}
