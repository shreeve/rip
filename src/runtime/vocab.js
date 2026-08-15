// The schema VOCABULARY — one definition of what a `:model` may
// declare, what shape each declaration's arguments take, and the naming
// rules every derived identifier obeys.
//
// ── why this file exists ─────────────────────────────────────────────
//
// Three layers need these facts and they run at different times:
//
//   src/schema.js         the COMPILER — validates source TOKENS at
//                         build time, and emits the descriptor
//   src/runtime/schema.js the validation runtime — checks declared
//                         names when a schema is constructed
//   src/runtime/orm.js    the persistence runtime — validates
//                         descriptor OBJECTS, because `__schema({...})`
//                         is a second entry point that takes a
//                         hand-built descriptor and cannot trust it
//
// Different inputs, genuinely different jobs — but ONE vocabulary. It
// used to live in all three, so adding a directive meant editing the
// same table twice and the same regex up to six times, with nothing
// checking that the copies agreed. They agreed by luck and review.
//
// ── delivery ─────────────────────────────────────────────────────────
//
// This is a RUNTIME module (RUNTIME_TABLE key 'vocab') with no bound
// user-facing names: it ships only as a dependency, fused ahead of
// whatever requires it. The compiler imports it as an ordinary
// build-time module — nothing here depends on a compiler or a runtime,
// so there is no bootstrap cycle.
//
// TWO RULES FOR EDITING, both enforced by how inline delivery works:
//   1. No imports. This is a leaf, and it must stay one.
//   2. Every name is `__schema`-prefixed and globally unique. Fused
//      units share ONE scope, and the emitter STRIPS the import — so a
//      consumer must import each name unaliased, under exactly the name
//      declared here.

// ── the snake_case ↔ camelCase bijection ─────────────────────────────
//
// Total and reversible only on canonical names — which is what the
// predicates below are for, and why they are not merely stylistic.

function __schemaSnake(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function __schemaCamel(col) {
  return String(col).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ── name rules ───────────────────────────────────────────────────────

// A field, accessor, or any other lowercase-first derived name.
// Consecutive capitals break the round-trip — `mdmID` snakes to
// `mdm_id` and camels back to `mdmId`, which is a different name — so
// they are refused wherever a name is DERIVED rather than stated.
//   ok:  name, mrn, firstName, mdmId, line2     bad: ID, mdmID, foo_bar
function __schemaIsCanonicalName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(name)) return false;
  if (/[A-Z]{2,}/.test(name)) return false;
  return true;
}

// A model or relation target: the same rule, uppercase-first. The FK
// column and accessor both derive from it.
//   ok:  User, MdmUser, Line2                   bad: user, MDMUser
function __schemaIsCanonicalTarget(name) {
  if (typeof name !== 'string' || !/^[A-Z][a-zA-Z0-9]*$/.test(name)) return false;
  if (/[A-Z]{2,}/.test(name)) return false;
  return true;
}

// A column Rip GENERATES and then reads back as a property: the FK in
// `{foreignKey:}` and the rename source in `{was:}`. Its property name
// is `__schemaCamel` of it, so it has to survive the round-trip — which
// is why this is the strict, lowercase form.
function __schemaIsColumnName(name) {
  return typeof name === 'string' && /^[a-z_][a-z0-9_]*$/.test(name);
}

// A column that ALREADY EXISTS under a name Rip did not choose —
// `{column: "USER_NAME"}`, the whole point of which is reaching an
// inherited schema's whatever. Nothing round-trips through it (the
// property name comes from the FIELD, not from here), so the only
// requirements are the ones that would break the SQL or silently name
// the wrong thing: a dot would ride through the quoter as ONE
// identifier (`"crm.users"` is a column called that, not a qualified
// name), and an embedded double quote is a typo every time.
function __schemaIsLiteralColumn(name) {
  return typeof name === 'string' && name.length > 0 &&
    !/[\u0000-\u001f\u007f".]/.test(name);
}

// ── the `:model` directive vocabulary ────────────────────────────────
//
// name → the SHAPE of its arguments. The shape names are contracts
// between the compiler's token parser and the runtime's object
// validator; adding a directive means adding one entry here and
// teaching both layers that shape, if it is a new one.
//
//   'none'    @timestamps                 no arguments
//   'target'  @belongsTo User, {...}      a PascalCase model + options
//   'columns' @index [:a, :b]             one field name or a list
//   'int'     @idStart 1000               an integer literal
//   'name'    @table UserProfile          a table name; bare is a
//             @table "USER_MASTER"        logical name Rip snake_cases,
//                                         quoted is the literal table
//   'field'   @primaryKey patientId       a camelCase property name and
//             …, {column: "PATIENT_ID"}   the column it reads, same pair
//                                         a declared field spells
const __SCHEMA_MODEL_DIRECTIVES = {
  __proto__: null,
  mixin: 'target',
  timestamps: 'none',
  softDelete: 'none',
  belongsTo: 'target',
  hasOne: 'target',
  hasMany: 'target',
  index: 'columns',
  unique: 'columns',
  idStart: 'int',
  table: 'name',
  tableWas: 'name',
  primaryKey: 'field',
};

// Directives a :model may declare at most once — a second one would
// silently last-win in the runtime's read loops.
const __SCHEMA_ONCE_DIRECTIVES = ['idStart', 'table', 'tableWas', 'primaryKey'];

// Plain arrays, not Sets: at this size `includes` beats a hash lookup
// and the error messages below `.join(', ')` them directly instead of
// spreading first. Same shape as db.rip's RETRYABLE_CODES.
//
// The subset of the above that declares a relation. `mixin` shares the
// 'target' shape but derives no names, so it is deliberately absent.
const __SCHEMA_RELATION_DIRECTIVES = ['belongsTo', 'hasOne', 'hasMany'];

// ── the `{key: value}` option vocabularies ───────────────────────────
//
// Each key maps to the NAMESPACE its value lives in, and the namespace
// decides everything else: how it is written, what validates it, and
// whether Rip converts it. This is the same rule `@table` follows —
// bare identifiers live in Rip's naming, quoted strings live in the
// database's — stated once, as data, instead of re-argued per key.
//
//   'property'  a Rip camelCase name       BARE     {as: author}
//   'model'     a Rip PascalCase name      BARE     {through: Membership}
//   'column'    a column Rip generates     QUOTED   {foreignKey: "author_id"}
//   'literal'   a column Rip did not name  QUOTED   {column: "USER_NAME"}
//
// Known keys only, in both brackets — a typo'd option baked silently
// into every downstream schema is worse than a hard error.

// A field's attrs.
//   column: the column this field reads and writes. Without it the
//           column is the field name snake_cased.
//   was:    the column-rename annotation the migration differ consumes
const __SCHEMA_FIELD_ATTRS = { __proto__: null, column: 'literal', was: 'column' };

// A relation's options.
//   as:         the accessor name. Without it the accessor derives from
//               the TARGET, so two relations to one model collide —
//               this is what lets `author` and `reviewer` both reach User.
//   foreignKey: the FK COLUMN. Without it the column derives from the
//               target (belongsTo) or the owner (hasOne/hasMany/through).
//   through:    the JOIN MODEL of a many-to-many. @hasMany only.
//   targetKey:  the join model's column pointing at the TARGET. `through`
//               only; without it, the join model's own @belongsTo says.
const __SCHEMA_RELATION_ATTRS = {
  __proto__: null,
  as: 'property',
  foreignKey: 'column',
  through: 'model',
  targetKey: 'column',
};

// One option's VALUE against its namespace. Returns the middle of an
// error sentence, or null when the value is good — the two layers frame
// it differently (the compiler names a source position, the runtime
// names a model) but they judge the same thing by the same rule.
//
// Shape only. Whether the author wrote it bare or quoted is a TOKEN
// fact, so the compiler enforces that half; a descriptor reaching
// `__schema({…})` directly has no such evidence to check.
function __schemaAttrValueError(kind, key, value) {
  if (typeof value !== 'string' || !value.length) {
    return "'" + key + "' requires a non-empty string";
  }
  if (kind === 'property' && !__schemaIsCanonicalName(value)) {
    return "'" + key + "' is a property name — canonical camelCase, e.g. {" + key + ': author}';
  }
  if (kind === 'model' && !__schemaIsCanonicalTarget(value)) {
    return "'" + key + "' is a model name — canonical PascalCase, e.g. {" + key + ': Membership}';
  }
  if (kind === 'column' && !__schemaIsColumnName(value)) {
    return "'" + key + "' is a column name Rip generates — lowercase, digits and underscores " +
      'only, e.g. {' + key + ': "author_id"}';
  }
  if (kind === 'literal' && !__schemaIsLiteralColumn(value)) {
    return "'" + key + "' is a database column name — any spelling the database uses, but with " +
      'no dots, double quotes, or control characters';
  }
  return null;
}

export {
  __schemaSnake,
  __schemaCamel,
  __schemaIsCanonicalName,
  __schemaIsCanonicalTarget,
  __schemaIsColumnName,
  __schemaIsLiteralColumn,
  __schemaAttrValueError,
  __SCHEMA_MODEL_DIRECTIVES,
  __SCHEMA_ONCE_DIRECTIVES,
  __SCHEMA_RELATION_DIRECTIVES,
  __SCHEMA_FIELD_ATTRS,
  __SCHEMA_RELATION_ATTRS,
};
