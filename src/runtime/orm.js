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

import { SchemaError, __SchemaRegistry, registerCoercer, __SchemaDef, __schemaInstallPersistence } from './schema.js';
import { harborAdapter } from './harbor.js';
import { __schemaSnake, __schemaCamel, __schemaIsCanonicalTarget, __schemaIsCanonicalName, __schemaAttrValueError, __SCHEMA_MODEL_DIRECTIVES, __SCHEMA_ONCE_DIRECTIVES, __SCHEMA_RELATION_DIRECTIVES, __SCHEMA_FIELD_ATTRS, __SCHEMA_RELATION_ATTRS } from './vocab.js';

// ── naming: the snake_case ↔ camelCase bijection ─────────────────────


// A SQL identifier in a STRUCTURED position: must be a string, free
// of control characters, a member of the operation's canonical column
// set, and emits double-quote escaped (an embedded quote doubles, so
// a name can never break out of the identifier). The trusted string
// overloads of where()/order() sit outside this helper by owner
// decision O4; every other identifier the builder interpolates for a
// caller passes through here.
function __schemaQuoteIdent(name, allowed, what) {
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

// LIMIT/OFFSET are numeric SQL positions interpolated as bare
// integers: only an actual number that is a safe non-negative integer
// may reach them — no coercion, no numeric strings (a request-derived
// string is exactly the injection surface this closes).
function __schemaPageInt(n, what) {
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
// JSON (__SCHEMA_SQL_TYPES) and __schemaSerialize stringifies an object
// written to them — so `where({prefs: {like: true}})` on a json column
// is a legitimate EQUALITY test against that document, not an ILIKE.
// The field's declared TYPE decides, never the value's shape.

function __schemaIsPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

// `IN ()` is a syntax error at the database, and both empty cases have
// an exact constant answer: nothing is inside an empty set, everything
// is outside one.
function __schemaInFragment(col, values, params, negated, field) {
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
const __SCHEMA_WHERE_OPS = new Map([
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
  ['in', (col, v, p, f) => __schemaInFragment(col, v, p, false, f)],
  ['nin', (col, v, p, f) => __schemaInFragment(col, v, p, true, f)],
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
const __SCHEMA_ORDER_DIRS = new Set([
  'asc', 'desc',
  'asc nulls first', 'asc nulls last',
  'desc nulls first', 'desc nulls last',
]);

function __schemaOrderDir(dir, field) {
  const key = typeof dir === 'string' ? dir.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  if (!__SCHEMA_ORDER_DIRS.has(key)) {
    throw new Error("schema: order() direction for '" + field + "' must be one of " +
      [...__SCHEMA_ORDER_DIRS].map((d) => JSON.stringify(d)).join(', ') + '; got ' +
      (typeof dir === 'string' ? JSON.stringify(dir) : (dir === null ? 'null' : typeof dir)));
  }
  return key.toUpperCase();
}


const __SCHEMA_UNCOUNTABLE = new Set(['equipment', 'information', 'rice', 'money', 'species', 'series', 'fish', 'sheep', 'data']);

const __SCHEMA_IRREGULAR = new Map([['person', 'people'], ['man', 'men'], ['woman', 'women'], ['child', 'children'], ['tooth', 'teeth'], ['foot', 'feet'], ['mouse', 'mice']]);

function __schemaPluralize(w) {
  const lw = w.toLowerCase();
  if (__SCHEMA_UNCOUNTABLE.has(lw)) return w;
  if (__SCHEMA_IRREGULAR.has(lw)) return __SCHEMA_IRREGULAR.get(lw);
  if (/[^aeiouy]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
}

function __schemaTableName(model) { return __schemaPluralize(__schemaSnake(model)); }

function __schemaFkName(model) { return __schemaSnake(model) + '_id'; }

// Relation TARGETS must be canonical PascalCase — uppercase-first,
// alphanumeric, no two consecutive uppercase letters — the same
// bijection guard field names already carry: an acronym-style target
// derives FK and accessor names the snake/camel round-trip cannot
// reproduce.
const __schemaCanonicalTarget = __schemaIsCanonicalTarget;

// ── reserved names ────────────────────────────────────────────────────

const __SCHEMA_RESERVED_STATIC = new Set([
  'parse', 'array', 'safe', 'ok', 'parseAsync', 'safeAsync', 'okAsync', 'toJSONSchema',
  'find', 'findMany', 'where', 'all', 'first', 'count', 'create', 'toSQL',
  'includes', 'upsert', 'insertMany', 'updateAll', 'deleteAll', 'withDeleted', 'onlyDeleted',
  'unscoped', 'factory',
]);
// Names a @scope may not take: the model statics above plus the
// builder-only chain methods — scopes install on both surfaces.
const __SCHEMA_SCOPE_RESERVED = new Set([
  ...__SCHEMA_RESERVED_STATIC,
  'limit', 'offset', 'order', 'orderBy',
]);
const __SCHEMA_RESERVED_INSTANCE = new Set([
  'save', 'destroy', 'restore', 'reload', 'ok', 'errors', 'toJSON', 'savedChanges', 'markDirty',
  '_saving', '_relMemo',
]);
// Implicit columns owned by directive-driven runtime behavior:
// declaring them as user fields would shadow the runtime API or
// produce duplicate SET writes when @timestamps / @softDelete bump
// them. (Mixin-included fields are exempt — declaring createdAt /
// updatedAt through a mixin is the explicit-control alternative to
// @timestamps.)
const __SCHEMA_RESERVED_IMPLICIT = new Set([
  'createdAt', 'updatedAt', 'deletedAt',
]);
const __SCHEMA_RESERVED = new Set([
  ...__SCHEMA_RESERVED_STATIC,
  ...__SCHEMA_RESERVED_INSTANCE,
  ...__SCHEMA_RESERVED_IMPLICIT,
]);

const __SCHEMA_HOOK_NAMES = new Set([
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
function __schemaSnapshot(norm, inst) {
  const snap = Object.create(null);
  snap[norm.primaryKey] = __schemaSnapshotValue(inst[norm.primaryKey]);
  for (const [n] of norm.fields) snap[n] = __schemaSnapshotValue(inst[n]);
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const fkCamel = __schemaFieldFor(norm, rel.foreignKey);
    snap[fkCamel] = __schemaSnapshotValue(inst[fkCamel]);
  }
  return snap;
}

function __schemaPersistedIdentity(def, inst, operation) {
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
function __schemaSameValue(a, b) {
  return a === b || (a !== a && b !== b);
}

// Persistence snapshots own their values: an object mutated while SQL
// awaits cannot advance the committed snapshot. Containers retain their
// value semantics; custom instances flatten only enumerable data, so
// model bookkeeping and prototypes never enter persistence state.
function __schemaSnapshotValue(value, seen = new Map()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const item of value) out.push(__schemaSnapshotValue(item, seen));
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [key, item] of value) {
      out.set(__schemaSnapshotValue(key, seen), __schemaSnapshotValue(item, seen));
    }
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const item of value) out.add(__schemaSnapshotValue(item, seen));
    return out;
  }
  const out = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = __schemaSnapshotValue(value[key], seen);
  return out;
}

function __schemaSnapshotEqual(a, b, seen = new Map()) {
  if (__schemaSameValue(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  let paired = seen.get(a);
  if (paired) return paired === b;
  seen.set(a, b);
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, i) => __schemaSnapshotEqual(item, b[i], seen));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    const aa = [...a], bb = [...b];
    return aa.every(([ak, av], i) =>
      __schemaSnapshotEqual(ak, bb[i][0], seen) && __schemaSnapshotEqual(av, bb[i][1], seen));
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    const aa = [...a], bb = [...b];
    return aa.every((item, i) => __schemaSnapshotEqual(item, bb[i], seen));
  }
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key, i) =>
    key === bk[i] && __schemaSnapshotEqual(a[key], b[key], seen));
}

// Relation memo — {identity, value} per instance and accessor,
// non-enumerable so it never reaches Object.keys / JSON.stringify.
// Identity is captured before resolution, including for null and []
// values, and written uniformly by accessors and eager loading.
function __schemaRelMemoSet(inst, acc, identity, value) {
  if (!inst._relMemo) {
    Object.defineProperty(inst, '_relMemo', {
      value: new Map(), enumerable: false, writable: false, configurable: true,
    });
  }
  inst._relMemo.set(acc, { identity, value });
  return value;
}

// ── the persistence seam: model normalization ─────────────────────────

function __schemaModelError(def, field, error, message) {
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
function __schemaColumnFor(norm, key) {
  const mapped = norm.columnOf.get(key);
  if (mapped !== undefined) return mapped;
  if (norm.fieldOf.has(key)) return key;
  return __schemaSnake(key);
}

function __schemaFieldFor(norm, column) {
  return norm.fieldOf.get(column) ?? __schemaCamel(column);
}

function __schemaNormalizeDirectiveRelation(def, directive) {
  const name = directive.name;
  if (!__SCHEMA_RELATION_DIRECTIVES.includes(name)) return null;
  const a = directive.args[0];
  const target = a.target;
  const targetLc = target[0].toLowerCase() + target.slice(1);
  // Both defaults derive from a MODEL name, which is why two relations
  // to one model collide without overrides: same accessor, same column.
  // `as:` renames the accessor, `foreignKey:` the column — supply both
  // and `author` and `reviewer` can each reach User independently.
  const optional = !!a.optional;
  if (name === 'belongsTo') {
    return {
      kind: 'belongsTo', target, optional,
      accessor: a.as ?? targetLc,
      foreignKey: a.foreignKey ?? __schemaFkName(target),
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
      accessor: a.as ?? (name === 'hasOne' ? targetLc : __schemaPluralize(targetLc)),
      foreignKey: a.foreignKey ?? null,
      targetKey: a.targetKey ?? null,
    };
  }
  if (name === 'hasOne') {
    return {
      kind: 'hasOne', target, optional,
      accessor: a.as ?? targetLc,
      foreignKey: a.foreignKey ?? __schemaFkName(def.name),
    };
  }
  return {
    kind: 'hasMany', target, optional,
    accessor: a.as ?? __schemaPluralize(targetLc),
    foreignKey: a.foreignKey ?? __schemaFkName(def.name),
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
function __schemaThroughKeys(def, rel, join) {
  const joinNorm = join._normalize();
  if (!(joinNorm.columns instanceof Set)) {
    throw new Error('schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
      ' reads through ' + rel.through + ', which is not a persisted :model');
  }
  const side = (explicit, model, what) => {
    if (explicit) {
      __schemaQuoteIdent(explicit, joinNorm.columns, 'through ' + what + ' key');
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
        __schemaFkName(model) + '"}');
    }
    throw new Error('schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
      ' reads through ' + rel.through + ', which declares ' + hits.length + ' @belongsTo ' + model +
      ' (' + hits.map((r) => r.accessor).join(', ') + ') — name the column to say which: ' +
      '{through: ' + rel.through + ', ' + option + ': "' + hits[0].foreignKey + '"}');
  };
  return {
    joinNorm,
    ownerKey: side(rel.foreignKey, def.name, 'owner'),
    targetKey: side(rel.targetKey, rel.target, 'target'),
  };
}

// Validate one directive's argument SHAPE against the vocabulary.
// Extra args, missing args, and wrong-typed args all reject — a
// directive that reads only part of what the user wrote acted on a
// different program.
function __schemaValidateDirectiveArgs(def, d) {
  const shape = __SCHEMA_MODEL_DIRECTIVES[d.name];
  if (shape === undefined) {
    throw __schemaModelError(def, '', 'directive',
      "unknown directive '@" + d.name + "' on :model — legal: " +
      Object.keys(__SCHEMA_MODEL_DIRECTIVES).map((n) => '@' + n).join(', '));
  }
  const args = d.args || [];
  const bad = (why) => {
    throw __schemaModelError(def, '', 'directive', '@' + d.name + ': ' + why);
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
      if (d.name !== 'mixin' && !__schemaCanonicalTarget(args[0].target)) {
        bad("target '" + args[0].target + "' is not canonical PascalCase — use an uppercase-first, " +
          "alphanumeric name with no consecutive uppercase letters (e.g. 'MdmUser' not 'MDMUser'); " +
          'the derived FK column and accessor names ride the snake_case bijection');
      }
      // The compiler validates these, but `__schema()` is also reached
      // directly (tests, generated descriptors), so the runtime holds
      // the same line rather than trusting its caller.
      if (d.name !== 'mixin') {
        for (const [key, kind] of Object.entries(__SCHEMA_RELATION_ATTRS)) {
          const value = args[0][key];
          if (value === undefined) continue;
          const why = __schemaAttrValueError(kind, key, value);
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
      if (!__schemaIsCanonicalName(args[0].name)) {
        bad("'" + args[0].name + "' is not canonical camelCase — lowercase-first, alphanumeric, " +
          "no consecutive capitals ('patientId' not 'patientID'); the property, the snapshot key " +
          'and the JSON key all ride the snake_case bijection');
      }
      // Hand-built descriptors may leave the column implicit; the
      // compiler always writes it.
      const column = args[0].column;
      if (column !== undefined) {
        const why = __schemaAttrValueError('literal', 'column', column);
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
function finishModelNorm(def, norm) {
  if (!def.name) {
    throw __schemaModelError(def, '', 'name', 'a :model needs a name — its table name derives from it');
  }

  const collision = (n, where) => {
    throw __schemaModelError(def, n, 'collision', n + ' collides with ' + where);
  };

  // Reserved ORM names guard DECLARED entries only: mixin-included
  // fields may spell createdAt/updatedAt (explicit control instead of
  // @timestamps).
  for (const e of def._desc.entries || []) {
    if ((e.tag === 'field' || e.tag === 'method' || e.tag === 'computed' || e.tag === 'derived') &&
        __SCHEMA_RESERVED.has(e.name)) {
      collision(e.name, 'reserved ORM name');
    }
    if (e.tag === 'hook' && !__SCHEMA_HOOK_NAMES.has(e.name)) {
      throw __schemaModelError(def, e.name, 'hook',
        "unknown lifecycle hook '" + e.name + "' — recognized: " + [...__SCHEMA_HOOK_NAMES].join(', '));
    }
  }
  for (const [n] of norm.scopes) {
    if (__SCHEMA_SCOPE_RESERVED.has(n)) collision(n, 'reserved query API name');
  }

  let timestamps = false;
  let softDelete = false;
  let tableWas = null;
  let table = null;
  let primaryKey = null;
  const relations = new Map();
  const seenOnce = new Set();
  for (const d of norm.directives) {
    __schemaValidateDirectiveArgs(def, d);
    if (__SCHEMA_ONCE_DIRECTIVES.includes(d.name)) {
      if (seenOnce.has(d.name)) {
        throw __schemaModelError(def, '', 'directive',
          "duplicate '@" + d.name + "' — a :model declares it at most once " +
          '(the second would silently override the first)');
      }
      seenOnce.add(d.name);
    }
    if (d.name === 'timestamps') timestamps = true;
    else if (d.name === 'softDelete') softDelete = true;
    else if (d.name === 'table') table = d.args[0].name;
    else if (d.name === 'tableWas') tableWas = d.args[0].name;
    else if (d.name === 'primaryKey') primaryKey = d.args[0];
    const rel = __schemaNormalizeDirectiveRelation(def, d);
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

  norm.relations = relations;
  norm.timestamps = timestamps;
  norm.softDelete = softDelete;
  norm.tableWas = tableWas;
  // The primary key is a PROPERTY and a COLUMN, and `{column:}` lets
  // them differ — the same pair every declared field has.
  norm.primaryKey = primaryKey?.name ?? 'id';
  norm.primaryKeyColumn = primaryKey
    ? (primaryKey.column ?? __schemaSnake(primaryKey.name))
    : 'id';
  // `@table` is a permanent override; `@tableWas` is a one-time rename
  // signal the differ consumes and the author then deletes. Both are in
  // table-name space, so they compose: @tableWas names the DEPLOYED
  // table, @table the desired one, and the pluralizer is bypassed
  // entirely when @table is present.
  norm.tableName = table ?? __schemaTableName(def.name);

  // ── surrogate or natural: DECLARING the pk as a field is the switch ─
  //
  // These are the only two coherent readings, and the declaration
  // settles which:
  //
  //   @primaryKey patientId          nothing declares patientId, so
  //                                  nothing says what it holds — it is
  //                                  the runtime's INTEGER surrogate:
  //                                  sequence default, RETURNING
  //                                  absorption, caller input refused
  //
  //   @primaryKey mrn                mrn IS declared, with a type and
  //   mrn! string                    constraints — a NATURAL key the
  //                                  caller supplies, which the INSERT
  //                                  writes like any other column
  //
  // There is no third case: a declared pk field with a surrogate
  // posture would be a `string` field over an INTEGER sequence column,
  // and an undeclared natural key would be a column with no type. The
  // two facts are one fact, so no separate flag states it.
  //
  // It takes BOTH declarations, though — an @primaryKey naming the
  // field. A bare `id! integer` with no @primaryKey keeps colliding as
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
      throw __schemaModelError(def, norm.primaryKey, 'primaryKey',
        "the primary key '" + norm.primaryKey + "' is declared optional — a row's " +
        'identity is never absent; declare it required (!)');
    }
    if (pkField.array === true) {
      throw __schemaModelError(def, norm.primaryKey, 'primaryKey',
        "the primary key '" + norm.primaryKey + "' is declared as an array — a primary key is one value");
    }
    for (const d of norm.directives) {
      if (d.name === 'idStart') {
        throw __schemaModelError(def, norm.primaryKey, 'primaryKey',
          "@idStart seeds the sequence behind a runtime-managed primary key, but '" +
          norm.primaryKey + "' is declared as a field, which makes it caller-supplied — " +
          'there is no sequence to seed. Drop @idStart, or drop the field declaration');
      }
    }
  }

  // ── the property ↔ column mapping ───────────────────────────────────
  //
  // ONE map each way, built once, consulted everywhere. Before
  // `{column:}` a column was always `__schemaSnake(property)` and the
  // derivation could be inlined at each site; now it is a lookup, and
  // the derivation survives only as the DEFAULT when a field declares
  // no column of its own.
  //
  // `columnOf` doubles as the column-OWNERSHIP guard: every table
  // column has exactly one owner. A field whose column equals a
  // belongsTo FK (`userId` + `@belongsTo User`), a directive-managed
  // column (a mixin-included `createdAt` + `@timestamps`), or another
  // field's `{column:}` would otherwise emit duplicate-column DDL and
  // duplicate-column INSERTs that fail only at the database. Fields
  // could not collide among themselves while name → snake_case was
  // injective; `{column:}` is exactly what ends that, which is why
  // fields now claim through the same gate as everything else.
  const columnOf = new Map();
  const fieldOf = new Map();
  const ownerOf = new Map();
  const claim = (property, col, owner) => {
    if (fieldOf.has(col)) {
      throw __schemaModelError(def, property, 'collision',
        ownerOf.get(col) + ' and ' + owner + " both own column '" + col +
        "' — every table column has exactly one owner");
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
    for (const [key, kind] of Object.entries(__SCHEMA_FIELD_ATTRS)) {
      const value = f.attrs?.[key];
      if (value === undefined) continue;
      const why = __schemaAttrValueError(kind, key, value);
      if (why) {
        throw __schemaModelError(def, n, 'attr',
          "field '" + n + "' option " + why + "; got '" + value + "'");
      }
    }
    claim(n, f.attrs?.column ?? __schemaSnake(n), "field '" + n + "'");
  }
  for (const [, rel] of relations) {
    if (rel.kind !== 'belongsTo') continue;
    claim(__schemaCamel(rel.foreignKey), rel.foreignKey,
      'the @belongsTo ' + rel.target + ' relation');
  }
  if (timestamps) {
    claim('createdAt', 'created_at', '@timestamps');
    claim('updatedAt', 'updated_at', '@timestamps');
  }
  if (softDelete) claim('deletedAt', 'deleted_at', '@softDelete');
  norm.columnOf = columnOf;
  norm.fieldOf = fieldOf;
  const known = new Set(fieldOf.keys());
  // The field's own `{column:}` is what the table has, so it wins — and
  // a second, different one on the directive is two answers to one
  // question rather than a default being overridden.
  if (norm.naturalKey) {
    const fieldColumn = columnOf.get(norm.primaryKey);
    if (primaryKey?.column !== undefined && primaryKey.column !== fieldColumn) {
      throw __schemaModelError(def, norm.primaryKey, 'primaryKey',
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
    const columns = d.args[0].fields.map((c) => __schemaColumnFor(norm, c));
    if (new Set(columns).size !== columns.length) {
      throw __schemaModelError(def, '', 'index',
        '@' + d.name + ' columns must be distinct after canonicalization: ' +
        columns.join(', '));
    }
    for (let i = 0; i < columns.length; i++) {
      const c = d.args[0].fields[i];
      if (!known.has(columns[i])) {
        throw __schemaModelError(def, c, 'index',
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
    if (d.name === 'unique') conflictTargets.push(d.args[0].fields.map((c) => __schemaColumnFor(norm, c)));
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
    ? __schemaAssertAdapter(desc.adapter, "schema :model on: (" + (desc.name || 'anon') + ')')
    : null;
  for (const e of desc.entries || []) {
    if (e.tag !== 'scope' || (e.name in def)) continue;
    const sfn = e.fn;
    Object.defineProperty(def, e.name, {
      enumerable: false, configurable: true,
      value: function (...args) { return __schemaInvokeScope(def, null, sfn, args); },
    });
  }
}

// A belongsTo FK holds a copy of the target's key, so it is that
// key's type. Resolved lazily and defensively: the target may not be
// registered yet, and asking an unregistered one is not an error here
// — the relation's own validation says that, at query time, with a
// better message. The convention's INTEGER surrogate is the answer
// until the target can say otherwise.
function __schemaRelationKeyType(rel) {
  const target = __SchemaRegistry.get(rel.target);
  if (!target || target.kind !== 'model') return 'integer';
  let targetNorm;
  try { targetNorm = target._normalize(); } catch { return 'integer'; }
  return targetNorm.primaryKeyField?.typeName ?? 'integer';
}

// The full projectable column set: declared fields plus the columns a
// :model manages implicitly — id, @timestamps, @softDelete, and
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
    col(__schemaFieldFor(norm, rel.foreignKey), __schemaRelationKeyType(rel), !rel.optional);
  }
  return out;
}

function jsonSchemaModelColumns(def, properties) {
  const norm = def._normalize();
  if (!norm.naturalKey) properties[norm.primaryKey] = { type: 'integer' };
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const t = __schemaRelationKeyType(rel) === 'integer' ? 'integer' : 'string';
    properties[__schemaFieldFor(norm, rel.foreignKey)] = rel.optional
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

// Temporal encode/decode used to be replicated here, because this file
// could not reach packages/db. It lives in ./harbor.js now — one decode
// seam, one copy of it — and this runtime no longer touches the wire at
// all: an installed adapter owns that, per the contract above.

// The default adapter, for a schema-model app that installs none: the
// one duckdb-harbor client, configured from RIP_DB_URL / RIP_DB_TOKEN.
// `src/cli/schema.js` advertises exactly this path.
//
// This used to be eighty lines of hand-rolled fetch living beside the
// real client in packages/db — a copy that drifted until it dialled the
// wrong port, discarded DuckDB's error text, could not read harbor's
// NDJSON, and knew nothing of timeouts or cancellation. There is one
// client now, and this is a call into it.
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
function __schemaDefaultAdapter(overrides) {
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
function __schemaAssertAdapter(a, who) {
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

let __schemaAdapter = __schemaDefaultAdapter();

// Whether anything beyond the unconfigured default is in play — the
// CLI's pre-flight check reads this so a `rip schema` run against
// nothing fails naming the fix instead of surfacing a connection
// error from the default endpoint.
let __schemaAdapterExplicit = false;

function __schemaSetAdapter(a) {
  __schemaAdapter = __schemaAssertAdapter(a, 'schema.setAdapter()');
  __schemaAdapterExplicit = true;
}

function __schemaAdapterConfigured() {
  const env = (typeof process !== 'undefined' && process.env) || {};
  return __schemaAdapterExplicit || !!env.RIP_DB_URL;
}

// A def's own `on:` adapter, else the process-global one.
function __schemaAdapterFor(def) {
  return (def && def._adapter) || __schemaAdapter;
}

// Build a NEW adapter value without installing it globally — the
// counterpart of `schema :model, on: analytics`.
function __schemaConnect(opts) {
  const o = typeof opts === 'string' ? { url: opts } : (opts || {});
  if (!o.url) throw new Error('schema.connect({url, token?, timeoutMs?}): a url is required');
  return __schemaDefaultAdapter({ url: o.url, token: o.token, timeoutMs: o.timeoutMs });
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
let __schemaTxALS = null;
let __schemaTxALSInit = null;

function __schemaTxALSGet() {
  if (!__schemaTxALSInit) {
    __schemaTxALSInit = (async () => {
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
      __schemaTxALS = new ALS();
      return __schemaTxALS;
    })();
  }
  return __schemaTxALSInit;
}

function __schemaTxStore(adapter) {
  if (!__schemaTxALS) return null;
  const map = __schemaTxALS.getStore();
  return (map && map.get(adapter)) || null;
}

// The single SQL funnel: resolves the def's adapter, routes through
// that adapter's ambient transaction when one exists, and translates
// DB constraint violations into structured SchemaErrors.
async function __schemaRunSQL(def, sql, params, opts) {
  const adapter = __schemaAdapterFor(def);
  const tx = __schemaTxStore(adapter);
  try {
    return await (tx ? tx.handle.query(sql, params, opts) : adapter.query(sql, params, opts));
  } catch (e) {
    throw __schemaTranslateDBError(e, def);
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
async function __schemaTransaction(optsOrFn, maybeFn = undefined) {
  const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
  const opts = typeof optsOrFn === 'function' ? {} : (optsOrFn || {});
  if (typeof fn !== 'function') {
    throw new Error('schema.transaction(fn): expected a function (got ' + typeof fn + ')');
  }
  const adapter = opts.on ? __schemaAssertAdapter(opts.on, 'schema.transaction(on:)') : __schemaAdapter;

  if (__schemaTxStore(adapter)) return fn();

  if (typeof adapter.begin !== 'function') {
    throw new Error(
      'schema.transaction(): the configured adapter does not support transactions ' +
      '(no begin() method; see Adapter Contract v2). Install an adapter with begin().');
  }
  const als = await __schemaTxALSGet();

  const handle = await adapter.begin(opts);
  // `after` collects {def, inst} for every save/destroy completed
  // inside the transaction on a model declaring afterCommit /
  // afterRollback.
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
    await __schemaFlushTxHooks(store, 'afterRollback');
    throw err;
  }
  await handle.commit();
  // afterCommit runs OUTSIDE the transaction — exceptions here
  // propagate but cannot roll anything back: the COMMIT already
  // happened.
  await __schemaFlushTxHooks(store, 'afterCommit');
  return result;
}

// Bind an ALREADY-OPEN handle as this adapter's ambient transaction for
// the duration of `fn`, so schema-model statements inside enroll on it
// instead of running autocommit on another connection.
//
// This exists because a transaction opened by the other tier (rip/db's
// `transaction`) is invisible here: `__schemaRunSQL` routes on this
// store alone, so a model write inside someone else's transaction used
// to commit itself and survive that transaction's rollback.
//
// The caller owns begin/commit/rollback; this owns only the ambience
// and the hooks that depend on the outcome. `fn` is handed a `settle`
// it calls once the commit or rollback has actually landed, so
// afterCommit never fires ahead of the COMMIT it reports.
// The open handle for this adapter's ambient transaction, or null. The
// mirror of __schemaAdoptTransaction: it lets the other tier see a
// transaction WE opened, so a raw statement issued inside one joins it
// rather than committing itself on another connection.
// DuckDB answers a bulk UPDATE/DELETE with a one-row result set whose
// single `Count` column carries the affected rows — so the envelope's
// own `rowCount` is 1 for every such statement, including one that
// matched nothing at all. Reading it reported "1 row changed" whatever
// happened. Take the number DuckDB actually returned, and fall back to
// `rowCount` for an adapter that answers some other way.
//
// Harbor sends integers past 2^53-1 as strings so they survive JSON;
// a bulk mutation is nowhere near that, but coerce rather than hand
// back a count whose type depends on its magnitude.
function __schemaAffectedRows(res) {
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
  return res?.rowCount ?? res?.rows ?? null;
}

// DuckDB's UPDATE and DELETE take a WHERE and nothing else — there is
// no `DELETE ... LIMIT`, and the parser refuses one. These clauses are
// assembled for a SELECT and were dropped on the way here, so a caller
// who scoped a bulk mutation to one row mutated every matching row
// instead. Refuse rather than widen. (rip/db's builder makes the same
// promise, in the same words.)
function __schemaAssertWhereOnly(rel, method) {
  const ignored = [];
  if (rel._limit != null) ignored.push('limit');
  if (rel._offset != null) ignored.push('offset');
  if (rel._order != null) ignored.push('order');
  if (!ignored.length) return;
  throw new Error(
    `${method}() cannot honor ${ignored.join(', ')} — DuckDB's UPDATE and DELETE accept only a WHERE. ` +
    `Narrow the condition, or read the rows first and mutate them by primary key.`);
}

function __schemaTxHandle(adapter) {
  const store = __schemaTxStore(adapter);
  return store ? store.handle : null;
}

async function __schemaAdoptTransaction(adapter, handle, fn) {
  const als = await __schemaTxALSGet();
  const store = { adapter, handle, after: [] };
  // Copy-on-run, as __schemaTransaction does: other adapters' ambient
  // contexts stay visible; only this adapter's slot is bound.
  const next = new Map(als.getStore() || []);
  next.set(adapter, store);
  return als.run(next, () => fn((outcome) => __schemaFlushTxHooks(store, outcome)));
}

async function __schemaFlushTxHooks(store, hookName) {
  // Dedupe by instance: a row saved twice in one transaction gets one
  // callback.
  const seen = new Set();
  for (const entry of store.after) {
    if (seen.has(entry.inst)) continue;
    seen.add(entry.inst);
    await __schemaRunHook(entry.def, entry.inst, hookName);
  }
}

// Queue an instance's commit-time hooks on the ambient transaction
// for ITS adapter. Returns false when no transaction is open — the
// caller fires afterCommit immediately (outside a transaction, the
// statement is the commit).
function __schemaEnqueueTxHook(def, inst) {
  const tx = __schemaTxStore(__schemaAdapterFor(def));
  if (!tx) return false;
  tx.after.push({ def, inst });
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
function __schemaTranslateDBError(e, def) {
  const msg = (e && e.message) || '';
  // The model's mapping, when there is one — a NOT NULL failure names
  // the COLUMN, and with `{column:}` that is not the field name.
  // Normalization can itself throw (this runs inside a catch), so a
  // model that cannot normalize simply reports the derived name.
  let norm = null;
  try { norm = def && def.kind === 'model' ? def._normalize() : null; } catch { norm = null; }
  const issue = __schemaConstraintIssue(msg, norm);
  if (!issue) return e;
  const err = new SchemaError([issue], def ? def.name : null, def ? def.kind : null);
  err.cause = e;
  return err;
}

// A name out of a database error message: a column when the model
// knows it as one, and the plain derivation otherwise — the unique
// pattern yields an INDEX name, which no mapping covers.
function __schemaConstraintName(raw, norm) {
  return norm ? __schemaFieldFor(norm, raw) : __schemaCamel(raw);
}

function __schemaConstraintIssue(msg, norm) {
  const nameOf = (raw) => __schemaConstraintName(raw, norm);
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
function __schemaInvokeScope(def, builder, fn, args) {
  const q = builder || new __SchemaQuery(def);
  const out = fn.apply(q, args);
  return out instanceof __SchemaQuery ? out : q;
}

class __SchemaQuery {
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
            value: (...args) => __schemaInvokeScope(def, this, sfn, args),
          });
        }
      }
    }
  }
  where(cond, ...params) {
    // The string form is the O4-trusted overload: caller-authored SQL,
    // passed through verbatim with its parameters. The object form is
    // STRUCTURED — every key validates against the model's persisted
    // columns and quotes through the identifier helper.
    if (typeof cond === 'string') {
      this._clauses.push(cond);
      this._params.push(...params);
    } else if (cond && typeof cond === 'object') {
      const norm = this._def._normalize();
      for (const [k, v] of Object.entries(cond)) {
        const column = __schemaColumnFor(norm, k);
        const col = __schemaQuoteIdent(column, norm.columns, 'filter column');
        // Either spelling reaches the field record, the same way either
        // spelling reaches the column.
        const field = norm.fields.get(__schemaFieldFor(norm, column));
        const opaque = !!field &&
          (field.array === true || field.typeName === 'json' || field.typeName === 'any');
        if (v === null || v === undefined) {
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
        } else if (__schemaIsPlainObject(v) && !opaque) {
          const ops = Object.keys(v);
          if (ops.length === 0) {
            throw new Error("schema: where() on '" + k + "' got an empty operator object — " +
              'name an operator (' + [...__SCHEMA_WHERE_OPS.keys()].join(', ') + ') or pass a value');
          }
          // Several operators on one field read as AND, which is what
          // {gte, lt} means to anyone writing a range.
          for (const name of ops) {
            const op = __SCHEMA_WHERE_OPS.get(name);
            if (!op) {
              throw new Error("schema: unknown where() operator '" + name + "' on '" + k +
                "' — known operators: " + [...__SCHEMA_WHERE_OPS.keys()].join(', '));
            }
            this._clauses.push(op(col, v[name], this._params, k));
          }
        } else {
          this._clauses.push(col + ' = ?');
          this._params.push(v);
        }
      }
    }
    return this;
  }
  limit(n) { this._limit = __schemaPageInt(n, 'limit'); return this; }
  offset(n) { this._offset = __schemaPageInt(n, 'offset'); return this; }
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
      if (!__schemaIsPlainObject(entry)) {
        throw new Error('schema: order(spec) accepts a trusted SQL string, a {field: direction} ' +
          'object, or an array of them; got ' + (entry === null ? 'null' : typeof entry));
      }
      for (const [k, dir] of Object.entries(entry)) {
        parts.push(__schemaQuoteIdent(__schemaColumnFor(norm, k), norm.columns, 'order column') +
          ' ' + __schemaOrderDir(dir, k));
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
    this._includes.push(...__schemaNormalizeIncludes(specs));
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
    const parts = ['SELECT * FROM ' + __schemaQuoteIdent(n.tableName, null, 'table')];
    const where = this._whereParts(n);
    if (where.length) parts.push('WHERE ' + where.join(' AND '));
    if (this._order) parts.push('ORDER BY ' + this._order);
    if (this._limit != null) parts.push('LIMIT ' + this._limit);
    if (this._offset != null) parts.push('OFFSET ' + this._offset);
    return parts.join(' ');
  }
  async all() {
    this._applyDefaultScope();
    if (this._includes.length) __schemaValidateIncludes(this._def, this._includes);
    const sql = this._buildSQL();
    const res = await __schemaRunSQL(this._def, sql, this._params);
    const instances = (res.data || []).map((row) => this._def._hydrate(res.columns, row));
    // Eager loading: batched second queries that fill the relation
    // memos; never changes the root result set.
    if (this._includes.length && instances.length) {
      await __schemaPreload(this._def, instances, this._includes);
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
    const parts = ['SELECT COUNT(*) FROM ' + __schemaQuoteIdent(n.tableName, null, 'table')];
    const where = this._whereParts(n);
    if (where.length) parts.push('WHERE ' + where.join(' AND '));
    const res = await __schemaRunSQL(this._def, parts.join(' '), this._params);
    return res.data?.[0]?.[0] || 0;
  }
  // One UPDATE for every matching row — bypasses validation and
  // per-instance hooks (the bulk path).
  async updateAll(values) {
    __schemaAssertWhereOnly(this, 'updateAll');
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
      const column = __schemaColumnFor(n, k);
      const field = n.fields.get(__schemaFieldFor(n, column));
      const quoted = __schemaQuoteIdent(column, n.callerWritableColumns, 'updateAll column');
      sets.push(quoted + ' = ?');
      params.push(__schemaSerialize(values[k], field));
    }
    if (n.timestamps) {
      sets.push('"updated_at" = ?');
      params.push(new Date()); // a real Date — the adapter encodes it at the wire
    }
    const where = this._whereParts(n);
    let sql = 'UPDATE ' + __schemaQuoteIdent(n.tableName, null, 'table') + ' SET ' + sets.join(', ');
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const res = await __schemaRunSQL(this._def, sql, [...params, ...this._params]);
    return __schemaAffectedRows(res);
  }
  // One statement for every matching row: soft-delete aware (UPDATE
  // deleted_at on a @softDelete model, real DELETE otherwise);
  // bypasses per-instance hooks (the bulk path).
  async deleteAll() {
    __schemaAssertWhereOnly(this, 'deleteAll');
    this._applyDefaultScope();
    const n = this._def._normalize();
    const where = this._whereParts(n);
    let sql, params;
    if (n.softDelete && this._deleted === 'live') {
      sql = 'UPDATE ' + __schemaQuoteIdent(n.tableName, null, 'table') + ' SET "deleted_at" = ?';
      params = [new Date(), ...this._params]; // a real Date — the adapter encodes it at the wire
    } else {
      sql = 'DELETE FROM ' + __schemaQuoteIdent(n.tableName, null, 'table');
      params = this._params;
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const res = await __schemaRunSQL(this._def, sql, params);
    return __schemaAffectedRows(res);
  }
}

// ── eager loading ─────────────────────────────────────────────────────

// Normalize .includes arguments into [{name, children}] trees:
// strings, symbols, arrays, and nested maps to any depth.
function __schemaNormalizeIncludes(specs) {
  const out = [];
  for (const s of specs) {
    if (s == null) continue;
    if (typeof s === 'symbol') out.push({ name: Symbol.keyFor(s) || s.description, children: [] });
    else if (typeof s === 'string') out.push({ name: s, children: [] });
    else if (Array.isArray(s)) out.push(...__schemaNormalizeIncludes(s));
    else if (typeof s === 'object') {
      for (const [k, v] of Object.entries(s)) {
        out.push({ name: k, children: __schemaNormalizeIncludes([v]) });
      }
    }
  }
  return out;
}

function __schemaValidateIncludes(def, specs) {
  const norm = def._normalize();
  for (const spec of specs) {
    const rel = norm.relations.get(spec.name);
    if (!rel) {
      throw new Error(
        "schema: includes('" + spec.name + "') — no such relation on " + (def.name || 'model') +
        '. Declared relations: ' + ([...norm.relations.keys()].join(', ') || '(none)'));
    }
    const target = __SchemaRegistry.get(rel.target);
    if (!target) throw new Error('schema: unknown relation target "' + rel.target + '" from ' + (def.name || 'anon'));
    __schemaValidateRelationTarget(def, rel, target);
    if (spec.children.length) __schemaValidateIncludes(target, spec.children);
  }
}

function __schemaValidateRelationTarget(def, rel, target) {
  const targetNorm = target._normalize();
  if (!(targetNorm.columns instanceof Set)) {
    throw new Error(
      'schema: relation ' + (def.name || 'model') + '.' + rel.accessor +
      ' targets ' + rel.target + ', which is not a persisted :model');
  }
  if (rel.kind === 'belongsTo') {
    __schemaQuoteIdent(targetNorm.primaryKeyColumn, targetNorm.columns, 'relation primary key');
  } else if (rel.through) {
    // Both keys live on the join model, and resolving them is the
    // whole check — the target only has to have a primary key to be
    // looked up by.
    __schemaQuoteIdent(targetNorm.primaryKeyColumn, targetNorm.columns, 'relation primary key');
    __schemaThroughKeys(def, rel, __schemaJoinModel(def, rel));
  } else {
    __schemaQuoteIdent(rel.foreignKey, targetNorm.columns, 'relation key');
  }
  return targetNorm;
}

function __schemaJoinModel(def, rel) {
  const join = __SchemaRegistry.get(rel.through);
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
async function __schemaThroughPairs(def, rel, join, keys, identities) {
  if (!identities.length) return [];
  const sql = 'SELECT ' + __schemaQuoteIdent(keys.ownerKey, keys.joinNorm.columns, 'through owner key') +
    ', ' + __schemaQuoteIdent(keys.targetKey, keys.joinNorm.columns, 'through target key') +
    ' FROM ' + __schemaQuoteIdent(keys.joinNorm.tableName, null, 'table') +
    ' WHERE ' + __schemaQuoteIdent(keys.ownerKey, keys.joinNorm.columns, 'through owner key') +
    ' IN (' + identities.map(() => '?').join(', ') + ')' +
    (keys.joinNorm.softDelete ? ' AND "deleted_at" IS NULL' : '');
  const res = await __schemaRunSQL(join, sql, identities);
  return (res.data || []).filter((row) => row[1] != null);
}

// Batched preload: one query per relation per nesting level (WHERE fk
// IN (…)), never JOINs — no row duplication, uniform across relation
// kinds. Results land in the relation memo, so accessors resolve from
// cache with no query.
async function __schemaPreload(def, instances, specs) {
  if (!instances.length || !specs.length) return;
  const norm = def._normalize();
  for (const spec of specs) {
    const rel = norm.relations.get(spec.name);
    if (!rel) {
      throw new Error(
        "schema: includes('" + spec.name + "') — no such relation on " + (def.name || 'model') +
        '. Declared relations: ' + ([...norm.relations.keys()].join(', ') || '(none)'));
    }
    const target = __SchemaRegistry.get(rel.target);
    if (!target) throw new Error('schema: unknown relation target "' + rel.target + '" from ' + (def.name || 'anon'));
    const targetNorm = __schemaValidateRelationTarget(def, rel, target);
    const children = [];
    // Capture the cache request before any await. Reload/absorption bumps
    // the generation, and mutable FKs can change identity independently;
    // either change makes this preload result ineligible for memoization.
    const requests = new Map();
    for (const inst of instances) {
      requests.set(inst, {
        generation: inst._relGeneration,
        identity: __schemaRelationIdentity(def, inst, rel),
      });
    }
    const current = (inst, request) =>
      inst._relGeneration === request.generation &&
      __schemaSameValue(__schemaRelationIdentity(def, inst, rel), request.identity);
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
        __schemaRelMemoSet(inst, spec.name, request.identity, v);
        if (v && !children.includes(v)) children.push(v);
      }
    } else if (rel.through) {
      // Three steps, all set-based: the join rows for every owner at
      // once, then the distinct targets in one findMany, then group.
      const join = __schemaJoinModel(def, rel);
      const keys = __schemaThroughKeys(def, rel, join);
      const ids = [...new Set([...requests.values()].map((r) => r.identity).filter((v) => v != null))];
      const pairs = await __schemaThroughPairs(def, rel, join, keys, ids);
      const targetIds = [...new Set(pairs.map((p) => p[1]))];
      const rows = targetIds.length ? await target.findMany(targetIds) : [];
      const byId = new Map(rows.map((r) => [r[targetNorm.primaryKey], r]));
      const groups = new Map();
      for (const [ownerId, targetId] of pairs) {
        const r = byId.get(targetId);
        if (!r) continue; // a dangling join row names no target
        if (!groups.has(ownerId)) groups.set(ownerId, []);
        groups.get(ownerId).push(r);
        if (!children.includes(r)) children.push(r);
      }
      for (const inst of instances) {
        const request = requests.get(inst);
        if (!current(inst, request)) continue;
        const g = groups.get(request.identity) || [];
        __schemaRelMemoSet(inst, spec.name, request.identity,
          rel.kind === 'hasOne' ? (g[0] ?? null) : g);
      }
    } else {
      const fkCamel = __schemaFieldFor(targetNorm, rel.foreignKey);
      const ids = [...new Set([...requests.values()].map((request) => request.identity))];
      let rows = [];
      if (ids.length) {
        rows = await new __SchemaQuery(target)
          .where(__schemaQuoteIdent(rel.foreignKey, targetNorm.columns, 'relation key') + ' IN (' + ids.map(() => '?').join(', ') + ')', ...ids)
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
        __schemaRelMemoSet(
          inst, spec.name, request.identity,
          rel.kind === 'hasOne' ? (g[0] ?? null) : g);
      }
    }
    if (spec.children.length) await __schemaPreload(target, children, spec.children);
  }
}

// ── writing a `through` relation ──────────────────────────────────────
//
// The link is a ROW, not a column, so linking and unlinking are the
// join model's INSERTs and DELETEs — and they go THROUGH the join
// model rather than around it: `insertMany` validates every row and
// respects the join's own fields, defaults, and `@timestamps`, and
// `deleteAll` respects its `@softDelete`. A join model with required
// columns of its own is therefore usable: pass them as `attrs`.
//
// Hooks are skipped, which is `insertMany`'s documented bulk-path
// contract; a join row needing per-row hooks is a model the caller
// should create directly.

// The pieces every write needs: the join model, its two columns, the
// owner's identity, and the target identities being named.
function __schemaThroughPlan(def, inst, rel, acc, items, api) {
  const join = __schemaJoinModel(def, rel);
  const keys = __schemaThroughKeys(def, rel, join);
  const identity = __schemaPersistedIdentity(def, inst, api);
  const list = items == null ? [] : (Array.isArray(items) ? items : [items]);
  const targetNorm = __SchemaRegistry.get(rel.target)?._normalize();
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
async function __schemaThroughLinked(def, rel, plan) {
  const pairs = await __schemaThroughPairs(def, rel, plan.join, plan.keys, [plan.identity]);
  return new Set(pairs.map((p) => p[1]));
}

// Every write invalidates the memo: the relation's value changed, and
// the accessor must not answer from a cache that predates it.
function __schemaThroughInvalidate(inst, acc) {
  inst._relGeneration++;
  if (inst._relMemo) inst._relMemo.delete(acc);
}

// Linking something already linked is a no-op rather than a second
// row — duplicate join rows would show up as duplicate targets on the
// read side, which nothing else in the relation surface produces.
async function __schemaThroughAdd(def, inst, rel, acc, items, attrs) {
  const api = 'add' + acc[0].toUpperCase() + acc.slice(1) + '()';
  const plan = __schemaThroughPlan(def, inst, rel, acc, items, api);
  if (!plan.targetIds.length) return 0;
  const linked = await __schemaThroughLinked(def, rel, plan);
  const fresh = plan.targetIds.filter((id) => !linked.has(id));
  if (!fresh.length) return 0;
  const joinNorm = plan.keys.joinNorm;
  const ownerField = __schemaFieldFor(joinNorm, plan.keys.ownerKey);
  const targetField = __schemaFieldFor(joinNorm, plan.keys.targetKey);
  if (attrs != null && !__schemaIsPlainObject(attrs)) {
    throw new Error('schema: ' + api + ' attrs must be a plain object of ' + rel.through +
      ' columns; got ' + (attrs === null ? 'null' : typeof attrs));
  }
  await plan.join.insertMany(fresh.map((id) => ({
    ...(attrs || {}),
    [ownerField]: plan.identity,
    [targetField]: id,
  })));
  __schemaThroughInvalidate(inst, acc);
  return fresh.length;
}

async function __schemaThroughRemove(def, inst, rel, acc, items) {
  const api = 'remove' + acc[0].toUpperCase() + acc.slice(1) + '()';
  const plan = __schemaThroughPlan(def, inst, rel, acc, items, api);
  if (!plan.targetIds.length) return 0;
  const removed = await __schemaThroughUnlink(def, rel, plan, plan.targetIds);
  __schemaThroughInvalidate(inst, acc);
  return removed;
}

// Make the link set exactly this. Both halves are computed from one
// read of the current set, so `set` costs the same round trips as an
// add and a remove that already knew what to do.
async function __schemaThroughSet(def, inst, rel, acc, items, attrs) {
  const api = 'set' + acc[0].toUpperCase() + acc.slice(1) + '()';
  const plan = __schemaThroughPlan(def, inst, rel, acc, items, api);
  const linked = await __schemaThroughLinked(def, rel, plan);
  const wanted = new Set(plan.targetIds);
  const stale = [...linked].filter((id) => !wanted.has(id));
  const fresh = plan.targetIds.filter((id) => !linked.has(id));
  let removed = 0;
  if (stale.length) removed = await __schemaThroughUnlink(def, rel, plan, stale);
  if (fresh.length) {
    const joinNorm = plan.keys.joinNorm;
    await plan.join.insertMany(fresh.map((id) => ({
      ...(attrs || {}),
      [__schemaFieldFor(joinNorm, plan.keys.ownerKey)]: plan.identity,
      [__schemaFieldFor(joinNorm, plan.keys.targetKey)]: id,
    })));
  }
  if (removed || fresh.length) __schemaThroughInvalidate(inst, acc);
  return { added: fresh.length, removed };
}

// Through the join model's own query builder, so a `@softDelete` join
// soft-deletes and a plain one really deletes — one rule, stated once,
// in `deleteAll`.
function __schemaThroughUnlink(def, rel, plan, targetIds) {
  const { joinNorm, ownerKey, targetKey } = plan.keys;
  const where = __schemaQuoteIdent(ownerKey, joinNorm.columns, 'through owner key') + ' = ?' +
    ' AND ' + __schemaQuoteIdent(targetKey, joinNorm.columns, 'through target key') +
    ' IN (' + targetIds.map(() => '?').join(', ') + ')';
  return new __SchemaQuery(plan.join).where(where, plan.identity, ...targetIds).deleteAll();
}

function __schemaRelationIdentity(def, inst, rel) {
  if (rel.kind === 'belongsTo') return inst[__schemaFieldFor(def._normalize(), rel.foreignKey)];
  return __schemaPersistedIdentity(def, inst, 'resolve relation ' + rel.accessor);
}

async function __schemaResolveRelation(def, rel, identity) {
  const target = __SchemaRegistry.get(rel.target);
  if (!target) throw new Error('schema: unknown relation target "' + rel.target + '" from ' + (def.name || 'anon'));
  const targetNorm = __schemaValidateRelationTarget(def, rel, target);
  if (rel.kind === 'belongsTo') {
    return identity != null ? await target.find(identity) : null;
  }
  if (rel.through) {
    const join = __schemaJoinModel(def, rel);
    const keys = __schemaThroughKeys(def, rel, join);
    const pairs = identity != null
      ? await __schemaThroughPairs(def, rel, join, keys, [identity])
      : [];
    const targetIds = [...new Set(pairs.map((p) => p[1]))];
    const found = targetIds.length ? await target.findMany(targetIds) : [];
    return rel.kind === 'hasOne' ? (found[0] ?? null) : found;
  }
  if (rel.kind === 'hasOne') {
    return await new __SchemaQuery(target).where(__schemaQuoteIdent(rel.foreignKey, targetNorm.columns, 'relation key') + ' = ?', identity).first();
  }
  if (rel.kind === 'hasMany') {
    return await new __SchemaQuery(target).where(__schemaQuoteIdent(rel.foreignKey, targetNorm.columns, 'relation key') + ' = ?', identity).all();
  }
  return null;
}

// ── save / destroy ────────────────────────────────────────────────────

async function __schemaRunHook(def, inst, name) {
  const fn = def._normalize().hooks.get(name);
  if (fn) await fn.call(inst);
}

// After a successful save/destroy: queue afterCommit/afterRollback on
// the ambient transaction, or fire afterCommit immediately when no
// transaction is open. Only models declaring one of the two hooks pay
// any cost here.
async function __schemaSettleTxHooks(def, inst) {
  const hooks = def._normalize().hooks;
  if (!hooks.has('afterCommit') && !hooks.has('afterRollback')) return;
  if (!__schemaEnqueueTxHook(def, inst)) {
    await __schemaRunHook(def, inst, 'afterCommit');
  }
}

async function __schemaSave(def, inst) {
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
  const persistedIdentity = isNew ? null : __schemaPersistedIdentity(def, inst, 'save()');

  await __schemaRunHook(def, inst, 'beforeValidation');
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
  await __schemaRunHook(def, inst, 'afterValidation');

  await __schemaRunHook(def, inst, 'beforeSave');
  if (isNew) await __schemaRunHook(def, inst, 'beforeCreate');
  else       await __schemaRunHook(def, inst, 'beforeUpdate');

  // savedChanges resets at the start of every save so it always
  // reflects the most recent write; afterCreate/afterUpdate/afterSave
  // read the just-completed diff.
  inst.savedChanges = new Map();

  if (isNew) {
    // Checked after every before-hook ran — a hook is one more channel
    // that can set the pk, and both postures care which way it went.
    // A natural key is the caller's to supply and the INSERT's to
    // write; a surrogate is the runtime's, and a preset value would
    // arm the RETURNING check below to pass on a garbage response.
    if (norm.naturalKey) {
      if (inst[norm.primaryKey] == null) {
        throw __schemaMissingPkError(def, 'save()', norm.primaryKey);
      }
    } else if (inst[norm.primaryKey] != null) {
      throw __schemaCallerPkError(def, 'save()', norm.primaryKey);
    }
    const cols = [], placeholders = [], values = [];
    const writtenColumns = [];
    for (const [n, f] of norm.fields) {
      const v = inst[n];
      if (v == null) continue;
      cols.push(__schemaQuoteIdent(norm.columnOf.get(n), norm.callerWritableColumns, 'insert column'));
      placeholders.push('?');
      values.push(__schemaSerialize(v, f));
      writtenColumns.push([n, v]);
    }
    // belongsTo FKs live as camelCase properties on the instance.
    for (const [, rel] of norm.relations) {
      if (rel.kind !== 'belongsTo') continue;
      const fkCamel = __schemaFieldFor(norm, rel.foreignKey);
      const v = inst[fkCamel];
      if (v != null) {
        cols.push(__schemaQuoteIdent(rel.foreignKey, norm.callerWritableColumns, 'insert column'));
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
      ? 'INSERT INTO ' + __schemaQuoteIdent(norm.tableName, null, 'table') + ' (' + cols.join(', ') + ') VALUES (' + placeholders.join(', ') + ') RETURNING *'
      : 'INSERT INTO ' + __schemaQuoteIdent(norm.tableName, null, 'table') + ' DEFAULT VALUES RETURNING *';
    const res = await __schemaRunSQL(def, sql, values);
    if (res.data?.[0] && res.columns) {
      __schemaAbsorbRow(inst, res.columns, res.data[0], 'row absorption', norm);
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
    inst._snapshot = __schemaSnapshot(norm, inst);
    inst._persisted = true;
    // INSERT records [null, newValue] per written column; @timestamps
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
      const changed = !snap || !Object.prototype.hasOwnProperty.call(snap, n) || !__schemaSnapshotEqual(snap[n], cur);
      if (!isDirty && !changed) continue;
      if (!nextSnap) nextSnap = Object.assign(Object.create(null), snap || {});
      const written = __schemaSnapshotValue(cur);
      sets.push(__schemaQuoteIdent(norm.columnOf.get(n), norm.callerWritableColumns, 'update column') + ' = ?');
      values.push(__schemaSerialize(written, f));
      nextSnap[n] = written;
      const old = snap && Object.prototype.hasOwnProperty.call(snap, n) ? snap[n] : null;
      changes.set(n, [old, written]);
      if (isDirty) dirtyVersions.set(n, inst._dirtyVersions.get(n));
    }
    // belongsTo FK columns: same machinery; the SQL column name is
    // already snake_case and FKs are scalar IDs (no serialize).
    for (const [, rel] of norm.relations) {
      if (rel.kind !== 'belongsTo') continue;
      const fkCamel = __schemaFieldFor(norm, rel.foreignKey);
      const cur = inst[fkCamel];
      const isDirty = dirty && dirty.has(fkCamel);
      const changed = !snap || !Object.prototype.hasOwnProperty.call(snap, fkCamel) || !__schemaSnapshotEqual(snap[fkCamel], cur);
      if (!isDirty && !changed) continue;
      if (!nextSnap) nextSnap = Object.assign(Object.create(null), snap || {});
      const written = __schemaSnapshotValue(cur);
      sets.push(__schemaQuoteIdent(rel.foreignKey, norm.callerWritableColumns, 'update column') + ' = ?');
      values.push(written);
      nextSnap[fkCamel] = written;
      const old = snap && Object.prototype.hasOwnProperty.call(snap, fkCamel) ? snap[fkCamel] : null;
      changes.set(fkCamel, [old, written]);
      if (isDirty) dirtyVersions.set(fkCamel, inst._dirtyVersions.get(fkCamel));
    }
    // @timestamps: bump updated_at iff this UPDATE will actually emit
    // SQL — never on a no-op save. The column is not in _snapshot (it
    // is always overwritten on real writes, never diffed); declaring
    // updatedAt as a user field is rejected at normalize, so a
    // duplicate SET cannot arise.
    if (norm.timestamps && sets.length > 0) {
      const newTs = new Date(); // a real Date — the adapter encodes it at the wire
      const oldTs = inst.updatedAt != null ? inst.updatedAt : null;
      sets.push('"updated_at" = ?');
      values.push(newTs);
      inst.updatedAt = newTs;
      changes.set('updatedAt', [oldTs, newTs]);
    }
    if (sets.length) {
      const pk = norm.primaryKeyColumn;
      values.push(persistedIdentity);
      const sql = 'UPDATE ' + __schemaQuoteIdent(norm.tableName, null, 'table') +
        ' SET ' + sets.join(', ') + ' WHERE ' +
        __schemaQuoteIdent(pk, norm.columns, 'primary key') + ' = ?';
      await __schemaRunSQL(def, sql, values);
      inst._snapshot = nextSnap;
      for (const [name, version] of dirtyVersions) {
        if (inst._dirtyVersions.get(name) === version) inst._dirty.delete(name);
      }
    }
  }

  if (isNew) await __schemaRunHook(def, inst, 'afterCreate');
  else       await __schemaRunHook(def, inst, 'afterUpdate');
  await __schemaRunHook(def, inst, 'afterSave');
  await __schemaSettleTxHooks(def, inst);
  return inst;

  } finally {
    inst._saving = false;
  }
}

// Validate one adapter row before any caller reads or absorbs it.
// Column names canonicalize through the same snake→camel boundary as
// instances; two spellings for one canonical key would otherwise let
// the later value silently overwrite an identity or conflict target.
function __schemaValidateAdapterRow(columns, row, operation, norm) {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(row) ||
      row.length !== columns.length) {
    throw new Error(
      'schema: ' + operation + ' adapter invariant — expected named columns and one matching row');
  }
  const indexes = new Map();
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (!column || typeof column.name !== 'string' || !column.name.length) {
      throw new Error(
        'schema: ' + operation + ' adapter invariant — every column needs a non-empty string name');
    }
    const canonical = norm ? __schemaFieldFor(norm, column.name) : __schemaCamel(column.name);
    if (indexes.has(canonical)) {
      throw new Error(
        "schema: " + operation + " adapter invariant — duplicate canonical column '" +
        canonical + "'");
    }
    indexes.set(canonical, i);
  }
  return indexes;
}

// Absorb a RETURNING row onto an instance: camelCase canonical own
// properties plus non-enumerable snake_case aliases. Shared by the
// INSERT path, upsert, and hydrate's column loop below.
function __schemaAbsorbRow(inst, columns, row, operation = 'row absorption', norm = null) {
  __schemaValidateAdapterRow(columns, row, operation, norm);
  if (typeof inst._relGeneration === 'number') {
    inst._relGeneration++;
    if (inst._relMemo) inst._relMemo.clear();
  }
  for (let i = 0; i < columns.length; i++) {
    const snake = columns[i].name;
    const key = norm ? __schemaFieldFor(norm, snake) : __schemaCamel(snake);
    if (!(key in inst)) {
      Object.defineProperty(inst, key, { value: row[i], enumerable: true, writable: true, configurable: true });
    } else {
      inst[key] = row[i];
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

async function __schemaDestroy(def, inst, opts) {
  if (!inst._persisted) return inst;
  const norm = def._normalize();
  const identity = __schemaPersistedIdentity(def, inst, 'destroy()');
  const hard = opts && opts.hard === true;
  await __schemaRunHook(def, inst, 'beforeDestroy');
  if (norm.softDelete && !hard) {
    const now = new Date(); // a real Date — the adapter encodes it at the wire
    await __schemaRunSQL(def, 'UPDATE ' + __schemaQuoteIdent(norm.tableName, null, 'table') +
      ' SET "deleted_at" = ? WHERE ' + __schemaQuoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?',
    [now, identity]);
    inst.deletedAt = now;
  } else {
    await __schemaRunSQL(def, 'DELETE FROM ' + __schemaQuoteIdent(norm.tableName, null, 'table') +
      ' WHERE ' + __schemaQuoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?', [identity]);
    inst._persisted = false;
  }
  await __schemaRunHook(def, inst, 'afterDestroy');
  await __schemaSettleTxHooks(def, inst);
  return inst;
}

// Soft-delete recovery: deleted_at = NULL, firing the update
// lifecycle. Loud on models without @softDelete.
async function __schemaRestore(def, inst) {
  const norm = def._normalize();
  if (!norm.softDelete) {
    throw new Error('schema: restore() requires @softDelete on ' + (def.name || 'model'));
  }
  if (!inst._persisted) return inst;
  const identity = __schemaPersistedIdentity(def, inst, 'restore()');
  await __schemaRunHook(def, inst, 'beforeUpdate');
  await __schemaRunSQL(def, 'UPDATE ' + __schemaQuoteIdent(norm.tableName, null, 'table') +
    ' SET "deleted_at" = NULL WHERE ' + __schemaQuoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?',
  [identity]);
  inst.deletedAt = null;
  await __schemaRunHook(def, inst, 'afterUpdate');
  return inst;
}

async function __schemaReload(def, inst) {
  const norm = def._normalize();
  const identity = __schemaPersistedIdentity(def, inst, 'reload()');
  // Invalidate every relation request that began against the old
  // instance image before the reload crosses its await boundary.
  inst._relGeneration++;
  const sql = 'SELECT * FROM ' + __schemaQuoteIdent(norm.tableName, null, 'table') +
    ' WHERE ' + __schemaQuoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' = ?';
  const res = await __schemaRunSQL(def, sql, [identity]);
  const data = Array.isArray(res?.data) ? res.data : [];
  if (!Array.isArray(res?.columns) || data.length !== 1) {
    throw new Error(
      'schema: reload() identity invariant for ' + (def.name || 'model') + ' ' +
      norm.primaryKey + '=' + String(identity) + ' expected exactly one row; got ' + data.length);
  }
  const indexes = __schemaValidateAdapterRow(res.columns, data[0], 'reload()', norm);
  const pkIndex = indexes.get(norm.primaryKey);
  const returnedIdentity = pkIndex !== undefined ? data[0][pkIndex] : undefined;
  if (!__schemaSameValue(returnedIdentity, identity)) {
    throw new Error(
      'schema: reload() identity invariant for ' + (def.name || 'model') +
      ' requested ' + String(identity) + ' but the adapter returned ' +
      String(returnedIdentity));
  }
  __schemaAbsorbRow(inst, res.columns, data[0], 'reload()', norm);
  def._applyEagerDerived(inst);
  inst._snapshot = __schemaSnapshot(norm, inst);
  inst._dirty.clear();
  inst.savedChanges = new Map();
  if (inst._relMemo) inst._relMemo.clear();
  return inst;
}

function __schemaSerialize(v, field) {
  if (field && field.typeName === 'json' && v != null && typeof v === 'object') {
    return JSON.stringify(v);
  }
  return v;
}

// Compare values at the SQL adapter boundary without erasing type
// identity. JSON objects take the same wire representation used for
// writes; temporal values compare by their represented instant because
// adapters return fresh Date objects. All other values remain exact.
function __schemaCanonicalDBValue(v, field) {
  const serialized = __schemaSerialize(v, field);
  return serialized instanceof Date ? serialized.getTime() : serialized;
}

function __schemaReturnedRow(res, operation, allowZero) {
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
  const indexes = __schemaValidateAdapterRow(columns, row, operation + ' RETURNING');
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
function __schemaCallerPkError(def, api, pk) {
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
function __schemaMissingPkError(def, api, pk) {
  return new SchemaError([{
    field: pk,
    error: 'required',
    message: 'schema: ' + api + ' on ' + (def.name || 'model') + ' has no ' + pk +
      ' — ' + pk + ' is declared as a field, which makes it a caller-supplied ' +
      'natural key: nothing generates it, so the INSERT has no identity to write',
  }], def.name, def.kind);
}

function __schemaCanonicalInput(def, data, api) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const norm = def._normalize();
  const writable = new Map();
  for (const [name] of norm.fields) {
    writable.set(name, name);
    writable.set(norm.columnOf.get(name), name);
  }
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const name = __schemaFieldFor(norm, rel.foreignKey);
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
        ? __schemaCallerPkError(def, api, norm.primaryKey).message
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

async function __schemaNormalizePersistenceInput(def, data, opts) {
  const canonical = __schemaCanonicalInput(def, data, opts?.api || 'create()');
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

function __schemaConstructInputInstance(def, canonical) {
  const inst = new (def._getClass())(canonical, false);
  for (const [k, v] of Object.entries(canonical)) {
    if (!(k in inst)) {
      Object.defineProperty(inst, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
  }
  return inst;
}

// ── ORM statics on __SchemaDef ────────────────────────────────────────

__SchemaDef.prototype._assertModel = function (api) {
  if (this.kind !== 'model') {
    throw new Error('schema: .' + api + '() is :model-only (got :' + this.kind + ')');
  }
};

__SchemaDef.prototype.find = async function (id) {
  this._assertModel('find');
  // Routed through the builder so find honors the same filters as
  // every other read: the @softDelete filter and @defaultScope.
  // `unscoped().where(id: …).first!` is the escape hatch.
  const norm = this._normalize();
  return new __SchemaQuery(this).where({ [norm.primaryKey]: id }).first();
};

__SchemaDef.prototype.findMany = async function (ids) {
  this._assertModel('findMany');
  if (!Array.isArray(ids)) throw new Error('schema: findMany(ids) expects an array');
  if (!ids.length) return [];
  const norm = this._normalize();
  return new __SchemaQuery(this)
    .where(__schemaQuoteIdent(norm.primaryKeyColumn, norm.columns, 'primary key') + ' IN (' + ids.map(() => '?').join(', ') + ')', ...ids)
    .all();
};

__SchemaDef.prototype.where = function (cond, ...params) {
  this._assertModel('where');
  return new __SchemaQuery(this).where(cond, ...params);
};

__SchemaDef.prototype.includes = function (...specs) {
  this._assertModel('includes');
  return new __SchemaQuery(this).includes(...specs);
};

__SchemaDef.prototype.withDeleted = function () {
  this._assertModel('withDeleted');
  return new __SchemaQuery(this).withDeleted();
};

__SchemaDef.prototype.onlyDeleted = function () {
  this._assertModel('onlyDeleted');
  return new __SchemaQuery(this).onlyDeleted();
};

__SchemaDef.prototype.unscoped = function () {
  this._assertModel('unscoped');
  return new __SchemaQuery(this).unscoped();
};

__SchemaDef.prototype.all = function () {
  this._assertModel('all');
  return new __SchemaQuery(this).all();
};

__SchemaDef.prototype.first = function () {
  this._assertModel('first');
  return new __SchemaQuery(this).first();
};

__SchemaDef.prototype.count = function () {
  this._assertModel('count');
  return new __SchemaQuery(this).count();
};

__SchemaDef.prototype.create = async function (data) {
  this._assertModel('create');
  // Normalize caller input before construction. Refinements run once
  // after beforeValidation inside save(), so hooks can still affect
  // the value they judge without transforms/coercions/defaults
  // running a second time.
  const canonical = await __schemaNormalizePersistenceInput(this, data, {
    skipEnsures: true,
    api: 'create()',
  });
  const inst = __schemaConstructInputInstance(this, canonical);
  await __schemaSave(this, inst);
  return inst;
};

// INSERT … ON CONFLICT (target) DO UPDATE/NOTHING RETURNING *.
// Validation and beforeSave run before the statement. A returned row
// completes the save lifecycle; a DO NOTHING conflict hydrates the
// authoritative row without save-completion hooks. beforeCreate /
// beforeUpdate never fire because the runtime cannot know the
// database branch before execution.
__SchemaDef.prototype.upsert = async function (data, opts) {
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
    return __schemaColumnFor(norm, text);
  });
  if (new Set(targets).size !== targets.length) {
    throw new Error('schema: upsert() conflict target columns must be distinct');
  }
  for (const t of targets) __schemaQuoteIdent(t, norm.conflictColumns, 'conflict target');
  const targetKey = [...targets].sort().join('\u0000');
  if (!norm.conflictTargetKeys.has(targetKey)) {
    throw new Error(
      'schema: upsert() conflict target (' + targets.join(', ') +
      ') must exactly match a declared primary key, unique field, or @unique tuple');
  }

  const canonical = await __schemaNormalizePersistenceInput(this, data, {
    skipEnsures: true,
    api: 'upsert()',
  });
  const inst = __schemaConstructInputInstance(this, canonical);

  await __schemaRunHook(this, inst, 'beforeValidation');
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
  await __schemaRunHook(this, inst, 'afterValidation');
  await __schemaRunHook(this, inst, 'beforeSave');

  if (norm.naturalKey) {
    if (inst[norm.primaryKey] == null) {
      throw __schemaMissingPkError(this, 'upsert()', norm.primaryKey);
    }
  } else if (inst[norm.primaryKey] != null) {
    throw __schemaCallerPkError(this, 'upsert()', norm.primaryKey);
  }

  const cols = [], placeholders = [], values = [];
  const plannedValues = new Map();
  for (const [n, f] of norm.fields) {
    const v = inst[n];
    if (v == null) continue;
    const column = norm.columnOf.get(n);
    cols.push(column);
    placeholders.push('?');
    const serialized = __schemaSerialize(v, f);
    values.push(serialized);
    plannedValues.set(column, serialized);
  }
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const v = inst[__schemaFieldFor(norm, rel.foreignKey)];
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
  let conflict = ' ON CONFLICT (' + targets.map((t) => __schemaQuoteIdent(t, norm.conflictColumns, 'conflict target')).join(', ') + ')';
  if (updateCols.length) {
    const sets = updateCols.map((c) => {
      const quoted = __schemaQuoteIdent(c, norm.callerWritableColumns, 'upsert column');
      return quoted + ' = EXCLUDED.' + quoted;
    });
    if (norm.timestamps) sets.push('"updated_at" = CURRENT_TIMESTAMP');
    conflict += ' DO UPDATE SET ' + sets.join(', ');
  } else {
    conflict += ' DO NOTHING';
  }
  const sql = 'INSERT INTO ' + __schemaQuoteIdent(norm.tableName, null, 'table') + ' (' +
    cols.map((c) => __schemaQuoteIdent(c, norm.callerWritableColumns, 'upsert column')).join(', ') + ')' +
    ' VALUES (' + placeholders.join(', ') + ')' + conflict + ' RETURNING *';
  const res = await __schemaRunSQL(this, sql, values);
  const returned = __schemaReturnedRow(res, 'upsert()', updateCols.length === 0);
  if (returned) {
    __schemaAbsorbRow(inst, returned.columns, returned.row, 'upsert() RETURNING', norm);
    this._applyEagerDerived(inst);
    inst._snapshot = __schemaSnapshot(norm, inst);
    inst._persisted = true;
    __schemaPersistedIdentity(this, inst, 'upsert()');
    await __schemaRunHook(this, inst, 'afterSave');
    await __schemaSettleTxHooks(this, inst);
    return inst;
  }
  const lookupSQL = 'SELECT * FROM ' + __schemaQuoteIdent(norm.tableName, null, 'table') +
    ' WHERE ' + targets.map((target) =>
      __schemaQuoteIdent(target, norm.conflictColumns, 'conflict target') + ' = ?').join(' AND ');
  const lookup = await __schemaRunSQL(this, lookupSQL, targetValues);
  const found = Array.isArray(lookup?.data) ? lookup.data : [];
  if (!Array.isArray(lookup?.columns) || found.length !== 1) {
    throw new Error(
      'schema: upsert() conflict lookup invariant for ' + (this.name || 'model') +
      ' expected exactly one row by (' + targets.join(', ') + '); got ' + found.length);
  }
  const canonicalIndexes = __schemaValidateAdapterRow(
    lookup.columns, found[0], 'upsert() conflict lookup', norm);
  const lookupColumns = new Map();
  for (const [canonical, index] of canonicalIndexes) {
    lookupColumns.set(__schemaColumnFor(norm, canonical), index);
  }
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const columnIndex = lookupColumns.get(target);
    if (columnIndex === undefined) {
      throw new Error(
        "schema: upsert() conflict lookup invariant — returned row is missing target column '" +
        target + "'");
    }
    const field = norm.fields.get(__schemaFieldFor(norm, target));
    const requested = __schemaCanonicalDBValue(targetValues[i], field);
    const actual = __schemaCanonicalDBValue(found[0][columnIndex], field);
    if (!__schemaSameValue(actual, requested)) {
      throw new Error(
        "schema: upsert() conflict lookup invariant — returned target column '" + target +
        "' does not match the requested value");
    }
  }
  const existing = this._hydrate(lookup.columns, found[0]);
  __schemaPersistedIdentity(this, existing, 'upsert() conflict lookup');
  return existing;
};

// Bulk insert: validates EVERY row first (all failures collect into
// one SchemaError, issues prefixed [i].field, before any SQL), then
// one multi-VALUES INSERT … RETURNING *. Per-instance hooks are
// deliberately skipped — this is the bulk path.
__SchemaDef.prototype.insertMany = async function (rows) {
  this._assertModel('insertMany');
  if (!Array.isArray(rows)) throw new Error('schema: insertMany(rows) expects an array');
  if (!rows.length) return [];
  const norm = this._normalize();

  const canonicalRows = [];
  const allErrs = [];
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i];
    const rowErrs = [];
    let canonical = null;
    try {
      canonical = __schemaCanonicalInput(this, data, 'insertMany()');
      const result = await this._runAsync(canonical, {
        materialize: false,
        materializeNested: true,
        derived: 'throw',
      });
      if (result.ok) canonical = result.value;
      else if (result.thrown) throw result.thrown;
      else {
        const src = result.from || this;
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
  if (allErrs.length) throw new SchemaError(allErrs, this.name, this.kind);

  // Column set = union of written columns across rows (missing values
  // insert as NULL / column default).
  const colSet = new Set();
  for (const row of canonicalRows) {
    for (const [n] of norm.fields) if (row[n] != null) colSet.add(n);
    for (const [, rel] of norm.relations) {
      if (rel.kind !== 'belongsTo') continue;
      const fk = __schemaFieldFor(norm, rel.foreignKey);
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
      values.push(__schemaSerialize(row[n] ?? null, norm.fields.get(n)));
    }
    tuples.push('(' + slots.join(', ') + ')');
  }
  const sql = 'INSERT INTO ' + __schemaQuoteIdent(norm.tableName, null, 'table') + ' (' +
    colNames.map((n) => __schemaQuoteIdent(__schemaColumnFor(norm, n), norm.callerWritableColumns, 'insertMany column')).join(', ') + ') VALUES ' +
    tuples.join(', ') + ' RETURNING *';
  const res = await __schemaRunSQL(this, sql, values);
  return (res.data || []).map((row) => this._hydrate(res.columns, row));
};

// ── hydration ─────────────────────────────────────────────────────────

__SchemaDef.prototype._hydrate = function (columns, row) {
  this._assertModel('_hydrate');
  // DB rows are trusted: hydrate into a class instance without
  // transforms, defaults, constraints, or refinements. Column names
  // arrive snake_case; properties live under camelCase with
  // non-enumerable snake aliases. Values are stored verbatim as
  // delivered by the adapter — temporals arrive already decoded to
  // real `Date` objects at the wire seam (the adapter keys the decode
  // off each column's duckdbType), and hydrate stores them verbatim.
  const norm = this._normalize();
  const data = {};
  for (let i = 0; i < columns.length; i++) {
    data[__schemaFieldFor(norm, columns[i].name)] = row[i];
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
    const camel = __schemaFieldFor(norm, snake);
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
  inst._snapshot = __schemaSnapshot(norm, inst);
  return inst;
};

// ── the model class: instance wiring ──────────────────────────────────

const __schemaBaseGetClass = __SchemaDef.prototype._getClass;

__SchemaDef.prototype._getClass = function () {
  if (this.kind !== 'model') return __schemaBaseGetClass.call(this);
  if (this._modelKlass) return this._modelKlass;
  const def = this;
  const norm = this._normalize();
  const Base = __schemaBaseGetClass.call(this);
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
        const identity = __schemaRelationIdentity(def, this, rel);
        const generation = this._relGeneration;
        const memo = this._relMemo && this._relMemo.get(acc);
        if (!(opts && opts.reload === true) && memo &&
            __schemaSameValue(memo.identity, identity)) {
          return memo.value;
        }
        const v = await __schemaResolveRelation(def, rel, identity);
        if (this._relGeneration === generation &&
            __schemaSameValue(__schemaRelationIdentity(def, this, rel), identity)) {
          __schemaRelMemoSet(this, acc, identity, v);
        }
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
      verb('add', __schemaThroughAdd);
      verb('remove', __schemaThroughRemove);
      verb('set', __schemaThroughSet);
    }
  }

  Object.defineProperty(klass.prototype, 'save', {
    enumerable: false, configurable: true, writable: true,
    value: async function () { return __schemaSave(def, this); },
  });
  Object.defineProperty(klass.prototype, 'destroy', {
    enumerable: false, configurable: true, writable: true,
    value: async function (opts) { return __schemaDestroy(def, this, opts); },
  });
  Object.defineProperty(klass.prototype, 'restore', {
    enumerable: false, configurable: true, writable: true,
    value: async function () { return __schemaRestore(def, this); },
  });
  Object.defineProperty(klass.prototype, 'reload', {
    enumerable: false, configurable: true, writable: true,
    value: async function () { return __schemaReload(def, this); },
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
      const n = __schemaFieldFor(nm, name);
      let valid = nm.fields.has(n);
      if (!valid) {
        for (const [, rel] of nm.relations) {
          if (rel.kind === 'belongsTo' && __schemaFieldFor(nm, rel.foreignKey) === n) {
            valid = true;
            break;
          }
        }
      }
      if (!valid) {
        throw new Error(
          "schema: markDirty('" + name + "') — '" + n + "' is not a declared field or belongsTo FK on " + (def.name || 'anon'));
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

const __SCHEMA_SQL_TYPES = {
  string: 'VARCHAR', text: 'TEXT', integer: 'INTEGER', number: 'DOUBLE',
  boolean: 'BOOLEAN', date: 'DATE', datetime: 'TIMESTAMP', email: 'VARCHAR',
  url: 'VARCHAR', uuid: 'UUID', phone: 'VARCHAR', zip: 'VARCHAR', json: 'JSON', any: 'JSON',
};

function __schemaColumnSpec(column, field) {
  let base = __SCHEMA_SQL_TYPES[field.typeName] || 'VARCHAR';
  if (field.array) base = 'JSON';
  if (base === 'VARCHAR' && field.constraints?.max != null) {
    base = 'VARCHAR(' + field.constraints.max + ')';
  }
  return {
    name: column,
    type: base,
    notNull: field.required === true,
    unique: field.unique === true,
    default: field.constraints?.default !== undefined
      ? __schemaSQLDefault(field.constraints.default) : null,
    was: field.attrs?.was || null,
  };
}

// The canonical table spec — one structure for DDL rendering (and,
// for the migration differ, its comparison shape).
__SchemaDef.prototype._tableSpec = function (options) {
  this._assertModel('_tableSpec');
  const opts = options || {};
  const norm = this._normalize();
  const table = norm.tableName;
  const seq = table + '_seq';

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

  const columns = [];
  if (!norm.naturalKey) {
    columns.push({
      name: norm.primaryKeyColumn, type: 'INTEGER',
      notNull: true, unique: false, primary: true,
      default: "nextval('" + seq + "')", was: null,
    });
  }
  for (const [n, f] of norm.fields) {
    const col = __schemaColumnSpec(norm.columnOf.get(n), f);
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
  const notes = [];
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const targetDef = __SchemaRegistry.get(rel.target);
    // An unregistered target cannot say where it lives or what it is
    // keyed by, so the convention answers — the same names and the
    // same INTEGER surrogate it would have chosen.
    const targetNorm = targetDef && targetDef.kind === 'model' ? targetDef._normalize() : null;
    const refTable = targetNorm ? targetNorm.tableName : __schemaTableName(rel.target);
    const refColumn = targetNorm ? targetNorm.primaryKeyColumn : 'id';
    // An FK holds a copy of the key it points at, so it is exactly as
    // wide: a target with a natural `string` key needs a VARCHAR FK,
    // not the surrogate's INTEGER.
    columns.push({
      name: rel.foreignKey,
      type: targetNorm?.primaryKeyField
        ? __schemaColumnSpec(rel.foreignKey, targetNorm.primaryKeyField).type
        : 'INTEGER',
      notNull: !rel.optional, unique: false, default: null, was: null,
    });
    // A cross-adapter relation cannot carry a database FK constraint
    // — the referenced table is in another database. The accessor
    // still works (a second query); the DDL suppresses the constraint
    // with a note.
    const crossAdapter = targetDef &&
      (targetDef._adapter || null) !== (this._adapter || null);
    if (crossAdapter) {
      notes.push('-- NOTE: ' + rel.foreignKey + ' references ' + refTable +
        '(' + refColumn + ') on a different adapter; FK constraint suppressed (cross-database constraints are impossible)');
      continue;
    }
    foreignKeys.push({ column: rel.foreignKey, refTable, refColumn });
  }

  if (norm.timestamps) {
    columns.push({ name: 'created_at', type: 'TIMESTAMP', notNull: false, unique: false, default: 'CURRENT_TIMESTAMP', was: null });
    columns.push({ name: 'updated_at', type: 'TIMESTAMP', notNull: false, unique: false, default: 'CURRENT_TIMESTAMP', was: null });
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
    const cols = d.args[0].fields.map((c) => __schemaColumnFor(norm, c));
    addIndex({ name: 'idx_' + table + '_' + cols.join('_'), columns: cols, unique: d.name === 'unique' });
  }

  return {
    name: table,
    sequence: norm.naturalKey ? null : { name: seq, start: idStart },
    primaryKey: norm.primaryKeyColumn,
    columns, indexes, foreignKeys, notes,
    tableWas: norm.tableWas || null,
  };
};

function __schemaRenderColumn(spec, col, fkByColumn) {
  const column = __schemaQuoteIdent(col.name, null, 'column');
  const parts = ['  ' + column + ' ' + col.type];
  if (col.primary) {
    parts[0] = '  ' + column + ' ' + col.type + ' PRIMARY KEY';
  } else {
    if (col.notNull) parts.push('NOT NULL');
    // Uniqueness renders as a named index below, never inline column
    // UNIQUE — one index shape for declaration and introspection.
  }
  const fk = fkByColumn ? fkByColumn.get(col.name) : null;
  if (fk) {
    parts.push('REFERENCES ' + __schemaQuoteIdent(fk.refTable, null, 'foreign-key table') +
      '(' + __schemaQuoteIdent(fk.refColumn, null, 'foreign-key column') + ')');
  }
  if (col.default != null) parts.push('DEFAULT ' + col.default);
  return parts.join(' ');
}

function __schemaRenderIndex(spec, ix) {
  const u = ix.unique ? 'UNIQUE ' : '';
  return 'CREATE ' + u + 'INDEX ' + __schemaQuoteIdent(ix.name, null, 'index') +
    ' ON ' + __schemaQuoteIdent(spec.name, null, 'table') +
    ' (' + ix.columns.map((c) => __schemaQuoteIdent(c, null, 'index column')).join(', ') + ');';
}

function __schemaRenderCreate(spec) {
  const blocks = [];
  const fkByColumn = new Map(spec.foreignKeys.map((fk) => [fk.column, fk]));
  if (spec.sequence) {
    blocks.push('CREATE SEQUENCE ' + __schemaQuoteIdent(spec.sequence.name, null, 'sequence') +
      ' START ' + spec.sequence.start + ';');
  }
  const lines = spec.columns.map((c) => __schemaRenderColumn(spec, c, fkByColumn));
  blocks.push('CREATE TABLE ' + __schemaQuoteIdent(spec.name, null, 'table') +
    ' (\n' + lines.join(',\n') + '\n);');
  const ix = spec.indexes.map((i) => __schemaRenderIndex(spec, i));
  if (ix.length) blocks.push(ix.join('\n'));
  if (spec.notes && spec.notes.length) blocks.push(spec.notes.join('\n'));
  return blocks;
}

function __schemaSQLDefault(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return "'" + v.replace(/'/g, "''") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

__SchemaDef.prototype.toSQL = function (options) {
  this._assertModel('toSQL');
  const opts = options || {};
  const { dropFirst = false, header } = opts;
  const spec = this._tableSpec(opts);
  const blocks = [];
  if (header) blocks.push(header);
  if (dropFirst) {
    blocks.push('DROP TABLE IF EXISTS ' + __schemaQuoteIdent(spec.name, null, 'table') + ' CASCADE;' +
      (spec.sequence
        ? '\nDROP SEQUENCE IF EXISTS ' + __schemaQuoteIdent(spec.sequence.name, null, 'sequence') + ';'
        : ''));
  }
  blocks.push(...__schemaRenderCreate(spec));
  return blocks.join('\n\n') + '\n';
};

// ── install + the user-facing namespace ───────────────────────────────

__schemaInstallPersistence({
  finishModelNorm,
  decorateDef,
  projectableFields,
  jsonSchemaModelColumns,
});

// The migration machinery is CLI-only (never delivered into
// user output) — the namespace carries loud pointers, not the
// differ. A program calling a migration verb gets the fix named,
// never `undefined is not a function`.
function __schemaMigrationStub(api) {
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
  transaction: __schemaTransaction,
  connect: __schemaConnect,
  setAdapter: __schemaSetAdapter,
  registerCoercer,
  plan: __schemaMigrationStub('plan'),
  status: __schemaMigrationStub('status'),
  make: __schemaMigrationStub('make'),
  migrate: __schemaMigrationStub('migrate'),
  introspect: __schemaMigrationStub('introspect'),
};

// The last two are the build-an-unsaved-instance seam rip/fake's
// Model.factory() augmentation composes with — normalize caller
// input, construct without saving.
export { schema, __schemaSetAdapter, __schemaTransaction, __schemaAdoptTransaction, __schemaTxHandle, __schemaConnect, __schemaRunSQL, __schemaAdapterFor, __schemaAdapterConfigured, __schemaQuoteIdent, __schemaRenderCreate, __schemaRenderIndex, __schemaNormalizePersistenceInput, __schemaConstructInputInstance };

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
  g.__ripSchema.__schemaAdoptTransaction = __schemaAdoptTransaction;
  g.__ripSchema.__schemaTxHandle = __schemaTxHandle;
  if (g.__ripDbAdapter && !__schemaAdapterExplicit) {
    try {
      __schemaSetAdapter(g.__ripDbAdapter);
    } catch {
      // Invalid leftover — leave the default adapter in place.
    }
  }
}
