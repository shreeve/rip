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

// ── naming: the snake_case ↔ camelCase bijection ─────────────────────

function __schemaSnake(s) { return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }

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

function __schemaCamel(col) { return String(col).replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }

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
function __schemaCanonicalTarget(name) {
  if (typeof name !== 'string' || !/^[A-Z][a-zA-Z0-9]*$/.test(name)) return false;
  if (/[A-Z]{2,}/.test(name)) return false;
  return true;
}

// ── reserved names ────────────────────────────────────────────────────

const __SCHEMA_RESERVED_STATIC = new Set([
  'parse', 'array', 'safe', 'ok', 'parseAsync', 'safeAsync', 'okAsync', 'toJSONSchema',
  'find', 'findMany', 'where', 'all', 'first', 'count', 'create', 'toSQL',
  'includes', 'upsert', 'insertMany', 'updateAll', 'deleteAll', 'withDeleted', 'onlyDeleted',
  'unscoped',
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
const __SCHEMA_MODEL_DIRECTIVES = {
  __proto__: null,
  mixin: 'target',
  timestamps: 'none',
  softDelete: 'none',
  belongs_to: 'target',
  has_one: 'target',
  has_many: 'target',
  one: 'target',
  many: 'target',
  index: 'columns',
  unique: 'columns',
  idStart: 'int',
  tableWas: 'name',
};

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
    const fkCamel = __schemaCamel(rel.foreignKey);
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

function __schemaNormalizeDirectiveRelation(def, directive) {
  const name = directive.name;
  if (name !== 'belongs_to' && name !== 'has_one' && name !== 'has_many' && name !== 'one' && name !== 'many') return null;
  const a = directive.args[0];
  const target = a.target;
  const targetLc = target[0].toLowerCase() + target.slice(1);
  if (name === 'belongs_to') {
    return { kind: 'belongsTo', target, accessor: targetLc, foreignKey: __schemaFkName(target), optional: !!a.optional };
  }
  if (name === 'has_one' || name === 'one') {
    return { kind: 'hasOne', target, accessor: targetLc, foreignKey: __schemaFkName(def.name), optional: !!a.optional };
  }
  return { kind: 'hasMany', target, accessor: __schemaPluralize(targetLc), foreignKey: __schemaFkName(def.name), optional: !!a.optional };
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
  const relations = new Map();
  for (const d of norm.directives) {
    __schemaValidateDirectiveArgs(def, d);
    if (d.name === 'timestamps') timestamps = true;
    else if (d.name === 'softDelete') softDelete = true;
    else if (d.name === 'tableWas') tableWas = d.args[0].name;
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
  norm.primaryKey = 'id';
  norm.tableName = __schemaTableName(def.name);

  // The pk column is runtime-owned (sequence default, RETURNING
  // absorption, snapshot WHERE): a declared `id` field would duplicate
  // the DDL column and let user input write the pk the insert paths
  // reject (the caller-supplied-pk posture). Mixin-included fields
  // collide identically — on a :model, `id` has one owner.
  if (norm.fields.has(norm.primaryKey)) {
    collision(norm.primaryKey, 'the runtime-managed primary key');
  }

  // The full column set doubles as the column-OWNERSHIP guard
  //: every table column has exactly one owner. A
  // field whose snake_case column equals a belongsTo FK column
  // (`userId` + `@belongs_to User`) or a directive-managed column (a
  // mixin-included `createdAt` + `@timestamps` — direct declarations
  // are caught by the reserved set first) would otherwise emit
  // duplicate-column DDL and duplicate-column INSERTs that fail only
  // at the database. Declared fields cannot collide among themselves:
  // canonical camelCase makes name → snake_case injective.
  const known = new Set([norm.primaryKey]);
  const fieldBySnake = new Map();
  for (const [n] of norm.fields) {
    const col = __schemaSnake(n);
    fieldBySnake.set(col, n);
    known.add(col);
  }
  const claim = (col, owner) => {
    if (known.has(col)) {
      const fieldName = fieldBySnake.get(col) ?? col;
      throw __schemaModelError(def, fieldName, 'collision',
        "field '" + fieldName + "' and " + owner + " both own column '" + col +
        "' — every table column has exactly one owner; rename the field or drop the directive");
    }
    known.add(col);
  };
  for (const [, rel] of relations) {
    if (rel.kind === 'belongsTo') claim(rel.foreignKey, 'the @belongs_to ' + rel.target + ' relation');
  }
  if (timestamps) { claim('created_at', '@timestamps'); claim('updated_at', '@timestamps'); }
  if (softDelete) claim('deleted_at', '@softDelete');

  // @index / @unique columns must exist on the table — an index over
  // an undeclared column is invalid DDL that would otherwise surface
  // only when the SQL runs.
  for (const d of norm.directives) {
    if (d.name !== 'index' && d.name !== 'unique') continue;
    const columns = d.args[0].fields.map(__schemaSnake);
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
  for (const [fname] of norm.fields) callerWritableColumns.add(__schemaSnake(fname));
  for (const [, rel] of relations) {
    if (rel.kind === 'belongsTo') callerWritableColumns.add(rel.foreignKey);
  }
  norm.callerWritableColumns = callerWritableColumns;
  const conflictTargets = [[norm.primaryKey]];
  for (const [fname, f] of norm.fields) {
    if (f.unique === true) conflictTargets.push([__schemaSnake(fname)]);
  }
  for (const d of norm.directives) {
    if (d.name === 'unique') conflictTargets.push(d.args[0].fields.map(__schemaSnake));
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
  col(norm.primaryKey, 'integer', true);
  if (norm.timestamps) { col('createdAt', 'datetime', true); col('updatedAt', 'datetime', true); }
  if (norm.softDelete) col('deletedAt', 'datetime', false);
  for (const [, rel] of norm.relations) {
    if (rel.kind === 'belongsTo') col(__schemaCamel(rel.foreignKey), 'integer', !rel.optional);
  }
  return out;
}

function jsonSchemaModelColumns(def, properties) {
  const norm = def._normalize();
  properties[norm.primaryKey] = { type: 'integer' };
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    properties[__schemaCamel(rel.foreignKey)] = rel.optional
      ? { type: ['integer', 'null'] }
      : { type: 'integer' };
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

// Temporal values cross the adapter wire as real JS `Date` objects.
// The design is ONE decode seam at the wire, and this default adapter
// is a wire seam exactly like packages/db's harborAdapter, so the
// decode/encode below is replicated inline from adapter.rip (core src/
// must not import packages/) and must stay identical to it. Rationale:
// a naive TIMESTAMP arrives with no `Z`/offset, so `new Date(value)`
// in app code would read it as LOCAL and shift by the host's UTC
// offset — naive TIMESTAMP is defined as UTC wall-clock and decoded
// here (plus DATE / TIMESTAMPTZ), keyed by the column's duckdbType.
// Only `YYYY-MM-DD[...]`-shaped strings decode; anything else (DuckDB's
// `infinity` sentinels, unexpected formats) passes through untouched.
// Symmetrically an outbound `Date` parameter encodes to an explicit
// ISO-8601 UTC string (nested Dates in array/object params included),
// and an Invalid Date throws loudly instead of letting JSON silently
// serialize it to `null`.
const __SCHEMA_TEMPORAL_ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/;
const __SCHEMA_TEMPORAL_ZONE = /([Zz]|[+-]\d{2}:?\d{2})$/;

function __schemaTemporalKind(duckdbType) {
  switch (String(duckdbType ?? '').trim().toUpperCase()) {
    case 'TIMESTAMP': case 'TIMESTAMP_S': case 'TIMESTAMP_MS': case 'TIMESTAMP_NS': case 'DATETIME':
      return 'utc';      // naive wall-clock we define as UTC → append `Z`, then parse
    case 'TIMESTAMP WITH TIME ZONE': case 'TIMESTAMPTZ':
      return 'instant';  // already carries `Z`/offset → parse as-is
    case 'DATE':
      return 'civil';    // date-only → parse as-is (UTC midnight)
    default:
      return null;       // not a type we decode (TIME, INTERVAL, scalars, nested)
  }
}

function __schemaDecodeTemporal(value, kind) {
  if (!kind || typeof value !== 'string' || !__SCHEMA_TEMPORAL_ISO.test(value)) return value;
  // Canonicalize to ISO 8601 so parsing is engine-independent: ` ` →
  // `T` date/time separator, a bare `±HHMM` offset → `±HH:MM`.
  let iso = value.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (kind === 'utc' && !__SCHEMA_TEMPORAL_ZONE.test(iso)) iso += 'Z';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date;
}

// Decode every temporal cell of a harbor envelope in one pass. Fast
// path: no temporal column, no row copy — the envelope is returned
// untouched. `lossless` rides along and never gates the decode.
function __schemaDecodeEnvelope(env) {
  if (!Array.isArray(env?.columns) || !Array.isArray(env?.data)) return env;
  const kinds = env.columns.map((c) => __schemaTemporalKind(c?.duckdbType ?? c?.type));
  if (!kinds.some((k) => k != null)) return env;
  const data = env.data.map((row) =>
    row.map((v, i) => (kinds[i] ? __schemaDecodeTemporal(v, kinds[i]) : v)));
  return { ...env, data };
}

function __schemaEncodeParam(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) {
      throw new TypeError('db: cannot bind an Invalid Date as a query parameter');
    }
    return v.toISOString();
  }
  if (Array.isArray(v)) return v.map(__schemaEncodeParam);
  if (v != null && typeof v === 'object' &&
      (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const out = {};
    for (const k of Object.keys(v)) out[k] = __schemaEncodeParam(v[k]);
    return out;
  }
  return v;
}

// The default adapter speaks HTTP to a duckdb-harbor-shaped endpoint:
// `query` POSTs /sql; `begin` pins a session (POST /sql/sessions/new),
// carries its sessionId per statement, and destroys it after
// COMMIT / ROLLBACK.
function __schemaDefaultAdapter(overrides) {
  const env = (typeof process !== 'undefined' && process.env) || {};
  const base = () => String(
    overrides?.url || env.RIP_DB_URL || 'http://127.0.0.1:9494').replace(/\/+$/, '');
  const headers = () => {
    const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const token = overrides?.token || env.RIP_DB_TOKEN;
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  };
  async function post(path, body) {
    const res = await fetch(base() + path, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || data.ok === false || data.error) {
      const err = new Error(data.error || ('db request failed: ' + res.status + ' ' + (res.statusText || '')));
      if (data.errorCode) err.code = data.errorCode;
      if (data.errorDetails) err.details = data.errorDetails;
      err.httpStatus = res.status;
      throw err;
    }
    return data;
  }
  return {
    async query(sql, params) {
      const body = params && params.length
        ? { sql, params: params.map(__schemaEncodeParam) }
        : { sql };
      return __schemaDecodeEnvelope(await post('/sql', body));
    },
    async begin(options) {
      const session = await post('/sql/sessions/new', {});
      const sessionId = session.sessionId;
      // No session id means no isolation — refuse loudly rather than
      // run BEGIN/COMMIT as independent autocommit statements on the
      // pool.
      if (sessionId == null) {
        throw new Error('db: harbor returned no session id for the transaction');
      }
      const run = async (sql, params) =>
        __schemaDecodeEnvelope(await post('/sql', params && params.length
          ? { sql, params: params.map(__schemaEncodeParam), sessionId }
          : { sql, sessionId }));
      const drop = async () => {
        // Best-effort: harbor's idle TTL reaps abandoned sessions, so
        // a failed DELETE only delays cleanup, never leaks a
        // transaction.
        try {
          await fetch(base() + '/sql/sessions/' + sessionId, { method: 'DELETE', headers: headers() });
        } catch {}
      };
      // A failed BEGIN would otherwise orphan the freshly-created
      // session with no handle for the caller to clean up — drop it
      // here.
      try {
        await run('BEGIN');
      } catch (error) {
        await drop();
        throw error;
      }
      return {
        query: run,
        async commit() {
          // drop in a finally, mirroring rollback: a failed COMMIT
          // still releases the open transaction now, not at the idle
          // TTL.
          try { await run('COMMIT'); } finally { await drop(); }
        },
        async rollback() {
          try { await run('ROLLBACK'); } finally { await drop(); }
        },
      };
    },
    // ddlTransactional: DuckDB rolls DDL back with the transaction,
    // so the migration runner may claim a whole-file rollback
    // (Adapter Contract v2 — the capability governs the claim).
    capabilities: { tx: true, ddlTransactional: true },
  };
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
  if (!o.url) throw new Error('schema.connect({url, token?}): a url is required');
  return __schemaDefaultAdapter({ url: o.url, token: o.token });
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
async function __schemaRunSQL(def, sql, params) {
  const adapter = __schemaAdapterFor(def);
  const tx = __schemaTxStore(adapter);
  try {
    return await (tx ? tx.handle.query(sql, params) : adapter.query(sql, params));
  } catch (e) {
    throw __schemaTranslateDBError(e, def);
  }
}

async function __schemaTransaction(optsOrFn, maybeFn) {
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
  const issue = __schemaConstraintIssue(msg);
  if (!issue) return e;
  const err = new SchemaError([issue], def ? def.name : null, def ? def.kind : null);
  err.cause = e;
  return err;
}

function __schemaConstraintIssue(msg) {
  let m;
  m = msg.match(/[Dd]uplicate key "([A-Za-z0-9_]+):[^"]*" violates (?:unique|primary key) constraint/);
  if (m || /violates unique constraint/i.test(msg)) {
    const field = m ? __schemaCamel(m[1]) : '';
    return { field, error: 'unique', message: (field || 'value') + ' already taken' };
  }
  m = msg.match(/NOT NULL constraint failed:\s*(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)/i);
  if (m) {
    const field = __schemaCamel(m[1]);
    return { field, error: 'required', message: field + ' is required' };
  }
  if (/[Vv]iolates foreign key constraint/.test(msg)) {
    m = msg.match(/"([A-Za-z0-9_]+):[^"]*"/);
    const field = m ? __schemaCamel(m[1]) : '';
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
        const col = __schemaQuoteIdent(__schemaSnake(k), norm.columns, 'filter column');
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
    if (typeof spec !== 'string') {
      throw new Error('schema: order(spec) accepts only a trusted SQL string; got ' + (spec === null ? 'null' : typeof spec));
    }
    this._order = spec;
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
      const name = __schemaCamel(k);
      const column = __schemaSnake(name);
      const field = n.fields.get(name);
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
    return res.rowCount ?? res.rows ?? null;
  }
  // One statement for every matching row: soft-delete aware (UPDATE
  // deleted_at on a @softDelete model, real DELETE otherwise);
  // bypasses per-instance hooks (the bulk path).
  async deleteAll() {
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
    return res.rowCount ?? res.rows ?? null;
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
    __schemaQuoteIdent(targetNorm.primaryKey, targetNorm.columns, 'relation primary key');
  } else {
    __schemaQuoteIdent(rel.foreignKey, targetNorm.columns, 'relation key');
  }
  return targetNorm;
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
    } else {
      const fkCamel = __schemaCamel(rel.foreignKey);
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

function __schemaRelationIdentity(def, inst, rel) {
  if (rel.kind === 'belongsTo') return inst[__schemaCamel(rel.foreignKey)];
  return __schemaPersistedIdentity(def, inst, 'resolve relation ' + rel.accessor);
}

async function __schemaResolveRelation(def, rel, identity) {
  const target = __SchemaRegistry.get(rel.target);
  if (!target) throw new Error('schema: unknown relation target "' + rel.target + '" from ' + (def.name || 'anon'));
  const targetNorm = __schemaValidateRelationTarget(def, rel, target);
  if (rel.kind === 'belongsTo') {
    return identity != null ? await target.find(identity) : null;
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
    // Checked after every before-hook ran (a hook is one more channel
    // that can preset the pk).
    if (inst[norm.primaryKey] != null) {
      throw __schemaCallerPkError(def, 'save()', norm.primaryKey);
    }
    const cols = [], placeholders = [], values = [];
    const writtenColumns = [];
    for (const [n, f] of norm.fields) {
      const v = inst[n];
      if (v == null) continue;
      cols.push(__schemaQuoteIdent(__schemaSnake(n), norm.callerWritableColumns, 'insert column'));
      placeholders.push('?');
      values.push(__schemaSerialize(v, f));
      writtenColumns.push([n, v]);
    }
    // belongsTo FKs live as camelCase properties on the instance.
    for (const [, rel] of norm.relations) {
      if (rel.kind !== 'belongsTo') continue;
      const fkCamel = __schemaCamel(rel.foreignKey);
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
      __schemaAbsorbRow(inst, res.columns, res.data[0]);
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
      sets.push(__schemaQuoteIdent(__schemaSnake(n), norm.callerWritableColumns, 'update column') + ' = ?');
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
      const fkCamel = __schemaCamel(rel.foreignKey);
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
      const pk = norm.primaryKey;
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
function __schemaValidateAdapterRow(columns, row, operation) {
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
    const canonical = __schemaCamel(column.name);
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
function __schemaAbsorbRow(inst, columns, row, operation = 'row absorption') {
  __schemaValidateAdapterRow(columns, row, operation);
  if (typeof inst._relGeneration === 'number') {
    inst._relGeneration++;
    if (inst._relMemo) inst._relMemo.clear();
  }
  for (let i = 0; i < columns.length; i++) {
    const snake = columns[i].name;
    const key = __schemaCamel(snake);
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
      ' SET "deleted_at" = ? WHERE ' + __schemaQuoteIdent(norm.primaryKey, norm.columns, 'primary key') + ' = ?',
    [now, identity]);
    inst.deletedAt = now;
  } else {
    await __schemaRunSQL(def, 'DELETE FROM ' + __schemaQuoteIdent(norm.tableName, null, 'table') +
      ' WHERE ' + __schemaQuoteIdent(norm.primaryKey, norm.columns, 'primary key') + ' = ?', [identity]);
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
    ' SET "deleted_at" = NULL WHERE ' + __schemaQuoteIdent(norm.primaryKey, norm.columns, 'primary key') + ' = ?',
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
    ' WHERE ' + __schemaQuoteIdent(norm.primaryKey, norm.columns, 'primary key') + ' = ?';
  const res = await __schemaRunSQL(def, sql, [identity]);
  const data = Array.isArray(res?.data) ? res.data : [];
  if (!Array.isArray(res?.columns) || data.length !== 1) {
    throw new Error(
      'schema: reload() identity invariant for ' + (def.name || 'model') + ' ' +
      norm.primaryKey + '=' + String(identity) + ' expected exactly one row; got ' + data.length);
  }
  const indexes = __schemaValidateAdapterRow(res.columns, data[0], 'reload()');
  const pkIndex = indexes.get(norm.primaryKey);
  const returnedIdentity = pkIndex !== undefined ? data[0][pkIndex] : undefined;
  if (!__schemaSameValue(returnedIdentity, identity)) {
    throw new Error(
      'schema: reload() identity invariant for ' + (def.name || 'model') +
      ' requested ' + String(identity) + ' but the adapter returned ' +
      String(returnedIdentity));
  }
  __schemaAbsorbRow(inst, res.columns, data[0], 'reload()');
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
    ' arrives via RETURNING). Remove ' + pk + ' from the data, or run explicit-id SQL ' +
    'through the adapter.');
}

function __schemaCanonicalInput(def, data, api) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const norm = def._normalize();
  const writable = new Map();
  for (const [name] of norm.fields) {
    writable.set(name, name);
    writable.set(__schemaSnake(name), name);
  }
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const name = __schemaCamel(rel.foreignKey);
    writable.set(name, name);
    writable.set(rel.foreignKey, name);
  }
  const managed = new Map();
  const addManaged = (name, label) => {
    managed.set(name, label);
    managed.set(__schemaSnake(name), label);
  };
  addManaged(__schemaCamel(norm.primaryKey), 'primary key');
  if (norm.timestamps) {
    addManaged('createdAt', 'managed timestamp');
    addManaged('updatedAt', 'managed timestamp');
  }
  if (norm.softDelete) addManaged('deletedAt', 'managed soft-delete column');

  const aliases = new Map();
  const canonical = {};
  for (const key of Object.keys(data).sort()) {
    const name = writable.get(key);
    if (!name) {
      const managedKind = managed.get(key);
      const message = managedKind === 'primary key'
        ? __schemaCallerPkError(def, api, __schemaCamel(norm.primaryKey)).message
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
    .where(__schemaQuoteIdent(norm.primaryKey, norm.columns, 'primary key') + ' IN (' + ids.map(() => '?').join(', ') + ')', ...ids)
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
    return __schemaSnake(text);
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

  if (inst[norm.primaryKey] != null) {
    throw __schemaCallerPkError(this, 'upsert()', norm.primaryKey);
  }

  const cols = [], placeholders = [], values = [];
  const plannedValues = new Map();
  for (const [n, f] of norm.fields) {
    const v = inst[n];
    if (v == null) continue;
    cols.push(__schemaSnake(n));
    placeholders.push('?');
    const serialized = __schemaSerialize(v, f);
    values.push(serialized);
    plannedValues.set(__schemaSnake(n), serialized);
  }
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    const v = inst[__schemaCamel(rel.foreignKey)];
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
    __schemaAbsorbRow(inst, returned.columns, returned.row, 'upsert() RETURNING');
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
    lookup.columns, found[0], 'upsert() conflict lookup');
  const lookupColumns = new Map();
  for (const [canonical, index] of canonicalIndexes) {
    lookupColumns.set(__schemaSnake(canonical), index);
  }
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const columnIndex = lookupColumns.get(target);
    if (columnIndex === undefined) {
      throw new Error(
        "schema: upsert() conflict lookup invariant — returned row is missing target column '" +
        target + "'");
    }
    const field = norm.fields.get(__schemaCamel(target));
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
      if (row[__schemaCamel(rel.foreignKey)] != null) colSet.add(__schemaCamel(rel.foreignKey));
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
    colNames.map((n) => __schemaQuoteIdent(__schemaSnake(n), norm.callerWritableColumns, 'insertMany column')).join(', ') + ') VALUES ' +
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
  const data = {};
  for (let i = 0; i < columns.length; i++) {
    data[__schemaCamel(columns[i].name)] = row[i];
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
    const camel = __schemaCamel(snake);
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
  inst._snapshot = __schemaSnapshot(this._normalize(), inst);
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
      const n = __schemaCamel(name);
      const nm = def._normalize();
      let valid = nm.fields.has(n);
      if (!valid) {
        for (const [, rel] of nm.relations) {
          if (rel.kind === 'belongsTo' && __schemaCamel(rel.foreignKey) === n) {
            valid = true;
            break;
          }
        }
      }
      if (!valid) {
        throw new Error(
          "schema: markDirty('" + name + "') — '" + n + "' is not a declared field or belongs_to FK on " + (def.name || 'anon'));
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

function __schemaColumnSpec(name, field) {
  let base = __SCHEMA_SQL_TYPES[field.typeName] || 'VARCHAR';
  if (field.array) base = 'JSON';
  if (base === 'VARCHAR' && field.constraints?.max != null) {
    base = 'VARCHAR(' + field.constraints.max + ')';
  }
  return {
    name: __schemaSnake(name),
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
  columns.push({
    name: norm.primaryKey, type: 'INTEGER',
    notNull: true, unique: false, primary: true,
    default: "nextval('" + seq + "')", was: null,
  });
  for (const [n, f] of norm.fields) {
    columns.push(__schemaColumnSpec(n, f));
  }

  const foreignKeys = [];
  const notes = [];
  for (const [, rel] of norm.relations) {
    if (rel.kind !== 'belongsTo') continue;
    columns.push({
      name: rel.foreignKey, type: 'INTEGER',
      notNull: !rel.optional, unique: false, default: null, was: null,
    });
    // A cross-adapter relation cannot carry a database FK constraint
    // — the referenced table is in another database. The accessor
    // still works (a second query); the DDL suppresses the constraint
    // with a note.
    const targetDef = __SchemaRegistry.get(rel.target);
    const crossAdapter = targetDef &&
      (targetDef._adapter || null) !== (this._adapter || null);
    if (crossAdapter) {
      notes.push('-- NOTE: ' + rel.foreignKey + ' references ' + __schemaTableName(rel.target) +
        '(id) on a different adapter; FK constraint suppressed (cross-database constraints are impossible)');
      continue;
    }
    foreignKeys.push({
      column: rel.foreignKey,
      refTable: __schemaTableName(rel.target),
      refColumn: 'id',
    });
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
    const col = __schemaSnake(n);
    addIndex({ name: 'idx_' + table + '_' + col, columns: [col], unique: true });
  }
  for (const d of norm.directives) {
    if (d.name !== 'index' && d.name !== 'unique') continue;
    const cols = d.args[0].fields.map(__schemaSnake);
    addIndex({ name: 'idx_' + table + '_' + cols.join('_'), columns: cols, unique: d.name === 'unique' });
  }

  return {
    name: table,
    sequence: { name: seq, start: idStart },
    primaryKey: norm.primaryKey,
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
    blocks.push('DROP TABLE IF EXISTS ' + __schemaQuoteIdent(spec.name, null, 'table') +
      ' CASCADE;\nDROP SEQUENCE IF EXISTS ' + __schemaQuoteIdent(spec.sequence.name, null, 'sequence') + ';');
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

export { schema, __schemaSetAdapter, __schemaTransaction, __schemaConnect, __schemaRunSQL, __schemaAdapterFor, __schemaAdapterConfigured, __schemaQuoteIdent, __schemaRenderCreate, __schemaRenderIndex };

// Process doorbell for packages that must not hard-import this file
// (e.g. @rip-lang/db). `connect()` sets `globalThis.__ripDbAdapter` and
// calls `__ripSchema.__schemaSetAdapter` when we are already loaded;
// if models load later, pick up that adapter here so order does not
// matter.
if (typeof globalThis !== 'undefined') {
  const g = globalThis;
  g.__ripSchema = g.__ripSchema || {};
  g.__ripSchema.__schemaSetAdapter = __schemaSetAdapter;
  if (g.__ripDbAdapter && !__schemaAdapterExplicit) {
    try {
      __schemaSetAdapter(g.__ripDbAdapter);
    } catch {
      // Invalid leftover — leave the default adapter in place.
    }
  }
}
