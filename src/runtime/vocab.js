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
//   2. Every name must be unique across the RUNTIME modules, which is a
//      smaller claim than it sounds. Inline delivery splices the fused
//      bodies into one IIFE and destructures each runtime's `names:`
//      list out of it; user code lives OUTSIDE that closure, and this
//      module has no `names:` list at all. So nothing here can collide
//      with anything a user writes — only with a sibling runtime. Names
//      that DO escape into user scope (`__schema`, `__schemaSetAdapter`)
//      carry a prefix for that reason; these do not need one, the same
//      way reactive.js and components.js do not.

// ── the snake_case ↔ camelCase bijection ─────────────────────────────
//
// Total and reversible only on canonical names — which is what the
// predicates below are for, and why they are not merely stylistic.

function snakeCase(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function camelCase(col) {
  return String(col).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ── derived names ────────────────────────────────────────────────────
//
// The three derivations every layer makes from a canonical TARGET: its
// plural (hasMany accessors, table names), its FK column, and its
// accessor. Same reason as the bijection above — these used to be
// spelled once in src/runtime/orm.js and again in src/ts/schema.js,
// where the copy carried a comment promising it mirrored the runtime
// "byte-for-byte" and a test gated the promise. The rule lives here now,
// so there is nothing left to drift.
//
// The renderer's original concern still holds and is why this is the
// right home: importing orm.js into the compiler would evaluate the
// persistence install. This file is a leaf with no side effects, which
// is already why src/schema.js imports it.

const UNCOUNTABLE = new Set(['equipment', 'information', 'rice', 'money', 'species', 'series', 'fish', 'sheep', 'data']);

const IRREGULAR = new Map([['person', 'people'], ['man', 'men'], ['woman', 'women'], ['child', 'children'], ['tooth', 'teeth'], ['foot', 'feet'], ['mouse', 'mice']]);

function pluralize(word) {
  const lw = word.toLowerCase();
  if (UNCOUNTABLE.has(lw)) return word;
  if (IRREGULAR.has(lw)) return IRREGULAR.get(lw);
  if (/[^aeiouy]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  return word + 's';
}

// The FK COLUMN a relation derives — snake, `_id`-suffixed. The FK
// PROPERTY is `camelCase` of it; the two spellings are one
// derivation, which is why they are not separate rules.
function fkName(model) { return snakeCase(model) + '_id'; }

// The accessor a relation derives from its target: lowercase-first,
// otherwise untouched. hasMany pluralizes this; hasOne/belongsTo take
// it as-is. `{as:}` overrides it everywhere.
function accessorOf(target) { return target[0].toLowerCase() + target.slice(1); }

// ── name rules ───────────────────────────────────────────────────────

// A field, accessor, or any other lowercase-first derived name.
// Consecutive capitals break the round-trip — `mdmID` snakes to
// `mdm_id` and camels back to `mdmId`, which is a different name — so
// they are refused wherever a name is DERIVED rather than stated.
//   ok:  name, mrn, firstName, mdmId, line2     bad: ID, mdmID, foo_bar
function isCanonicalName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(name)) return false;
  if (/[A-Z]{2,}/.test(name)) return false;
  return true;
}

// A model or relation target: the same rule, uppercase-first. The FK
// column and accessor both derive from it.
//   ok:  User, MdmUser, Line2                   bad: user, MDMUser
function isCanonicalTarget(target) {
  if (typeof target !== 'string' || !/^[A-Z][a-zA-Z0-9]*$/.test(target)) return false;
  if (/[A-Z]{2,}/.test(target)) return false;
  return true;
}

// A column Rip GENERATES and then reads back as a property: the FK in
// `{foreignKey:}` and the rename source in `{was:}`. Its property name
// is `camelCase` of it, so it has to survive the round-trip — which
// is why this is the strict, lowercase form.
function isColumnName(col) {
  return typeof col === 'string' && /^[a-z_][a-z0-9_]*$/.test(col);
}

// A column that ALREADY EXISTS under a name Rip did not choose —
// `{column: "USER_NAME"}`, the whole point of which is reaching an
// inherited schema's whatever. Nothing round-trips through it (the
// property name comes from the FIELD, not from here), so the only
// requirements are the ones that would break the SQL or silently name
// the wrong thing: a dot would ride through the quoter as ONE
// identifier (`"crm.users"` is a column called that, not a qualified
// name), and an embedded double quote is a typo every time.
function isLiteralColumn(col) {
  return typeof col === 'string' && col.length > 0 &&
    !/[\u0000-\u001f\u007f".]/.test(col);
}

// ── the `:model` directive vocabulary ────────────────────────────────
//
// name → the SHAPE of its arguments. The shape names are contracts
// between the compiler's token parser and the runtime's object
// validator; adding a directive means adding one entry here and
// teaching both layers that shape, if it is a new one.
//
//   'none'    @times                 no arguments
//   'target'  @belongsTo User, {...}      a PascalCase model + options
//   'columns' @index [:a, :b]             one field name or a list
//   'int'     @idStart 1000               an integer literal
//   'name'    @table UserProfile          a table name; bare is a
//             @table "USER_MASTER"        logical name Rip snake_cases,
//                                         quoted is the literal table
//   'field'   @primary patientId          a camelCase property name and
//             …, {column: "PATIENT_ID"}   the column it reads, same pair
//                                         a declared field spells
const MODEL_DIRECTIVES = {
  __proto__: null,
  mixin: 'target',
  times: 'none',
  softDelete: 'none',
  belongsTo: 'target',
  hasOne: 'target',
  hasMany: 'target',
  index: 'columns',
  unique: 'columns',
  idStart: 'int',
  table: 'name',
  tableWas: 'name',
  primary: 'field',
};

// Directives a :model declares at most once. For the argument-carrying
// ones a second occurrence would silently last-win in the runtime's
// read loops; for the argument-less pair (@times, @softDelete) a
// second occurrence is a duplicate declaration of a once-thing — both
// layers reject it rather than tolerating it idempotently.
const ONCE_DIRECTIVES = ['idStart', 'table', 'tableWas', 'primary', 'times', 'softDelete'];

// Plain arrays, not Sets: at this size `includes` beats a hash lookup
// and the error messages below `.join(', ')` them directly instead of
// spreading first. Same shape as db.rip's RETRYABLE_CODES.
//
// The subset of the above that declares a relation. `mixin` shares the
// 'target' shape but derives no names, so it is deliberately absent.
const RELATION_DIRECTIVES = ['belongsTo', 'hasOne', 'hasMany'];

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
const FIELD_ATTRS = { __proto__: null, column: 'literal', was: 'column' };

// A relation's options.
//   as:         the accessor name. Without it the accessor derives from
//               the TARGET — this is what lets `author` and `reviewer`
//               both reach User.
//   foreignKey: the FK COLUMN. Without it, a belongsTo derives it from
//               the ACCESSOR (`{as: reviewer}` → reviewer_id; no as: →
//               the target), so two named relations to one model carry
//               their own columns; hasOne/hasMany/through derive from
//               the OWNER.
//   through:    the JOIN MODEL a @hasMany/@hasOne reads through.
//   targetKey:  the join model's column pointing at the TARGET. `through`
//               only; without it, the join model's own @belongsTo says.
const RELATION_ATTRS = {
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
function attrValueError(kind, key, value) {
  if (typeof value !== 'string' || !value.length) {
    return "'" + key + "' requires a non-empty string";
  }
  if (kind === 'property' && !isCanonicalName(value)) {
    return "'" + key + "' is a property name — canonical camelCase, e.g. {" + key + ': author}';
  }
  if (kind === 'model' && !isCanonicalTarget(value)) {
    return "'" + key + "' is a model name — canonical PascalCase, e.g. {" + key + ': Membership}';
  }
  if (kind === 'column' && !isColumnName(value)) {
    return "'" + key + "' is a column name Rip generates — lowercase, digits and underscores " +
      'only, e.g. {' + key + ': "author_id"}';
  }
  if (kind === 'literal' && !isLiteralColumn(value)) {
    return "'" + key + "' is a database column name — any spelling the database uses, but with " +
      'no dots, double quotes, or control characters';
  }
  return null;
}

export {
  snakeCase,
  camelCase,
  pluralize,
  fkName,
  accessorOf,
  isCanonicalName,
  isCanonicalTarget,
  isColumnName,
  isLiteralColumn,
  attrValueError,
  MODEL_DIRECTIVES,
  ONCE_DIRECTIVES,
  RELATION_DIRECTIVES,
  FIELD_ATTRS,
  RELATION_ATTRS,
};
