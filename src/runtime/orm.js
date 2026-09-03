// The schema PERSISTENCE runtime — the model machinery behind
// the `:model` kind: the ORM (find/where/create/save/destroy, the
// query builder, relations, lifecycle hooks, scopes, soft delete,
// upsert/insertMany, transactions) and DDL (`toSQL`). It installs into
// the validation runtime (src/runtime/schema.js) through the explicit
// persistence seam; kind 'model' rejects loudly in any process where
// this module is absent.
//
// Delivery: a second delivered module behind the same seam as
// the validation runtime. Toolchain paths import it (this file's own
// import of ./schema.js makes the dependency real in the module
// graph); standalone output inlines its body INTO the validation
// runtime's IIFE (one shared scope — the emitter strips the import
// and export lines), so the two bodies see each other exactly as the
// module graph does. Duplicate copies meeting in one process reject
// through the validation runtime's process-wide sentinel: every path
// into this module evaluates that module first.
//
// Storage boundary: the Contract-v2 adapter — `query(sql, params) →
// {columns, data, rowCount}` is the one required method; `begin()`
// and a truthful `capabilities` object are optional and
// feature-detected. The default adapter speaks HTTP (fetch) to a
// duckdb-harbor-shaped endpoint (RIP_DB_URL / RIP_DB_TOKEN); tests
// install in-memory recording adapters. SQL engines stay USER-side —
// the dependency graph stays empty. There is no browser fork:
// the adapter contract is the whole environment story, and
// transactions feature-detect AsyncLocalStorage, rejecting loudly
// where the host has none.

import { SchemaError, SchemaRegistry, registerCoercer, SchemaDef, installPersistence } from './schema.js';
import { harborAdapter, decodeTemporal, isPlainObject } from './duckdb.js';
import { snakeCase, camelCase, pluralize, fkName, accessorOf, isCanonicalTarget, isCanonicalName, attrValueError, MODEL_DIRECTIVES, ONCE_DIRECTIVES, RELATION_DIRECTIVES, FIELD_ATTRS, RELATION_ATTRS } from './vocab.js';

// ── naming: the snake_case ↔ camelCase bijection ─────────────────────


// A SQL identifier in a STRUCTURED position: must be a string, free
// of control characters, a member of the operation's canonical column
// set, and emits double-quote escaped (an embedded quote doubles, so
// a name can never break out of the identifier). The trusted string
// overloads of where()/order() sit outside this helper by owner
// decision O4; every other identifier the builder interpolates for a
// caller passes through here. Namespace honesty: every `what` at a
// call site names a COLUMN position and every name reaching this
// helper IS a column — keys a caller may spell as camelCase
// properties (where/order/updateAll) resolve and reject through
// callerColumn first, so the snake_case inventory below is
// never shown to someone who wrote property names.
function quoteIdent(name, allowed, what) {
  if (typeof name !== 'string') {
    throw new Error('schema: ' + what + ' must be a string column name; got ' + (name === null ? 'null' : typeof name));
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('schema: ' + what + ' contains control characters: ' + JSON.stringify(name));
  }
  if (allowed !== null && !allowed.has(name)) {
    throw new Error('schema: unknown ' + what + " '" + name + "' — known columns: " + [...allowed].sort().join(', '));
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

// The one place a name reaches SQL as a string LITERAL rather than an
// identifier: nextval() takes the sequence by name, in quotes of the
// other kind. Identifiers go through quoteIdent; this is its
// literal twin, and both exist so no name is ever pasted raw.
function quoteLiteral(text, what) {
  if (typeof text !== 'string') {
    throw new Error('schema: ' + what + ' must be a string; got ' + (text === null ? 'null' : typeof text));
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error('schema: ' + what + ' contains control characters: ' + JSON.stringify(text));
  }
  return "'" + text.replace(/'/g, "''") + "'";
}

// LIMIT/OFFSET are numeric SQL positions interpolated as bare
// integers: only an actual number that is a safe non-negative integer
// may reach them — no coercion, no numeric strings (a request-derived
// string is exactly the injection surface this closes).
function pageInt(n, what) {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new Error('schema: ' + what + '() requires a safe non-negative integer number; got ' + (typeof n === 'string' ? JSON.stringify(n) : String(n)));
  }
  return n;
}

// ── structured filters: comparison operators ──────────────────────────
//
// `where({age: {gte: 18, lt: 65}})` reads an object VALUE as a map of
// operators. That reading is off-limits for fields whose declared type
// is itself an object: `json`, `any`, and array fields all render as
// JSON (SQL_TYPES) and serialize stringifies an object
// written to them — so `where({prefs: {like: true}})` on a json column
// is a legitimate EQUALITY test against that document, not an ILIKE.
// The field's declared TYPE decides, never the value's shape.


// `IN ()` is a syntax error at the database, and both empty cases have
// an exact constant answer: nothing is inside an empty set, everything
// is outside one.
function inFragment(col, values, params, negated, field) {
  const op = negated ? 'nin' : 'in';
  if (!Array.isArray(values)) {
    throw new Error("schema: where() " + op + " on '" + field + "' requires an array; got " +
      (values === null ? 'null' : typeof values));
  }
  if (values.length === 0) return negated ? '1 = 1' : '1 = 0';
  params.push(...values);
  return col + (negated ? ' NOT IN (' : ' IN (') + values.map(() => '?').join(', ') + ')';
}

// Each renders its fragment and pushes its own params, so clause order
// and param order stay locked together however the caller nests them.
const WHERE_OPS = new Map([
  // null is why eq/ne are operators at all: `= NULL` is never true in
  // SQL, so the comparison has to become IS [NOT] NULL.
  ['eq', (col, v, p) => { if (v === null) return col + ' IS NULL'; p.push(v); return col + ' = ?'; }],
  ['ne', (col, v, p) => { if (v === null) return col + ' IS NOT NULL'; p.push(v); return col + ' <> ?'; }],
  ['gt', (col, v, p) => { p.push(v); return col + ' > ?'; }],
  ['gte', (col, v, p) => { p.push(v); return col + ' >= ?'; }],
  ['lt', (col, v, p) => { p.push(v); return col + ' < ?'; }],
  ['lte', (col, v, p) => { p.push(v); return col + ' <= ?'; }],
  ['like', (col, v, p) => { p.push(v); return col + ' LIKE ?'; }],
  ['ilike', (col, v, p) => { p.push(v); return col + ' ILIKE ?'; }],
  ['in', (col, v, p, f) => inFragment(col, v, p, false, f)],
  ['nin', (col, v, p, f) => inFragment(col, v, p, true, f)],
  ['between', (col, v, p, f) => {
    if (!Array.isArray(v) || v.length !== 2) {
      throw new Error("schema: where() between on '" + f + "' requires a two-element [low, high] array");
    }
    p.push(v[0], v[1]);
    return col + ' BETWEEN ? AND ?';
  }],
]);

// A closed set: ORDER BY is interpolated, not parameterized, so the
// direction is an identifier-grade decision and an open string would be
// an injection surface.
const ORDER_DIRS = new Set([
  'asc', 'desc',
  'asc nulls first', 'asc nulls last',
  'desc nulls first', 'desc nulls last',
]);

function orderDir(dir, field) {
  const key = typeof dir === 'string' ? dir.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  if (!ORDER_DIRS.has(key)) {
    throw new Error("schema: order() direction for '" + field + "' must be one of " +
      [...ORDER_DIRS].map((d) => JSON.stringify(d)).join(', ') + '; got ' +
      (typeof dir === 'string' ? JSON.stringify(dir) : (dir === null ? 'null' : typeof dir)));
  }
  return key.toUpperCase();
}


// The pluralizer, the FK column rule, and the accessor rule live in
// ./vocab.js — the compiler's type renderer derives the same names and
// must not import this module (that would evaluate the persistence
// install into the compiler process).
function tableName(model) { return pluralize(snakeCase(model)); }

// Relation TARGETS must be canonical PascalCase — uppercase-first,
// alphanumeric, no two consecutive uppercase letters — the same
// bijection guard field names already carry: an acronym-style target
// derives FK and accessor names the snake/camel round-trip cannot
// reproduce.
const canonicalTarget = isCanonicalTarget;

// ── reserved names ────────────────────────────────────────────────────

const RESERVED_STATIC = new Set([
  'parse', 'array', 'safe', 'ok', 'parseAsync', 'safeAsync', 'okAsync', 'toJSONSchema',
  'find', 'findMany', 'with', 'where', 'all', 'first', 'count', 'create', 'toSQL',
  'includes', 'upsert', 'insertMany', 'updateAll', 'deleteAll', 'withDeleted', 'onlyDeleted',
  'unscoped', 'factory',
]);
// Names a @scope may not take: the model statics above plus the
// builder-only chain methods — scopes install on both surfaces.
const SCOPE_RESERVED = new Set([
  ...RESERVED_STATIC,
  'limit', 'offset', 'order', 'orderBy',
]);
const RESERVED_INSTANCE = new Set([
  'save', 'set', 'destroy', 'restore', 'reload', 'ok', 'errors', 'toJSON', 'savedChanges', 'markDirty',
  '_saving', '_relMemo',
]);
// Implicit columns owned by directive-driven runtime behavior:
// declaring them as user fields would shadow the runtime API or
// produce duplicate SET writes when @times / @softDelete bump
// them. (Mixin-included fields are exempt — declaring createdAt /
// updatedAt through a mixin is the explicit-control alternative to
// @times.)
const RESERVED_IMPLICIT = new Set([
  'createdAt', 'updatedAt', 'deletedAt',
]);
const RESERVED = new Set([
  ...RESERVED_STATIC,
  ...RESERVED_INSTANCE,
  ...RESERVED_IMPLICIT,
]);

const HOOK_NAMES = new Set([
  'beforeValidation', 'afterValidation',
  'beforeSave', 'afterSave',
  'beforeCreate', 'afterCreate',
  'beforeUpdate', 'afterUpdate',
  'beforeDestroy', 'afterDestroy',
  // Transaction-aware: fire after the outermost COMMIT / ROLLBACK, or
  // immediately after save/destroy when no transaction is open.
  'afterCommit', 'afterRollback',
]);

// The model directive vocabulary with each name's argument shape.
// An unknown directive name — or a known one with the wrong argument
// shape — is a silently wrong schema, never a no-op: both reject
// loudly (#103).

// ── per-instance persistence state ────────────────────────────────────

// Snapshot the current values of every persisted column — the primary
// key, declared fields, and belongsTo FK columns (keyed camelCase,
// the same convention the dirty set / savedChanges / markDirty use).
// The PK is captured so save()'s UPDATE WHERE targets the
// originally-loaded row even if `inst[pk]` is reassigned in memory.
function snapshot(norm, inst) {
  const snap = Object.create(null);
  snap[norm.primaryKey] = snapshotValue(inst[norm.primaryKey]);
  for (const [n] of norm.fields) snap[n] = snapshotValue(inst[n]);
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const fkCamel = fieldFor(norm, rel.foreignKey);
    snap[fkCamel] = snapshotValue(inst[fkCamel]);
  }
  return snap;
}

function persistedIdentity(def, inst, operation) {
  const norm = def._normalize();
  const pk = norm.primaryKey;
  const snap = inst._snapshot;
  if (!inst._persisted) {
    throw new Error(
      'schema: ' + operation + ' on ' + (def.name || 'model') +
      ' requires a persisted instance');
  }
  if (!snap || !Object.prototype.hasOwnProperty.call(snap, pk) || snap[pk] == null) {
    throw new Error(
      'schema: ' + operation + ' on persisted ' + (def.name || 'instance') +
      ' has no persisted identity in _snapshot.' + pk +
      ' — hydrate or save the instance before using identity-dependent operations');
  }
  return snap[pk];
}

// SameValue-Zero: like ===, except NaN equals NaN (a persisted NaN
// must not trigger a wasted UPDATE every save); +0/-0 stay equal —
// the DB does not distinguish them.
function sameValue(a, b) {
  return a === b || (a !== a && b !== b);
}

// Persistence snapshots own their values: an object mutated while SQL
// awaits cannot advance the committed snapshot. Containers retain their
// value semantics; custom instances flatten only enumerable data, so
// model bookkeeping and prototypes never enter persistence state.
function snapshotValue(value, seen = new Map()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const item of value) out.push(snapshotValue(item, seen));
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [key, item] of value) {
      out.set(snapshotValue(key, seen), snapshotValue(item, seen));
    }
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const item of value) out.add(snapshotValue(item, seen));
    return out;
  }
  const out = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = snapshotValue(value[key], seen);
  return out;
}

function snapshotEqual(a, b, seen = new Map()) {
  if (sameValue(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  let paired = seen.get(a);
  if (paired) return paired === b;
  seen.set(a, b);
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, i) => snapshotEqual(item, b[i], seen));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    const aa = [...a], bb = [...b];
    return aa.every(([ak, av], i) =>
      snapshotEqual(ak, bb[i][0], seen) && snapshotEqual(av, bb[i][1], seen));
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    const aa = [...a], bb = [...b];
    return aa.every((item, i) => snapshotEqual(item, bb[i], seen));
  }
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key, i) =>
    key === bk[i] && snapshotEqual(a[key], b[key], seen));
}

// Relation memo — {identity, value} per instance and accessor,
// non-enumerable so it never reaches Object.keys / JSON.stringify.
// Identity is captured before resolution, including for null and []
// values, and written uniformly by accessors and eager loading.
function relMemoSet(inst, acc, identity, value) {
  if (!inst._relMemo) {
    Object.defineProperty(inst, '_relMemo', {
      value: new Map(), enumerable: false, writable: false, configurable: true,
    });
  }
  inst._relMemo.set(acc, { identity, value });
  return value;
}

// ── the persistence seam: model normalization ─────────────────────────

function modelError(def, field, error, message) {
  return new SchemaError([{ field, error, message }], def.name, def.kind);
}

// ── property ↔ column, the two directions ─────────────────────────────
//
// The maps are authoritative; the snake/camel derivation survives only
// as the fallback for a name the map has never heard of, which then
// fails its own validation with a message naming the known columns.
//
// Callers may spell a key EITHER way (`where({firstName: …})` and
// `where({first_name: …})` both work), so the column direction tries
// the map, then an exact column match, then the derivation.
function columnFor(norm, key) {
  const mapped = norm.columnOf.get(key);
  if (mapped !== undefined) return mapped;
  if (norm.fieldOf.has(key)) return key;
  return snakeCase(key);
}

function fieldFor(norm, column) {
  return norm.fieldOf.get(column) ?? camelCase(column);
}

// A structured key the CALLER wrote (where()/order()/updateAll()):
// resolved property→column, then validated and quoted exactly as
// every other structured identifier. The rejection speaks the
// caller's namespace — it echoes the key AS WRITTEN and inventories
// the model's property names (each with its column beside it where
// the spellings differ), instead of echoing a snake_case derivation
// of a name nobody wrote over a column list nobody typed.
function callerColumn(norm, key, allowed, what) {
  const column = columnFor(norm, key);
  if (typeof column === 'string' && !/[\u0000-\u001f\u007f]/.test(column) &&
      allowed !== null && !allowed.has(column)) {
    const known = [...allowed].sort().map((col) => {
      const prop = fieldFor(norm, col);
      return prop === col ? col : prop + ' (column ' + col + ')';
    }).join(', ');
    throw new Error('schema: unknown ' + what + " '" + key + "' — known: " + known);
  }
  return quoteIdent(column, allowed, what);
}

function normalizeDirectiveRelation(def, directive) {
  const name = directive.name;
  if (!RELATION_DIRECTIVES.includes(name)) return null;
  const a = directive.args[0];
  const target = a.target;
  const targetLc = accessorOf(target);
  // A belongsTo's FK column derives from its ACCESSOR — the name the
  // relation goes by: `@belongsTo User` reads user_id, and
  // `{as: reviewer}` reads reviewer_id, so two relations to one model
  // coexist with no explicit keys. An explicit `{foreignKey:}` names
  // the column directly and always wins. hasOne/hasMany keys live on
  // the OTHER table and name the OWNER — `as:` never described them.
  const optional = !!a.optional;
  if (name === 'belongsTo') {
    const accessor = a.as ?? targetLc;
    return {
      kind: 'belongsTo', target, optional,
      accessor,
      foreignKey: a.foreignKey ?? fkName(accessor),
    };
  }
  // A `through` relation owns no column on either end — both foreign
  // keys live on the JOIN model — so `foreignKey`/`targetKey` name
  // columns THERE, and both may stay unresolved until query time,
  // when the join model is registered and its own @belongsTo can say.
  // The kind still decides the SHAPE of the answer: hasOne takes the
  // first row, hasMany takes them all.
  if (a.through) {
    return {
      kind: name, target, optional, through: a.through,
      accessor: a.as ?? (name === 'hasOne' ? targetLc : pluralize(targetLc)),
      foreignKey: a.foreignKey ?? null,
      targetKey: a.targetKey ?? null,
    };
  }
  if (name === 'hasOne') {
    return {
      kind: 'hasOne', target, optional,
      accessor: a.as ?? targetLc,
      foreignKey: a.foreignKey ?? fkName(def.name),
    };
  }
  return {
    kind: 'hasMany', target, optional,
    accessor: a.as ?? pluralize(targetLc),
    foreignKey: a.foreignKey ?? fkName(def.name),
  };
}

// The two join columns of a `through` relation, resolved against the
// JOIN MODEL — late, because the registry fills in whatever order the
// modules load. Each side is whichever @belongsTo on the join model
// points at that end; an explicit `foreignKey:`/`targetKey:` names the
// column directly and skips the search.
//
// Ambiguity is refused, never guessed: a join model with two
// @belongsTo to the same end (author + reviewer) has no single right
// answer, and picking one would wire the relation to the wrong column
// silently.
function throughKeys(def, rel, join) {
  const joinNorm = join._normalize();
  if (!(joinNorm.columns instanceof Set)) {
    throw new Error('schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
      ' reads through ' + rel.through + ', which is not a persisted :model');
  }
  const side = (explicit, model, what) => {
    if (explicit) {
      quoteIdent(explicit, joinNorm.columns, 'through ' + what + ' key');
      return explicit;
    }
    const hits = [];
    for (const [, r] of joinNorm.relations) {
      if (r.kind === 'belongsTo' && r.target === model) hits.push(r);
    }
    if (hits.length === 1) return hits[0].foreignKey;
    const option = what === 'owner' ? 'foreignKey' : 'targetKey';
    if (!hits.length) {
      throw new Error('schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
        ' reads through ' + rel.through + ', which declares no @belongsTo ' + model +
        " — add one, or name the column: {through: " + rel.through + ', ' + option + ': "' +
        fkName(model) + '"}');
    }
    throw new Error('schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
      ' reads through ' + rel.through + ', which declares ' + hits.length + ' @belongsTo ' + model +
      ' (' + hits.map((r) => r.accessor).join(', ') + ') — name the column to say which: ' +
      '{through: ' + rel.through + ', ' + option + ': "' + hits[0].foreignKey + '"}');
  };
  const ownerKey = side(rel.foreignKey, def.name, 'owner');
  const targetKey = side(rel.targetKey, rel.target, 'target');
  // One column cannot hold both ends of a link. A self-referential
  // relation whose join model declares ONE @belongsTo to the shared
  // target resolves both sides to that same column — every row its
  // own partner, guessed rather than refused.
  if (ownerKey === targetKey) {
    throw new Error('schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
      ' reads through ' + rel.through + " with '" + ownerKey +
      "' as both its owner and target column — one column cannot hold both ends of a link; " +
      'name distinct columns with {foreignKey: "…"} and {targetKey: "…"}');
  }
  return { joinNorm, ownerKey, targetKey };
}

// Validate one directive's argument SHAPE against the vocabulary.
// Extra args, missing args, and wrong-typed args all reject — a
// directive that reads only part of what the user wrote acted on a
// different program.
function validateDirectiveArgs(def, d) {
  const shape = MODEL_DIRECTIVES[d.name];
  if (shape === undefined) {
    throw modelError(def, '', 'directive',
      "unknown directive '@" + d.name + "' on :model — legal: " +
      Object.keys(MODEL_DIRECTIVES).map((n) => '@' + n).join(', '));
  }
  const args = d.args || [];
  const bad = (why) => {
    throw modelError(def, '', 'directive', '@' + d.name + ': ' + why);
  };
  switch (shape) {
    case 'none':
      if (args.length) bad('takes no arguments');
      break;
    case 'target': {
      if (args.length !== 1 || !args[0] || typeof args[0].target !== 'string') {
        bad('takes exactly one target name');
      }
      // Relation targets carry the FK/accessor derivation; mixin
      // targets never derive names and keep the base resolution.
      if (d.name !== 'mixin' && !canonicalTarget(args[0].target)) {
        bad("target '" + args[0].target + "' is not canonical PascalCase — use an uppercase-first, " +
          "alphanumeric name with no consecutive uppercase letters (e.g. 'MdmUser' not 'MDMUser'); " +
          'the derived FK column and accessor names ride the snake_case bijection');
      }
      // The compiler validates these, but `__schema()` is also reached
      // directly (tests, generated descriptors), so the runtime holds
      // the same line rather than trusting its caller.
      if (d.name !== 'mixin') {
        for (const [key, kind] of Object.entries(RELATION_ATTRS)) {
          const value = args[0][key];
          if (value === undefined) continue;
          const why = attrValueError(kind, key, value);
          if (why) bad('option ' + why + "; got '" + value + "'");
        }
        if (args[0].through !== undefined && d.name === 'belongsTo') {
          bad("option 'through' is for @hasMany/@hasOne — a @belongsTo holds its key in its own " +
            'row, so it has nothing to read through');
        }
        if (args[0].targetKey !== undefined && args[0].through === undefined) {
          bad("option 'targetKey' names a column on the join model, so it requires 'through'");
        }
      }
      break;
    }
    case 'columns': {
      if (args.length !== 1 || !args[0] || !Array.isArray(args[0].fields) || !args[0].fields.length) {
        bad('takes a non-empty column list');
      }
      break;
    }
    case 'int': {
      if (args.length !== 1 || !args[0] || !Number.isInteger(args[0].value)) {
        bad('takes one integer literal (e.g. @idStart 10001)');
      }
      break;
    }
    case 'name': {
      if (args.length !== 1 || !args[0] || typeof args[0].name !== 'string' || !args[0].name.length) {
        bad('takes one prior table name');
      }
      break;
    }
    case 'field': {
      if (args.length !== 1 || !args[0] || typeof args[0].name !== 'string') {
        bad('takes one property name');
      }
      if (!isCanonicalName(args[0].name)) {
        bad("'" + args[0].name + "' is not canonical camelCase — lowercase-first, alphanumeric, " +
          "no consecutive capitals ('patientId' not 'patientID'); the property, the snapshot key " +
          'and the JSON key all ride the snake_case bijection');
      }
      // Hand-built descriptors may leave the column implicit; the
      // compiler always writes it.
      const column = args[0].column;
      if (column !== undefined) {
        const why = attrValueError('literal', 'column', column);
        if (why) bad('option ' + why + "; got '" + column + "'");
      }
      break;
    }
  }
}

// finishModelNorm — attaches the model layer to a freshly-built base
// norm: directive validation, relations, table naming, timestamps /
// softDelete, reserved-name enforcement, hook-name validation, and
// the index-column check. Runs inside
// _normalize(), so every downstream layer (validator, ORM plan, DDL
// plan) sees a fully-validated model.
// The migration runner keeps its whole state in one table of this name
// (the history, the '@lock' row, the '@op:…' rows). Only the current
// name is reserved here: the runner's retired names are filtered out of
// diffs by the runner itself, and naming them in this file — which
// ships to the browser — would drag CLI-only vocabulary across the
// delivery boundary the tests defend.
const RUNNER_TABLE_NAMES = new Set(['schema']);

function finishModelNorm(def, norm) {
  if (!def.name) {
    throw modelError(def, '', 'name', 'a :model needs a name — its table name derives from it');
  }

  const collision = (n, where) => {
    throw modelError(def, n, 'collision', n + ' collides with ' + where);
  };

  // Reserved ORM names guard DECLARED entries only: mixin-included
  // fields may spell createdAt/updatedAt (explicit control instead of
  // @times).
  for (const e of def._desc.entries || []) {
    if ((e.tag === 'field' || e.tag === 'method' || e.tag === 'computed' || e.tag === 'derived') &&
        RESERVED.has(e.name)) {
      collision(e.name, 'reserved ORM name');
    }
    if (e.tag === 'hook' && !HOOK_NAMES.has(e.name)) {
      throw modelError(def, e.name, 'hook',
        "unknown lifecycle hook '" + e.name + "' — recognized: " + [...HOOK_NAMES].join(', '));
    }
  }
  for (const [n] of norm.scopes) {
    if (SCOPE_RESERVED.has(n)) collision(n, 'reserved query API name');
  }

  let timestamps = false;
  let softDelete = false;
  let tableWas = null;
  let table = null;
  let primaryKey = null;
  const relations = new Map();
  const seenOnce = new Set();
  for (const d of norm.directives) {
    validateDirectiveArgs(def, d);
    if (ONCE_DIRECTIVES.includes(d.name)) {
      if (seenOnce.has(d.name)) {
        // Same verdict as the compiler: an argument-less once-directive
        // (@times, @softDelete) has no second value to override;
        // the duplicate is still refused — it declares itself once.
        throw modelError(def, '', 'directive',
          MODEL_DIRECTIVES[d.name] === 'none'
            ? "duplicate '@" + d.name + "' — declared twice; a :model declares it once"
            : "duplicate '@" + d.name + "' — a :model declares it at most once " +
              '(the second would silently override the first)');
      }
      seenOnce.add(d.name);
    }
    if (d.name === 'times') timestamps = true;
    else if (d.name === 'softDelete') softDelete = true;
    else if (d.name === 'table') table = d.args[0].name;
    else if (d.name === 'tableWas') tableWas = d.args[0].name;
    else if (d.name === 'primary') primaryKey = d.args[0];
    const rel = normalizeDirectiveRelation(def, d);
    if (rel) {
      if (relations.has(rel.accessor)) collision(rel.accessor, 'relation');
      if (norm.fields.has(rel.accessor)) collision(rel.accessor, 'field');
      if (norm.methods.has(rel.accessor)) collision(rel.accessor, 'method');
      if (norm.computed.has(rel.accessor)) collision(rel.accessor, 'computed');
      if (norm.derived.has(rel.accessor)) collision(rel.accessor, 'derived');
      if (norm.hooks.has(rel.accessor)) collision(rel.accessor, 'hook');
      relations.set(rel.accessor, rel);
    }
  }

  // The inline spelling: '@primary' on the field line serializes as a
  // field flag rather than a directive; it names itself.
  if (!primaryKey) {
    for (const [n, f] of norm.fields) {
      if (f.primary) { primaryKey = { name: n }; break; }
    }
  }

  norm.relations = relations;
  norm.timestamps = timestamps;
  norm.softDelete = softDelete;
  norm.tableWas = tableWas;
  // The primary key is a PROPERTY and a COLUMN, and `{column:}` lets
  // them differ — the same pair every declared field has.
  norm.primaryKey = primaryKey?.name ?? 'id';
  norm.primaryKeyColumn = primaryKey
    ? (primaryKey.column ?? snakeCase(primaryKey.name))
    : 'id';
  // `@table` is a permanent override; `@tableWas` is a one-time rename
  // signal the differ consumes and the author then deletes. Both are in
  // table-name space, so they compose: @tableWas names the DEPLOYED
  // table, @table the desired one, and the pluralizer is bypassed
  // entirely when @table is present.
  norm.tableName = table ?? tableName(def.name);

  // The migration runner keeps its whole state — history, lock, run
  // outcomes — in a table called `schema`, and it must never collide
  // with one of yours. The runner filters that name out of every diff,
  // so a model claiming it would be invisible to `plan` and `make`:
  // never created, never altered, silently absent. Refuse it here,
  // where the author can see why, rather than there, where nobody can.
  if (RUNNER_TABLE_NAMES.has(norm.tableName)) {
    throw modelError(def, norm.tableName, 'collision',
      "'" + norm.tableName + "' is reserved for the migration runner's own state — " +
      'rename the model, or give it another table with @table');
  }

  // ── surrogate or natural: DECLARING the pk as a field is the switch ─
  //
  // These are the only two coherent readings, and the declaration
  // settles which:
  //
  //   @primary patientId             nothing declares patientId, so
  //                                  nothing says what it holds — it is
  //                                  the runtime's INTEGER surrogate:
  //                                  sequence default, RETURNING
  //                                  absorption, caller input refused
  //
  //   @primary mrn                   mrn IS declared, with a type and
  //   mrn! string                    constraints — a NATURAL key the
  //                                  caller supplies, which the INSERT
  //                                  writes like any other column
  //
  // There is no third case: a declared pk field with a surrogate
  // posture would be a `string` field over an INTEGER sequence column,
  // and an undeclared natural key would be a column with no type. The
  // two facts are one fact, so no separate flag states it.
  //
  // It takes BOTH declarations, though — an @primary naming the
  // field. A bare `id! integer` with no @primary keeps colliding as
  // it always has, because someone writing that means "I have an id",
  // not "turn off the sequence", and the default name is exactly where
  // a silent posture flip would be unnoticeable.
  const pkField = primaryKey ? (norm.fields.get(norm.primaryKey) ?? null) : null;
  norm.primaryKeyField = pkField;
  norm.naturalKey = pkField !== null;
  if (!pkField && norm.fields.has(norm.primaryKey)) {
    collision(norm.primaryKey, 'the runtime-managed primary key');
  }
  if (pkField) {
    if (pkField.optional === true || pkField.required !== true) {
      throw modelError(def, norm.primaryKey, 'primary',
        "the primary key '" + norm.primaryKey + "' is declared optional — a row's " +
        'identity is never absent; declare it required (!)');
    }
    if (pkField.array === true) {
      throw modelError(def, norm.primaryKey, 'primary',
        "the primary key '" + norm.primaryKey + "' is declared as an array — a primary key is one value");
    }
    for (const d of norm.directives) {
      if (d.name === 'idStart') {
        throw modelError(def, norm.primaryKey, 'primary',
          "@idStart seeds the sequence behind a runtime-managed primary key, but '" +
          norm.primaryKey + "' is declared as a field, which makes it caller-supplied — " +
          'there is no sequence to seed. Drop @idStart, or drop the field declaration');
      }
    }
  }

  // ── the property ↔ column mapping ───────────────────────────────────
  //
  // ONE map each way, built once, consulted everywhere. `{column:}`
  // makes the mapping a lookup; snakeCase(property) is only the
  // DEFAULT when a field declares no column of its own, so inlining
  // the derivation at a use site would be wrong.
  //
  // `columnOf` doubles as the column-OWNERSHIP guard: every table
  // column has exactly one owner. A field whose column equals a
  // belongsTo FK (`userId` + `@belongsTo User`), a directive-managed
  // column (a mixin-included `createdAt` + `@times`), or another
  // field's `{column:}` would otherwise emit duplicate-column DDL and
  // duplicate-column INSERTs that fail only at the database. Fields
  // can only collide because `{column:}` ends the injectivity of
  // name → snake_case, which is why fields claim through the same
  // gate as everything else.
  const columnOf = new Map();
  const fieldOf = new Map();
  const ownerOf = new Map();
  const claim = (property, col, owner) => {
    if (fieldOf.has(col)) {
      throw modelError(def, property, 'collision',
        ownerOf.get(col) + ' and ' + owner + " both own column '" + col +
        "' — every table column has exactly one owner");
    }
    // The mirror of the column gate: one property reads exactly one
    // column. A `{column:}` field beside a relation deriving the same
    // property would otherwise map one property onto two columns —
    // duplicate-column DDL and INSERTs, and a phantom column in the
    // canonical sets.
    const prior = columnOf.get(property);
    if (prior !== undefined) {
      throw modelError(def, property, 'collision',
        ownerOf.get(prior) + ' and ' + owner + " both own property '" + property +
        "' (columns '" + prior + "' and '" + col +
        "') — every property reads exactly one column");
    }
    columnOf.set(property, col);
    fieldOf.set(col, property);
    ownerOf.set(col, owner);
  };
  // A natural key claims its column as the FIELD it is, once — the
  // field loop below does it. A surrogate has no field to do it.
  if (!norm.naturalKey) claim(norm.primaryKey, norm.primaryKeyColumn, 'the primary key');
  for (const [n, f] of norm.fields) {
    // The compiler checks these too; `__schema({…})` is a second
    // entry point that takes a hand-built descriptor, so the runtime
    // holds the same line rather than trusting its caller.
    for (const [key, kind] of Object.entries(FIELD_ATTRS)) {
      const value = f.attrs?.[key];
      if (value === undefined) continue;
      const why = attrValueError(kind, key, value);
      if (why) {
        throw modelError(def, n, 'attr',
          "field '" + n + "' option " + why + "; got '" + value + "'");
      }
    }
    claim(n, f.attrs?.column ?? snakeCase(n), "field '" + n + "'");
  }
  for (const [, rel] of relations) {
    if (rel.kind !== 'belongsTo') continue;
    claim(camelCase(rel.foreignKey), rel.foreignKey,
      'the @belongsTo ' + rel.target + ' relation');
  }
  if (timestamps) {
    claim('createdAt', 'created_at', '@times');
    claim('updatedAt', 'updated_at', '@times');
  }
  if (softDelete) claim('deletedAt', 'deleted_at', '@softDelete');
  norm.columnOf = columnOf;
  norm.fieldOf = fieldOf;
  // The properties whose DECLARED type is temporal — the set hydrate
  // and row absorption coerce through coerceTemporal. An array
  // field is a JSON document whatever its element type, so it is
  // excluded; @times / @softDelete columns are datetime by
  // definition.
  const temporalOf = new Map();
  for (const [n, f] of norm.fields) {
    if (f.array !== true && (f.typeName === 'date' || f.typeName === 'datetime')) {
      temporalOf.set(n, f.typeName);
    }
  }
  if (timestamps) {
    temporalOf.set('createdAt', 'datetime');
    temporalOf.set('updatedAt', 'datetime');
  }
  if (softDelete) temporalOf.set('deletedAt', 'datetime');
  norm.temporalOf = temporalOf;
  const known = new Set(fieldOf.keys());
  // The field's own `{column:}` is what the table has, so it wins — and
  // a second, different one on the directive is two answers to one
  // question rather than a default being overridden.
  if (norm.naturalKey) {
    const fieldColumn = columnOf.get(norm.primaryKey);
    if (primaryKey?.column !== undefined && primaryKey.column !== fieldColumn) {
      throw modelError(def, norm.primaryKey, 'primary',
        "@primaryKey names column '" + primaryKey.column + "' but field '" + norm.primaryKey +
        "' reads column '" + fieldColumn + "' — state the column once, on the field");
    }
    norm.primaryKeyColumn = fieldColumn;
  }

  // @index / @unique columns must exist on the table — an index over
  // an undeclared column is invalid DDL that would otherwise surface
  // only when the SQL runs. Written in FIELD space and resolved
  // through the map, so an index on `name` indexes whatever column
  // `name` reads.
  for (const d of norm.directives) {
    if (d.name !== 'index' && d.name !== 'unique') continue;
    const columns = d.args[0].fields.map((c) => columnFor(norm, c));
    if (new Set(columns).size !== columns.length) {
      throw modelError(def, '', 'index',
        '@' + d.name + ' columns must be distinct after canonicalization: ' +
        columns.join(', '));
    }
    for (let i = 0; i < columns.length; i++) {
      const c = d.args[0].fields[i];
      if (!known.has(columns[i])) {
        throw modelError(def, c, 'index',
          '@' + d.name + ": unknown column '" + c + "' — the table has: " + [...known].sort().join(', '));
      }
    }
  }

  // The canonical column sets — every STRUCTURED SQL position
  // validates against the right one. `columns` (every persisted
  // column) serves filters; `conflictTargets` preserves each exact
  // unique tuple the database can arbitrate (the pk, unique fields,
  // and @unique indexes). Caller-WRITABLE input keys are a narrower
  // set still, owned by the creation paths.
  norm.columns = known;
  const callerWritableColumns = new Set();
  for (const [fname] of norm.fields) callerWritableColumns.add(columnOf.get(fname));
  for (const [, rel] of relations) {
    if (rel.kind === 'belongsTo') callerWritableColumns.add(rel.foreignKey);
  }
  norm.callerWritableColumns = callerWritableColumns;
  const conflictTargets = [[norm.primaryKeyColumn]];
  for (const [fname, f] of norm.fields) {
    if (f.unique === true) conflictTargets.push([columnOf.get(fname)]);
  }
  for (const d of norm.directives) {
    if (d.name === 'unique') conflictTargets.push(d.args[0].fields.map((c) => columnFor(norm, c)));
  }
  norm.conflictTargets = conflictTargets;
  norm.conflictColumns = new Set(conflictTargets.flat());
  norm.conflictTargetKeys = new Set(conflictTargets.map((tuple) =>
    [...tuple].sort().join('\u0000')));
}

// decorateDef — construction-time model setup: the per-schema `on:`
// adapter and eager @scope statics (`User.active()` must work as the
// very first call; the invocation itself triggers normalization and
// its collision checks). Prototype methods win on name conflict
// (`in` sees the chain), and normalize rejects those names anyway.
function decorateDef(def, desc) {
  def._adapter = desc.adapter
    ? assertAdapter(desc.adapter, "schema :model on: (" + (desc.name || 'anon') + ')')
    : null;
  for (const e of desc.entries || []) {
    if (e.tag !== 'scope' || (e.name in def)) continue;
    const sfn = e.fn;
    Object.defineProperty(def, e.name, {
      enumerable: false, configurable: true,
      value: function (...args) { return invokeScope(def, null, sfn, args); },
    });
  }
}

// A belongsTo FK holds a copy of the target's key, so it is that
// key's type. Resolved lazily and defensively: the target may not be
// registered yet, and asking an unregistered one is not an error here
// — the relation's own validation says that, at query time, with a
// better message. The convention's INTEGER surrogate is the answer
// until the target can say otherwise.
function relationKeyType(rel) {
  const target = SchemaRegistry.get(rel.target);
  if (!target || target.kind !== 'model') return 'integer';
  let targetNorm;
  try { targetNorm = target._normalize(); } catch { return 'integer'; }
  return targetNorm.primaryKeyField?.typeName ?? 'integer';
}

// The full projectable column set: declared fields plus the columns a
// :model manages implicitly — id, @times, @softDelete, and
// belongsTo FKs. Algebra operates over THIS set, so a client
// projection can pick `id` or `createdAt`.
function projectableFields(def) {
  const norm = def._normalize();
  const out = new Map(norm.fields);
  const col = (name, typeName, required) => {
    if (!out.has(name)) {
      out.set(name, {
        name, required: !!required, optional: !required,
        typeName, literals: null, array: false,
        coerce: false, coercer: null, constraints: null, transform: null,
      });
    }
  };
  // A natural key is already in `norm.fields` with its declared type,
  // and `col` never overwrites — so this line only fires for the
  // runtime's INTEGER surrogate.
  col(norm.primaryKey, 'integer', true);
  if (norm.timestamps) { col('createdAt', 'datetime', true); col('updatedAt', 'datetime', true); }
  if (norm.softDelete) col('deletedAt', 'datetime', false);
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    col(fieldFor(norm, rel.foreignKey), relationKeyType(rel), !rel.optional);
  }
  return out;
}

function jsonSchemaModelColumns(def, properties) {
  const norm = def._normalize();
  if (!norm.naturalKey) properties[norm.primaryKey] = { type: 'integer' };
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const t = relationKeyType(rel) === 'integer' ? 'integer' : 'string';
    properties[fieldFor(norm, rel.foreignKey)] = rel.optional
      ? { type: [t, 'null'] }
      : { type: t };
  }
  if (norm.timestamps) {
    properties.createdAt = { type: 'string', format: 'date-time' };
    properties.updatedAt = { type: 'string', format: 'date-time' };
  }
  if (norm.softDelete) {
    properties.deletedAt = { type: ['string', 'null'], format: 'date-time' };
  }
}

// ── the adapter (Contract v2) ─────────────────────────────────────────

// Temporal encode/decode lives in ./duckdb.js — one decode seam, one
// copy of it — and this runtime never touches the wire at all: an
// installed adapter owns that, per the contract above.

// The default adapter, for a schema-model app that installs none: the
// one duckdb-harbor client, configured from RIP_DB_URL / RIP_DB_TOKEN.
// `src/cli/schema.js` advertises exactly this path.
//
// ONE client, and this is a call into it — a hand-rolled fetch copy
// beside the real client is a copy that drifts (wrong port, discarded
// error text, unread NDJSON, no timeouts or cancellation).
//
// timeoutMs: 0 means "no client clock; inherit harbor's deployment
// default" — not "no deadline". An app wants exactly that: the operator
// sets HARBOR_STATEMENT_TIMEOUT_MS once, and it is the only layer that
// can recover a wedged pool, because harbor's reaper interrupts from
// its own thread while the cancel endpoint itself needs a free worker.
// A client clock cannot substitute: it returns while the statement runs
// on, so an upstream retry manufactures runaways faster.
//
// The migration runner opts out per statement with `timeoutMs: null`
// (see migrate.js). It has to: a 200M-row CREATE INDEX is ~26s on a
// laptop and minutes on a small cloud VM, while a request handler past
// ~30s is already a lost request. No single number serves both.
function defaultAdapter(overrides) {
  return harborAdapter({
    url: overrides?.url,
    token: overrides?.token,
    // 0 unless the caller asked for something else — the knob has to be
    // reachable through schema.connect(), or an app cannot set a client
    // deadline at all. `undefined` (no opinion) is not `null` (opt out).
    timeoutMs: overrides?.timeoutMs === undefined ? 0 : overrides.timeoutMs,
  });
}

// The contract's floor, checked at every installation seam: an
// adapter without a callable query() would otherwise fail LATE — a
// raw TypeError deep inside the first ORM call — instead of at the
// installation site that caused it. A NEAR-MISS (an object that just
// lacks the method) is named distinctly from a non-object, so the
// message says what to add rather than what was passed. (begin()
// stays optional and is feature-checked at the transaction path.)
function assertAdapter(a, who) {
  if (!a || (typeof a !== 'object' && typeof a !== 'function')) {
    throw new Error(
      who + ': an adapter must implement query(sql, params) — Adapter Contract v2; got ' +
      (a === null ? 'null' : typeof a) + ', not an adapter object');
  }
  if (typeof a.query !== 'function') {
    const keys = Object.keys(a).slice(0, 8).join(', ') || '(no enumerable keys)';
    throw new Error(
      who + ': the adapter has no query() method — Adapter Contract v2 requires ' +
      'query(sql, params); the object carries: ' + keys);
  }
  return a;
}

let currentAdapter = defaultAdapter();
// Nothing chose this adapter — it exists so a first ORM call has
// somewhere to route. The marker lets the SQL funnel reword its
// connection failures as the configuration problem they are; every
// explicitly-built adapter (setAdapter, connect, on:) lacks it.
currentAdapter.__schemaImplicitDefault = true;

// Whether anything beyond the unconfigured default is in play — the
// CLI's pre-flight check reads this so a `rip schema` run against
// nothing fails naming the fix instead of surfacing a connection
// error from the default endpoint.
let adapterExplicit = false;

function __schemaSetAdapter(a) {
  currentAdapter = assertAdapter(a, 'schema.setAdapter()');
  adapterExplicit = true;
}

function adapterConfigured() {
  const env = (typeof process !== 'undefined' && process.env) || {};
  return adapterExplicit || !!env.RIP_DB_URL;
}

// A def's own `on:` adapter, else the process-global one.
function adapterFor(def) {
  return (def && def._adapter) || currentAdapter;
}

// Build a NEW adapter value without installing it globally — the
// counterpart of `schema :model, on: analytics`.
function connect(opts) {
  const o = typeof opts === 'string' ? { url: opts } : (opts || {});
  if (!o.url) throw new Error('schema.connect({url, token?, timeoutMs?}): a url is required');
  return defaultAdapter({ url: o.url, token: o.token, timeoutMs: o.timeoutMs });
}

// ── transactions ──────────────────────────────────────────────────────
//
// schema.transaction! -> …    propagates ambiently: every ORM call
// inside the block routes through the transaction's handle via
// AsyncLocalStorage — model code is unchanged inside the block.
// Block throws → ROLLBACK + afterRollback hooks; returns → COMMIT +
// afterCommit hooks. A nested call on the SAME adapter joins the
// ambient transaction; a different adapter is independent (each
// adapter has its own ambient slot — cross-adapter atomicity is
// impossible and the runtime never pretends otherwise).
//
// The singleton initializes through a MEMOIZED PROMISE: the process's
// first N concurrent transactions all await one resolution and share
// one AsyncLocalStorage instance. A per-caller `new ALS()` here would
// let the second cold-start transaction overwrite the first's
// instance, silently routing the first transaction's statements to
// autocommit — writes escaping the transaction with no error
//. Hosts without node:async_hooks reject loudly
// at every attempt (the rejected init promise is the memo).
let txALS = null;
let txALSInit = null;

function txALSGet() {
  if (!txALSInit) {
    txALSInit = (async () => {
      let ALS = null;
      let importError = null;
      try {
        ({ AsyncLocalStorage: ALS } = await import('node:async_hooks'));
      } catch (e) {
        importError = e;
      }
      if (!ALS) {
        const err = new Error(
          'schema.transaction() needs AsyncLocalStorage (node:async_hooks), which this host does not ' +
          'provide — ambient transactions are unavailable here (browsers have no async context to pin ' +
          'a connection to). Run transactional code on Bun or Node.');
        if (importError) err.cause = importError;
        throw err;
      }
      txALS = new ALS();
      return txALS;
    })();
  }
  return txALSInit;
}

function txStore(adapter) {
  if (!txALS) return null;
  const map = txALS.getStore();
  return (map && map.get(adapter)) || null;
}

// The single SQL funnel: resolves the def's adapter, routes through
// that adapter's ambient transaction when one exists, and translates
// DB constraint violations into structured SchemaErrors.
async function runSQL(def, sql, params, opts) {
  const adapter = adapterFor(def);
  const tx = txStore(adapter);
  try {
    return await (tx ? tx.handle.query(sql, params, opts) : adapter.query(sql, params, opts));
  } catch (e) {
    // A connection failure on the never-configured default adapter is
    // a configuration problem, not a network one: name the fix — the
    // CLI pre-flight's own wording — instead of a mystery endpoint.
    const env = (typeof process !== 'undefined' && process.env) || {};
    if (e?.name === 'ConnectionError' && adapter.__schemaImplicitDefault === true && !env.RIP_DB_URL) {
      const err = new Error(
        'schema: no database is configured — nothing installed an adapter and RIP_DB_URL is unset, ' +
        'so this statement dialed the default duckdb-harbor endpoint. Call schema.setAdapter(adapter) ' +
        'or schema.setAdapter(schema.connect({url, token})), or set RIP_DB_URL (and RIP_DB_TOKEN). ' +
        '(' + (e.message || String(e)) + ')');
      err.cause = e;
      throw err;
    }
    throw translateDBError(e, def);
  }
}

// Two call shapes: `transaction(fn)` and `transaction(opts, fn)`. The
// default on the second parameter is load-bearing for TYPES, not for
// behavior — without it TypeScript infers arity 2 and reports TS2554
// on every `schema.transaction! ->`, which is the common form.
/**
 * @param {Record<string, any>|Function} optsOrFn
 * @param {Function} [maybeFn]
 */
async function transaction(optsOrFn, maybeFn = undefined) {
  const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
  const opts = typeof optsOrFn === 'function' ? {} : (optsOrFn || {});
  if (typeof fn !== 'function') {
    throw new Error('schema.transaction(fn): expected a function (got ' + typeof fn + ')');
  }
  const adapter = opts.on ? assertAdapter(opts.on, 'schema.transaction(on:)') : currentAdapter;

  if (txStore(adapter)) return fn();

  if (typeof adapter.begin !== 'function') {
    throw new Error(
      'schema.transaction(): the configured adapter does not support transactions ' +
      '(no begin() method; see Adapter Contract v2). Install an adapter with begin().');
  }
  const als = await txALSGet();

  const handle = await adapter.begin(opts);
  // `after` collects {def, inst, restore} for every save/destroy/
  // restore/upsert completed inside the transaction on a model
  // declaring afterCommit / afterRollback; `restore` is the instance
  // state a ROLLBACK puts back.
  const store = { adapter, handle, after: [] };
  // Copy-on-run: other adapters' ambient contexts stay visible inside
  // the block; only this adapter's slot is (re)bound.
  const nextMap = new Map(als.getStore() || []);
  nextMap.set(adapter, store);
  let result;
  try {
    result = await als.run(nextMap, fn);
  } catch (err) {
    try { await handle.rollback(); } catch {}
    // The database revoked the transaction's writes; the enqueued
    // instances go back to their recorded pre-write state BEFORE the
    // hooks run, so afterRollback observes truth.
    rollbackTxState(store);
    try {
      await flushTxHooks(store, 'afterRollback');
    } catch (hookErr) {
      // The block's error is the transaction's outcome; a throwing
      // afterRollback hook reports through its cause chain rather
      // than replacing it.
      attachCause(err, hookErr);
    }
    throw err;
  }
  try {
    await handle.commit();
  } catch (e) {
    // The COMMIT itself failed, so the outcome is genuinely UNKNOWN:
    // the database may have made the writes durable and lost only the
    // acknowledgment, or may have discarded them. Neither hook family
    // runs — each would assert an outcome nobody observed — and
    // instance state is NOT restored: unknown is not rolled-back, and
    // un-persisting rows that may exist would manufacture a different
    // lie. The caller must verify the rows before retrying.
    const models = [...new Set(store.after.map((entry) => entry.def.name || '(anonymous model)'))];
    const err = new Error(
      'schema: COMMIT failed — the transaction outcome is indeterminate: the writes' +
      (models.length ? ' to ' + models.join(', ') : '') +
      ' may or may not have been applied. Neither afterCommit nor afterRollback hooks ran; ' +
      'verify the rows before retrying. (' + ((e && e.message) || String(e)) + ')');
    err.cause = e;
    throw err;
  }
  // afterCommit runs OUTSIDE the transaction — exceptions here
  // propagate but cannot roll anything back: the COMMIT already
  // happened.
  await flushTxHooks(store, 'afterCommit');
  return result;
}

// Bind an ALREADY-OPEN handle as this adapter's ambient transaction for
// the duration of `fn`, so schema-model statements inside enroll on it
// instead of running autocommit on another connection.
//
// This exists because a transaction opened by the other tier (rip/db's
// `transaction`) is invisible here: `runSQL` routes on this store
// alone, so without it a model write inside someone else's transaction
// commits itself and survives that transaction's rollback.
//
// The caller owns begin/commit/rollback; this owns only the ambience
// and the hooks that depend on the outcome. `fn` is handed a `settle`
// it calls once the commit or rollback has actually landed, so
// afterCommit never fires ahead of the COMMIT it reports.
// The open handle for this adapter's ambient transaction, or null. The
// mirror of adoptTransaction: it lets the other tier see a
// transaction WE opened, so a raw statement issued inside one joins it
// rather than committing itself on another connection.
// DuckDB answers a bulk UPDATE/DELETE with a one-row result set whose
// single `Count` column carries the affected rows — so the envelope's
// own `rowCount` is 1 for every such statement, including one that
// matched nothing at all: read directly it says "1 row changed"
// whatever happened. The Count shape is the one AFFIRMATIVE affected-rows
// answer in the contract: `rowCount` counts RESULT rows (harbor
// derives it from data.length), and a mutation without RETURNING
// legitimately answers an empty result set whatever it matched — so a
// bare `rowCount: 0` is "the adapter did not say", never "zero rows
// were affected". The instance write paths (save/destroy/restore)
// treat only an affirmed 0 as proof the row is gone; a truthless
// adapter keeps its statements un-judged.
//
// Harbor sends integers past 2^53-1 as strings so they survive JSON;
// a bulk mutation is nowhere near that, but coerce rather than hand
// back a count whose type depends on its magnitude.
function affirmedRowCount(res) {
  const cols = res?.columns;
  const data = res?.data;
  if (Array.isArray(cols) && cols.length === 1 && Array.isArray(data) && data.length === 1) {
    const name = String(cols[0]?.name ?? cols[0] ?? '');
    if (name.toLowerCase() === 'count') {
      const n = data[0]?.[0];
      if (typeof n === 'number') return n;
      if (typeof n === 'bigint' || typeof n === 'string') return Number(n);
    }
  }
  return null;
}

function affectedRows(res) {
  const affirmed = affirmedRowCount(res);
  if (affirmed !== null) return affirmed;
  return res?.rowCount ?? res?.rows ?? null;
}

// An instance write whose WHERE targeted the snapshot pk affirmed
// ZERO rows: the row is GONE — deleted, or re-keyed by someone else —
// not "no change". The instance is stale; it stops claiming a
// persisted state the database revoked.
function staleRowError(def, api, pk, identity) {
  return new SchemaError([{
    field: pk,
    error: 'stale',
    message: 'schema: ' + api + ' on ' + (def.name || 'model') + ' ' + pk + '=' + String(identity) +
      ' matched no row — the row no longer exists (stale instance); _persisted is now false',
  }], def.name, def.kind);
}

// DuckDB's UPDATE and DELETE take a WHERE and nothing else — there is
// no `DELETE ... LIMIT`, and the parser refuses one. These clauses are
// assembled for a SELECT and were dropped on the way here, so a caller
// who scoped a bulk mutation to one row mutated every matching row
// instead. Refuse rather than widen: a scope the statement cannot
// honor is an error, never a silently wider write.
function assertWhereOnly(rel, method) {
  const ignored = [];
  if (rel._limit != null) ignored.push('limit');
  if (rel._offset != null) ignored.push('offset');
  if (rel._order != null) ignored.push('order');
  if (!ignored.length) return;
  throw new Error(
    `${method}() cannot honor ${ignored.join(', ')} — DuckDB's UPDATE and DELETE accept only a WHERE. ` +
    `Narrow the condition, or read the rows first and mutate them by primary key.`);
}

function txHandle(adapter) {
  const store = txStore(adapter);
  return store ? store.handle : null;
}

async function adoptTransaction(adapter, handle, fn) {
  const als = await txALSGet();
  const store = { adapter, handle, after: [] };
  // Copy-on-run, as transaction does: other adapters' ambient
  // contexts stay visible; only this adapter's slot is bound.
  const next = new Map(als.getStore() || []);
  next.set(adapter, store);
  return als.run(next, () => fn(async (outcome) => {
    // The caller settles AFTER its COMMIT/ROLLBACK landed, so the
    // transaction is over: unbind this adapter's ambient slot before
    // any hook runs. A hook's own writes then go to autocommit and
    // settle immediately — identical semantics to the native path,
    // where the flush runs after als.run exits. A slot left bound
    // would route hook statements to the dead handle and let the
    // flush queue extend itself without bound.
    next.delete(adapter);
    if (outcome === 'afterRollback') rollbackTxState(store);
    return flushTxHooks(store, outcome);
  }));
}

// Flush the queued commit/rollback callbacks against a SNAPSHOT of
// the queue. Both transaction paths unbind the adapter's ambient slot
// before flushing, so an entry can no longer arrive mid-flush — a
// hook's own writes ran post-commit and settle immediately as
// autocommit statements — and the snapshot keeps the flush finite
// against any store something still appends to. Dedupe by instance: a
// row saved twice in one transaction gets one callback. One hook
// throwing must not cancel the rest: every queued callback runs, and
// the failures rethrow after the flush (several aggregate).
async function flushTxHooks(store, hookName) {
  const entries = store.after.slice();
  const seen = new Set();
  const failures = [];
  for (const entry of entries) {
    if (seen.has(entry.inst)) continue;
    seen.add(entry.inst);
    try {
      await runHook(entry.def, entry.inst, hookName);
    } catch (e) {
      failures.push(e);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures,
      'schema: ' + failures.length + ' ' + hookName + ' hooks threw');
  }
}

// The instance state a ROLLBACK must put back, captured by each write
// operation BEFORE it changes anything and carried on its queue entry.
function txRestorePoint(norm, inst) {
  return {
    persisted: inst._persisted,
    snapshot: inst._snapshot,
    pkValue: inst[norm.primaryKey],
  };
}

// ROLLBACK revoked every row the transaction wrote, so each enqueued
// instance goes back to the state captured when its FIRST in-tx write
// began (entries are chronological; the first wins the dedupe) —
// afterRollback hooks observe what the database now holds, never a
// revoked id or snapshot. An instance created inside the transaction
// returns to _persisted=false with no pk, so a post-rollback save()
// takes the INSERT arm and re-creates: Active-Record semantics.
function rollbackTxState(store) {
  const seen = new Set();
  for (const entry of store.after) {
    if (seen.has(entry.inst) || !entry.restore) continue;
    seen.add(entry.inst);
    const { def, inst, restore } = entry;
    inst._persisted = restore.persisted;
    inst._snapshot = restore.snapshot;
    const pk = def._normalize().primaryKey;
    if (restore.pkValue === undefined) {
      if (pk in inst) delete inst[pk];
    } else {
      inst[pk] = restore.pkValue;
    }
  }
}

// Append `extra` at the first free `cause` link of `err`'s chain (the
// codebase's error idiom), bounded against pathological chains. A
// non-Error throw carries no cause slot; the original still surfaces.
function attachCause(err, extra) {
  let node = err;
  for (let hops = 0; hops < 16 && node instanceof Error; hops++) {
    if (node.cause === undefined) {
      try { node.cause = extra; } catch {}
      return;
    }
    node = node.cause;
  }
}

// Queue an instance's commit-time hooks on the ambient transaction
// for ITS adapter, with the pre-write state a rollback restores.
// Returns false when no transaction is open — the caller fires
// afterCommit immediately (outside a transaction, the statement is
// the commit).
function enqueueTxHook(def, inst, restorePoint) {
  const tx = txStore(adapterFor(def));
  if (!tx) return false;
  tx.after.push({ def, inst, restore: restorePoint });
  return true;
}

// ── constraint-violation translation ──────────────────────────────────
//
// Errors that are recognizably DB constraint violations become
// SchemaErrors, so a save! tripping a UNIQUE index fails the same
// structured way a validator failure does. Unrecognized errors
// propagate untouched; the original rides as `.cause`. Recognition is
// message-pattern based (DuckDB shapes). Deliberately absent:
// pre-write uniqueness SELECTs — they race; the DB constraint is the
// check.
function translateDBError(e, def) {
  const msg = (e && e.message) || '';
  // The model's mapping, when there is one — a NOT NULL failure names
  // the COLUMN, and with `{column:}` that is not the field name.
  // Normalization can itself throw (this runs inside a catch), so a
  // model that cannot normalize simply reports the derived name.
  let norm = null;
  try { norm = def && def.kind === 'model' ? def._normalize() : null; } catch { norm = null; }
  const issue = constraintIssue(msg, norm);
  if (!issue) return e;
  const err = new SchemaError([issue], def ? def.name : null, def ? def.kind : null);
  err.cause = e;
  return err;
}

// A name out of a database error message: a column when the model
// knows it as one, and the plain derivation otherwise — the unique
// pattern yields an INDEX name, which no mapping covers.
function constraintName(raw, norm) {
  return norm ? fieldFor(norm, raw) : camelCase(raw);
}

function constraintIssue(msg, norm) {
  const nameOf = (raw) => constraintName(raw, norm);
  let m;
  m = msg.match(/[Dd]uplicate key "([A-Za-z0-9_]+):[^"]*" violates (?:unique|primary key) constraint/);
  if (m || /violates unique constraint/i.test(msg)) {
    const field = m ? nameOf(m[1]) : '';
    return { field, error: 'unique', message: (field || 'value') + ' already taken' };
  }
  m = msg.match(/NOT NULL constraint failed:\s*(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)/i);
  if (m) {
    const field = nameOf(m[1]);
    return { field, error: 'required', message: field + ' is required' };
  }
  if (/[Vv]iolates foreign key constraint/.test(msg)) {
    m = msg.match(/"([A-Za-z0-9_]+):[^"]*"/);
    const field = m ? nameOf(m[1]) : '';
    return { field, error: 'reference', message: (field || 'reference') + ' refers to a missing or still-referenced record' };
  }
  if (/CHECK constraint failed/i.test(msg)) {
    return { field: '', error: 'check', message: msg };
  }
  return null;
}

// ── the query builder ─────────────────────────────────────────────────

// Run a scope body with `this` bound to a query builder (fresh when
// invoked from a model static; the existing builder when chained). A
// body that returns something other than the builder falls back to
// the builder so chains never break on a stray trailing expression.
function invokeScope(def, builder, fn, args) {
  const q = builder || new SchemaQuery(def);
  const out = fn.apply(q, args);
  return out instanceof SchemaQuery ? out : q;
}

class SchemaQuery {
  constructor(def) {
    this._def = def;
    this._clauses = [];
    this._params = [];
    this._limit = null;
    this._offset = null;
    this._order = null;
    this._includes = [];
    this._unscoped = false;
    this._defaultScopeApplied = false;
    // Soft-delete filter mode: 'live' (default), 'all' (.withDeleted),
    // 'deleted' (.onlyDeleted).
    this._deleted = 'live';
    // Per-model scopes install as own methods so chains compose in
    // any order. Builder method names win on collision (normalize
    // rejects those names anyway).
    const scopes = def._normalize().scopes;
    if (scopes && scopes.size) {
      for (const [sname, sfn] of scopes) {
        if (!(sname in this)) {
          Object.defineProperty(this, sname, {
            enumerable: false, configurable: true,
            value: (...args) => invokeScope(def, this, sfn, args),
          });
        }
      }
    }
  }
  where(cond, ...params) {
    // The string form is the O4-trusted overload: caller-authored SQL,
    // passed through with its parameters. Trust covers the SQL's
    // content, not its composition: clauses join with AND, so a
    // caller's top-level OR would regroup under SQL precedence and
    // swallow every clause beside it — the soft-delete filter and
    // @defaultScope included. Parentheses keep each clause atomic.
    if (typeof cond === 'string') {
      this._clauses.push('(' + cond + ')');
      this._params.push(...params);
    } else if (cond && typeof cond === 'object') {
      const norm = this._def._normalize();
      for (const [k, v] of Object.entries(cond)) {
        const column = columnFor(norm, k);
        const col = callerColumn(norm, k, norm.columns, 'where() key');
        // Either spelling reaches the field record, the same way either
        // spelling reaches the column.
        const field = norm.fields.get(fieldFor(norm, column));
        const opaque = !!field &&
          (field.array === true || field.typeName === 'json' || field.typeName === 'any');
        if (v === undefined) {
          // An undefined value is an absent parameter, not a filter —
          // rendering IS NULL for it turns `where(title: params.title)`
          // with a missing param into a silent empty result.
          throw new Error("schema: where() value for '" + k + "' is undefined — an absent " +
            'value cannot filter; pass null to match IS NULL, or omit the key');
        }
        if (v === null) {
          this._clauses.push(col + ' IS NULL');
        } else if (Array.isArray(v)) {
          // An empty IN list matches nothing — `IN ()` is a syntax
          // error at the database, so emit a constant-false predicate.
          if (v.length === 0) {
            this._clauses.push('1 = 0');
          } else {
            this._clauses.push(col + ' IN (' + v.map(() => '?').join(', ') + ')');
            this._params.push(...v);
          }
        } else if (v instanceof RegExp) {
          // A regex value is a real regex match — DuckDB's
          // regexp_matches, never a lossy LIKE translation. The JS
          // flags that change match semantics carry over (i, m, s);
          // the mechanics flags (g, y, u, d) do not apply to a
          // boolean match and drop.
          const options = [...v.flags].filter((f) => 'ims'.includes(f)).join('');
          if (options !== '') {
            this._clauses.push('regexp_matches(' + col + ', ?, ?)');
            this._params.push(v.source, options);
          } else {
            this._clauses.push('regexp_matches(' + col + ', ?)');
            this._params.push(v.source);
          }
        } else if (isPlainObject(v) && !opaque) {
          const ops = Object.keys(v);
          if (ops.length === 0) {
            throw new Error("schema: where() on '" + k + "' got an empty operator object — " +
              'name an operator (' + [...WHERE_OPS.keys()].join(', ') + ') or pass a value');
          }
          // Several operators on one field read as AND, which is what
          // {gte, lt} means to anyone writing a range.
          for (const name of ops) {
            const op = WHERE_OPS.get(name);
            if (!op) {
              throw new Error("schema: unknown where() operator '" + name + "' on '" + k +
                "' — known operators: " + [...WHERE_OPS.keys()].join(', '));
            }
            this._clauses.push(op(col, v[name], this._params, k));
          }
        } else {
          this._clauses.push(col + ' = ?');
          this._params.push(v);
        }
      }
    } else {
      // Anything else — a number, null, a boolean — is a dropped
      // filter, and a dropped filter widens whatever runs next:
      // `where(user.id).deleteAll()` (missing the `{id: …}` wrapper)
      // would delete every row. Loud, like every other bad argument.
      throw new Error('schema: where() takes a conditions object or SQL text with params; got ' +
        (cond === null ? 'null' : typeof cond) +
        (typeof cond === 'number' || typeof cond === 'bigint'
          ? ' — a primary-key lookup is find(pk), or spell the filter {id: …}' : ''));
    }
    return this;
  }
  limit(n) { this._limit = pageInt(n, 'limit'); return this; }
  offset(n) { this._offset = pageInt(n, 'offset'); return this; }
  order(spec) {
    // The string form is the O4-trusted overload: caller-authored SQL,
    // spliced verbatim. The structured forms — `{createdAt: 'desc'}`, or
    // an array of them when one object's key order will not do — resolve
    // every identifier against the model's columns and quote it, so a
    // sort key taken from a request never reaches ORDER BY unchecked.
    if (typeof spec === 'string') {
      this._order = spec;
      return this;
    }
    const entries = Array.isArray(spec) ? spec : [spec];
    const norm = this._def._normalize();
    const parts = [];
    for (const entry of entries) {
      if (!isPlainObject(entry)) {
        throw new Error('schema: order(spec) accepts a trusted SQL string, a {field: direction} ' +
          'object, or an array of them; got ' + (entry === null ? 'null' : typeof entry));
      }
      for (const [k, dir] of Object.entries(entry)) {
        parts.push(callerColumn(norm, k, norm.columns, 'order() key') +
          ' ' + orderDir(dir, k));
      }
    }
    if (parts.length === 0) {
      throw new Error('schema: order(spec) named no columns to sort by');
    }
    this._order = parts.join(', ');
    return this;
  }
  orderBy(spec) { return this.order(spec); }
  includes(...specs) {
    this._includes.push(...normalizeIncludes(specs));
    return this;
  }
  withDeleted() { this._deleted = 'all'; return this; }
  onlyDeleted() { this._deleted = 'deleted'; return this; }
  unscoped() { this._unscoped = true; return this; }
  // @defaultScope applies lazily at terminal time so .unscoped()
  // works anywhere in the chain and the default's clauses never
  // double-apply.
  _applyDefaultScope() {
    if (this._unscoped || this._defaultScopeApplied) return;
    this._defaultScopeApplied = true;
    const fn = this._def._normalize().defaultScope;
    if (fn) fn.call(this);
  }
  _whereParts(norm) {
    const where = [...this._clauses];
    if (norm.softDelete) {
      if (this._deleted === 'live') where.push('"deleted_at" IS NULL');
      else if (this._deleted === 'deleted') where.push('"deleted_at" IS NOT NULL');
    }
    return where;
  }
  _buildSQL() {
    const n = this._def._normalize();
    const parts = ['SELECT * FROM ' + quoteIdent(n.tableName, null, 'table')];
    const where = this._whereParts(n);
    if (where.length) parts.push('WHERE ' + where.join(' AND '));
    if (this._order) parts.push('ORDER BY ' + this._order);
    if (this._limit != null) parts.push('LIMIT ' + this._limit);
    if (this._offset != null) parts.push('OFFSET ' + this._offset);
    return parts.join(' ');
  }
  async all() {
    this._applyDefaultScope();
    if (this._includes.length) validateIncludes(this._def, this._includes);
    const sql = this._buildSQL();
    const res = await runSQL(this._def, sql, this._params);
    const instances = (res.data || []).map((row) => this._def._hydrate(res.columns, row));
    // Eager loading: batched second queries that fill the relation
    // memos; never changes the root result set.
    if (this._includes.length && instances.length) {
      await preload(this._def, instances, this._includes);
    }
    return instances;
  }
  async first() {
    this._limit = 1;
    const arr = await this.all();
    return arr[0] || null;
  }
  async count() {
    this._applyDefaultScope();
    const n = this._def._normalize();
    const parts = ['SELECT COUNT(*) FROM ' + quoteIdent(n.tableName, null, 'table')];
    const where = this._whereParts(n);
    if (where.length) parts.push('WHERE ' + where.join(' AND '));
    const res = await runSQL(this._def, parts.join(' '), this._params);
    return res.data?.[0]?.[0] || 0;
  }
  // One UPDATE for every matching row — bypasses validation and
  // per-instance hooks (the bulk path).
  async updateAll(values) {
    assertWhereOnly(this, 'updateAll');
    this._applyDefaultScope();
    const n = this._def._normalize();
    const keys = values && typeof values === 'object' ? Object.keys(values) : [];
    // An empty bulk update is a no-op: zero affected rows and no
    // adapter call. It must not synthesize an UPDATE containing only
    // the managed timestamp column.
    if (!keys.length) return 0;
    const sets = [];
    const params = [];
    for (const k of keys) {
      const column = columnFor(n, k);
      const field = n.fields.get(fieldFor(n, column));
      const quoted = callerColumn(n, k, n.callerWritableColumns, 'updateAll() key');
      sets.push(quoted + ' = ?');
      params.push(serialize(values[k], field));
    }
    if (n.timestamps) {
      sets.push('"updated_at" = ?');
      params.push(new Date()); // a real Date — the adapter encodes it at the wire
    }
    const where = this._whereParts(n);
    let sql = 'UPDATE ' + quoteIdent(n.tableName, null, 'table') + ' SET ' + sets.join(', ');
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const res = await runSQL(this._def, sql, [...params, ...this._params]);
    return affectedRows(res);
  }
  // One statement for every matching row: soft-delete aware (UPDATE
  // deleted_at on a @softDelete model, real DELETE otherwise);
  // bypasses per-instance hooks (the bulk path).
  async deleteAll() {
    assertWhereOnly(this, 'deleteAll');
    this._applyDefaultScope();
    const n = this._def._normalize();
    const where = this._whereParts(n);
    let sql, params;
    if (n.softDelete && this._deleted === 'live') {
      sql = 'UPDATE ' + quoteIdent(n.tableName, null, 'table') + ' SET "deleted_at" = ?';
      params = [new Date(), ...this._params]; // a real Date — the adapter encodes it at the wire
    } else {
      sql = 'DELETE FROM ' + quoteIdent(n.tableName, null, 'table');
      params = this._params;
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const res = await runSQL(this._def, sql, params);
    return affectedRows(res);
  }
}

// ── eager loading ─────────────────────────────────────────────────────

// Normalize .includes arguments into [{name, children}] trees:
// strings, symbols, arrays, and nested maps to any depth.
function normalizeIncludes(specs) {
  const out = [];
  for (const s of specs) {
    if (s == null) continue;
    if (typeof s === 'symbol') out.push({ name: Symbol.keyFor(s) || s.description, children: [] });
    else if (typeof s === 'string') out.push({ name: s, children: [] });
    else if (Array.isArray(s)) out.push(...normalizeIncludes(s));
    else if (typeof s === 'object') {
      for (const [k, v] of Object.entries(s)) {
        out.push({ name: k, children: normalizeIncludes([v]) });
      }
    }
  }
  return out;
}

function validateIncludes(def, specs) {
  const norm = def._normalize();
  for (const spec of specs) {
    const rel = norm.relations.get(spec.name);
    if (!rel) {
      throw new Error(
        "schema: includes('" + spec.name + "') — no such relation on " + (def.name || 'model') +
        '. Declared relations: ' + ([...norm.relations.keys()].join(', ') || '(none)'));
    }
    const target = SchemaRegistry.get(rel.target);
    if (!target) throw new Error('schema: unknown relation target "' + rel.target + '" from ' + (def.name || 'anon'));
    validateRelationTarget(def, rel, target);
    if (spec.children.length) validateIncludes(target, spec.children);
  }
}

function validateRelationTarget(def, rel, target) {
  const targetNorm = target._normalize();
  if (!(targetNorm.columns instanceof Set)) {
    throw new Error(
      'schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
      ' targets ' + rel.target + ', which is not a persisted :model');
  }
  if (rel.kind === 'belongsTo') {
    quoteIdent(targetNorm.primaryKeyColumn, targetNorm.columns, 'relation primary key');
  } else if (rel.through) {
    // Both keys live on the join model, and resolving them is the
    // whole check — the target only has to have a primary key to be
    // looked up by.
    quoteIdent(targetNorm.primaryKeyColumn, targetNorm.columns, 'relation primary key');
    throughKeys(def, rel, joinModel(def, rel));
  } else {
    quoteIdent(rel.foreignKey, targetNorm.columns, 'relation key');
  }
  return targetNorm;
}

function joinModel(def, rel) {
  const join = SchemaRegistry.get(rel.through);
  if (!join) {
    throw new Error('schema: unknown join model "' + rel.through + '" for relation ' +
      (def.name || 'anon') + '.' + rel.accessor);
  }
  return join;
}

// The join-model half of a `through` read: owner identities in, one
// `[ownerIdentity, targetIdentity]` pair per join row out. Deliberately
// NOT a JOIN — the same two-query shape every other relation uses, so
// no row duplicates and no join-table columns leak into target
// instances.
async function throughPairs(def, rel, join, keys, identities) {
  if (!identities.length) return [];
  // The join model's own read filters — @defaultScope and @softDelete
  // — apply here exactly as deleteAll applies them to the unlink:
  // both halves of a set() diff must see the same rows, and a scoped
  // join model scopes its reads wherever they are issued.
  const scoped = new SchemaQuery(join);
  scoped._applyDefaultScope();
  const where = [
    quoteIdent(keys.ownerKey, keys.joinNorm.columns, 'through owner key') +
      ' IN (' + identities.map(() => '?').join(', ') + ')',
    ...scoped._whereParts(keys.joinNorm),
  ];
  const sql = 'SELECT ' + quoteIdent(keys.ownerKey, keys.joinNorm.columns, 'through owner key') +
    ', ' + quoteIdent(keys.targetKey, keys.joinNorm.columns, 'through target key') +
    ' FROM ' + quoteIdent(keys.joinNorm.tableName, null, 'table') +
    ' WHERE ' + where.join(' AND ');
  const res = await runSQL(join, sql, [...identities, ...scoped._params]);
  return (res.data || []).filter((row) => row[1] != null);
}

// Batched preload: one query per relation per nesting level (WHERE fk
// IN (…)), never JOINs — no row duplication, uniform across relation
// kinds. Results land in the relation memo, so accessors resolve from
// cache with no query.
async function preload(def, instances, specs) {
  if (!instances.length || !specs.length) return;
  const norm = def._normalize();
  for (const spec of specs) {
    const rel = norm.relations.get(spec.name);
    if (!rel) {
      throw new Error(
        "schema: includes('" + spec.name + "') — no such relation on " + (def.name || 'model') +
        '. Declared relations: ' + ([...norm.relations.keys()].join(', ') || '(none)'));
    }
    const target = SchemaRegistry.get(rel.target);
    if (!target) throw new Error('schema: unknown relation target "' + rel.target + '" from ' + (def.name || 'anon'));
    const targetNorm = validateRelationTarget(def, rel, target);
    const children = [];
    // Identity-dedup for the recursion below. The belongsTo and
    // through paths can hand many owners the same child instance —
    // Array.includes made that a scan per row (O(owners x targets));
    // the hasMany path pushes without checking because its grouping
    // already guarantees each row appears once.
    const seen = new Set();
    const collect = (r) => { if (!seen.has(r)) { seen.add(r); children.push(r); } };
    // Capture the cache request before any await. Reload/absorption bumps
    // the generation, and mutable FKs can change identity independently;
    // either change makes this preload result ineligible for memoization.
    const requests = new Map();
    for (const inst of instances) {
      requests.set(inst, {
        generation: inst._relGeneration,
        identity: relationIdentity(def, inst, rel),
      });
    }
    const current = (inst, request) =>
      inst._relGeneration === request.generation &&
      sameValue(relationIdentity(def, inst, rel), request.identity);
    if (rel.kind === 'belongsTo') {
      const ids = [...new Set(
        [...requests.values()].map((request) => request.identity).filter((v) => v != null),
      )];
      const rows = ids.length ? await target.findMany(ids) : [];
      const pk = targetNorm.primaryKey;
      const byId = new Map(rows.map((r) => [r[pk], r]));
      for (const inst of instances) {
        const request = requests.get(inst);
        if (!current(inst, request)) continue;
        const v = request.identity != null ? (byId.get(request.identity) ?? null) : null;
        relMemoSet(inst, spec.name, request.identity, v);
        if (v) collect(v);
      }
    } else if (rel.through) {
      // Three steps, all set-based: the join rows for every owner at
      // once, then the distinct targets in one findMany, then group.
      const join = joinModel(def, rel);
      const keys = throughKeys(def, rel, join);
      const ids = [...new Set([...requests.values()].map((r) => r.identity).filter((v) => v != null))];
      const pairs = await throughPairs(def, rel, join, keys, ids);
      const targetIds = [...new Set(pairs.map((p) => p[1]))];
      const rows = targetIds.length ? await target.findMany(targetIds) : [];
      const byId = new Map(rows.map((r) => [r[targetNorm.primaryKey], r]));
      const groups = new Map();
      for (const [ownerId, targetId] of pairs) {
        const r = byId.get(targetId);
        if (!r) continue; // a dangling join row names no target
        if (!groups.has(ownerId)) groups.set(ownerId, []);
        groups.get(ownerId).push(r);
        collect(r);
      }
      for (const inst of instances) {
        const request = requests.get(inst);
        if (!current(inst, request)) continue;
        const g = groups.get(request.identity) || [];
        relMemoSet(inst, spec.name, request.identity,
          rel.kind === 'hasOne' ? (g[0] ?? null) : g);
      }
    } else {
      const fkCamel = fieldFor(targetNorm, rel.foreignKey);
      const ids = [...new Set([...requests.values()].map((request) => request.identity))];
      let rows = [];
      if (ids.length) {
        rows = await new SchemaQuery(target)
          .where(quoteIdent(rel.foreignKey, targetNorm.columns, 'relation key') + ' IN (' + ids.map(() => '?').join(', ') + ')', ...ids)
          .all();
      }
      const groups = new Map();
      for (const r of rows) {
        const k = r[fkCamel];
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
        children.push(r);
      }
      for (const inst of instances) {
        const request = requests.get(inst);
        if (!current(inst, request)) continue;
        const g = groups.get(request.identity) || [];
        relMemoSet(
          inst, spec.name, request.identity,
          rel.kind === 'hasOne' ? (g[0] ?? null) : g);
      }
    }
    if (spec.children.length) await preload(target, children, spec.children);
  }
}

// ── writing a `through` relation ──────────────────────────────────────
//
// The link is a ROW, not a column, so linking and unlinking are the
// join model's INSERTs and DELETEs — and they go THROUGH the join
// model rather than around it: `insertMany` validates every row and
// respects the join's own fields, defaults, and `@times`, and
// `deleteAll` respects its `@softDelete`. A join model with required
// columns of its own is therefore usable: pass them as `attrs`.
//
// Hooks are skipped, which is `insertMany`'s documented bulk-path
// contract; a join row needing per-row hooks is a model the caller
// should create directly.

// The pieces every write needs: the join model, its two columns, the
// owner's identity, and the target identities being named.
function throughPlan(def, inst, rel, acc, items, api) {
  const join = joinModel(def, rel);
  const keys = throughKeys(def, rel, join);
  const identity = persistedIdentity(def, inst, api);
  const list = items == null ? [] : (Array.isArray(items) ? items : [items]);
  const targetNorm = SchemaRegistry.get(rel.target)?._normalize();
  const targetIds = list.map((item, i) => {
    // An instance names itself; a bare value is already an identity.
    if (item !== null && typeof item === 'object') {
      const pk = targetNorm ? targetNorm.primaryKey : 'id';
      const v = item[pk];
      if (v == null) {
        throw new Error('schema: ' + api + ' received an unsaved ' + rel.target +
          ' at [' + i + '] — it has no ' + pk + ' to link to; save it first');
      }
      return v;
    }
    if (item == null) {
      throw new Error('schema: ' + api + ' received ' + String(item) + ' at [' + i + ']');
    }
    return item;
  });
  return { join, keys, identity, targetIds: [...new Set(targetIds)] };
}

// The target identities this owner is already linked to.
async function throughLinked(def, rel, plan) {
  const pairs = await throughPairs(def, rel, plan.join, plan.keys, [plan.identity]);
  return new Set(pairs.map((p) => p[1]));
}

// Every write invalidates the memo: the relation's value changed, and
// the accessor must not answer from a cache that predates it. The
// write landed in the JOIN TABLE, so every relation reading through
// the same join model answers from the changed rows — sibling
// accessors' memo entries clear along with the writer's own.
function throughInvalidate(def, inst, rel, acc) {
  inst._relGeneration++;
  if (!inst._relMemo) return;
  inst._relMemo.delete(acc);
  for (const [sibling, r] of def._normalize().relations) {
    if (r.through === rel.through) inst._relMemo.delete(sibling);
  }
}

// Linking something already linked is a no-op rather than a second
// row — duplicate join rows would show up as duplicate targets on the
// read side, which nothing else in the relation surface produces.
//
// The check-then-insert has an await between its halves, so two
// concurrent adds of one tuple can both read "not linked". When the
// join table carries a unique pair index (the deployment-side
// recommendation), the loser's INSERT draws a unique violation that
// MEANS "already linked": the loop below re-reads and retries only
// what is still missing, so the add reports the rows it actually
// wrote — usually 0. Without that index the race stands (two rows
// land); closing it is a DDL decision the deployment owns, not
// something a JS-side guard can reach across processes.
async function throughAdd(def, inst, rel, acc, items, attrs) {
  const api = 'add' + acc[0].toUpperCase() + acc.slice(1) + '()';
  const plan = throughPlan(def, inst, rel, acc, items, api);
  if (!plan.targetIds.length) return 0;
  const linked = await throughLinked(def, rel, plan);
  const fresh = plan.targetIds.filter((id) => !linked.has(id));
  if (!fresh.length) return 0;
  const joinNorm = plan.keys.joinNorm;
  const ownerField = fieldFor(joinNorm, plan.keys.ownerKey);
  const targetField = fieldFor(joinNorm, plan.keys.targetKey);
  if (attrs != null && !isPlainObject(attrs)) {
    throw new Error('schema: ' + api + ' attrs must be a plain object of ' + rel.through +
      ' columns; got ' + (attrs === null ? 'null' : typeof attrs));
  }
  const joinRow = (id) => ({
    ...(attrs || {}),
    [ownerField]: plan.identity,
    [targetField]: id,
  });
  let added = 0;
  let toLink = fresh;
  try {
    while (toLink.length) {
      try {
        await plan.join.insertMany(toLink.map(joinRow));
        added += toLink.length;
        break;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // insertMany is one statement, so nothing landed. Re-read: a
        // shrunken missing set proves the violation was this race (the
        // tuples now exist, which is what the caller asked for); no
        // shrink means something else tripped a unique constraint (an
        // attrs column, say) — that violation rethrows untouched.
        const nowLinked = await throughLinked(def, rel, plan);
        const missing = toLink.filter((id) => !nowLinked.has(id));
        if (missing.length === toLink.length) throw e;
        toLink = missing;
      }
    }
  } finally {
    // Attempted SQL always invalidates: even a raced no-op just
    // learned the join rows changed under it.
    throughInvalidate(def, inst, rel, acc);
  }
  return added;
}

// A translated DB unique violation (constraintIssue's 'unique'
// classification) — the shape addX's race handling keys on.
function isUniqueViolation(e) {
  return e instanceof SchemaError && Array.isArray(e.issues) &&
    e.issues.some((issue) => issue.error === 'unique');
}

async function throughRemove(def, inst, rel, acc, items) {
  const api = 'remove' + acc[0].toUpperCase() + acc.slice(1) + '()';
  const plan = throughPlan(def, inst, rel, acc, items, api);
  if (!plan.targetIds.length) return 0;
  const removed = await throughUnlink(def, rel, plan, plan.targetIds);
  throughInvalidate(def, inst, rel, acc);
  return removed;
}

// Make the link set exactly this. Both halves are computed from one
// read of the current set, so `set` costs the same round trips as an
// add and a remove that already knew what to do. The fresh rows
// validate BEFORE the unlink DELETE — a set() whose insert half
// cannot succeed must not have destroyed the links it was replacing —
// and the memo invalidates whenever either half was ATTEMPTED (a
// failed insert after a landed delete still changed the link set, and
// an adapter whose rowCount is untruthful for mutations must not talk
// the accessor into keeping a stale answer).
async function throughSet(def, inst, rel, acc, items, attrs) {
  const api = 'set' + acc[0].toUpperCase() + acc.slice(1) + '()';
  if (attrs != null && !isPlainObject(attrs)) {
    throw new Error('schema: ' + api + ' attrs must be a plain object of ' + rel.through +
      ' columns; got ' + (attrs === null ? 'null' : typeof attrs));
  }
  const plan = throughPlan(def, inst, rel, acc, items, api);
  const linked = await throughLinked(def, rel, plan);
  const wanted = new Set(plan.targetIds);
  const stale = [...linked].filter((id) => !wanted.has(id));
  const fresh = plan.targetIds.filter((id) => !linked.has(id));
  const joinNorm = plan.keys.joinNorm;
  const freshRows = fresh.map((id) => ({
    ...(attrs || {}),
    [fieldFor(joinNorm, plan.keys.ownerKey)]: plan.identity,
    [fieldFor(joinNorm, plan.keys.targetKey)]: id,
  }));
  if (freshRows.length) await validateInsertRows(plan.join, freshRows);
  let removed = 0;
  try {
    if (stale.length) removed = await throughUnlink(def, rel, plan, stale);
    if (freshRows.length) await plan.join.insertMany(freshRows);
  } finally {
    if (stale.length || fresh.length) throughInvalidate(def, inst, rel, acc);
  }
  return { added: fresh.length, removed };
}

// Through the join model's own query builder, so a `@softDelete` join
// soft-deletes and a plain one really deletes — one rule, stated once,
// in `deleteAll`.
function throughUnlink(def, rel, plan, targetIds) {
  const { joinNorm, ownerKey, targetKey } = plan.keys;
  const where = quoteIdent(ownerKey, joinNorm.columns, 'through owner key') + ' = ?' +
    ' AND ' + quoteIdent(targetKey, joinNorm.columns, 'through target key') +
    ' IN (' + targetIds.map(() => '?').join(', ') + ')';
  return new SchemaQuery(plan.join).where(where, plan.identity, ...targetIds).deleteAll();
}

function relationIdentity(def, inst, rel) {
  if (rel.kind === 'belongsTo') return inst[fieldFor(def._normalize(), rel.foreignKey)];
  return persistedIdentity(def, inst, 'resolve relation ' + rel.accessor);
}

async function resolveRelation(def, rel, identity) {
  const target = SchemaRegistry.get(rel.target);
  if (!target) throw new Error('schema: unknown relation target "' + rel.target + '" from ' + (def.name || 'anon'));
  const targetNorm = validateRelationTarget(def, rel, target);
  if (rel.kind === 'belongsTo') {
    return identity != null ? await target.find(identity) : null;
  }
  if (rel.through) {
    const join = joinModel(def, rel);
    const keys = throughKeys(def, rel, join);
    const pairs = identity != null
      ? await throughPairs(def, rel, join, keys, [identity])
      : [];
    const targetIds = [...new Set(pairs.map((p) => p[1]))];
    const found = targetIds.length ? await target.findMany(targetIds) : [];
    // Pair order is the relation's one deterministic order, and the
    // eager path already answers in it — re-order the findMany result
    // to match, so hasOne picks the same row on both paths.
    const byId = new Map(found.map((r) => [r[targetNorm.primaryKey], r]));
    const ordered = [];
    for (const id of targetIds) {
      const r = byId.get(id);
      if (r) ordered.push(r);
    }
    return rel.kind === 'hasOne' ? (ordered[0] ?? null) : ordered;
  }
  if (rel.kind === 'hasOne') {
    return await new SchemaQuery(target).where(quoteIdent(rel.foreignKey, targetNorm.columns, 'relation key') + ' = ?', identity).first();
  }
  if (rel.kind === 'hasMany') {
    return await new SchemaQuery(target).where(quoteIdent(rel.foreignKey, targetNorm.columns, 'relation key') + ' = ?', identity).all();
  }
  return null;
}

// ── save / destroy ────────────────────────────────────────────────────

async function runHook(def, inst, name) {
  const fn = def._normalize().hooks.get(name);
  if (fn) await fn.call(inst);
}

// After a successful save/destroy/restore/upsert: queue afterCommit/
// afterRollback on the ambient transaction (with the pre-write state
// a rollback restores), or fire afterCommit immediately when no
// transaction is open. Only models declaring one of the two hooks pay
// any cost here — which also scopes rollback state restoration to
// exactly the instances with an observer.
async function settleTxHooks(def, inst, restorePoint) {
  const hooks = def._normalize().hooks;
  if (!hooks.has('afterCommit') && !hooks.has('afterRollback')) return;
  if (!enqueueTxHook(def, inst, restorePoint)) {
    await runHook(def, inst, 'afterCommit');
  }
}

async function save(def, inst) {
  // Re-entry guard: same-instance re-entry into save() — typically a
  // hook on this very instance calling save() on `this` — would race
  // the snapshot / savedChanges machinery and almost certainly loop.
  // Per-instance: independent instances save in parallel freely;
  // sequential saves on one instance work (finally clears the flag).
  if (inst._saving) {
    throw new Error(
      'schema: save() re-entered on the same ' + (def.name || 'instance') +
      '; a hook on this instance called save() while a save was already in flight.');
  }
  inst._saving = true;
  try {

  const norm = def._normalize();
  const isNew = !inst._persisted;
  const identity = isNew ? null : persistedIdentity(def, inst, 'save()');
  const restorePoint = txRestorePoint(norm, inst);

  await runHook(def, inst, 'beforeValidation');
  const validated = await def._runExistingAsync(inst, {
    materialize: false,
    materializeNested: true,
    derived: 'throw',
  });
  if (!validated.ok) {
    if (validated.thrown) throw validated.thrown;
    const src = validated.from || def;
    throw new SchemaError(validated.errors, src.name, src.kind);
  }
  // Existing-instance validation stages nested/enum normalization in a
  // separate working graph. Commit only after every field and
  // refinement succeeds, so a failed save leaves the instance intact.
  for (const [name] of norm.fields) {
    if (validated.value[name] !== inst[name]) inst[name] = validated.value[name];
  }
  await runHook(def, inst, 'afterValidation');

  await runHook(def, inst, 'beforeSave');
  if (isNew) await runHook(def, inst, 'beforeCreate');
  else       await runHook(def, inst, 'beforeUpdate');

  // savedChanges resets at the start of every save so it always
  // reflects the most recent write; afterCreate/afterUpdate/afterSave
  // read the just-completed diff. The prior diff is kept so a refused
  // UPDATE can put it back — the instance then reports the last save
  // that actually happened, exactly as _snapshot and _dirty do.
  const priorChanges = inst.savedChanges;
  inst.savedChanges = new Map();

  if (isNew) {
    // Checked after every before-hook ran — a hook is one more channel
    // that can set the pk, and both postures care which way it went.
    // A natural key is the caller's to supply and the INSERT's to
    // write; a surrogate is the runtime's, and a preset value would
    // arm the RETURNING check below to pass on a garbage response.
    if (norm.naturalKey) {
      if (inst[norm.primaryKey] == null) {
        throw missingPkError(def, 'save()', norm.primaryKey);
      }
    } else if (inst[norm.primaryKey] != null) {
      throw callerPkError(def, 'save()', norm.primaryKey);
    }
    const cols = [], placeholders = [], values = [];
    const writtenColumns = [];
    for (const [n, f] of norm.fields) {
      const v = inst[n];
      if (v == null) continue;
      cols.push(quoteIdent(norm.columnOf.get(n), norm.callerWritableColumns, 'insert column'));
      placeholders.push('?');
      values.push(serialize(v, f));
      writtenColumns.push([n, v]);
    }
    // belongsTo FKs live as camelCase properties on the instance.
    for (const [, rel] of norm.relations) {
      if (rel.kind !== 'belongsTo') continue;
      const fkCamel = fieldFor(norm, rel.foreignKey);
      const v = inst[fkCamel];
      if (v != null) {
        cols.push(quoteIdent(rel.foreignKey, norm.callerWritableColumns, 'insert column'));
        placeholders.push('?');
        values.push(v);
        writtenColumns.push([fkCamel, v]);
      }
    }
    // A row with no insertable values (every field optional or
    // defaulted, none supplied) is legal — it takes the table's
    // column defaults. Empty `(…) VALUES (…)` lists are a syntax
    // error, so the standard DEFAULT VALUES form emits instead.
    const sql = cols.length
      ? 'INSERT INTO ' + quoteIdent(norm.tableName, null, 'table') + ' (' + cols.join(', ') + ') VALUES (' + placeholders.join(', ') + ') RETURNING *'
      : 'INSERT INTO ' + quoteIdent(norm.tableName, null, 'table') + ' DEFAULT VALUES RETURNING *';
    const res = await runSQL(def, sql, values);
    if (res.data?.[0] && res.columns) {
      absorbRow(inst, res.columns, res.data[0], 'row absorption', norm);
    }
    // The RETURNING row must have produced the primary key — a
    // malformed adapter response would otherwise mark this instance
    // persisted with an undefined id, and a later save() would UPDATE
    // WHERE id = undefined. Reject naming the response shape instead.
    // (upsert is exempt by semantics: ON CONFLICT DO NOTHING
    // legitimately returns no row.)
    if (inst[norm.primaryKey] == null) {
      throw new Error(
        'schema: INSERT INTO "' + norm.tableName + '" produced no ' + norm.primaryKey +
        ' — the adapter\'s query() must answer {columns, data, rowCount} with the RETURNING row ' +
        '(Adapter Contract v2); got ' +
        (res && typeof res === 'object'
          ? '{columns: ' + (Array.isArray(res.columns) ? res.columns.length + ' cols' : typeof res.columns) +
            ', data: ' + (Array.isArray(res.data) ? res.data.length + ' rows' : typeof res.data) + '}'
          : String(res)));
    }
    // With the RETURNING columns (id, timestamps, FKs) on the
    // instance, !> eager-derived fields can see them — one firing, at
    // end of construction, mirroring the hydrate path. Snapshot
    // BEFORE flipping _persisted so a later save() can never observe
    // "_persisted = true, _snapshot = null" (which would fall through
    // to a full-row UPDATE).
    def._applyEagerDerived(inst);
    inst._snapshot = snapshot(norm, inst);
    inst._persisted = true;
    // INSERT records [null, newValue] per written column; @times
    // columns were assigned on this INSERT, so they join the diff.
    for (const [n, v] of writtenColumns) inst.savedChanges.set(n, [null, v]);
    if (norm.timestamps) {
      if (inst.createdAt != null) inst.savedChanges.set('createdAt', [null, inst.createdAt]);
      if (inst.updatedAt != null) inst.savedChanges.set('updatedAt', [null, inst.updatedAt]);
    }
  } else {
    // Column-targeted UPDATE: write only fields that changed since
    // hydrate / last save (snapshot comparison) or were explicitly
    // marked dirty (in-place mutations of object-valued fields, where
    // value identity cannot see the change). No-op saves issue NO
    // SQL. `nextSnap` builds from the values about to be written —
    // BEFORE the await — and installs only on success: capturing
    // after the await would let a concurrent mutation mark itself
    // clean without ever being persisted.
    const sets = [], values = [];
    const snap = inst._snapshot;
    const dirty = inst._dirty;
    const changes = inst.savedChanges;
    const dirtyVersions = new Map();
    let nextSnap = null;
    for (const [n, f] of norm.fields) {
      const cur = inst[n];
      const isDirty = dirty && dirty.has(n);
      const changed = !snap || !Object.prototype.hasOwnProperty.call(snap, n) || !snapshotEqual(snap[n], cur);
      if (!isDirty && !changed) continue;
      if (!nextSnap) nextSnap = Object.assign(Object.create(null), snap || {});
      const written = snapshotValue(cur);
      sets.push(quoteIdent(norm.columnOf.get(n), norm.callerWritableColumns, 'update column') + ' = ?');
      values.push(serialize(written, f));
      nextSnap[n] = written;
      const old = snap && Object.prototype.hasOwnProperty.call(snap, n) ? snap[n] : null;
      changes.set(n, [old, written]);
      if (isDirty) dirtyVersions.set(n, inst._dirtyVersions.get(n));
    }
    // belongsTo FK columns: same machinery; the SQL column name is
    // already snake_case and FKs are scalar IDs (no serialize).
    for (const [, rel] of norm.relations) {
      if (rel.kind !== 'belongsTo') continue;
      const fkCamel = fieldFor(norm, rel.foreignKey);
      const cur = inst[fkCamel];
      const isDirty = dirty && dirty.has(fkCamel);
      const changed = !snap || !Object.prototype.hasOwnProperty.call(snap, fkCamel) || !snapshotEqual(snap[fkCamel], cur);
      if (!isDirty && !changed) continue;
      if (!nextSnap) nextSnap = Object.assign(Object.create(null), snap || {});
      const written = snapshotValue(cur);
      sets.push(quoteIdent(rel.foreignKey, norm.callerWritableColumns, 'update column') + ' = ?');
      values.push(written);
      nextSnap[fkCamel] = written;
      const old = snap && Object.prototype.hasOwnProperty.call(snap, fkCamel) ? snap[fkCamel] : null;
      changes.set(fkCamel, [old, written]);
      if (isDirty) dirtyVersions.set(fkCamel, inst._dirtyVersions.get(fkCamel));
    }
    // @times: bump updated_at iff this UPDATE will actually emit
    // SQL — never on a no-op save. The column is not in _snapshot (it
    // is always overwritten on real writes, never diffed); declaring
    // updatedAt as a user field is rejected at normalize, so a
    // duplicate SET cannot arise.
    let priorUpdatedAt = null;
    let tsBumped = false;
    if (norm.timestamps && sets.length > 0) {
      const newTs = new Date(); // a real Date — the adapter encodes it at the wire
      const oldTs = inst.updatedAt != null ? inst.updatedAt : null;
      sets.push('"updated_at" = ?');
      values.push(newTs);
      inst.updatedAt = newTs;
      priorUpdatedAt = oldTs;
      tsBumped = true;
      changes.set('updatedAt', [oldTs, newTs]);
    }
    if (sets.length) {
      const pk = norm.primaryKeyColumn;
      values.push(identity);
      const sql = 'UPDATE ' + quoteIdent(norm.tableName, null, 'table') +
        ' SET ' + sets.join(', ') + ' WHERE ' +
        quoteIdent(pk, norm.columns, 'primary key') + ' = ?';
      let res;
      try {
        res = await runSQL(def, sql, values);
      } catch (e) {
        // The database refused the write, so nothing changed: the
        // reported diff and the managed timestamp go back to their
        // pre-attempt values, matching the untouched _snapshot/_dirty.
        inst.savedChanges = priorChanges;
        if (tsBumped) inst.updatedAt = priorUpdatedAt;
        throw e;
      }
      // An affirmed zero means the row is gone (the WHERE targets the
      // snapshot pk): same restoration as a refused write, plus
      // _persisted drops — the instance stops claiming a row the
      // database revoked. A later save() on it rejects the retained
      // pk as caller-supplied, exactly like any unsaved instance
      // carrying a surrogate id.
      if (affirmedRowCount(res) === 0) {
        inst.savedChanges = priorChanges;
        if (tsBumped) inst.updatedAt = priorUpdatedAt;
        inst._persisted = false;
        throw staleRowError(def, 'save()', norm.primaryKey, identity);
      }
      inst._snapshot = nextSnap;
      for (const [name, version] of dirtyVersions) {
        if (inst._dirtyVersions.get(name) === version) inst._dirty.delete(name);
      }
    }
  }

  if (isNew) await runHook(def, inst, 'afterCreate');
  else       await runHook(def, inst, 'afterUpdate');
  await runHook(def, inst, 'afterSave');
  await settleTxHooks(def, inst, restorePoint);
  return inst;

  } finally {
    inst._saving = false;
  }
}

// Temporal columns hold instants; the DECLARED type (date/datetime)
// decides coercion, never the value's shape. Harbor already decodes
// temporals to real `Date`s at the wire seam — those pass through
// untouched, no double conversion — but adapters that answer strings
// (ISO-8601, DuckDB/SQLite 'YYYY-MM-DD HH:MM:SS[.fff]') or
// epoch-millisecond numbers would otherwise hydrate a declared
// temporal as raw wire text whose meaning shifts by adapter.
// Interpretation MATCHES the harbor codec (decodeTemporal): a naive
// wall-clock string is UTC, a zoned string is the instant it names, a
// bare date is UTC midnight — one row means one instant on every
// adapter. A value that cannot be read as an instant is adapter
// breakage, not data: host-API normalization does not decide
// validity, so it rejects naming the column and the value instead of
// riding through as-is.
function coerceTemporal(value, typeName, column, operation) {
  if (value == null || value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value === 'string') {
    const decoded = decodeTemporal(value, /[T ]/.test(value) ? 'utc' : 'civil');
    if (decoded instanceof Date) return decoded;
  }
  throw new Error(
    'schema: ' + operation + " adapter invariant — column '" + column + "' is declared " +
    typeName + ' but the adapter delivered ' +
    (typeof value === 'string' ? 'unparseable ' + JSON.stringify(value) : String(value) + ' (' + typeof value + ')') +
    '; temporal columns arrive as Date, ISO-8601 / SQL timestamp text, or epoch milliseconds');
}

// Validate one adapter row before any caller reads or absorbs it.
// Column names canonicalize through the same snake→camel boundary as
// instances; two spellings for one canonical key would otherwise let
// the later value silently overwrite an identity or conflict target.
function validateAdapterRow(columns, row, operation, norm) {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(row) ||
      row.length !== columns.length) {
    throw new Error(
      'schema: ' + operation + ' adapter invariant — expected named columns and one matching row');
  }
  const indexes = new Map();
  const sourceOf = new Map();
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (!column || typeof column.name !== 'string' || !column.name.length) {
      throw new Error(
        'schema: ' + operation + ' adapter invariant — every column needs a non-empty string name');
    }
    const canonical = norm ? fieldFor(norm, column.name) : camelCase(column.name);
    if (indexes.has(canonical)) {
      // Naming the table and BOTH source columns is what makes this
      // actionable: the fix is dropping or mapping one of two real
      // columns, and the canonical name alone identifies neither.
      throw new Error(
        "schema: " + operation + " adapter invariant — duplicate canonical column '" +
        canonical + "'" + (norm ? " on table \"" + norm.tableName + '"' : '') +
        ": columns '" + sourceOf.get(canonical) + "' and '" + column.name +
        "' both canonicalize to it");
    }
    indexes.set(canonical, i);
    sourceOf.set(canonical, column.name);
  }
  return indexes;
}

// Absorb a RETURNING row onto an instance: camelCase canonical own
// properties plus non-enumerable snake_case aliases. Shared by the
// INSERT path, upsert, and hydrate's column loop below.
function absorbRow(inst, columns, row, operation = 'row absorption', norm = null) {
  validateAdapterRow(columns, row, operation, norm);
  if (typeof inst._relGeneration === 'number') {
    inst._relGeneration++;
    if (inst._relMemo) inst._relMemo.clear();
  }
  for (let i = 0; i < columns.length; i++) {
    const snake = columns[i].name;
    const key = norm ? fieldFor(norm, snake) : camelCase(snake);
    let value = row[i];
    // Coerce BEFORE the value lands on the instance, so the snapshot
    // taken after absorption sees the Date — dirty tracking must never
    // diff a wire string against its own coerced self.
    const temporal = norm && norm.temporalOf.get(key);
    if (temporal) value = coerceTemporal(value, temporal, snake, operation);
    if (!(key in inst)) {
      Object.defineProperty(inst, key, { value, enumerable: true, writable: true, configurable: true });
    } else {
      inst[key] = value;
    }
    if (snake !== key && !(snake in inst)) {
      Object.defineProperty(inst, snake, {
        enumerable: false, configurable: true,
        get() { return this[key]; },
        set(v) { this[key] = v; },
      });
    }
  }
}

async function destroy(def, inst, opts) {
  if (!inst._persisted) return inst;
  const norm = def._normalize();
  const identity = persistedIdentity(def, inst, 'destroy()');
  const restorePoint = txRestorePoint(norm, inst);
  const hard = opts && opts.hard === true;
  await runHook(def, inst, 'beforeDestroy');
  if (norm.softDelete && !hard) {
    const now = new Date(); // a real Date — the adapter encodes it at the wire
    const res = await runSQL(def, 'UPDATE ' + quoteIdent(norm.tableName, null, 'table') +
      ' SET "deleted_at" = ? WHERE ' + quoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?',
    [now, identity]);
    // A row soft-deleted ELSEWHERE still exists, so this UPDATE
    // matches it and re-stamps deleted_at — a write that landed, not
    // staleness. An affirmed zero means the row itself is gone.
    if (affirmedRowCount(res) === 0) {
      inst._persisted = false;
      throw staleRowError(def, 'destroy()', norm.primaryKey, identity);
    }
    inst.deletedAt = now;
  } else {
    const res = await runSQL(def, 'DELETE FROM ' + quoteIdent(norm.tableName, null, 'table') +
      ' WHERE ' + quoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?', [identity]);
    // The row was already gone: this destroy destroyed nothing, so it
    // must not run the after-destroy lifecycle a second time.
    if (affirmedRowCount(res) === 0) {
      inst._persisted = false;
      throw staleRowError(def, 'destroy()', norm.primaryKey, identity);
    }
    inst._persisted = false;
  }
  await runHook(def, inst, 'afterDestroy');
  await settleTxHooks(def, inst, restorePoint);
  return inst;
}

// Soft-delete recovery: deleted_at = NULL, firing the update
// lifecycle. Loud on models without @softDelete.
async function restore(def, inst) {
  const norm = def._normalize();
  if (!norm.softDelete) {
    throw new Error('schema: restore() requires @softDelete on ' + (def.name || 'model'));
  }
  if (!inst._persisted) return inst;
  const identity = persistedIdentity(def, inst, 'restore()');
  const restorePoint = txRestorePoint(norm, inst);
  await runHook(def, inst, 'beforeUpdate');
  const res = await runSQL(def, 'UPDATE ' + quoteIdent(norm.tableName, null, 'table') +
    ' SET "deleted_at" = NULL WHERE ' + quoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?',
  [identity]);
  if (affirmedRowCount(res) === 0) {
    inst._persisted = false;
    throw staleRowError(def, 'restore()', norm.primaryKey, identity);
  }
  inst.deletedAt = null;
  await runHook(def, inst, 'afterUpdate');
  // restore() completes the update lifecycle it began: afterCommit /
  // afterRollback settle exactly as save() and destroy() settle.
  await settleTxHooks(def, inst, restorePoint);
  return inst;
}

async function reload(def, inst) {
  const norm = def._normalize();
  const identity = persistedIdentity(def, inst, 'reload()');
  // Invalidate every relation request that began against the old
  // instance image before the reload crosses its await boundary.
  inst._relGeneration++;
  const sql = 'SELECT * FROM ' + quoteIdent(norm.tableName, null, 'table') +
    ' WHERE ' + quoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?';
  const res = await runSQL(def, sql, [identity]);
  const data = Array.isArray(res?.data) ? res.data : [];
  if (!Array.isArray(res?.columns) || data.length !== 1) {
    throw new Error(
      'schema: reload() identity invariant for ' + (def.name || 'model') + ' ' +
      norm.primaryKey + '=' + String(identity) + ' expected exactly one row; got ' + data.length);
  }
  const indexes = validateAdapterRow(res.columns, data[0], 'reload()', norm);
  const pkIndex = indexes.get(norm.primaryKey);
  const returnedIdentity = pkIndex !== undefined ? data[0][pkIndex] : undefined;
  if (!sameValue(returnedIdentity, identity)) {
    throw new Error(
      'schema: reload() identity invariant for ' + (def.name || 'model') +
      ' requested ' + String(identity) + ' but the adapter returned ' +
      String(returnedIdentity));
  }
  absorbRow(inst, res.columns, data[0], 'reload()', norm);
  def._applyEagerDerived(inst);
  inst._snapshot = snapshot(norm, inst);
  inst._dirty.clear();
  inst.savedChanges = new Map();
  if (inst._relMemo) inst._relMemo.clear();
  return inst;
}

function serialize(v, field) {
  if (field && field.typeName === 'json' && v != null && typeof v === 'object') {
    return JSON.stringify(v);
  }
  return v;
}

// Compare values at the SQL adapter boundary without erasing type
// identity. JSON objects take the same wire representation used for
// writes; temporal values compare by their represented instant because
// adapters return fresh Date objects. All other values remain exact.
function canonicalDBValue(v, field) {
  const serialized = serialize(v, field);
  return serialized instanceof Date ? serialized.getTime() : serialized;
}

function returnedRow(res, operation, allowZero, norm) {
  const data = Array.isArray(res?.data) ? res.data : null;
  if (!data) {
    throw new Error('schema: ' + operation + ' RETURNING invariant — adapter data must be an array');
  }
  if (data.length === 0) {
    if (allowZero) return null;
    throw new Error('schema: ' + operation + ' RETURNING invariant — expected exactly one row; got 0');
  }
  if (data.length !== 1) {
    throw new Error('schema: ' + operation + ' RETURNING invariant — expected exactly one row; got ' + data.length);
  }
  const columns = res.columns;
  const row = data[0];
  const indexes = validateAdapterRow(columns, row, operation + ' RETURNING', norm);
  return { columns, row, indexes };
}

// Caller-supplied primary keys are REJECTED on every insert path
//: the INSERT never writes the pk (it is
// sequence-assigned and comes back via RETURNING), so a caller id
// would be silently dropped — and it would defeat the
// RETURNING-produced-the-pk check, since the preset value makes
// `inst[pk] == null` pass on a garbage adapter response, arming a
// later `UPDATE WHERE id = <caller value>`. Explicit-id workflows
// run SQL through the adapter directly.
function callerPkError(def, api, pk) {
  return new Error(
    'schema: ' + api + ' on ' + (def.name || 'model') + ' received a caller-supplied ' + pk +
    ' — the primary key is runtime-managed (the INSERT never writes it; the real ' + pk +
    ' arrives via RETURNING). Remove ' + pk + ' from the data, declare ' + pk +
    ' as a field to make it a caller-supplied natural key, or run explicit-id SQL ' +
    'through the adapter.');
}

// The natural-key mirror: the caller owns the identity, so an absent
// one is not something the database will fill in. Caught here rather
// than as a NOT NULL violation, because the reason is a posture the
// model declared, not a constraint the table happens to carry.
function missingPkError(def, api, pk) {
  return new SchemaError([{
    field: pk,
    error: 'required',
    message: 'schema: ' + api + ' on ' + (def.name || 'model') + ' has no ' + pk +
      ' — ' + pk + ' is declared as a field, which makes it a caller-supplied ' +
      'natural key: nothing generates it, so the INSERT has no identity to write',
  }], def.name, def.kind);
}

function canonicalInput(def, data, api) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const norm = def._normalize();
  const writable = new Map();
  for (const [name] of norm.fields) {
    writable.set(name, name);
    writable.set(norm.columnOf.get(name), name);
  }
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const name = fieldFor(norm, rel.foreignKey);
    writable.set(name, name);
    writable.set(rel.foreignKey, name);
  }
  const managed = new Map();
  const addManaged = (name, column, label) => {
    managed.set(name, label);
    managed.set(column, label);
  };
  if (!norm.naturalKey) addManaged(norm.primaryKey, norm.primaryKeyColumn, 'primary key');
  if (norm.timestamps) {
    addManaged('createdAt', 'created_at', 'managed timestamp');
    addManaged('updatedAt', 'updated_at', 'managed timestamp');
  }
  if (norm.softDelete) addManaged('deletedAt', 'deleted_at', 'managed soft-delete column');

  const aliases = new Map();
  const canonical = {};
  for (const key of Object.keys(data).sort()) {
    const name = writable.get(key);
    if (!name) {
      const managedKind = managed.get(key);
      const message = managedKind === 'primary key'
        ? callerPkError(def, api, norm.primaryKey).message
        : managedKind
          ? 'schema: ' + api + ' on ' + (def.name || 'model') + " received runtime-managed key '" + key +
            "' (" + managedKind + ')'
          : 'schema: ' + api + ' on ' + (def.name || 'model') + " received unknown key '" + key +
            "' — writable keys: " + [...new Set(writable.values())].sort().join(', ');
      throw new SchemaError([{
        field: key,
        error: managedKind === 'primary key' ? 'pk' : managedKind ? 'managed' : 'unknown',
        message,
      }], def.name, def.kind);
    }
    const prior = aliases.get(name);
    if (prior) {
      const pair = [prior, key].sort();
      throw new SchemaError([{
        field: name,
        error: 'alias',
        message: 'schema: ' + api + ' on ' + (def.name || 'model') + ' received conflicting aliases ' +
          pair.map((x) => "'" + x + "'").join(' and ') + " for '" + name + "'",
      }], def.name, def.kind);
    }
    aliases.set(name, key);
    canonical[name] = data[key];
  }
  return canonical;
}

async function normalizePersistenceInput(def, data, opts) {
  const canonical = canonicalInput(def, data, opts?.api || 'create()');
  const result = await def._runAsync(canonical, {
    materialize: false,
    materializeNested: true,
    derived: 'throw',
    skipEnsures: opts?.skipEnsures === true,
  });
  if (result.ok) return result.value;
  if (result.thrown) throw result.thrown;
  const src = result.from || def;
  throw new SchemaError(result.errors, src.name, src.kind);
}

function constructInputInstance(def, canonical) {
  const inst = new (def._getClass())(canonical, false);
  for (const [k, v] of Object.entries(canonical)) {
    if (!(k in inst)) {
      Object.defineProperty(inst, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
  }
  return inst;
}

// ── ORM statics on SchemaDef ────────────────────────────────────────

SchemaDef.prototype._assertModel = function (api) {
  if (this.kind !== 'model') {
    throw new Error('schema: .' + api + '() is :model-only (got :' + this.kind + ')');
  }
};

// find(pk) — primary-key lookup only. PKs are unique by construction,
// so find needs no ambiguity story; a conditions lookup is with()'s
// job, which enforces exactly-one. Routed through the builder so find
// honors the same filters as every other read: the @softDelete filter
// and @defaultScope. `unscoped().where(id: …).first!` is the escape
// hatch.
SchemaDef.prototype.find = async function (id) {
  this._assertModel('find');
  if (id === null || id === undefined) {
    // A missing route param or a failed lookup feeding find() should
    // be loud here, not a silent `WHERE pk IS NULL` miss downstream.
    throw new Error('schema: find() got ' + (id === null ? 'null' : 'undefined') +
      ' — pass a primary key; a conditions lookup is with(cond)');
  }
  const t = typeof id;
  if (t !== 'number' && t !== 'bigint' && t !== 'string') {
    throw new Error('schema: find(pk) takes a primary key (number or string); ' +
      (Array.isArray(id) ? 'findMany(ids) is the batch lookup' : 'a conditions lookup is with(cond)') +
      ' — got ' + t);
  }
  const norm = this._normalize();
  return new SchemaQuery(this).where({ [norm.primaryKey]: id }).first();
};

// with(cond) — the exactly-one conditions lookup. cond is anything
// where() accepts: a conditions object, or caller-authored SQL text
// with its params. LIMIT 2 makes the uniqueness check free: zero rows
// is a normal miss (null), one is the answer, and two means the
// condition the caller assumed unique is not — a broken invariant,
// thrown loudly rather than silently picking a winner.
// `where(cond).first!` is the explicit "whichever comes first" read.
// Routed through the builder, so @softDelete and @defaultScope apply.
SchemaDef.prototype.with = async function (cond, ...params) {
  this._assertModel('with');
  if (cond === null || cond === undefined) {
    throw new Error('schema: with() got ' + (cond === null ? 'null' : 'undefined') +
      ' — pass a conditions object or SQL text with params');
  }
  const t = typeof cond;
  if (t !== 'string' && !isPlainObject(cond)) {
    throw new Error('schema: with(cond) takes a conditions object or SQL text; ' +
      (t === 'number' || t === 'bigint' ? 'a primary-key lookup is find(pk)' : 'got ' + t));
  }
  if (t !== 'string' && params.length) {
    throw new Error('schema: with(cond) with a conditions object takes no extra params — ' +
      'values belong inside the object');
  }
  const found = await new SchemaQuery(this).where(cond, ...params).limit(2).all();
  if (found.length > 1) {
    // Keys only, never values: conditions often carry PII (emails,
    // phone numbers) and this message ends up in logs.
    const shape = t === 'string' ? JSON.stringify(cond) : '{' + Object.keys(cond).join(', ') + '}';
    throw new Error('schema: with() matched more than one ' + (this.name || 'row') + ' for ' + shape +
      ' — the condition was assumed unique. Fix the data, or use where(...).first() to accept ambiguity');
  }
  return found[0] ?? null;
};

SchemaDef.prototype.findMany = async function (ids) {
  this._assertModel('findMany');
  if (!Array.isArray(ids)) throw new Error('schema: findMany(ids) expects an array');
  if (!ids.length) return [];
  const norm = this._normalize();
  return new SchemaQuery(this)
    .where(quoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' IN (' + ids.map(() => '?').join(', ') + ')', ...ids)
    .all();
};

SchemaDef.prototype.where = function (cond, ...params) {
  this._assertModel('where');
  return new SchemaQuery(this).where(cond, ...params);
};

SchemaDef.prototype.includes = function (...specs) {
  this._assertModel('includes');
  return new SchemaQuery(this).includes(...specs);
};

SchemaDef.prototype.withDeleted = function () {
  this._assertModel('withDeleted');
  return new SchemaQuery(this).withDeleted();
};

SchemaDef.prototype.onlyDeleted = function () {
  this._assertModel('onlyDeleted');
  return new SchemaQuery(this).onlyDeleted();
};

SchemaDef.prototype.unscoped = function () {
  this._assertModel('unscoped');
  return new SchemaQuery(this).unscoped();
};

SchemaDef.prototype.all = function () {
  this._assertModel('all');
  return new SchemaQuery(this).all();
};

SchemaDef.prototype.first = function () {
  this._assertModel('first');
  return new SchemaQuery(this).first();
};

SchemaDef.prototype.count = function () {
  this._assertModel('count');
  return new SchemaQuery(this).count();
};

// The builder's chain starters are model statics too — a chain may
// begin at any of them (`Post.order(…).limit(2).all()`), exactly as
// where() starts one.
SchemaDef.prototype.order = function (spec) {
  this._assertModel('order');
  return new SchemaQuery(this).order(spec);
};

SchemaDef.prototype.limit = function (n) {
  this._assertModel('limit');
  return new SchemaQuery(this).limit(n);
};

SchemaDef.prototype.offset = function (n) {
  this._assertModel('offset');
  return new SchemaQuery(this).offset(n);
};

SchemaDef.prototype.create = async function (data) {
  this._assertModel('create');
  // Normalize caller input before construction. Refinements run once
  // after beforeValidation inside save(), so hooks can still affect
  // the value they judge without transforms/coercions/defaults
  // running a second time.
  const canonical = await normalizePersistenceInput(this, data, {
    skipEnsures: true,
    api: 'create()',
  });
  const inst = constructInputInstance(this, canonical);
  await save(this, inst);
  return inst;
};

// INSERT … ON CONFLICT (target) DO UPDATE/NOTHING RETURNING *.
// Validation and beforeSave run before the statement. A returned row
// completes the save lifecycle; a DO NOTHING conflict hydrates the
// authoritative row without save-completion hooks. beforeCreate /
// beforeUpdate never fire because the runtime cannot know the
// database branch before execution.
SchemaDef.prototype.upsert = async function (data, opts) {
  this._assertModel('upsert');
  const norm = this._normalize();
  const on = opts && (opts.on ?? opts.conflict);
  if (on == null) throw new Error('schema: upsert(data, on: :column) requires a conflict target');
  // Conflict targets are STRUCTURED SQL and must name one complete
  // declared unique tuple. Tuple order is irrelevant for database
  // conflict inference; caller order is retained in emitted SQL.
  const targetInputs = Array.isArray(on) ? on : [on];
  if (!targetInputs.length) {
    throw new Error('schema: upsert() conflict target must contain at least one column');
  }
  const targets = targetInputs.map((t) => {
    if (typeof t !== 'string' && typeof t !== 'symbol') {
      throw new Error('schema: upsert() conflict targets must be strings or symbols; got ' + (t === null ? 'null' : typeof t));
    }
    const text = typeof t === 'symbol' ? (Symbol.keyFor(t) || t.description) : t;
    if (typeof text !== 'string' || !text.length) {
      throw new Error('schema: upsert() conflict target symbols must have a description');
    }
    // Validated against the conflict-eligible set HERE, where the
    // caller's own spelling is still in hand for the rejection.
    callerColumn(norm, text, norm.conflictColumns, 'upsert() conflict target');
    return columnFor(norm, text);
  });
  if (new Set(targets).size !== targets.length) {
    throw new Error('schema: upsert() conflict target columns must be distinct');
  }
  const targetKey = [...targets].sort().join('\u0000');
  if (!norm.conflictTargetKeys.has(targetKey)) {
    throw new Error(
      'schema: upsert() conflict target (' + targets.join(', ') +
      ') must exactly match a declared primary key, unique field, or @unique tuple');
  }

  const canonical = await normalizePersistenceInput(this, data, {
    skipEnsures: true,
    api: 'upsert()',
  });
  const inst = constructInputInstance(this, canonical);
  const restorePoint = txRestorePoint(norm, inst);

  await runHook(this, inst, 'beforeValidation');
  const validated = await this._runExistingAsync(inst, {
    materialize: false,
    materializeNested: true,
    derived: 'throw',
  });
  if (!validated.ok) {
    if (validated.thrown) throw validated.thrown;
    const src = validated.from || this;
    throw new SchemaError(validated.errors, src.name, src.kind);
  }
  for (const [name] of norm.fields) {
    if (validated.value[name] !== inst[name]) inst[name] = validated.value[name];
  }
  await runHook(this, inst, 'afterValidation');
  await runHook(this, inst, 'beforeSave');

  if (norm.naturalKey) {
    if (inst[norm.primaryKey] == null) {
      throw missingPkError(this, 'upsert()', norm.primaryKey);
    }
  } else if (inst[norm.primaryKey] != null) {
    throw callerPkError(this, 'upsert()', norm.primaryKey);
  }

  const cols = [], placeholders = [], values = [];
  const plannedValues = new Map();
  for (const [n, f] of norm.fields) {
    const v = inst[n];
    if (v == null) continue;
    const column = norm.columnOf.get(n);
    cols.push(column);
    placeholders.push('?');
    const serialized = serialize(v, f);
    values.push(serialized);
    plannedValues.set(column, serialized);
  }
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const v = inst[fieldFor(norm, rel.foreignKey)];
    if (v != null) {
      cols.push(rel.foreignKey);
      placeholders.push('?');
      values.push(v);
      plannedValues.set(rel.foreignKey, v);
    }
  }
  if (!cols.length) throw new Error('schema: upsert() requires at least one column');
  const targetValues = targets.map((target) => {
    if (!plannedValues.has(target) || plannedValues.get(target) == null) {
      throw new Error(
        "schema: upsert() conflict target '" + target +
        "' requires an explicit non-null canonical input value");
    }
    return plannedValues.get(target);
  });
  const updateCols = cols.filter((c) => !targets.includes(c));
  let conflict = ' ON CONFLICT (' + targets.map((t) => quoteIdent(t, norm.conflictColumns, 'conflict target')).join(', ') + ')';
  if (updateCols.length) {
    const sets = updateCols.map((c) => {
      const quoted = quoteIdent(c, norm.callerWritableColumns, 'upsert column');
      return quoted + ' = EXCLUDED.' + quoted;
    });
    // UTC, like every other writer of these columns (see UTC_NOW).
    // now(), not CURRENT_TIMESTAMP: DuckDB resolves a bare keyword in a
    // DO UPDATE SET target list as a COLUMN reference, so the standard
    // spelling fails here with "table has no column named
    // CURRENT_TIMESTAMP".
    if (norm.timestamps) sets.push('"updated_at" = ' + UTC_NOW);
    conflict += ' DO UPDATE SET ' + sets.join(', ');
  } else {
    conflict += ' DO NOTHING';
  }
  const sql = 'INSERT INTO ' + quoteIdent(norm.tableName, null, 'table') + ' (' +
    cols.map((c) => quoteIdent(c, norm.callerWritableColumns, 'upsert column')).join(', ') + ')' +
    ' VALUES (' + placeholders.join(', ') + ')' + conflict + ' RETURNING *';
  const res = await runSQL(this, sql, values);
  // `norm` canonicalizes column names through the model's own map: without
  // it a {column:} field and a same-named-after-camelCase sibling look like
  // two spellings of one canonical key, and a correct RETURNING * is
  // rejected as a duplicate column.
  const returned = returnedRow(res, 'upsert()', updateCols.length === 0, norm);
  if (returned) {
    absorbRow(inst, returned.columns, returned.row, 'upsert() RETURNING', norm);
    this._applyEagerDerived(inst);
    inst._snapshot = snapshot(norm, inst);
    // The RETURNING row must have produced the primary key BEFORE the
    // instance is marked persisted — a malformed adapter response must
    // not manufacture a "persisted" instance with no identity.
    if (inst._snapshot[norm.primaryKey] == null) {
      throw new Error(
        'schema: upsert() RETURNING for ' + (this.name || 'model') + ' produced no ' +
        norm.primaryKey + " — the adapter's query() must answer the RETURNING row with the " +
        'primary key (Adapter Contract v2)');
    }
    inst._persisted = true;
    await runHook(this, inst, 'afterSave');
    await settleTxHooks(this, inst, restorePoint);
    return inst;
  }
  const lookupSQL = 'SELECT * FROM ' + quoteIdent(norm.tableName, null, 'table') +
    ' WHERE ' + targets.map((target) =>
      quoteIdent(target, norm.conflictColumns, 'conflict target') + ' = ?').join(' AND ');
  const lookup = await runSQL(this, lookupSQL, targetValues);
  const found = Array.isArray(lookup?.data) ? lookup.data : [];
  if (!Array.isArray(lookup?.columns) || found.length !== 1) {
    throw new Error(
      'schema: upsert() conflict lookup invariant for ' + (this.name || 'model') +
      ' expected exactly one row by (' + targets.join(', ') + '); got ' + found.length);
  }
  const canonicalIndexes = validateAdapterRow(
    lookup.columns, found[0], 'upsert() conflict lookup', norm);
  const lookupColumns = new Map();
  for (const [canonical, index] of canonicalIndexes) {
    lookupColumns.set(columnFor(norm, canonical), index);
  }
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const columnIndex = lookupColumns.get(target);
    if (columnIndex === undefined) {
      throw new Error(
        "schema: upsert() conflict lookup invariant — returned row is missing target column '" +
        target + "'");
    }
    const field = norm.fields.get(fieldFor(norm, target));
    const requested = canonicalDBValue(targetValues[i], field);
    const actual = canonicalDBValue(found[0][columnIndex], field);
    if (!sameValue(actual, requested)) {
      throw new Error(
        "schema: upsert() conflict lookup invariant — returned target column '" + target +
        "' does not match the requested value");
    }
  }
  const existing = this._hydrate(lookup.columns, found[0]);
  persistedIdentity(this, existing, 'upsert() conflict lookup');
  return existing;
};

// The DB-free half of insertMany: canonicalize and validate every
// row, collecting ALL failures into one SchemaError (issues prefixed
// [i].field) before any SQL. setX runs it against the fresh join rows
// BEFORE its unlink DELETE, so a set() that cannot insert has not yet
// destroyed anything.
async function validateInsertRows(def, rows) {
  const canonicalRows = [];
  const allErrs = [];
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i];
    const rowErrs = [];
    let canonical = null;
    try {
      canonical = canonicalInput(def, data, 'insertMany()');
      const result = await def._runAsync(canonical, {
        materialize: false,
        materializeNested: true,
        derived: 'throw',
      });
      if (result.ok) canonical = result.value;
      else if (result.thrown) throw result.thrown;
      else {
        const src = result.from || def;
        throw new SchemaError(result.errors, src.name, src.kind);
      }
    } catch (e) {
      if (!(e instanceof SchemaError)) throw e;
      rowErrs.push(...e.issues);
    }
    for (const e of rowErrs) {
      allErrs.push({
        field: '[' + i + ']' + (e.field ? '.' + e.field : ''),
        error: e.error,
        message: '[' + i + '] ' + e.message,
      });
    }
    canonicalRows.push(canonical);
  }
  if (allErrs.length) throw new SchemaError(allErrs, def.name, def.kind);
  return canonicalRows;
}

// Bulk insert: validates EVERY row first (all failures collect into
// one SchemaError, issues prefixed [i].field, before any SQL), then
// one multi-VALUES INSERT … RETURNING *. Per-instance hooks are
// deliberately skipped — this is the bulk path.
SchemaDef.prototype.insertMany = async function (rows) {
  this._assertModel('insertMany');
  if (!Array.isArray(rows)) throw new Error('schema: insertMany(rows) expects an array');
  if (!rows.length) return [];
  const norm = this._normalize();
  const canonicalRows = await validateInsertRows(this, rows);

  // Column set = union of written columns across rows (missing values
  // insert as NULL / column default).
  const colSet = new Set();
  for (const row of canonicalRows) {
    for (const [n] of norm.fields) if (row[n] != null) colSet.add(n);
    for (const [, rel] of norm.relations) {
      if (rel.kind !== 'belongsTo') continue;
      const fk = fieldFor(norm, rel.foreignKey);
      if (row[fk] != null) colSet.add(fk);
    }
  }
  const colNames = [...colSet];
  if (!colNames.length) throw new Error('schema: insertMany() requires at least one column');
  const values = [];
  const tuples = [];
  for (const row of canonicalRows) {
    const slots = [];
    for (const n of colNames) {
      slots.push('?');
      values.push(serialize(row[n] ?? null, norm.fields.get(n)));
    }
    tuples.push('(' + slots.join(', ') + ')');
  }
  const sql = 'INSERT INTO ' + quoteIdent(norm.tableName, null, 'table') + ' (' +
    colNames.map((n) => quoteIdent(columnFor(norm, n), norm.callerWritableColumns, 'insertMany column')).join(', ') + ') VALUES ' +
    tuples.join(', ') + ' RETURNING *';
  const res = await runSQL(this, sql, values);
  return (res.data || []).map((row) => this._hydrate(res.columns, row));
};

// ── hydration ─────────────────────────────────────────────────────────

SchemaDef.prototype._hydrate = function (columns, row) {
  this._assertModel('_hydrate');
  // DB rows are trusted: hydrate into a class instance without
  // transforms, defaults, constraints, or refinements. Column names
  // arrive snake_case; properties live under camelCase with
  // non-enumerable snake aliases. Values are stored as delivered by
  // the adapter, with ONE exception: a column whose DECLARED type is
  // temporal coerces to a real `Date` (coerceTemporal) — an
  // adapter that already decodes at the wire seam (harbor, keyed off
  // duckdbType) passes through untouched, and one that answers wire
  // text or epoch numbers hydrates the same instant.
  const norm = this._normalize();
  // The same adapter-row validation reload() runs: two spellings for
  // one canonical key (an externally-managed table carrying both
  // `MRN_NBR` and `mrn`) would otherwise hydrate whichever value came
  // last — and a later save would write it back through the mapped
  // column.
  validateAdapterRow(columns, row, 'row hydration', norm);
  const data = {};
  for (let i = 0; i < columns.length; i++) {
    const key = fieldFor(norm, columns[i].name);
    // Coerced BEFORE the snapshot below, so dirty tracking never diffs
    // a wire string against its own coerced Date.
    const temporal = norm.temporalOf.get(key);
    data[key] = temporal
      ? coerceTemporal(row[i], temporal, columns[i].name, 'row hydration')
      : row[i];
  }
  const k = this._getClass();
  const inst = new k(data, true);
  for (const key of Object.keys(data)) {
    if (!(key in inst)) {
      Object.defineProperty(inst, key, {
        value: data[key], enumerable: true, writable: true, configurable: true,
      });
    }
  }
  for (let i = 0; i < columns.length; i++) {
    const snake = columns[i].name;
    const camel = fieldFor(norm, snake);
    if (snake !== camel && !(snake in inst)) {
      Object.defineProperty(inst, snake, {
        enumerable: false, configurable: true,
        get() { return this[camel]; },
        set(v) { this[camel] = v; },
      });
    }
  }
  // Eager-derived fields re-run on hydrate — they are not persisted
  // and recompute from the declared fields now present.
  this._applyEagerDerived(inst);
  // Capture the as-loaded values so save() emits a column-targeted
  // UPDATE touching only what the caller actually mutated.
  inst._snapshot = snapshot(norm, inst);
  return inst;
};

// ── the model class: instance wiring ──────────────────────────────────

const baseGetClass = SchemaDef.prototype._getClass;

SchemaDef.prototype._getClass = function () {
  if (this.kind !== 'model') return baseGetClass.call(this);
  if (this._modelKlass) return this._modelKlass;
  const def = this;
  const norm = this._normalize();
  const Base = baseGetClass.call(this);
  const name = this.name || 'Schema';

  const klass = ({ [name]: class extends Base {
    constructor(data, persisted = false) {
      super(data);
      // Internal state is non-enumerable so Object.keys(inst) lists
      // only declared fields that received a value.
      Object.defineProperty(this, '_dirty', { value: new Set(), enumerable: false, writable: false, configurable: true });
      Object.defineProperty(this, '_dirtyVersions', { value: new Map(), enumerable: false, writable: false, configurable: true });
      Object.defineProperty(this, '_dirtyVersion', { value: 0, enumerable: false, writable: true, configurable: true });
      Object.defineProperty(this, '_persisted', { value: persisted === true, enumerable: false, writable: true, configurable: true });
      Object.defineProperty(this, '_snapshot', { value: null, enumerable: false, writable: true, configurable: true });
      Object.defineProperty(this, '_saving', { value: false, enumerable: false, writable: true, configurable: true });
      Object.defineProperty(this, '_relGeneration', { value: 0, enumerable: false, writable: true, configurable: true });
      // Mirrors the most recent save()'s field-level diff: INSERT
      // yields [null, newValue] per written field, UPDATE
      // [oldValue, newValue] per changed field; empty after a no-op.
      Object.defineProperty(this, 'savedChanges', { value: new Map(), enumerable: false, writable: true, configurable: true });
    }
  } })[name];

  // Relation accessors: async, per-instance memoized (eager loading
  // fills the same memo); {reload: true} busts the memo.
  for (const [acc, rel] of norm.relations) {
    Object.defineProperty(klass.prototype, acc, {
      enumerable: false, configurable: true,
      value: async function (opts) {
        const wantsReload = !!(opts && opts.reload === true);
        const identity = relationIdentity(def, this, rel);
        // A reload supersedes every read already in flight: bumping
        // the generation drops their memo eligibility, while this
        // read's own post-await check keys on the bumped value — an
        // older plain read can never memoize its stale image over the
        // reload's result.
        if (wantsReload) {
          this._relGeneration++;
          if (this._relMemo) this._relMemo.delete(acc);
        }
        const generation = this._relGeneration;
        const memo = this._relMemo && this._relMemo.get(acc);
        if (!wantsReload && memo && sameValue(memo.identity, identity)) {
          return memo.value;
        }
        const v = await resolveRelation(def, rel, identity);
        // The re-check decides memo ELIGIBILITY only. Deriving the
        // identity can itself throw — a hard destroy landing mid-read
        // leaves no persisted identity — and that must not poison a
        // read whose data already arrived: decline to memoize,
        // return the value.
        let eligible = this._relGeneration === generation;
        if (eligible) {
          try {
            eligible = sameValue(relationIdentity(def, this, rel), identity);
          } catch {
            eligible = false;
          }
        }
        if (eligible) relMemoSet(this, acc, identity, v);
        return v;
      },
    });
    // A `through` relation is the one kind the owner can WRITE, because
    // the link is a row of its own rather than a column on either end.
    // Three verbs, named off the ACCESSOR — `teams` → addTeams —
    // because the accessor is the only name guaranteed unique per
    // relation: two relations to one target share a target name, and
    // depluralizing an arbitrary `{as:}` would be a guess.
    if (rel.through) {
      const Acc = acc[0].toUpperCase() + acc.slice(1);
      const verb = (name, fn) => {
        Object.defineProperty(klass.prototype, name + Acc, {
          enumerable: false, configurable: true, writable: true,
          value: async function (items, attrs) { return fn(def, this, rel, acc, items, attrs); },
        });
      };
      verb('add', throughAdd);
      verb('remove', throughRemove);
      verb('set', throughSet);
    }
  }

  Object.defineProperty(klass.prototype, 'save', {
    enumerable: false, configurable: true, writable: true,
    value: async function () { return save(def, this); },
  });
  // A key names a WRITABLE property when it reaches a declared field
  // or a belongsTo FK (either spelling). set() and markDirty() share
  // the test, so the two verbs cannot drift on what counts as
  // declared. Returns the normalized field name, or null.
  const writableField = (nm, key) => {
    const n = fieldFor(nm, key);
    if (nm.fields.has(n)) return n;
    for (const [, rel] of nm.relations) {
      if (rel.kind === 'belongsTo' && fieldFor(nm, rel.foreignKey) === n) return n;
    }
    return null;
  };
  // set(attrs) — assign-and-save in one call (Ruby's update). Every
  // key must name a declared field or belongsTo FK (either spelling);
  // an unknown key throws rather than silently assigning a property
  // save() would never write. Assignment goes through the instance's
  // own accessors, so dirty tracking sees exactly what manual
  // assignments followed by save() would.
  Object.defineProperty(klass.prototype, 'set', {
    enumerable: false, configurable: true, writable: true,
    value: async function (attrs) {
      if (!isPlainObject(attrs)) {
        throw new Error('schema: set(attrs) takes a plain object of field values');
      }
      const nm = def._normalize();
      for (const key of Object.keys(attrs)) {
        if (writableField(nm, key) === null) {
          throw new Error("schema: set() — '" + key + "' is not a declared field or belongsTo FK on " +
            (def.name || 'anon'));
        }
      }
      for (const [key, value] of Object.entries(attrs)) this[key] = value;
      return save(def, this);
    },
  });
  Object.defineProperty(klass.prototype, 'destroy', {
    enumerable: false, configurable: true, writable: true,
    value: async function (opts) { return destroy(def, this, opts); },
  });
  Object.defineProperty(klass.prototype, 'restore', {
    enumerable: false, configurable: true, writable: true,
    value: async function () { return restore(def, this); },
  });
  Object.defineProperty(klass.prototype, 'reload', {
    enumerable: false, configurable: true, writable: true,
    value: async function () { return reload(def, this); },
  });
  Object.defineProperty(klass.prototype, 'ok', {
    enumerable: false, configurable: true, writable: true,
    value: function () { return def._validateFields(this, false); },
  });
  Object.defineProperty(klass.prototype, 'errors', {
    enumerable: false, configurable: true, writable: true,
    value: function () { return def._validateFields(this, true); },
  });
  // Force a column into the next UPDATE when value identity cannot
  // see the change (in-place mutation of an object-valued field).
  // Name-validated so typos throw; persisted instances only (INSERT
  // writes every set field — a silent no-op would be a footgun).
  Object.defineProperty(klass.prototype, 'markDirty', {
    enumerable: false, configurable: true, writable: true,
    value: function (name) {
      if (!this._persisted) {
        throw new Error(
          "schema: markDirty('" + name + "') is only valid on persisted instances; INSERT writes every set field");
      }
      const nm = def._normalize();
      const n = writableField(nm, name);
      if (n === null) {
        throw new Error(
          "schema: markDirty('" + name + "') — '" + fieldFor(nm, name) + "' is not a declared field or belongsTo FK on " + (def.name || 'anon'));
      }
      this._dirty.add(n);
      this._dirtyVersions.set(n, ++this._dirtyVersion);
      return this;
    },
  });
  // toJSON mirrors the instance's own enumerable properties — by
  // construction the pk, declared fields, timestamp columns,
  // deletedAt, FK columns, and eager-derived values; internal state
  // is non-enumerable and methods/computed live on the prototype.
  Object.defineProperty(klass.prototype, 'toJSON', {
    enumerable: false, configurable: true, writable: true,
    value: function () {
      const out = {};
      for (const k of Object.keys(this)) out[k] = this[k];
      return out;
    },
  });

  this._modelKlass = klass;
  return klass;
};

// ── DDL ───────────────────────────────────────────────────────────────

// Null-prototype: indexed by the user's field type name, so an inherited
// Object.prototype member never passes for an intrinsic and the unknown-
// type rejection below stays reachable.
const SQL_TYPES = {
  __proto__: null,
  string: 'VARCHAR', text: 'TEXT', integer: 'INTEGER', number: 'DOUBLE',
  boolean: 'BOOLEAN', date: 'DATE', datetime: 'TIMESTAMP', email: 'VARCHAR',
  url: 'VARCHAR', uuid: 'UUID', phone: 'VARCHAR', zip: 'VARCHAR', json: 'JSON', any: 'JSON',
};

// DuckDB spells an inline ENUM `ENUM('a', 'b')`, and reports it back
// from `duckdb_columns()` in exactly that spelling — comma-space
// between members, a doubled quote for an embedded one. Render it
// byte-identically so a column the schema did not change never reads
// as changed to the migration differ.
function sqlEnumType(values) {
  return 'ENUM(' + values.map((v) => "'" + String(v).replace(/'/g, "''") + "'").join(', ') + ')';
}

// Split `ENUM('a', 'b''c')` back into its member values, or null when
// the type is not an ENUM at all. SQL string literals only, `''`
// being one escaped quote — the only form DuckDB emits and the only
// form sqlEnumType writes. The differ needs this because an ENUM's
// members ARE its type: `ENUM('draft','sent')` and
// `ENUM('draft','sent','void')` are two different column types, so
// the member list must survive normalization rather than be folded
// away the way a VARCHAR width hint is.
function sqlEnumMembers(type) {
  const s = String(type == null ? '' : type).trim();
  if (!/^enum\s*\(/i.test(s) || !s.endsWith(')')) return null;
  const body = s.slice(s.indexOf('(') + 1, -1);
  const members = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && body[i] !== "'") i++;
    if (i >= body.length) break;
    i++;
    let v = '';
    for (;;) {
      if (i >= body.length) return null; // unterminated literal
      if (body[i] === "'") {
        if (body[i + 1] === "'") { v += "'"; i += 2; continue; }
        i++;
        break;
      }
      v += body[i++];
    }
    members.push(v);
  }
  return members.length ? members : null;
}

// A field's declared type → its column type. Every answer is
// DELIBERATE: no catch-all, because a VARCHAR catch-all turns a
// typo'd type name into a shipped column nothing complains about —
// `amt! stirng` renders `"amt" VARCHAR` and validates every value it
// is handed.
//
// Resolved at DDL time, which is the moment a column type is committed
// and the last moment the registry can be asked. `def` is the model
// being rendered, named only so the rejection can say where.
function columnType(field, def) {
  // An array of anything is a JSON document, whatever the element is.
  if (field.array) return 'JSON';
  const intrinsic = SQL_TYPES[field.typeName];
  if (intrinsic) return intrinsic;
  // An inline literal union (`status! "draft" | ["published"]`) is a
  // closed set of strings — which is exactly what a DuckDB ENUM is,
  // so the column enforces the set instead of taking any string a
  // VARCHAR would have accepted. The parser admits string members
  // only, so every member has an ENUM rendering. It lives on the
  // field itself, never in the registry, so it answers before the
  // registry is asked.
  if (field.typeName === 'literal-union') {
    if (!field.literals?.length) {
      throw new Error("schema: field type 'literal-union'" + ' (on ' + (def?.name || 'model') +
        ') has no members — a closed set with nothing in it has no column it could render');
    }
    return sqlEnumType(field.literals);
  }
  const nested = SchemaRegistry.get(field.typeName);
  const where = ' (on ' + (def?.name || 'model') + ')';
  if (!nested) {
    throw new Error("schema: unknown field type '" + field.typeName + "'" + where +
      ' — no schema declares it, and it is not one of: ' +
      Object.keys(SQL_TYPES).sort().join(', ') +
      '. A type Rip cannot map has no column it could honestly render');
  }
  switch (nested.kind) {
    // An enum materializes to its member VALUE, which is what the
    // column holds — not the member name. A closed set of strings is
    // a DuckDB ENUM. A set holding a number or a boolean has no ENUM
    // form (DuckDB enum members are strings), so it stays VARCHAR
    // rather than being silently restated as something the values are
    // not.
    case 'enum': {
      const values = [...new Set(nested._normalize().enumMembers.values())];
      if (!values.length || !values.every((v) => typeof v === 'string')) return 'VARCHAR';
      return sqlEnumType(values);
    }
    // A nested schema is an object, so it is a JSON document — the
    // array form's answer, for the same reason.
    case 'shape': case 'input': case 'union': return 'JSON';
    case 'model':
      throw new Error("schema: field type '" + field.typeName + "'" + where +
        ' is a :model — a row does not nest inside a column. Declare the ' +
        'relation instead: @belongsTo ' + field.typeName);
    default:
      throw new Error("schema: field type '" + field.typeName + "'" + where +
        ' is a :' + nested.kind + ', which has no column form');
  }
}

function columnSpec(column, field, def) {
  let base = columnType(field, def);
  if (base === 'VARCHAR' && field.constraints?.max != null) {
    // A VARCHAR width is a count of characters, so only a positive
    // integer has a rendering. `..2.5` reads fine as a validation
    // bound but renders as VARCHAR(2.5), which no database accepts —
    // and picking 2 or 3 on the caller's behalf is guessing at the
    // one number the column is defined by.
    const max = field.constraints.max;
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new Error("schema: column '" + column + "' has a maximum length of " + String(max) +
        ' — a VARCHAR width must be a positive whole number of characters');
    }
    base = 'VARCHAR(' + max + ')';
  }
  return {
    name: column,
    type: base,
    notNull: field.required === true,
    unique: field.unique === true,
    default: field.constraints?.default !== undefined
      ? sQLDefault(field.constraints.default) : null,
    was: field.attrs?.was || null,
  };
}

// ── the shared sequence ───────────────────────────────────────────────
//
// By default each table's surrogate key draws from its OWN
// `<table>_seq`, so ids collide across tables: patient 1 and order 1
// both exist, and an integer alone never says which row it names. A
// database can declare one counter for all of them instead:
//
//   schema.sequence 'id'                 -- once, beside the models
//
// after which every surrogate key defaults from `nextval('id')` and no
// two rows in the database share an id. Nothing else changes: the
// column stays INTEGER, each table still has its own `id`, and the ids
// are merely sparse rather than dense per table.
//
// It is stated ONCE, for the database, and deliberately not as a
// per-model directive: a shared counter holds only if EVERY table
// draws from it, and a per-model spelling would offer a way to get
// that half right — one model keeps its own sequence, its ids overlap
// everyone else's, and nothing anywhere says so.
let sharedSequence = null;

// `schema.sequence 'id'` sets it; `schema.sequence()` reads it back;
// `schema.sequence null` clears it, back to a sequence per table.
// Setting it twice with the same name is idempotent (two model files
// may each state the database's rule); with a different one it throws,
// because the second name would silently re-key every table declared
// under the first.
function sequenceSetting(name, options) {
  if (name === undefined) return sharedSequence && { ...sharedSequence };
  if (name === null) { sharedSequence = null; return null; }
  if (typeof name !== 'string' || !name.length) {
    throw new Error('schema.sequence(): takes the sequence name, e.g. schema.sequence(\'id\')');
  }
  const start = options?.start ?? 1;
  if (!Number.isInteger(start)) {
    throw new Error('schema.sequence(): start must be an integer; got ' + String(start));
  }
  if (sharedSequence && (sharedSequence.name !== name || sharedSequence.start !== start)) {
    throw new Error("schema.sequence(): already declared as '" + sharedSequence.name + "' START " +
      sharedSequence.start + " — a database has one shared sequence; declare it once.");
  }
  sharedSequence = { name, start };
  return { ...sharedSequence };
}

// TIMESTAMP is zone-NAIVE: it stores whatever wall clock wrote it and
// remembers nothing about which one. Three writers touch these columns
// — the column DEFAULT, the ORM's own JS Date on save, and upsert's DO
// UPDATE SET — and a bare CURRENT_TIMESTAMP or now() resolves in the
// SESSION's zone while a JS Date serializes as UTC. One table then
// holds two clocks, and created_at/updated_at on the same row disagree
// by the machine's offset: a row created and updated seconds apart
// reads as hours apart, and any ordering across the two is fiction.
//
// So every writer states UTC explicitly. The rule is UTC in the
// database, local at the edge — the only one that survives a server
// moving zones, two servers in different zones, and daylight saving.
const UTC_NOW = "timezone('UTC', now())";

// The canonical table spec — one structure for DDL rendering (and,
// for the migration differ, its comparison shape).
SchemaDef.prototype._tableSpec = function (options) {
  this._assertModel('_tableSpec');
  const opts = options || {};
  const norm = this._normalize();
  const table = norm.tableName;
  const shared = sharedSequence;
  const seq = shared ? shared.name : table + '_seq';

  // Sequence seed: explicit option wins over @idStart wins over 1.
  let idStart = 1;
  for (const d of norm.directives) {
    if (d.name === 'idStart') idStart = d.args[0].value;
  }
  if (opts.idStart !== undefined) {
    if (!Number.isInteger(opts.idStart)) {
      throw new Error('schema.toSQL(): idStart must be an integer; got ' + String(opts.idStart));
    }
    idStart = opts.idStart;
  }
  // A shared sequence is the DATABASE's counter, so no one table gets
  // to seed it — @idStart on any model would set where EVERY table
  // starts, which is not what the model says. The database-wide seed
  // is `schema.sequence 'id', start: 10001`.
  if (shared && idStart !== 1) {
    throw new Error("schema: " + (this.name || table) + " declares @idStart " + idStart +
      ", but this database shares one sequence ('" + shared.name + "') across every table — " +
      'one table cannot seed it. Set the seed on the sequence: ' +
      "schema.sequence('" + shared.name + "', { start: " + idStart + ' })');
  }
  if (shared) idStart = shared.start;

  const columns = [];
  if (!norm.naturalKey) {
    columns.push({
      name: norm.primaryKeyColumn, type: 'INTEGER',
      notNull: true, unique: false, primary: true,
      default: 'nextval(' + quoteLiteral(seq, 'sequence name') + ')', was: null,
    });
  }
  for (const [n, f] of norm.fields) {
    const col = columnSpec(norm.columnOf.get(n), f, this);
    // A natural key is an ordinary column that happens to be the
    // identity: its type, length, and default are the field's. It
    // takes PRIMARY KEY and nothing else — no sequence exists to
    // default from, because nothing generates it.
    if (norm.naturalKey && n === norm.primaryKey) {
      col.primary = true;
      col.notNull = true;
      col.unique = false;
    }
    columns.push(col);
  }

  const foreignKeys = [];
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const targetDef = SchemaRegistry.get(rel.target);
    // An unregistered target cannot say where it lives or what it is
    // keyed by, so the convention answers — the same names and the
    // same INTEGER surrogate it would have chosen.
    const targetNorm = targetDef && targetDef.kind === 'model' ? targetDef._normalize() : null;
    const refTable = targetNorm ? targetNorm.tableName : tableName(rel.target);
    const refColumn = targetNorm ? targetNorm.primaryKeyColumn : 'id';
    // An FK holds a copy of the key it points at, so it is exactly as
    // wide: a target with a natural `string` key needs a VARCHAR FK,
    // not the surrogate's INTEGER.
    columns.push({
      name: rel.foreignKey,
      type: targetNorm?.primaryKeyField
        ? columnSpec(rel.foreignKey, targetNorm.primaryKeyField, targetDef).type
        : 'INTEGER',
      notNull: !rel.optional, unique: false, default: null, was: null,
    });
    // A cross-adapter relation's target lives in another database, so
    // it stays out of foreignKeys (which orders the dump's DDL stream);
    // the accessor still works as a second query.
    const crossAdapter = targetDef &&
      (targetDef._adapter || null) !== (this._adapter || null);
    if (crossAdapter) continue;
    foreignKeys.push({ column: rel.foreignKey, refTable, refColumn });
  }

  if (norm.timestamps) {
    columns.push({ name: 'created_at', type: 'TIMESTAMP', notNull: false, unique: false, default: UTC_NOW, was: null });
    columns.push({ name: 'updated_at', type: 'TIMESTAMP', notNull: false, unique: false, default: UTC_NOW, was: null });
  }
  if (norm.softDelete) {
    columns.push({ name: 'deleted_at', type: 'TIMESTAMP', notNull: false, unique: false, default: null, was: null });
  }

  // Index names derive from their column set, so two declarations on
  // the same columns collide — always a redundant/contradictory
  // schema; reject rather than emit duplicate CREATE INDEX.
  const indexes = [];
  const indexByName = new Map();
  const addIndex = (ix) => {
    if (indexByName.has(ix.name)) {
      throw new Error(
        `Table '${table}': duplicate index '${ix.name}' on (${ix.columns.join(', ')}). ` +
        `Those columns are declared unique/indexed more than once — a '@unique' already ` +
        `creates an index, so remove the redundant '@unique'/'@index' declaration.`);
    }
    indexByName.set(ix.name, ix);
    indexes.push(ix);
  };
  for (const [n, f] of norm.fields) {
    if (!f.unique) continue;
    const col = norm.columnOf.get(n);
    addIndex({ name: 'idx_' + table + '_' + col, columns: [col], unique: true });
  }
  for (const d of norm.directives) {
    if (d.name !== 'index' && d.name !== 'unique') continue;
    const cols = d.args[0].fields.map((c) => columnFor(norm, c));
    addIndex({ name: 'idx_' + table + '_' + cols.join('_'), columns: cols, unique: d.name === 'unique' });
  }

  // A model any registered relation names as `{through:}` is a LINK
  // table: one row per (owner, target) pair. addX treats a duplicate
  // link as pathological and its unique-violation handling makes the
  // database the race arbiter, so the DDL states what the runtime
  // contract already claims — the pair is UNIQUE. The asserting fact
  // lives on the DECLARING model, an action-at-a-distance that is
  // deliberate (owner decision); the pair resolves here through the
  // registry exactly as the relation resolves it at use, so
  // registration order never matters. A pair that cannot resolve
  // (missing/ambiguous @belongsTo on this model) derives nothing —
  // the relation itself already refuses loudly at use. Column order
  // is canonicalized by sort: a unique constraint has no order, and a
  // join model used as `through` from BOTH ends must derive ONE index.
  const pairIndexOn = (pairKey) => indexes.find((ix) =>
    ix.columns.length === 2 && [...ix.columns].sort().join('\u0000') === pairKey);
  const derivedPairs = new Map();
  for (const entry of SchemaRegistry._entries.values()) {
    if (entry.kind !== 'model') continue;
    let ownerNorm;
    try { ownerNorm = entry.def._normalize(); } catch { continue; }
    for (const [, rel] of ownerNorm.relations) {
      if (rel.through !== this.name || SchemaRegistry.get(rel.through) !== this) continue;
      let keys;
      try { keys = throughKeys(entry.def, rel, this); } catch { continue; }
      const pair = [keys.ownerKey, keys.targetKey].sort();
      const pairKey = pair.join('\u0000');
      const declared = pairIndexOn(pairKey);
      if (declared) {
        // A declared @unique over the pair (either order) IS this
        // index — nothing to add. A plain @index over it contradicts
        // the link contract the through declaration asserts.
        if (!declared.unique) {
          throw new Error(
            `Table '${table}': (${declared.columns.join(', ')}) is the link pair of a ` +
            `through-relation (${entry.def.name || 'model'}.${rel.accessor} reads through ${rel.through}), ` +
            `so it must be UNIQUE — declare '@unique' over those columns instead of '@index'.`);
        }
        continue;
      }
      derivedPairs.set(pairKey, { name: 'idx_' + table + '_' + pair.join('_'), columns: pair, unique: true });
    }
  }
  for (const pairKey of [...derivedPairs.keys()].sort()) addIndex(derivedPairs.get(pairKey));

  return {
    name: table,
    sequence: norm.naturalKey ? null : { name: seq, start: idStart, shared: shared != null },
    primaryKey: norm.primaryKeyColumn,
    columns, indexes, foreignKeys,
    tableWas: norm.tableWas || null,
  };
};

function renderColumn(spec, col, inlineUnique) {
  const column = quoteIdent(col.name, null, 'column');
  const parts = ['  ' + column + ' ' + col.type];
  if (col.primary) {
    parts[0] = '  ' + column + ' ' + col.type + ' PRIMARY KEY';
  } else {
    if (col.notNull) parts.push('NOT NULL');
    // Single-column uniqueness renders INLINE; renderCreate decides
    // which columns qualify and drops their indexes. See the note there.
    if (inlineUnique) parts.push('UNIQUE');
  }
  // No REFERENCES clause, deliberately. DuckDB's FK enforcement is a
  // net loss for an app database: an UPDATE of any indexed column on a
  // referenced table is executed as DELETE+INSERT and the DELETE trips
  // the incoming FK ("over-eager checking", documented + open issues
  // duckdb#13819/#20246); deletes are invisible to FK verification
  // within a transaction; there is no deferral; and ALTER TABLE ADD
  // CONSTRAINT does not exist, so constraints also block every rebuild
  // dance. Referential integrity is the app's job (@belongsTo still
  // mints the typed column, NOT NULL, and the accessor — everything
  // but the constraint), and `foreignKeys` metadata still orders the
  // dump and names relations for tooling.
  if (col.default != null) parts.push('DEFAULT ' + col.default);
  return parts.join(' ');
}

function renderIndex(spec, ix) {
  const u = ix.unique ? 'UNIQUE ' : '';
  return 'CREATE ' + u + 'INDEX ' + quoteIdent(ix.name, null, 'index') +
    ' ON ' + quoteIdent(spec.name, null, 'table') +
    ' (' + ix.columns.map((c) => quoteIdent(c, null, 'index column')).join(', ') + ');';
}

// Single-column uniqueness is emitted as an inline UNIQUE constraint;
// everything else stays a named index.
//
// Not cosmetic. In DuckDB a standalone index is a catalog object the
// table DEPENDS on, and DuckDB refuses to ALTER any table something
// depends on — the WHOLE table, not merely the indexed column, and for
// DROP, RENAME and type changes alike ("Dependency Error: Cannot alter
// entry"). So one unique index freezes every column of its table
// against migration. An inline constraint enforces the same invariant,
// is still ART-index-backed for lookups and still serves ON CONFLICT,
// but carries no dependency — the table stays alterable. (Uniqueness
// is not what costs: a plain @index blocks identically.)
//
// COMPOSITE uniques deliberately stay indexes. The differ models
// composite uniqueness as a unique index — a deployed composite
// CONSTRAINT is invisible to duckdb_indexes(), so it would plan the
// index anyway and re-freeze the table. Single-column uniqueness has
// no such gap: foldSpec folds an auto-named single-column unique index
// into the column's `unique` flag, and the contract folds a deployed
// single-column UNIQUE constraint into that SAME flag, so both shapes
// compare equal.
//
// Uniqueness ADDED to a table that already exists is a table REBUILD
// (the add-unique step in the migration planner): DuckDB has no
// working ALTER TABLE ADD CONSTRAINT, so the planner recreates the
// table around the changed flag and renderCreate renders it inline.

// The ORM's own uniqueness index: single-column, auto-named. One
// predicate, two consumers — renderCreate folds it into the column's
// inline UNIQUE, and the differ's foldSpec folds it into the column
// flag — and the two MUST agree or the differ would plan an index
// that already exists.
function isAutoUniqueIndex(spec, ix) {
  return ix.unique === true && ix.columns.length === 1 &&
    ix.name === 'idx_' + spec.name + '_' + ix.columns[0];
}

function renderCreate(spec) {
  const blocks = [];
  // A per-table sequence is part of the table's own DDL. A SHARED one
  // outlives every table that draws from it, so it is rendered once
  // for the database (renderDump, and the planner's create-sequence
  // step) rather than repeated here for each table.
  if (spec.sequence && !spec.sequence.shared) {
    blocks.push('CREATE SEQUENCE ' + quoteIdent(spec.sequence.name, null, 'sequence') +
      ' START ' + spec.sequence.start + ';');
  }
  const inlineUnique = new Set();
  const indexes = [];
  for (const ix of spec.indexes) {
    const col = isAutoUniqueIndex(spec, ix) ? spec.columns.find((c) => c.name === ix.columns[0]) : null;
    if (col && !col.primary) { inlineUnique.add(col.name); continue; }
    indexes.push(ix);
  }
  // A FOLDED spec (the differ's) carries that same fact as the column's
  // own flag with no index left to read, so honour both spellings —
  // renderCreate is what rebuilds a table from its deployed shape.
  for (const c of spec.columns) if (c.unique && !c.primary) inlineUnique.add(c.name);
  const lines = spec.columns.map((c) => renderColumn(spec, c, inlineUnique.has(c.name)));
  // A deployed composite UNIQUE constraint (hand-written DDL; the spec
  // cannot declare one) rides the spec in compositeUniques — a rebuild
  // or dump that dropped it would silently stop enforcing it.
  for (const cols of spec.compositeUniques ?? []) {
    lines.push('  UNIQUE (' + cols.map((c) => quoteIdent(c, null, 'unique column')).join(', ') + ')');
  }
  blocks.push('CREATE TABLE ' + quoteIdent(spec.name, null, 'table') +
    ' (\n' + lines.join(',\n') + '\n);');
  const ix = indexes.map((i) => renderIndex(spec, i));
  if (ix.length) blocks.push(ix.join('\n'));
  return blocks;
}

function sQLDefault(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return "'" + v.replace(/'/g, "''") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

SchemaDef.prototype.toSQL = function (options) {
  this._assertModel('toSQL');
  const opts = options || {};
  const { dropFirst = false, header } = opts;
  const spec = this._tableSpec(opts);
  const blocks = [];
  if (header) blocks.push(header);
  if (dropFirst) {
    // A shared sequence survives the table: other tables draw from it,
    // and dropping it would strip their defaults too.
    blocks.push('DROP TABLE IF EXISTS ' + quoteIdent(spec.name, null, 'table') + ' CASCADE;' +
      (spec.sequence && !spec.sequence.shared
        ? '\nDROP SEQUENCE IF EXISTS ' + quoteIdent(spec.sequence.name, null, 'sequence') + ';'
        : ''));
  }
  // Standalone DDL for one model still has to RUN, so it carries the
  // shared sequence it defaults from — IF NOT EXISTS, because the
  // sequence is the database's and another table may have made it.
  if (spec.sequence?.shared) {
    blocks.push('CREATE SEQUENCE IF NOT EXISTS ' + quoteIdent(spec.sequence.name, null, 'sequence') +
      ' START ' + spec.sequence.start + ';');
  }
  blocks.push(...renderCreate(spec));
  return blocks.join('\n\n') + '\n';
};

// ── install + the user-facing namespace ───────────────────────────────

installPersistence({
  finishModelNorm,
  decorateDef,
  projectableFields,
  jsonSchemaModelColumns,
});

// The migration machinery is CLI-only (never delivered into
// user output) — the namespace carries loud pointers, not the
// differ. A program calling a migration verb gets the fix named,
// never `undefined is not a function`.
function migrationStub(api) {
  return function () {
    throw new Error(
      'schema.' + api + '() is CLI-only — run `rip schema ' +
      (api === 'introspect' ? 'plan' : api) +
      '`; the migration machinery is never delivered into program output (it lives in the rip CLI).');
  };
}

// `schema.transaction! ->`, `schema.connect url: …`,
// `schema.setAdapter adapter` — the namespace user code references;
// referencing it is what delivers this runtime.
const schema = {
  transaction: transaction,
  connect: connect,
  setAdapter: __schemaSetAdapter,
  sequence: sequenceSetting,
  registerCoercer,
  plan: migrationStub('plan'),
  status: migrationStub('status'),
  make: migrationStub('make'),
  migrate: migrationStub('migrate'),
  introspect: migrationStub('introspect'),
};

// The last two are the build-an-unsaved-instance seam rip/fake's
// Model.factory() augmentation composes with — normalize caller
// input, construct without saving.
export { schema, __schemaSetAdapter, transaction, adoptTransaction, txHandle, connect, runSQL, adapterFor, adapterConfigured, quoteIdent, renderCreate, renderIndex, isAutoUniqueIndex, normalizePersistenceInput, constructInputInstance, sqlEnumType, sqlEnumMembers, sequenceSetting };

// Process doorbell for packages that must not hard-import this file
// (e.g. rip/db). `connect()` sets `globalThis.__ripDbAdapter` and
// calls `__ripSchema.__schemaSetAdapter` when we are already loaded;
// if models load later, pick up that adapter here so order does not
// matter.
if (typeof globalThis !== 'undefined') {
  const g = globalThis;
  g.__ripSchema = g.__ripSchema || {};
  g.__ripSchema.__schemaSetAdapter = __schemaSetAdapter;
  // So a transaction opened by rip/db can enroll model statements that
  // run inside it, instead of letting them commit on their own.
  g.__ripSchema.adoptTransaction = adoptTransaction;
  g.__ripSchema.txHandle = txHandle;
  if (g.__ripDbAdapter && !adapterExplicit) {
    try {
      __schemaSetAdapter(g.__ripDbAdapter);
    } catch {
      // Invalid leftover — leave the default adapter in place.
    }
  }
}
