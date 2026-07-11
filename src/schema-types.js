// The schema TYPE story — one renderer, two consumers (the
// typetext.js precedent): declaration emission (src/dts.js) and the
// TS-face emission (src/emitter.js) both render a schema descriptor's
// type surface through this module, so the two artifacts cannot drift
// in declaration structure.
//
// What renders:
//   - the INTRINSIC declarations (SchemaIssue / SchemaSafeResult /
//     ArraySchema / Schema / SchemaQuery / ModelSchema) — type-level
//     interfaces ONLY, per-file inline (); the persistence
//     tier (SchemaQuery/ModelSchema) emits only where a :model exists
//   - per-schema alias lines and the binding's declared type:
//       :enum   → bare literal-union type + validation const
//       :mixin  → bare fields type only (no runtime value surface)
//       :union  → constituent-union type + validation const
//       :input  → bare name (Data split only where `!>` derived
//                 exists) + Schema<Out, In> const
//       :shape  → bare name (Data split only where behavior exists)
//                 + Schema<Out, In> const
//       :model  → NameData / NameCreate / bare Name instance type +
//                 ModelSchema<Name, NameData, number, NameCreate>
//                 const (& scope statics; NameQuery where scopes
//                 exist)
//   - the callable `this` types () keyed by entry index —
//     the instance type for method/computed/derived/hook (the
//     runtime binds `this` to the instance), the query type for
//     scope/defaultScope (the runtime applies them to a builder);
//     ensure predicates and field transforms are honestly absent
//     (the runtime calls them unbound)
//
// Field types map through the intrinsic vocabulary below; a field
// naming a schema declared in the SAME module renders that name (the
// alias exists — recursion and mutual reference resolve in TS type
// space); an unknown name renders `unknown` — never an unresolved
// identifier in a shipped artifact (emitting it bare would be a
// as-is and its artifact fails any self-contained checker).
//
// Computed/derived members type `unknown` and methods
// `(...args: any[]) => unknown` — @timestamps
// and @softDelete columns type `string`/`string | null` — the
// runtime writes ISO strings and its own JSON-Schema export says so
//
// The emitted type names are a module-level namespace: a collision —
// with the intrinsic vocabulary, between two schema-derived aliases,
// or with a user-declared type/interface/class/enum name — REJECTS
// loudly at the typed artifact (); JS shipping output never
// carries these names and is untouched.
//
// Pure text/tree work: no stores, no builder, no I/O. Rejections
// throw SchemaTypeError carrying the offending source offset where
// one is known; dts wraps them as DtsError and the TS face as a
// positioned emitter diagnostic.

export class SchemaTypeError extends Error {
  constructor(message, start = null, node = null) {
    super(message);
    this.name = 'SchemaTypeError';
    this.start = start;
    // The offending sexpr NODE when the offender is a user
    // declaration (the face positions through its stores; a bare
    // offset only exists for descriptor-sourced offenders).
    this.node = node;
  }
}

// ── naming (mirrors src/runtime/schema-orm.js byte-for-byte) ─────────
// The runtime module is never imported here (importing it would
// evaluate the persistence install into the compiler process); the
// copies are drift-gated by test/schema-types.test.js against the
// runtime's own exports.

const snakeCase = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const camelCase = (col) => String(col).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const UNCOUNTABLE = new Set(['equipment', 'information', 'rice', 'money', 'species', 'series', 'fish', 'sheep', 'data']);
const IRREGULAR = new Map([['person', 'people'], ['man', 'men'], ['woman', 'women'], ['child', 'children'], ['tooth', 'teeth'], ['foot', 'feet'], ['mouse', 'mice']]);

export const pluralize = (w) => {
  const lw = w.toLowerCase();
  if (UNCOUNTABLE.has(lw)) return w;
  if (IRREGULAR.has(lw)) return IRREGULAR.get(lw);
  if (/[^aeiouy]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
};

const fkCamel = (target) => camelCase(snakeCase(target) + '_id');
const accessorOf = (target) => target[0].toLowerCase() + target.slice(1);

// ── the intrinsic vocabulary ─────────────────────────────────────────

// Rip's built-in field-type names → TS types. Everything stringy is
// `string` (email/url/uuid/phone/zip are validation refinements, not
// distinct value shapes); date/datetime fields hold Date instances
// after parse (the runtime coerces ISO strings); json/any are the
// honest opaque pair.
export const INTRINSIC_FIELD_TYPES = {
  __proto__: null,
  string: 'string',
  text: 'string',
  email: 'string',
  url: 'string',
  uuid: 'string',
  phone: 'string',
  zip: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  date: 'Date',
  datetime: 'Date',
  json: 'unknown',
  any: 'any',
};

// The reserved vocabulary, split by emission tier: a user declaration
// collides only with the tier a module ACTUALLY emits (a user
// `ModelSchema` beside validation-only schemas is legal — the
// persistence tier never prints there). Schema-emitted ALIAS names
// check against the whole set — a schema named `ModelSchema` would
// still collide the moment a :model joins the file, and reserving the
// full vocabulary for schema names keeps that cliff out of the
// language.
export const VALIDATION_INTRINSIC_NAMES = new Set([
  'SchemaIssue', 'SchemaSafeResult', 'ArraySchema', 'Schema',
]);
export const MODEL_INTRINSIC_NAMES = new Set(['SchemaQuery', 'ModelSchema']);
export const SCHEMA_INTRINSIC_NAMES = new Set([
  ...VALIDATION_INTRINSIC_NAMES, ...MODEL_INTRINSIC_NAMES,
]);

const VALIDATION_INTRINSICS = [
  'interface SchemaIssue { field: string; error: string; message: string; }',
  'type SchemaSafeResult<T> = { ok: true; value: T; errors: null } | { ok: false; value: null; errors: SchemaIssue[] };',
  'interface ArraySchema<Out> {',
  '  parse(data: unknown): Out[];',
  '  safe(data: unknown): SchemaSafeResult<Out[]>;',
  '  ok(data: unknown): boolean;',
  '  parseAsync(data: unknown): Promise<Out[]>;',
  '  safeAsync(data: unknown): Promise<SchemaSafeResult<Out[]>>;',
  '  okAsync(data: unknown): Promise<boolean>;',
  '  toJSONSchema(): Record<string, unknown>;',
  '}',
  // `Out` is the parsed value type; `In` the projectable data shape.
  // Algebra methods parameterize over `In`, so derived schemas
  // (`View = User.omit("bio")`) type through TS's own Pick/Omit —
  // with `In` defaulted to unknown, `keyof In` is never and algebra
  // offers nothing, which is right where no data shape is known.
  'interface Schema<Out, In = unknown> {',
  '  parse(data: unknown): Out;',
  '  array: ArraySchema<Out>;',
  '  safe(data: unknown): SchemaSafeResult<Out>;',
  '  ok(data: unknown): boolean;',
  '  parseAsync(data: unknown): Promise<Out>;',
  '  safeAsync(data: unknown): Promise<SchemaSafeResult<Out>>;',
  '  okAsync(data: unknown): Promise<boolean>;',
  '  toJSONSchema(): Record<string, unknown>;',
  '  pick<K extends keyof In>(...keys: K[]): Schema<Pick<In, K>, Pick<In, K>>;',
  '  omit<K extends keyof In>(...keys: K[]): Schema<Omit<In, K>, Omit<In, K>>;',
  '  partial(): Schema<Partial<In>, Partial<In>>;',
  '  required<K extends keyof In>(...keys: K[]): Schema<Omit<In, K> & Required<Pick<In, K>>, Omit<In, K> & Required<Pick<In, K>>>;',
  '  extend<U>(other: Schema<U>): Schema<In & U, In & U>;',
  '}',
];

// The persistence tier — the query builder and model statics exactly
// as src/runtime/schema-orm.js serves them: all()/first()/count()
// take no arguments (reads route through where()), updateAll/
// deleteAll live on the BUILDER only.
const MODEL_INTRINSICS = [
  'interface SchemaQuery<T, Data = Record<string, unknown>> {',
  '  all(): Promise<T[]>;',
  '  first(): Promise<T | null>;',
  '  count(): Promise<number>;',
  '  where(cond: Partial<Record<keyof Data, unknown>> | string, ...params: unknown[]): SchemaQuery<T, Data>;',
  '  limit(n: number): SchemaQuery<T, Data>;',
  '  offset(n: number): SchemaQuery<T, Data>;',
  '  order(spec: string): SchemaQuery<T, Data>;',
  '  orderBy(spec: string): SchemaQuery<T, Data>;',
  '  includes(...specs: unknown[]): SchemaQuery<T, Data>;',
  '  withDeleted(): SchemaQuery<T, Data>;',
  '  onlyDeleted(): SchemaQuery<T, Data>;',
  '  updateAll(values: Partial<Record<keyof Data, unknown>>): Promise<number | null>;',
  '  deleteAll(): Promise<number | null>;',
  '  unscoped(): SchemaQuery<T, Data>;',
  '}',
  'interface ModelSchema<Instance, Data = unknown, Id = number, Create = Partial<Data>> extends Schema<Instance, Data> {',
  '  find(id: Id): Promise<Instance | null>;',
  '  findMany(ids: Id[]): Promise<Instance[]>;',
  '  where(cond: Partial<Record<keyof Data, unknown>> | string, ...params: unknown[]): SchemaQuery<Instance, Data>;',
  '  includes(...specs: unknown[]): SchemaQuery<Instance, Data>;',
  '  withDeleted(): SchemaQuery<Instance, Data>;',
  '  onlyDeleted(): SchemaQuery<Instance, Data>;',
  '  unscoped(): SchemaQuery<Instance, Data>;',
  '  all(): Promise<Instance[]>;',
  '  first(): Promise<Instance | null>;',
  '  count(): Promise<number>;',
  '  create(data: Create): Promise<Instance>;',
  '  upsert(data: Create, opts: { on: unknown }): Promise<Instance>;',
  '  insertMany(rows: Create[]): Promise<Instance[]>;',
  '  toSQL(options?: { dropFirst?: boolean; header?: string; idStart?: number }): string;',
  '}',
];

export const schemaIntrinsicLines = (withModel) =>
  withModel ? [...VALIDATION_INTRINSICS, ...MODEL_INTRINSICS] : [...VALIDATION_INTRINSICS];

// ── collection ───────────────────────────────────────────────────────

const isNode = (x) => Array.isArray(x);
const isSchemaNode = (x) =>
  isNode(x) && x[0] === 'schema' && x.length === 2 &&
  x[1] && typeof x[1] === 'object' && Array.isArray(x[1].entries);

// The MODULE-LEVEL named schema declarations — the type story's
// population (function-local and anonymous schemas keep today's
// untyped behavior; both are recorded boundaries). Returns
// declaration order.
export function collectSchemaDecls(programSexpr) {
  const out = [];
  if (!isNode(programSexpr) || programSexpr[0] !== 'program') return out;
  const consider = (stmt, exported) => {
    if (!isNode(stmt) || stmt[0] !== '=' || stmt.length !== 3) return;
    if (typeof stmt[1] !== 'string' || !isSchemaNode(stmt[2])) return;
    out.push({ name: stmt[1], descriptor: stmt[2][1], node: stmt[2], exported });
  };
  for (const stmt of programSexpr.slice(1)) {
    if (isNode(stmt) && stmt[0] === 'export' && stmt.length === 2) consider(stmt[1], true);
    else consider(stmt, false);
  }
  return out;
}

// User-declared TYPE-SPACE names at module level — everything that
// occupies a TS type name in the emitted artifacts: type/interface
// declarations, class declarations, and enum declarations (the enum
// companion). The collision check runs the schema alias names
// against this set.
export function collectUserTypeNames(programSexpr) {
  const names = new Map(); // name → {what, node} (message + face position)
  if (!isNode(programSexpr) || programSexpr[0] !== 'program') return names;
  const consider = (stmt) => {
    if (!isNode(stmt)) return;
    if (stmt[0] === 'type-decl' && typeof stmt[1] === 'string') {
      const m = stmt[1].replace(/^export\s+/, '').match(/^(type|interface)\s+([A-Za-z_$][\w$]*)/);
      if (m) names.set(m[2], { what: `the ${m[1]} declaration '${m[2]}'`, node: stmt });
    } else if (stmt[0] === 'class' && typeof stmt[1] === 'string') {
      names.set(stmt[1], { what: `class ${stmt[1]}`, node: stmt });
    } else if (stmt[0] === 'enum' && typeof stmt[1] === 'string') {
      names.set(stmt[1], { what: `enum ${stmt[1]}`, node: stmt });
    }
  };
  for (const stmt of programSexpr.slice(1)) {
    consider(isNode(stmt) && stmt[0] === 'export' && stmt.length === 2 ? stmt[1] : stmt);
  }
  return names;
}

// Is the program a MODULE by its own VALUE-LEVEL syntax — a
// top-level module import or an export STATEMENT node? The caller
// supplies isModuleImport (the emitter's semanticKind-backed
// discriminator): a dynamic-import CALL statement spells the same
// head as a module import and must stay non-module-making, and the
// shapes collide at three elements (`import(Foo, "./m.js")` vs
// `import Foo from "./m.js"`), so shape alone cannot decide.
// Type-only exports (`export type Q = …`) parse as type-decl
// statements, not export nodes, so they are not detected; the
// consequence is a redundant marker beside a line that already makes
// the face a module — harmless. Where a program is NOT value-level
// module-shaped, the TS FACE appends the `export {}` module marker
// (TS-only): without it the face is a global SCRIPT whose
// top-level bindings (and, for schema files, intrinsic aliases)
// collide across files in one program (TS2451/TS2300) — false
// diagnostics, since the loader runs every .rip file as an ES
// module. The .d.ts gates on its own EMITTED lines instead
// (src/dts.js — declaration emission can erase every module
// indicator the source carried).
export function isModuleShaped(programSexpr, isModuleImport) {
  if (!isNode(programSexpr) || programSexpr[0] !== 'program') return false;
  for (const stmt of programSexpr.slice(1)) {
    if (!isNode(stmt)) continue;
    if (stmt[0] === 'export') return true;
    if (isModuleImport(stmt)) return true;
  }
  return false;
}

// ── field/property rendering ─────────────────────────────────────────

// A field entry's TS type: literal unions verbatim, the intrinsic
// vocabulary through the table, a SAME-MODULE schema name as itself
// (its alias exists), anything else `unknown` — never an unresolved
// identifier in a shipped artifact.
export const fieldType = (entry, known) => {
  if (entry.typeName === 'literal-union' && entry.literals?.length) {
    return entry.literals.map((l) => JSON.stringify(l)).join(' | ');
  }
  let base = INTRINSIC_FIELD_TYPES[entry.typeName] ??
    (known && known.has(entry.typeName) ? entry.typeName : 'unknown');
  return entry.array ? `${base}[]` : base;
};

const fieldProps = (descriptor, known) => {
  const props = [];
  for (const e of descriptor.entries) {
    if (e.tag !== 'field') continue;
    const required = e.modifiers.includes('!');
    props.push(`${e.name}${required ? '' : '?'}: ${fieldType(e, known)}`);
  }
  return props;
};

// `& Mixin` intersections for @mixin directives whose target is a
// same-module :mixin schema (unknown targets contribute nothing —
// the runtime resolves them late; the type surface stays honest
// about what it can see).
const mixinRefs = (descriptor, byName) => {
  const refs = [];
  for (const e of descriptor.entries) {
    if (e.tag !== 'directive' || e.name !== 'mixin') continue;
    const target = e.args?.[0]?.target;
    if (target && byName.get(target)?.descriptor.kind === 'mixin') refs.push(target);
  }
  return refs;
};

const intersect = (base, refs) => (refs.length ? `${base} & ${refs.join(' & ')}` : base);

const RELATION_KINDS = { __proto__: null, belongs_to: 'belongsTo', has_one: 'hasOne', one: 'hasOne', has_many: 'hasMany', many: 'hasMany' };

const relationsOf = (descriptor) => {
  const rels = [];
  for (const e of descriptor.entries) {
    const kind = e.tag === 'directive' ? RELATION_KINDS[e.name] : undefined;
    if (!kind) continue;
    const target = e.args?.[0]?.target;
    if (!target) continue;
    rels.push({ kind, target, optional: e.args[0].optional === true });
  }
  return rels;
};

// A :model's implicitly-managed columns as Data properties: the `id`
// pk, belongsTo FK columns, and the @timestamps/@softDelete columns.
// Timestamp columns are `string` — the runtime writes ISO strings
const modelImplicitProps = (descriptor) => {
  const props = ['id: number'];
  for (const rel of relationsOf(descriptor)) {
    if (rel.kind !== 'belongsTo') continue;
    props.push(`${fkCamel(rel.target)}: number${rel.optional ? ' | null' : ''}`);
  }
  const has = (n) => descriptor.entries.some((e) => e.tag === 'directive' && e.name === n);
  if (has('timestamps')) props.push('createdAt: string', 'updatedAt: string');
  if (has('softDelete')) props.push('deletedAt: string | null');
  return props;
};

// The create-input shape: a declared field is required iff marked `!`
// with no `[default]` (a defaulted required field is optional at
// insert); belongsTo FKs ride relation optionality; runtime-managed
// columns (id, timestamps, deletedAt) are omitted — the DB fills them.
const modelCreateProps = (descriptor, known) => {
  const props = [];
  for (const e of descriptor.entries) {
    if (e.tag !== 'field') continue;
    const required = e.modifiers.includes('!') && e.constraints?.default === undefined;
    props.push(`${e.name}${required ? '' : '?'}: ${fieldType(e, known)}`);
  }
  for (const rel of relationsOf(descriptor)) {
    if (rel.kind !== 'belongsTo') continue;
    props.push(`${fkCamel(rel.target)}${rel.optional ? '?' : ''}: number${rel.optional ? ' | null' : ''}`);
  }
  return props;
};

// Relation accessor signatures per the runtime's actual shapes:
// async, memoized, `{reload: true}` busts the memo; hasMany accessors
// pluralize through the SAME rules the runtime derives names with.
// Same-module targets type as their bare instance name; cross-file
// targets stay `unknown` honestly.
const relationAccessors = (descriptor, known) => {
  const out = [];
  const OPTS = 'opts?: { reload?: boolean }';
  for (const rel of relationsOf(descriptor)) {
    const isKnown = known.has(rel.target);
    if (rel.kind === 'hasMany') {
      out.push(`${pluralize(accessorOf(rel.target))}(${OPTS}): Promise<${isKnown ? `${rel.target}[]` : 'unknown[]'}>`);
    } else {
      out.push(`${accessorOf(rel.target)}(${OPTS}): Promise<${isKnown ? `${rel.target} | null` : 'unknown'}>`);
    }
  }
  return out;
};

const braced = (props) => (props.length ? `{ ${props.join('; ')} }` : '{}');

// ── the per-schema story ─────────────────────────────────────────────

// One schema's type story:
//   aliasLines — the `type …` lines (may be empty for a kind that
//                needs none beyond the const)
//   constType  — the declared type of the binding, or null when the
//                binding deliberately stays untyped (:mixin — its
//                runtime value is not a user surface)
//   thisTypes  — entry index → the callable's `this` type ()
//   typeNames  — every type name these lines bind (collision fodder)
export function schemaTypeStory(decl, byName, known) {
  const { name, descriptor } = decl;
  const kind = descriptor.kind;

  if (kind === 'enum') {
    const members = descriptor.entries
      .filter((e) => e.tag === 'enum-member')
      .map((e) => (e.value !== undefined ? e.value : e.name));
    const union = members.length
      ? members.map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(' | ')
      : 'never';
    // `ok` narrows (`data is`) only when every member materializes to
    // its own name — a VALUED member's ok() also accepts the symbol
    // name, which is outside the value union, so the guard would lie.
    const bare = descriptor.entries.every((e) => e.tag !== 'enum-member' || e.value === undefined || e.value === e.name);
    return {
      aliasLines: [`type ${name} = ${union};`],
      constType: `{ parse(data: unknown): ${name}; safe(data: unknown): SchemaSafeResult<${name}>; ` +
        `ok(data: unknown): ${bare ? `data is ${name}` : 'boolean'}; ` +
        `parseAsync(data: unknown): Promise<${name}>; safeAsync(data: unknown): Promise<SchemaSafeResult<${name}>>; ` +
        `okAsync(data: unknown): Promise<boolean>; toJSONSchema(): Record<string, unknown>; array: ArraySchema<${name}>; }`,
      thisTypes: new Map(),
      typeNames: [name],
    };
  }

  if (kind === 'union') {
    const members = descriptor.entries.filter((e) => e.tag === 'union-member').map((e) => e.name);
    // Constituents outside the module degrade the WHOLE union to
    // unknown-armed honesty per member, like field types do.
    const armed = members.map((m) => (known.has(m) ? m : 'unknown'));
    const union = armed.length ? armed.join(' | ') : 'never';
    return {
      aliasLines: [`type ${name} = ${union};`],
      constType: `{ parse(data: unknown): ${name}; safe(data: unknown): SchemaSafeResult<${name}>; ` +
        `ok(data: unknown): boolean; ` +
        `parseAsync(data: unknown): Promise<${name}>; safeAsync(data: unknown): Promise<SchemaSafeResult<${name}>>; ` +
        `okAsync(data: unknown): Promise<boolean>; toJSONSchema(): Record<string, unknown>; array: ArraySchema<${name}>; }`,
      thisTypes: new Map(),
      typeNames: [name],
    };
  }

  if (kind === 'mixin') {
    return {
      aliasLines: [`type ${name} = ${intersect(braced(fieldProps(descriptor, known)), mixinRefs(descriptor, byName))};`],
      constType: null,
      thisTypes: new Map(),
      typeNames: [name],
    };
  }

  // The fielded instance kinds. Behavior members split Out from In:
  // derived (`!>`) own props, computed (`~>`) readonly getters, and
  // methods live on the instance, never the projectable data shape.
  const dataType = intersect(braced(fieldProps(descriptor, known)), mixinRefs(descriptor, byName));
  const derived = [];
  const computed = [];
  const methods = [];
  const instanceIdx = []; // entries whose `this` is the instance
  const scopeIdx = [];    // entries whose `this` is the query builder
  descriptor.entries.forEach((e, i) => {
    if (e.tag === 'derived') { derived.push(`${e.name}: unknown`); instanceIdx.push(i); }
    else if (e.tag === 'computed') { computed.push(`readonly ${e.name}: unknown`); instanceIdx.push(i); }
    else if (e.tag === 'method') { methods.push(`${e.name}: (...args: any[]) => unknown`); instanceIdx.push(i); }
    else if (e.tag === 'hook') instanceIdx.push(i);
    else if (e.tag === 'scope' || e.tag === 'defaultScope') scopeIdx.push(i);
  });
  const behavior = [...derived, ...computed, ...methods];

  if (kind === 'model') {
    const dataName = `${name}Data`;
    const createName = `${name}Create`;
    const softDelete = descriptor.entries.some((e) => e.tag === 'directive' && e.name === 'softDelete');
    const scopeNames = descriptor.entries.filter((e) => e.tag === 'scope').map((e) => e.name);
    const queryName = `${name}Query`;
    const queryType = scopeNames.length ? queryName : `SchemaQuery<${name}, ${dataName}>`;
    const instanceExtras = [
      ...behavior,
      ...relationAccessors(descriptor, known),
      `save(): Promise<${name}>`,
      `destroy(opts?: { hard?: boolean }): Promise<${name}>`,
      ...(softDelete ? [`restore(): Promise<${name}>`] : []),
      `ok(): boolean`,
      `errors(): SchemaIssue[]`,
      `markDirty(name: string): ${name}`,
      `savedChanges: Map<string, [unknown, unknown]>`,
      `toJSON(): ${dataName}`,
    ];
    const aliasLines = [
      `type ${dataName} = ${dataType} & ${braced(modelImplicitProps(descriptor))};`,
      `type ${createName} = ${intersect(braced(modelCreateProps(descriptor, known)), mixinRefs(descriptor, byName))};`,
      `type ${name} = ${dataName} & ${braced(instanceExtras)};`,
    ];
    const typeNames = [dataName, createName, name];
    let constType = `ModelSchema<${name}, ${dataName}, number, ${createName}>`;
    if (scopeNames.length) {
      const scopeSigs = scopeNames.map((s) => `${s}(...args: any[]): ${queryName}`);
      aliasLines.push(`type ${queryName} = SchemaQuery<${name}, ${dataName}> & ${braced(scopeSigs)};`);
      typeNames.push(queryName);
      constType += ` & ${braced(scopeSigs)}`;
    }
    const thisTypes = new Map();
    for (const i of instanceIdx) thisTypes.set(i, name);
    for (const i of scopeIdx) thisTypes.set(i, queryType);
    return { aliasLines, constType, thisTypes, typeNames };
  }

  // :input / :shape — collapse to one bare name when instance === data.
  const thisTypes = new Map();
  for (const i of instanceIdx) thisTypes.set(i, name);
  if (behavior.length) {
    const dataName = `${name}Data`;
    return {
      aliasLines: [
        `type ${dataName} = ${dataType};`,
        `type ${name} = ${dataName} & ${braced(behavior)};`,
      ],
      constType: `Schema<${name}, ${dataName}>`,
      thisTypes,
      typeNames: [dataName, name],
    };
  }
  return {
    aliasLines: [`type ${name} = ${dataType};`],
    constType: `Schema<${name}, ${name}>`,
    thisTypes,
    typeNames: [name],
  };
}

// ── the module story ─────────────────────────────────────────────────

// Build the whole module's schema type story from its program sexpr:
// the declaration list (declaration order), each schema's story, the
// intrinsic tier, and the collision check — REJECTING loudly (a
// (i)) when an emitted type name collides with the intrinsic
// vocabulary, another emitted alias, or a user-declared type name.
// Returns null when the module declares no named schema (the zero-
// cost path: no intrinsics, no aliases, nothing).
export function buildSchemaTypeStory(programSexpr) {
  const decls = collectSchemaDecls(programSexpr);
  if (decls.length === 0) return null;
  const known = new Set(decls.map((d) => d.name));
  const byName = new Map(decls.map((d) => [d.name, d]));
  const userTypes = collectUserTypeNames(programSexpr);
  const withModel = decls.some((d) => d.descriptor.kind === 'model');

  // The user-vs-intrinsic direction: the module is about to EMIT the
  // intrinsic block, so a user type/interface/class/enum name in the
  // emitted tier would duplicate (aliases, TS2300) or silently merge
  // (interfaces) with it. Checked against the tier that actually
  // prints — a user `ModelSchema` beside validation-only schemas is
  // legal. Positioned on the USER declaration (the offender the user
  // can rename).
  for (const [name, user] of userTypes) {
    const emitted = VALIDATION_INTRINSIC_NAMES.has(name) ||
      (withModel && MODEL_INTRINSIC_NAMES.has(name));
    if (emitted) {
      throw new SchemaTypeError(
        `${user.what} collides with the schema intrinsic declarations this module emits ` +
        `(a schema declaration is present${MODEL_INTRINSIC_NAMES.has(name) ? ', and a :model brings the persistence tier' : ''}) — ` +
        `rename it; the emitted intrinsic vocabulary here is ` +
        `${[...VALIDATION_INTRINSIC_NAMES, ...(withModel ? MODEL_INTRINSIC_NAMES : [])].join(', ')}`,
        null, user.node);
    }
  }

  const owners = new Map(); // emitted type name → owning description
  const stories = [];
  for (const d of decls) {
    const story = schemaTypeStory(d, byName, known);
    for (const t of story.typeNames) {
      if (SCHEMA_INTRINSIC_NAMES.has(t)) {
        throw new SchemaTypeError(
          `schema '${d.name}' emits the type name '${t}', which is reserved by the schema ` +
          `intrinsic declarations (${[...SCHEMA_INTRINSIC_NAMES].join(', ')}) — rename the schema`,
          d.descriptor.start ?? null);
      }
      const prior = owners.get(t);
      if (prior !== undefined) {
        throw new SchemaTypeError(
          `schema '${d.name}' emits the type name '${t}', which ${prior} already emits — ` +
          `every schema-emitted type name binds once per module; rename one`,
          d.descriptor.start ?? null);
      }
      owners.set(t, `schema '${d.name}'`);
      const user = userTypes.get(t);
      if (user !== undefined) {
        throw new SchemaTypeError(
          `schema '${d.name}' emits the type name '${t}', which collides with ${user.what} — ` +
          `the schema's types and the user declaration would merge or duplicate; rename one`,
          d.descriptor.start ?? null);
      }
    }
    stories.push({ decl: d, ...story });
  }
  return {
    stories,
    intrinsicLines: schemaIntrinsicLines(withModel),
    withModel,
  };
}
