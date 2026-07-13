// The schema VALIDATION runtime — the first feature runtime
// through the delivery machinery: the pure validation core every
// compiled `__schema({...})` call needs. The persistence surface
// (:model, ORM, hydration, relations) lives in its sibling module,
// src/runtime/schema-orm.js, which installs through the persistence
// seam below; kind 'model' rejects loudly wherever that module is
// absent .
//
// Delivery: this file is BOTH the shared module toolchain paths
// import (the emitter injects `import { __schema, SchemaError } from
// …` on the loader path) and the body standalone output inlines once
// (IIFE-wrapped; the emitter strips the export line below). It is
// plain JavaScript — the runtime compiles inject-free by construction
// (it cannot depend on its own injection).
//
// Process-wide sentinel: two standalone copies meeting in one process
// would not share the registry or SchemaError identity — silent
// non-propagation. Loading a second copy therefore rejects LOUDLY
// with instructions. The shared module evaluates once per process
// (module cache), so toolchain-path programs never trip it.

const __RIP_SCHEMA_SENTINEL = Symbol.for('rip.runtime.schema');
if (globalThis[__RIP_SCHEMA_SENTINEL]) {
  throw new Error(
    'two copies of the Rip schema runtime loaded in one process — schemas from different copies ' +
    'cannot see each other (separate registries, distinct SchemaError classes). Run .rip sources ' +
    'through the rip CLI/loader (one shared runtime module per process), or load only one ' +
    'standalone-compiled file per process.',
  );
}
globalThis[__RIP_SCHEMA_SENTINEL] = true;

// The persistence seam : src/runtime/schema-orm.js installs
// its model machinery here at load. Kind 'model' is rejected loudly
// until it does — a hand-built model descriptor in a process without
// the persistence runtime has no working reading. The seam carries:
//   finishModelNorm(def, norm)     — relations, tableName, reserved
//                                    and directive validation
//   decorateDef(def, desc)         — scope statics, the on: adapter
//   projectableFields(def)         — algebra's model column set
//   jsonSchemaModelColumns(def, p) — the wire shape's implicit columns
let __schemaPersistence = null;
function __schemaInstallPersistence(impl) {
  if (__schemaPersistence && __schemaPersistence !== impl) {
    throw new Error('the Rip schema persistence runtime is already installed — two different copies met in one process');
  }
  __schemaPersistence = impl;
}

class SchemaError extends Error {
  constructor(issues, schemaName, schemaKind) {
    super(__schemaFormatIssues(issues, schemaName));
    this.name = 'SchemaError';
    this.issues = issues;
    this.schemaName = schemaName || null;
    this.schemaKind = schemaKind || null;
  }
}

function __schemaFormatIssues(issues, name) {
  if (!issues || !issues.length) return 'SchemaError';
  const head = name ? name + ': ' : '';
  return head + issues.map((i) => i.message || i.error || 'invalid').join('; ');
}

const __schemaTypes = {
  string:   (v) => typeof v === 'string',
  number:   (v) => typeof v === 'number' && !Number.isNaN(v),
  integer:  (v) => Number.isInteger(v),
  boolean:  (v) => typeof v === 'boolean',
  date:     (v) => v instanceof Date && !Number.isNaN(v.getTime()),
  datetime: (v) => v instanceof Date && !Number.isNaN(v.getTime()),
  email:    (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  url:      (v) => typeof v === 'string' && /^https?:\/\/.+/.test(v),
  uuid:     (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  phone:    (v) => typeof v === 'string' && /^[\d\s\-+()]+$/.test(v),
  zip:      (v) => typeof v === 'string' && /^\d{5}(-\d{4})?$/.test(v),
  text:     (v) => typeof v === 'string',
  json:     (v) => v !== undefined,
  any:      () => true,
};

// Strict coercion tables for the `~type` marker — "coerce, then
// validate". Deliberately narrow: `~integer` rejects "12.5" and NaN,
// `~boolean` accepts exactly six tokens, `~date` accepts ISO-8601
// strings and finite epoch numbers. A failed coercion is
// {error: 'coerce'}, distinct from {error: 'type'}.
const __SCHEMA_COERCERS = {
  integer(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? { ok: true, value: v } : { ok: false };
    if (typeof v === 'string' && /^[+-]?\d+$/.test(v.trim())) return { ok: true, value: parseInt(v.trim(), 10) };
    return { ok: false };
  },
  number(v) {
    if (typeof v === 'number') return Number.isNaN(v) ? { ok: false } : { ok: true, value: v };
    if (typeof v === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v.trim())) {
      return { ok: true, value: Number(v.trim()) };
    }
    return { ok: false };
  },
  boolean(v) {
    if (typeof v === 'boolean') return { ok: true, value: v };
    if (v === 'true' || v === '1' || v === 1) return { ok: true, value: true };
    if (v === 'false' || v === '0' || v === 0) return { ok: true, value: false };
    return { ok: false };
  },
  date(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? { ok: false } : { ok: true, value: v };
    if (typeof v === 'number' && Number.isFinite(v)) return { ok: true, value: new Date(v) };
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
    if (m) {
      // The written calendar date must EXIST: Date() silently
      // normalizes an impossible day (Feb 30 becomes Mar 1), changing
      // the user's date instead of failing. Pure calendar math — days
      // in the written month, leap years included — independent of
      // any timezone suffix.
      const mo = +m[2], day = +m[3];
      const daysInMonth = new Date(Date.UTC(+m[1], mo, 0)).getUTCDate();
      if (mo < 1 || mo > 12 || day < 1 || day > daysInMonth) return { ok: false };
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return { ok: true, value: d };
    }
    return { ok: false };
  },
};
__SCHEMA_COERCERS.datetime = __SCHEMA_COERCERS.date;


// An object schema's input must BE an object — a primitive, null, or
// an array would spread into a valid-looking empty instance when every
// field is optional. Returns the structured issue, or null for a real
// object.
function __schemaObjectIssue(data) {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) return null;
  const kind = data === null ? 'null' : Array.isArray(data) ? 'an array' : 'a ' + typeof data;
  return { field: '', error: 'object', message: 'input must be an object; got ' + kind };
}

// Named-coercer registry for the `~:name` field syntax. A coercer is a
// function (wireValue) → coercedValue, where null/undefined/false
// means "didn't convert" → {error: 'coerce'}. `opts.raw` passes the
// value through un-stringified (coercers over arrays/objects).
const __schemaNamedCoercers = new Map();

function __schemaRegisterCoercer(name, fn, opts) {
  if (typeof name !== 'string' || typeof fn !== 'function') {
    throw new Error('registerCoercer(name, fn, opts?): name string and fn required');
  }
  __schemaNamedCoercers.set(name, { fn, raw: opts?.raw === true });
  return fn;
}

// A field type that resolves to a schema with its OWN pipeline —
// nested shapes, inputs, models, and unions. These validate through
// the child's full contract and return normalized values; enums and
// primitives validate inline.
function __schemaNestedDef(typeName) {
  if (__schemaTypes[typeName]) return null;
  const d = __SchemaRegistry.get(typeName);
  return d && (d.kind === 'shape' || d.kind === 'input' || d.kind === 'model' || d.kind === 'union') ? d : null;
}

// Nested field validation runs the child's FULL sync pipeline —
// structure, transforms, coercions, defaults, dates, fields,
// refinements — and returns the child's NORMALIZED value so the
// parent writes it back (a parent must never retain raw input its
// child's own schema would transform). Returns { value } on success,
// { errors } on failure; issues arrive unprefixed and the caller
// prefixes once at the field boundary.
function __schemaValidateValue(v, typeName) {
  const prim = __schemaTypes[typeName];
  if (prim) {
    return prim(v) ? { value: v } : { errors: [{ field: '', error: 'type', message: 'must be ' + typeName }] };
  }
  const subDef = __SchemaRegistry.get(typeName);
  if (!subDef) return { value: v };
  if (subDef.kind === 'enum') {
    const errs = subDef._validateEnum(v, true);
    return errs.length
      ? { errors: [{ field: '', error: 'enum', message: errs[0].message }] }
      : { value: subDef._materializeEnum(v) };
  }
  if (subDef.kind === 'mixin') {
    return { errors: [{ field: '', error: 'type', message: ':mixin ' + typeName + ' is not usable as a field type' }] };
  }
  if (subDef.kind === 'union') {
    const r = subDef._unionResolve(v);
    if (r.issue) return { errors: [r.issue] };
    const res = r.def._runSync(v, { materialize: false });
    return res.ok ? { value: res.value } : { errors: res.errors };
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return { errors: [{ field: '', error: 'type', message: 'must be a ' + typeName + ' object' }] };
  }
  const res = subDef._runSync(v, { materialize: false });
  return res.ok ? { value: res.value } : { errors: res.errors };
}

// The async twin: nested children await their own async pipelines, so
// an @ensure! at any depth is awaited, never silently accepted.
async function __schemaValidateValueAsync(v, typeName) {
  const subDef = __schemaNestedDef(typeName);
  if (subDef === null) return __schemaValidateValue(v, typeName);
  if (subDef.kind === 'union') {
    const r = subDef._unionResolve(v);
    if (r.issue) return { errors: [r.issue] };
    const res = await r.def._runAsync(v, { materialize: false });
    return res.ok ? { value: res.value } : { errors: res.errors };
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return { errors: [{ field: '', error: 'type', message: 'must be a ' + typeName + ' object' }] };
  }
  const res = await subDef._runAsync(v, { materialize: false });
  return res.ok ? { value: res.value } : { errors: res.errors };
}

function __schemaJoinField(head, child) {
  if (!child) return head;
  return head + (child.startsWith('[') ? child : '.' + child);
}

function __schemaRewriteMessage(joinedField, childField, childMessage) {
  if (!childField) return joinedField + ' ' + childMessage;
  if (childMessage.startsWith(childField)) {
    return joinedField + childMessage.slice(childField.length);
  }
  return joinedField + ': ' + childMessage;
}

// Canonical camelCase names only: two consecutive uppercase letters
// break the snake_case ↔ camelCase bijection persistence consumers
// rely on — a schema valid today must stay valid when the
// persistence layer loads.
//   ok:  name, mrn, firstName, mdmId, line2      bad: ID, mdmID, foo_bar
function __schemaValidateCanonicalName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(name)) return false;
  if (/[A-Z]{2,}/.test(name)) return false;
  return true;
}

// Structural signature of a declaration — name-shape only, function
// bodies excluded. Two registrations with the same signature are the
// same declaration arriving twice and rebind silently; different
// signatures under one name are a real collision and throw (unless
// `__SchemaRegistry.replace` — dev/HMR semantics).
function __schemaSignature(def) {
  const safe = (v) => JSON.stringify(v ?? null, (k, x) =>
    x instanceof RegExp ? String(x) : (typeof x === 'function' ? '<fn>' : x));
  const parts = [def.kind];
  for (const e of def._desc.entries || []) {
    switch (e.tag) {
      case 'field':
        parts.push('f:' + e.name + ':' + (e.typeName || '') +
          (e.array ? '[]' : '') + ':' + (e.modifiers || []).join('') +
          (e.literals ? ':' + e.literals.join(',') : '') +
          ':' + safe(e.constraints) + (e.coerce ? ':~' + (e.coercer || '') : '') +
          (e.transform ? ':t' : ''));
        break;
      case 'enum-member':
        parts.push('e:' + e.name + '=' + String(e.value));
        break;
      case 'directive':
        parts.push('d:' + e.name + ':' + safe(e.args));
        break;
      case 'ensure':
        parts.push('n:' + (e.message || ''));
        break;
      default:
        parts.push(e.tag + ':' + (e.name || ''));
    }
  }
  return parts.join('|');
}

// Registry generation: bumped on every registration or scope swap.
// Transitive async-status memos key on it, so a schema that becomes
// reachable-async through a LATER registration is re-planned on next
// use rather than trusting a stale answer.
let __schemaRegistryGen = 0;

const __SchemaRegistry = {
  _entries: new Map(),
  replace: false,
  register(def) {
    if (!def.name) return;
    __schemaRegistryGen++;
    const existing = this._entries.get(def.name);
    if (existing && existing.def !== def && !this.replace) {
      if (__schemaSignature(existing.def) !== __schemaSignature(def)) {
        throw new SchemaError(
          [{
            field: def.name, error: 'collision',
            message: "schema name '" + def.name + "' is already registered with a different definition. " +
              'Schema names are app-global (they resolve nested field types and @mixin references), so two ' +
              'different schemas cannot share one name. Rename one — or, for dev/HMR reload semantics, set ' +
              '__SchemaRegistry.replace = true before re-evaluating modules.',
          }],
          def.name, def.kind);
      }
    }
    this._entries.set(def.name, { def, kind: def.kind });
  },
  get(name) {
    const entry = this._entries.get(name);
    return entry ? entry.def : null;
  },
  getKind(name, kind) {
    const entry = this._entries.get(name);
    return entry && entry.kind === kind ? entry.def : null;
  },
  has(name) { return this._entries.has(name); },
  reset() { this._entries.clear(); __schemaRegistryGen++; },
  // Run `fn` against a fresh, empty registry; restore afterward
  // (success, throw, or async rejection) — the test-scoping seam.
  scope(fn) {
    const saved = this._entries;
    this._entries = new Map();
    __schemaRegistryGen++;
    const restore = () => { this._entries = saved; __schemaRegistryGen++; };
    try {
      const r = fn();
      if (r && typeof r.then === 'function') return r.finally(restore);
      restore();
      return r;
    } catch (e) {
      restore();
      throw e;
    }
  },
};

class __SchemaDef {
  constructor(desc) {
    if (desc.kind === 'model' && !__schemaPersistence) {
      throw new Error(
        "schema: kind 'model' needs the persistence runtime (src/runtime/schema-orm.js), which is not " +
        'loaded in this process — reference a persistence name (schema.transaction, __schemaSetAdapter) ' +
        'or import the module directly',
      );
    }
    this._desc = desc;
    this.kind = desc.kind;
    this.name = desc.name || null;
    this._norm = null;
    this._klass = null;
    this._unionPlanCache = null;
    this._sourceModel = null;
    if (desc.kind === 'model') __schemaPersistence.decorateDef(this, desc);
  }

  _normalize() {
    if (this._norm) return this._norm;

    const fields = new Map();
    const methods = new Map();
    const computed = new Map();
    const derived = new Map();
    const hooks = new Map();
    const scopes = new Map();
    let defaultScope = null;
    const directives = [];
    const enumMembers = new Map();
    const ensures = [];

    const collision = (n, where) => {
      throw new SchemaError(
        [{ field: n, error: 'collision', message: n + ' collides with ' + where }],
        this.name, this.kind);
    };
    const noteCollision = (n) => {
      if (fields.has(n)) collision(n, 'field');
      if (methods.has(n)) collision(n, 'method');
      if (computed.has(n)) collision(n, 'computed');
      if (derived.has(n)) collision(n, 'derived');
      if (hooks.has(n)) collision(n, 'hook');
    };
    const modelOnly = (what) => {
      throw new SchemaError(
        [{ field: '', error: 'kind', message: what + ' is :model-only (this schema is :' + this.kind + ')' }],
        this.name, this.kind);
    };
    // Directive names are validated per kind — an unknown name is a
    // silently wrong schema, never a no-op. The
    // persistence set is validated by the seam below; the base kinds
    // accept exactly their matrix.
    const baseDirectives = this.kind === 'union' ? new Set(['on']) : new Set(['mixin']);
    const requireCanonicalName = (n, kindLabel) => {
      if (!__schemaValidateCanonicalName(n)) {
        throw new SchemaError(
          [{
            field: n, error: 'invalid-name',
            message: kindLabel + " name '" + n + "' is not canonical camelCase. " +
              'Use a lowercase-first, alphanumeric identifier with no consecutive uppercase letters ' +
              "(e.g. 'mdmId' not 'mdmID').",
          }],
          this.name, this.kind);
      }
    };

    for (const e of this._desc.entries) {
      switch (e.tag) {
        case 'field':
          requireCanonicalName(e.name, 'field');
          noteCollision(e.name);
          fields.set(e.name, {
            name: e.name,
            required: e.modifiers.includes('!'),
            optional: e.modifiers.includes('?'),
            // unique/attrs are persistence metadata riding the field
            // (inline @unique, {was:} column renames) — inert for
            // validation, read by the persistence layer's DDL.
            unique: e.unique === true,
            attrs: e.attrs || null,
            typeName: e.typeName,
            literals: e.literals || null,
            array: e.array === true,
            coerce: e.coerce === true,
            coercer: e.coercer || null,
            constraints: e.constraints || null,
            transform: e.transform || null,
          });
          break;
        case 'method':
          noteCollision(e.name);
          methods.set(e.name, e.fn);
          break;
        case 'computed':
          noteCollision(e.name);
          computed.set(e.name, e.fn);
          break;
        case 'derived':
          noteCollision(e.name);
          derived.set(e.name, e.fn);
          break;
        case 'hook':
          if (this.kind !== 'model') modelOnly("lifecycle hook '" + e.name + "'");
          if (hooks.has(e.name)) collision(e.name, 'duplicate hook');
          hooks.set(e.name, e.fn);
          break;
        case 'scope':
          if (this.kind !== 'model') modelOnly("query scope '@scope :" + e.name + "'");
          if (scopes.has(e.name)) collision(e.name, 'scope');
          scopes.set(e.name, e.fn);
          break;
        case 'defaultScope':
          if (this.kind !== 'model') modelOnly('@defaultScope');
          if (defaultScope) {
            throw new SchemaError(
              [{ field: '', error: 'collision', message: 'only one @defaultScope per model' }],
              this.name, this.kind);
          }
          defaultScope = e.fn;
          break;
        case 'directive':
          if (this.kind !== 'model' && !baseDirectives.has(e.name)) {
            throw new SchemaError(
              [{
                field: '', error: 'directive',
                message: "unknown directive '@" + e.name + "' on :" + this.kind +
                  ' — legal here: ' + [...baseDirectives].map((d) => '@' + d).join(', '),
              }],
              this.name, this.kind);
          }
          directives.push({ name: e.name, args: e.args || [] });
          break;
        case 'enum-member':
          enumMembers.set(e.name, e.value !== undefined ? e.value : e.name);
          break;
        case 'union-member':
          break;
        case 'ensure':
          ensures.push({
            message: e.message,
            field: e.field || '',
            async: e.async === true,
            fn: e.fn,
          });
          break;
        default:
          // An unrecognized entry tag is a silently wrong schema —
          // reject rather than drop (the unknown-name class at
          // the entry level).
          throw new SchemaError(
            [{ field: '', error: 'entry', message: "unknown schema entry tag '" + e.tag + "'" }],
            this.name, this.kind);
      }
    }

    if (this.kind === 'shape' || this.kind === 'input' || this.kind === 'mixin' || this.kind === 'model') {
      __schemaExpandMixins(this, fields, directives, {
        stack: [this.name || '<anon>'],
        seen: new Set([this.name || '<anon>']),
      });
    }

    let unionOn = null;
    const unionMembers = [];
    if (this.kind === 'union') {
      for (const d of directives) {
        if (d.name === 'on' && d.args?.[0]?.field) unionOn = d.args[0].field;
      }
      for (const e of this._desc.entries) {
        if (e.tag === 'union-member') unionMembers.push(e.name);
      }
    }

    this._norm = {
      fields, methods, computed, derived, hooks, scopes, defaultScope,
      directives, enumMembers, ensures,
      hasAsyncEnsures: ensures.some((r) => r.async),
      unionOn, unionMembers,
    };
    // Kind 'model' cannot exist without the persistence runtime (the
    // constructor rejects), so the seam is present here by
    // construction: relations, tableName, reserved-name enforcement,
    // and the directive/argument validation (#102–#105) attach now.
    if (this.kind === 'model') __schemaPersistence.finishModelNorm(this, this._norm);
    return this._norm;
  }

  // ── :union dispatch (lazy plan: value → constituent map) ───────────

  _unionPlan() {
    if (this._unionPlanCache) return this._unionPlanCache;
    const norm = this._normalize();
    const disc = norm.unionOn;
    if (this.kind !== 'union' || !disc) {
      throw new Error("schema: '" + (this.name || 'anon') + "' is not a :union");
    }
    const map = new Map();
    const members = [];
    for (const name of norm.unionMembers) {
      const def = __SchemaRegistry.get(name);
      if (!def) {
        throw new SchemaError(
          [{ field: '', error: 'union', message: 'unknown union constituent: ' + name + ' (import the file that declares it)' }],
          this.name, this.kind);
      }
      members.push(def);
      const f = def._normalize().fields.get(disc);
      if (!f || f.typeName !== 'literal-union' || !f.literals?.length) {
        throw new SchemaError(
          [{ field: disc, error: 'union', message: name + " must declare '" + disc +
            "' as a string-literal type (e.g. " + disc + '! "click") to join union ' + (this.name || '') }],
          this.name, this.kind);
      }
      for (const lit of f.literals) {
        if (map.has(lit)) {
          throw new SchemaError(
            [{ field: disc, error: 'union', message: 'duplicate discriminator value ' + JSON.stringify(lit) +
              ' in ' + (map.get(lit).name || 'anon') + ' and ' + name }],
            this.name, this.kind);
        }
        map.set(lit, def);
      }
    }
    const plan = {
      disc, map,
      expected: [...map.keys()].join(' | '),
      hasAsyncEnsures: members.some((d) => d._normalize().hasAsyncEnsures),
    };
    this._unionPlanCache = plan;
    return plan;
  }

  _unionResolve(data) {
    const plan = this._unionPlan();
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { issue: { field: plan.disc, error: 'union', message: 'expected an object with ' + plan.disc } };
    }
    const def = plan.map.get(data[plan.disc]);
    if (!def) {
      return { issue: { field: plan.disc, error: 'union', message: 'expected one of ' + plan.expected } };
    }
    return { def };
  }

  // Eager-derived entries (!>) — one pass, declaration order,
  // materialized once at instance creation (use ~> for live
  // recomputation). Own enumerable properties, so they round-trip
  // through Object.keys / JSON.stringify.
  _applyEagerDerived(inst) {
    const norm = this._normalize();
    if (!norm.derived.size) return;
    for (const [n, fn] of norm.derived) {
      const v = fn.call(inst);
      Object.defineProperty(inst, n, {
        value: v, enumerable: true, writable: true, configurable: true,
      });
    }
  }

  // `@ensure` predicates — schema-level cross-field invariants,
  // running AFTER per-field validation against typed, defaulted data.
  // Truthy → pass; falsy or thrown → the declared message. All run;
  // declaration order preserved.
  _applyEnsures(data) {
    const norm = this._normalize();
    if (!norm.ensures.length) return [];
    const errs = [];
    for (const r of norm.ensures) {
      let ok = false;
      try {
        ok = !!r.fn(data);
      } catch {
        errs.push({ field: r.field || '', error: 'ensure', message: r.message || 'ensure failed' });
        continue;
      }
      if (!ok) {
        errs.push({ field: r.field || '', error: 'ensure', message: r.message || 'ensure failed' });
      }
    }
    return errs;
  }

  // Async-aware pass: sync refinements first (cheap before expensive),
  // async ones CONCURRENTLY; issues surface in declaration order.
  async _applyEnsuresAsync(data) {
    const norm = this._normalize();
    if (!norm.ensures.length) return [];
    const results = [];
    const pending = [];
    norm.ensures.forEach((r, idx) => {
      const issue = () => ({ field: r.field || '', error: 'ensure', message: r.message || 'ensure failed' });
      if (r.async) {
        pending.push((async () => {
          let ok = false;
          try { ok = !!(await r.fn(data)); } catch { ok = false; }
          if (!ok) results.push({ idx, issue: issue() });
        })());
      } else {
        let ok = false;
        try { ok = !!r.fn(data); } catch { ok = false; }
        if (!ok) results.push({ idx, issue: issue() });
      }
    });
    await Promise.all(pending);
    results.sort((a, b) => a.idx - b.idx);
    return results.map((r) => r.issue);
  }

  // Transitive async status: can this schema REACH a schema with an
  // async refinement — through nested fields, array element types, or
  // union constituents? Reachability over a possibly-cyclic, mutable
  // graph: a revisited node contributes "not proven async" (the root's
  // DFS still visits every reachable node, so the root's answer is
  // exact), and only the queried root memoizes, keyed on the registry
  // generation — a later registration invalidates every memo, so a
  // schema that becomes reachable-async re-plans on next use.
  _transitiveAsync() {
    if (this._taGen === __schemaRegistryGen) return this._taCache;
    const seen = new Set();
    const walk = (def) => {
      if (seen.has(def)) return false;
      seen.add(def);
      const norm = def._normalize();
      if (norm.hasAsyncEnsures) return true;
      if (def.kind === 'union') {
        for (const name of norm.unionMembers) {
          const m = __SchemaRegistry.get(name);
          if (m && walk(m)) return true;
        }
        return false;
      }
      for (const f of norm.fields.values()) {
        const child = __schemaNestedDef(f.typeName);
        if (child && walk(child)) return true;
      }
      return false;
    };
    this._taCache = walk(this);
    this._taGen = __schemaRegistryGen;
    return this._taCache;
  }

  // A schema that can reach ≥1 @ensure! is async-validating: sync
  // entry points refuse loudly rather than sometimes-returning a
  // promise or silently accepting an unawaited refinement.
  _assertSyncValidatable(api) {
    if (!this._transitiveAsync()) return;
    const own = this.kind !== 'union' && this._normalize().hasAsyncEnsures;
    throw new Error(
      "schema '" + (this.name || 'anon') + "' has async refinements (@ensure!" +
      (own ? '' : ' in a nested or constituent schema') + '); ' +
      '.' + api + '() is sync. Use parseAsync/safeAsync/okAsync instead.');
  }

  _getClass() {
    if (this._klass) return this._klass;
    const norm = this._normalize();
    const name = this.name || 'Schema';

    const fieldNames = [...norm.fields.keys()];
    const klass = ({ [name]: class {
      constructor(data) {
        if (data && typeof data === 'object') {
          for (const k of fieldNames) {
            if (k in data && data[k] !== undefined) this[k] = data[k];
          }
        }
      }
    } })[name];

    for (const [n, fn] of norm.methods) {
      Object.defineProperty(klass.prototype, n, {
        value: fn, writable: true, enumerable: false, configurable: true,
      });
    }
    for (const [n, fn] of norm.computed) {
      Object.defineProperty(klass.prototype, n, {
        get: fn, enumerable: false, configurable: true,
      });
    }

    this._klass = klass;
    return klass;
  }

  // Coerce ISO date strings to Date for date/datetime fields — over
  // JSON a date is a string. Only ISO-shaped strings coerce (a lax
  // `new Date("5")` would let bad input slip through as a bogus
  // Date). Array fields coerce element-wise.
  _coerceDates(working) {
    const norm = this._normalize();
    const isoShaped = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s);
    // The written calendar date must EXIST — Date() silently
    // normalizes an impossible day (Feb 30 becomes Mar 1), changing
    // the user's date instead of failing validation. Pure calendar
    // math on the written components, timezone-independent; a bad day
    // leaves the string in place for the type check to reject.
    const dayExists = (s) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      const mo = +m[2], day = +m[3];
      return mo >= 1 && mo <= 12 && day >= 1 && day <= new Date(Date.UTC(+m[1], mo, 0)).getUTCDate();
    };
    const toDate = (s) => {
      if (!dayExists(s)) return s;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : d;
    };
    for (const [n, f] of norm.fields) {
      if (f.typeName !== 'date' && f.typeName !== 'datetime') continue;
      const v = working[n];
      if (f.array && Array.isArray(v)) {
        working[n] = v.map((el) => (isoShaped(el) ? toDate(el) : el));
      } else if (isoShaped(v)) {
        working[n] = toDate(v);
      }
    }
  }

  // Field validation, and — because nested values validate through
  // the child schema's FULL pipeline — nested normalization: on
  // success the child's normalized value writes back into `data`
  // (always a replacement, never an in-place write, since `data` is a
  // working copy whose array/object values are still shared with
  // caller input). `opts.deferNested` skips the value validation of
  // nested/union-typed fields (structure and length bounds still run)
  // so the async pipeline can await those children instead.
  _validateFields(data, collect, skip, opts) {
    const norm = this._normalize();
    const errors = collect ? [] : null;
    for (const [n, f] of norm.fields) {
      if (skip && skip.has(n)) continue;
      const v = data == null ? undefined : data[n];
      if (v === undefined || v === null) {
        if (f.required) {
          if (!collect) return false;
          errors.push({ field: n, error: 'required', message: n + ' is required' });
        }
        continue;
      }
      if (f.array) {
        if (!Array.isArray(v)) {
          if (!collect) return false;
          errors.push({ field: n, error: 'type', message: n + ' must be an array' });
          continue;
        }
        // Length bounds apply after array structure succeeds — the same
        // min/max the JSON Schema face advertises as minItems/maxItems.
        const ac = f.constraints;
        if (ac) {
          if (ac.min != null && v.length < ac.min) {
            if (!collect) return false;
            errors.push({ field: n, error: 'min', message: n + ' must have at least ' + ac.min + ' items' });
          }
          if (ac.max != null && v.length > ac.max) {
            if (!collect) return false;
            errors.push({ field: n, error: 'max', message: n + ' must have at most ' + ac.max + ' items' });
          }
        }
        if (opts?.deferNested && __schemaNestedDef(f.typeName)) continue;
        let bad = false;
        let changed = false;
        const out = new Array(v.length);
        for (let i = 0; i < v.length; i++) {
          const res = __schemaValidateValue(v[i], f.typeName);
          if (res.errors) {
            if (!collect) return false;
            const head = n + '[' + i + ']';
            for (const e of res.errors) {
              const joined = __schemaJoinField(head, e.field);
              errors.push({
                field: joined,
                error: e.error,
                message: __schemaRewriteMessage(joined, e.field, e.message),
              });
            }
            bad = true;
          } else {
            out[i] = res.value;
            if (res.value !== v[i]) changed = true;
          }
        }
        if (bad) continue;
        if (changed) data[n] = out;
      } else if (f.typeName === 'literal-union') {
        if (!f.literals.includes(v)) {
          if (!collect) return false;
          errors.push({ field: n, error: 'enum', message: n + ' must be one of ' + f.literals.map((l) => JSON.stringify(l)).join(', ') });
          continue;
        }
      } else {
        if (opts?.deferNested && __schemaNestedDef(f.typeName)) continue;
        const res = __schemaValidateValue(v, f.typeName);
        if (res.errors) {
          if (!collect) return false;
          for (const e of res.errors) {
            const joined = __schemaJoinField(n, e.field);
            errors.push({
              field: joined,
              error: e.error,
              message: __schemaRewriteMessage(joined, e.field, e.message),
            });
          }
          continue;
        }
        if (res.value !== v) data[n] = res.value;
      }
      const c = f.constraints;
      if (c) {
        if (typeof v === 'string') {
          if (c.min != null && v.length < c.min) { if (!collect) return false; errors.push({ field: n, error: 'min', message: n + ' must be at least ' + c.min + ' chars' }); }
          if (c.max != null && v.length > c.max) { if (!collect) return false; errors.push({ field: n, error: 'max', message: n + ' must be at most ' + c.max + ' chars' }); }
          if (c.regex) {
            // A /g or /y constraint is stateful through lastIndex —
            // identical inputs must validate identically, so the
            // cursor resets before every test.
            if (c.regex.global || c.regex.sticky) c.regex.lastIndex = 0;
            if (!c.regex.test(v)) { if (!collect) return false; errors.push({ field: n, error: 'pattern', message: n + ' is invalid' }); }
          }
        } else if (typeof v === 'number') {
          if (c.min != null && v < c.min) { if (!collect) return false; errors.push({ field: n, error: 'min', message: n + ' must be >= ' + c.min }); }
          if (c.max != null && v > c.max) { if (!collect) return false; errors.push({ field: n, error: 'max', message: n + ' must be <= ' + c.max }); }
        }
      }
    }
    return collect ? errors : true;
  }

  _applyDefaults(data) {
    const norm = this._normalize();
    for (const [n, f] of norm.fields) {
      if ((data[n] === undefined || data[n] === null) && f.constraints?.default !== undefined) {
        const d = f.constraints.default;
        data[n] = (typeof d === 'object' && d !== null && !(d instanceof RegExp))
          ? structuredClone(d) : d;
      }
    }
    return data;
  }

  // Inline field transforms run once during parse (and safe/ok). Each
  // receives the whole raw input as `it`; its return becomes the
  // field's candidate value before default + validation.
  _applyTransforms(raw, working) {
    const norm = this._normalize();
    const errors = [];
    for (const [n, f] of norm.fields) {
      if (!f.transform) continue;
      try {
        working[n] = f.transform(raw);
      } catch (e) {
        errors.push({ field: n, error: 'transform', message: e?.message || String(e) });
      }
    }
    return errors;
  }

  // `~type` / `~:name` coercions: the wire value converts before
  // defaults and validation, so range checks see the coerced value.
  // Failed coercions land in `failed` so per-field validation doesn't
  // double-report. Mutually exclusive with transforms at compile time.
  _applyCoercions(working, failed) {
    const norm = this._normalize();
    const errors = [];
    for (const [n, f] of norm.fields) {
      if (!f.coerce) continue;
      const v = working[n];
      if (v === undefined || v === null) continue;
      if (f.coercer) {
        const entry = __schemaNamedCoercers.get(f.coercer);
        if (!entry) {
          throw new Error(
            "schema: no coercer registered for '~:" + f.coercer + "' (field '" + n + "' on " +
            (this.name || 'anon') + "). Register it with registerCoercer('" + f.coercer + "', fn).");
        }
        const input = entry.raw ? v : String(v).trim();
        let out;
        try { out = entry.fn(input); } catch { out = null; }
        if (out === null || out === undefined || out === false) {
          errors.push({ field: n, error: 'coerce', message: n + ' is not a valid ' + f.coercer });
          failed.add(n);
        } else {
          working[n] = out;
        }
        continue;
      }
      const r = __SCHEMA_COERCERS[f.typeName] ? __SCHEMA_COERCERS[f.typeName](v) : { ok: false };
      if (r.ok) {
        working[n] = r.value;
      } else {
        errors.push({ field: n, error: 'coerce', message: n + ' cannot be coerced to ' + f.typeName });
        failed.add(n);
      }
    }
    return errors;
  }

  _validateEnum(data, collect) {
    const norm = this._normalize();
    for (const [n, v] of norm.enumMembers) {
      if (data === n || data === v) return collect ? [] : true;
    }
    if (!collect) return false;
    const members = [...norm.enumMembers.keys()].join(', ');
    return [{ field: '', error: 'enum', message: (this.name || 'enum') + ' expected one of: ' + members }];
  }

  _materializeEnum(data) {
    const norm = this._normalize();
    for (const [n, v] of norm.enumMembers) {
      if (data === n || data === v) return v;
    }
    return data;
  }

  // ── the canonical validation pipeline ───────────────────────────────
  //
  // ONE value-returning pipeline (sync and its async twin) behind
  // every entry point, per field in declaration order:
  //   1. structure check          2. copy into a working value
  //   3. transforms               4. coercions
  //   5. defaults                 6. date normalization
  //   7. field validation         8. nested normalization/write-back
  //   9. refinements             10. materialization + eager-derived
  // Returns { ok: true, value } | { ok: false, errors } — plus
  // `from` (the union member that produced the errors, so throwing
  // wrappers attribute correctly) and `thrown` (an eager-derived
  // throw, which parse propagates raw and safe reports as an issue).
  // `materialize: false` stops after stage 9: answering a boolean or
  // normalizing a nested child never constructs instances or runs
  // eager-derived behavior. Stages 7–8 run fused inside
  // _validateFields: a nested value validates through the child's
  // full pipeline exactly once, and that same run's normalized value
  // writes back into the parent working value.
  _runSync(data, opts) {
    if (this.kind === 'union') {
      const r = this._unionResolve(data);
      if (r.issue) return { ok: false, errors: [r.issue] };
      const res = r.def._runSync(data, opts);
      return res.ok ? res : { ...res, from: res.from || r.def };
    }
    if (this.kind === 'enum') {
      const errs = this._validateEnum(data, true);
      return errs.length ? { ok: false, errors: errs } : { ok: true, value: this._materializeEnum(data) };
    }
    const objIssue = __schemaObjectIssue(data);
    if (objIssue) return { ok: false, errors: [objIssue] };
    const raw = data;
    const working = { ...raw };
    const failed = new Set();
    const transformErrors = this._applyTransforms(raw, working);
    const coerceErrors = this._applyCoercions(working, failed);
    this._applyDefaults(working);
    this._coerceDates(working);
    const errs = transformErrors.concat(coerceErrors, this._validateFields(working, true, failed));
    if (errs.length) return { ok: false, errors: errs };
    const ensureErrs = this._applyEnsures(working);
    if (ensureErrs.length) return { ok: false, errors: ensureErrs };
    if (!opts?.materialize) return { ok: true, value: working };
    const inst = new (this._getClass())(working);
    try { this._applyEagerDerived(inst); }
    catch (e) { return { ok: false, errors: null, thrown: e }; }
    return { ok: true, value: inst };
  }

  // Async twin: identical stages, but nested/union-typed fields are
  // DEFERRED out of stage 7 and awaited here through the children's
  // async pipelines — an @ensure! at any depth is awaited, never
  // silently accepted — and refinements await per _applyEnsuresAsync.
  async _runAsync(data, opts) {
    if (this.kind === 'union') {
      const r = this._unionResolve(data);
      if (r.issue) return { ok: false, errors: [r.issue] };
      const res = await r.def._runAsync(data, opts);
      return res.ok ? res : { ...res, from: res.from || r.def };
    }
    if (this.kind === 'enum') return this._runSync(data, opts);
    const objIssue = __schemaObjectIssue(data);
    if (objIssue) return { ok: false, errors: [objIssue] };
    const raw = data;
    const working = { ...raw };
    const failed = new Set();
    const transformErrors = this._applyTransforms(raw, working);
    const coerceErrors = this._applyCoercions(working, failed);
    this._applyDefaults(working);
    this._coerceDates(working);
    const fieldErrs = this._validateFields(working, true, failed, { deferNested: true });
    const nestedErrs = await this._normalizeNestedAsync(working, failed);
    const errs = transformErrors.concat(coerceErrors, fieldErrs, nestedErrs);
    if (errs.length) return { ok: false, errors: errs };
    const ensureErrs = await this._applyEnsuresAsync(working);
    if (ensureErrs.length) return { ok: false, errors: ensureErrs };
    if (!opts?.materialize) return { ok: true, value: working };
    const inst = new (this._getClass())(working);
    try { this._applyEagerDerived(inst); }
    catch (e) { return { ok: false, errors: null, thrown: e }; }
    return { ok: true, value: inst };
  }

  // Stage 8 for the async pipeline: every nested/union-typed field
  // (and every element of an array of them) runs the child's async
  // pipeline; normalized values write back, issues prefix once at the
  // field boundary, declaration order preserved.
  async _normalizeNestedAsync(working, failed) {
    const norm = this._normalize();
    const errors = [];
    for (const [n, f] of norm.fields) {
      if (failed && failed.has(n)) continue;
      if (!__schemaNestedDef(f.typeName)) continue;
      const v = working[n];
      if (v === undefined || v === null) continue;
      if (f.array) {
        if (!Array.isArray(v)) continue;
        const out = new Array(v.length);
        let bad = false;
        for (let i = 0; i < v.length; i++) {
          const res = await __schemaValidateValueAsync(v[i], f.typeName);
          if (res.errors) {
            bad = true;
            const head = n + '[' + i + ']';
            for (const e of res.errors) {
              const joined = __schemaJoinField(head, e.field);
              errors.push({ field: joined, error: e.error, message: __schemaRewriteMessage(joined, e.field, e.message) });
            }
          } else {
            out[i] = res.value;
          }
        }
        if (!bad) working[n] = out;
      } else {
        const res = await __schemaValidateValueAsync(v, f.typeName);
        if (res.errors) {
          for (const e of res.errors) {
            const joined = __schemaJoinField(n, e.field);
            errors.push({ field: joined, error: e.error, message: __schemaRewriteMessage(joined, e.field, e.message) });
          }
        } else {
          working[n] = res.value;
        }
      }
    }
    return errors;
  }

  parse(data) {
    if (this.kind === 'mixin') {
      throw new Error(":mixin schema '" + (this.name || 'anon') + "' is not instantiable");
    }
    this._assertSyncValidatable('parse');
    const r = this._runSync(data, { materialize: true });
    if (r.ok) return r.value;
    if (r.thrown) throw r.thrown;
    const src = r.from || this;
    throw new SchemaError(r.errors, src.name, src.kind);
  }

  // Array combinator: `Schema.array` is a list-of-this schema with the
  // same validation family. Item failures aggregate, tagged `[index]`.
  get array() {
    const elem = this;
    const notArray = (data) => {
      const got = data === null ? 'null'
        : data === undefined ? 'undefined'
        : typeof data === 'object' ? ('an object with keys [' + Object.keys(data).join(', ') + ']')
        : typeof data;
      return { field: '', error: 'not_array', message: 'expected an array, received ' + got };
    };
    const collect = (results) => {
      const value = [];
      const errors = [];
      results.forEach((r, i) => {
        if (r.ok) value.push(r.value);
        else for (const e of r.errors) {
          errors.push({ ...e, field: '[' + i + ']' + (e.field ? '.' + e.field : '') });
        }
      });
      return { value, errors };
    };
    return {
      parse(data) {
        if (!Array.isArray(data)) throw new SchemaError([notArray(data)], elem.name, elem.kind);
        const { value, errors } = collect(data.map((x) => elem.safe(x)));
        if (errors.length) throw new SchemaError(errors, elem.name, elem.kind);
        return value;
      },
      safe(data) {
        if (!Array.isArray(data)) return { ok: false, value: null, errors: [notArray(data)] };
        const { value, errors } = collect(data.map((x) => elem.safe(x)));
        return errors.length ? { ok: false, value: null, errors } : { ok: true, value, errors: null };
      },
      ok(data) {
        return Array.isArray(data) && data.every((x) => elem.ok(x));
      },
      async parseAsync(data) {
        if (!Array.isArray(data)) throw new SchemaError([notArray(data)], elem.name, elem.kind);
        const { value, errors } = collect(await Promise.all(data.map((x) => elem.safeAsync(x))));
        if (errors.length) throw new SchemaError(errors, elem.name, elem.kind);
        return value;
      },
      async safeAsync(data) {
        if (!Array.isArray(data)) return { ok: false, value: null, errors: [notArray(data)] };
        const { value, errors } = collect(await Promise.all(data.map((x) => elem.safeAsync(x))));
        return errors.length ? { ok: false, value: null, errors } : { ok: true, value, errors: null };
      },
      async okAsync(data) {
        return Array.isArray(data) && (await Promise.all(data.map((x) => elem.okAsync(x)))).every(Boolean);
      },
      toJSONSchema() {
        return { type: 'array', items: elem.toJSONSchema() };
      },
    };
  }

  safe(data) {
    if (this.kind === 'mixin') {
      return { ok: false, value: null, errors: [{ field: '', error: 'mixin', message: 'not instantiable' }] };
    }
    this._assertSyncValidatable('safe');
    const r = this._runSync(data, { materialize: true });
    if (r.ok) return { ok: true, value: r.value, errors: null };
    if (r.thrown) {
      return { ok: false, value: null, errors: [{ field: '', error: 'derived', message: r.thrown?.message || String(r.thrown) }] };
    }
    return { ok: false, value: null, errors: r.errors };
  }

  ok(data) {
    if (this.kind === 'mixin') return false;
    this._assertSyncValidatable('ok');
    return this._runSync(data, { materialize: false }).ok;
  }

  // Async entry points — work on EVERY schema (sync-only ones resolve
  // immediately); REQUIRED when @ensure! refinements are reachable.
  async parseAsync(data) {
    if (this.kind === 'mixin') {
      throw new Error(":mixin schema '" + (this.name || 'anon') + "' is not instantiable");
    }
    const r = await this._runAsync(data, { materialize: true });
    if (r.ok) return r.value;
    if (r.thrown) throw r.thrown;
    const src = r.from || this;
    throw new SchemaError(r.errors, src.name, src.kind);
  }

  async safeAsync(data) {
    if (this.kind === 'mixin') {
      return { ok: false, value: null, errors: [{ field: '', error: 'mixin', message: 'not instantiable' }] };
    }
    const r = await this._runAsync(data, { materialize: true });
    if (r.ok) return { ok: true, value: r.value, errors: null };
    if (r.thrown) {
      return { ok: false, value: null, errors: [{ field: '', error: 'derived', message: r.thrown?.message || String(r.thrown) }] };
    }
    return { ok: false, value: null, errors: r.errors };
  }

  async okAsync(data) {
    if (this.kind === 'mixin') return false;
    return (await this._runAsync(data, { materialize: false })).ok;
  }

  // ── projection algebra ──────────────────────────────────────────────

  pick(...keys) {
    return __schemaDerive(this, (src) => {
      const names = __schemaFlatten(keys);
      const out = new Map();
      for (const k of names) {
        if (!src.has(k)) throw new Error("pick: unknown field '" + k + "' on " + (this.name || 'schema'));
        out.set(k, src.get(k));
      }
      return out;
    });
  }

  omit(...keys) {
    return __schemaDerive(this, (src) => {
      const drop = new Set(__schemaFlatten(keys));
      const out = new Map();
      for (const [k, v] of src) if (!drop.has(k)) out.set(k, v);
      return out;
    });
  }

  partial() {
    return __schemaDerive(this, (src) => {
      const out = new Map();
      for (const [k, v] of src) out.set(k, { ...v, required: false });
      return out;
    });
  }

  required(...keys) {
    return __schemaDerive(this, (src) => {
      const req = new Set(__schemaFlatten(keys));
      const out = new Map();
      for (const [k, v] of src) out.set(k, { ...v, required: req.has(k) ? true : v.required });
      return out;
    });
  }

  extend(other) {
    if (!(other instanceof __SchemaDef)) {
      throw new Error('extend(): argument must be a schema value');
    }
    if (other.kind === 'union') {
      throw new Error('extend(): :union schemas have no fields to merge');
    }
    return __schemaDerive(this, (src) => {
      const merged = new Map(src);
      const otherFields = other._normalize().fields;
      for (const [k, v] of otherFields) {
        if (merged.has(k)) {
          throw new Error("extend(): field '" + k + "' collides between " + (this.name || 'schema') + ' and ' + (other.name || 'other'));
        }
        merged.set(k, v);
      }
      return merged;
    });
  }
}

// ── JSON Schema export (draft 2020-12) ───────────────────────────────
// Field types map per the reference table; nested registry schemas
// become `$ref`s under `$defs` (cycle-safe); enums map to `enum`,
// unions to `oneOf` + a discriminator. Transforms and refinements
// export as `description` annotations, never silently dropped.

const __SCHEMA_JSON_TYPES = {
  string:   () => ({ type: 'string' }),
  text:     () => ({ type: 'string' }),
  email:    () => ({ type: 'string', format: 'email' }),
  url:      () => ({ type: 'string', format: 'uri' }),
  uuid:     () => ({ type: 'string', format: 'uuid' }),
  phone:    () => ({ type: 'string', pattern: '^[\\d\\s\\-+()]+$' }),
  zip:      () => ({ type: 'string', pattern: '^\\d{5}(-\\d{4})?$' }),
  number:   () => ({ type: 'number' }),
  integer:  () => ({ type: 'integer' }),
  boolean:  () => ({ type: 'boolean' }),
  date:     () => ({ type: 'string', format: 'date' }),
  datetime: () => ({ type: 'string', format: 'date-time' }),
  json:     () => ({}),
  any:      () => ({}),
};

function __schemaFieldJSONSchema(f, ctx) {
  let s;
  if (f.typeName === 'literal-union' && f.literals?.length) {
    s = f.literals.length === 1 ? { const: f.literals[0] } : { enum: [...f.literals] };
  } else if (__SCHEMA_JSON_TYPES[f.typeName]) {
    s = __SCHEMA_JSON_TYPES[f.typeName]();
  } else {
    const sub = __SchemaRegistry.get(f.typeName);
    s = sub ? __schemaJSONSchemaRef(sub, ctx) : {};
  }
  const c = f.constraints;
  if (c && !f.array) {
    if (s.type === 'string') {
      if (c.min != null) s.minLength = c.min;
      if (c.max != null) s.maxLength = c.max;
      if (c.regex) s.pattern = c.regex.source;
    } else if (s.type === 'number' || s.type === 'integer') {
      if (c.min != null) s.minimum = c.min;
      if (c.max != null) s.maximum = c.max;
    }
  }
  if (f.array) {
    const items = s;
    s = { type: 'array', items };
    if (c) {
      if (c.min != null) s.minItems = c.min;
      if (c.max != null) s.maxItems = c.max;
    }
  }
  if (c && c.default !== undefined) s.default = c.default;
  if (f.coerce) {
    s.description = ((s.description ? s.description + ' ' : '') +
      'Coerced from wire data (' + (f.coercer ? '~:' + f.coercer : '~' + f.typeName) + ').').trim();
  }
  if (f.transform) {
    s.description = ((s.description ? s.description + ' ' : '') +
      'Derived via transform; the raw input may use different keys.').trim();
  }
  return s;
}

function __schemaJSONSchemaRef(def, ctx) {
  const name = def.name || 'Anon';
  if (!ctx.defs.has(name) && !ctx.expanding.has(name)) {
    ctx.expanding.add(name);
    ctx.defs.set(name, null);
    ctx.defs.set(name, __schemaJSONSchemaBody(def, ctx));
    ctx.expanding.delete(name);
  }
  return { $ref: '#/$defs/' + name };
}

function __schemaJSONSchemaBody(def, ctx) {
  const norm = def._normalize();

  if (def.kind === 'enum') {
    return { enum: [...new Set(norm.enumMembers.values())] };
  }

  if (def.kind === 'union') {
    const plan = def._unionPlan();
    const oneOf = norm.unionMembers.map((name) => {
      const member = __SchemaRegistry.get(name);
      return member ? __schemaJSONSchemaRef(member, ctx) : {};
    });
    return { oneOf, discriminator: { propertyName: plan.disc } };
  }

  // Fielded kinds: a field is required on the wire only when
  // `!`-marked AND defaultless (defaults apply before the check).
  const properties = {};
  const required = [];
  for (const [n, f] of norm.fields) {
    properties[n] = __schemaFieldJSONSchema(f, ctx);
    if (f.required && f.constraints?.default === undefined) required.push(n);
  }
  // A model's wire shape includes the DB-managed columns toJSON()
  // carries (id, FK columns, timestamps, deletedAt).
  if (def.kind === 'model') __schemaPersistence.jsonSchemaModelColumns(def, properties);
  const out = { type: 'object', properties };
  if (required.length) out.required = required;
  if (norm.ensures.length) {
    out.description = 'Refinements (not expressible in JSON Schema): ' +
      norm.ensures.map((r) => r.message).join('; ') + '.';
  }
  return out;
}

__SchemaDef.prototype.toJSONSchema = function () {
  const ctx = { defs: new Map(), expanding: new Set() };
  const root = __schemaJSONSchemaBody(this, ctx);
  root.$schema = 'https://json-schema.org/draft/2020-12/schema';
  if (this.name) root.title = this.name;
  if (ctx.defs.size) {
    root.$defs = {};
    for (const [k, v] of ctx.defs) root.$defs[k] = v;
  }
  return root;
};

function __schemaFlatten(keys) {
  const out = [];
  for (const k of keys) {
    if (Array.isArray(k)) for (const kk of k) out.push(kk);
    else out.push(k);
  }
  return out;
}

function __schemaDerive(source, transform) {
  if (source.kind === 'union') {
    throw new Error('schema algebra (.pick/.omit/.partial/.required/.extend) is not supported on :union — derive from a constituent schema instead');
  }
  if (source.kind === 'enum') {
    throw new Error('schema algebra is not supported on :enum — an enum has no field set');
  }
  // A model projects over its FULL column set — declared fields plus
  // the implicit id/timestamps/softDelete/FK columns the runtime
  // manages — so a client view can pick `id` or `createdAt`. The
  // derived value is always a :shape: ORM surface never carries over.
  const src = source.kind === 'model'
    ? __schemaPersistence.projectableFields(source)
    : source._normalize().fields;
  const derivedFields = transform(src);
  const entries = [];
  for (const [, f] of derivedFields) {
    const mods = [];
    if (f.required) mods.push('!');
    if (f.optional && !f.required) mods.push('?');
    entries.push({
      tag: 'field', name: f.name, modifiers: mods,
      unique: f.unique === true,
      attrs: f.attrs || null,
      typeName: f.typeName, array: f.array,
      literals: f.literals || null,
      coerce: f.coerce === true,
      coercer: f.coercer || null,
      constraints: f.constraints,
      transform: f.transform || null,
    });
  }
  const name = (source.name || 'Schema') + 'Derived';
  // Derived schemas bypass the registry — their synthetic names must
  // not shadow the source.
  const derived = new __SchemaDef({ kind: 'shape', name, entries });
  // sourceModel propagates through chained algebra: tooling follows the
  // chain back to the original :model for projection hints.
  derived._sourceModel = source._sourceModel || (source.kind === 'model' ? source : null);
  return derived;
}

function __schemaExpandMixins(host, fields, directives, ctx) {
  for (const d of directives) {
    if (d.name !== 'mixin' || !d.args || !d.args[0]) continue;
    const target = d.args[0].target;
    if (!target) continue;
    if (ctx.stack.includes(target)) {
      throw new SchemaError(
        [{ field: '', error: 'mixin-cycle', message: 'mixin cycle: ' + ctx.stack.concat(target).join(' -> ') }],
        host.name, host.kind);
    }
    if (ctx.seen.has(target)) continue;
    const mx = __SchemaRegistry.getKind(target, 'mixin');
    if (!mx) {
      throw new SchemaError(
        [{ field: '', error: 'mixin-missing', message: 'unknown mixin: ' + target }],
        host.name, host.kind);
    }
    ctx.seen.add(target);
    ctx.stack.push(target);
    // Nested mixins first (depth-first), then the mixin's own fields.
    const childDirectives = mx._desc.entries
      .filter((e) => e.tag === 'directive' && e.name === 'mixin')
      .map((e) => ({ name: e.name, args: e.args || [] }));
    __schemaExpandMixins(host, fields, childDirectives, ctx);
    for (const e of mx._desc.entries) {
      if (e.tag !== 'field') continue;
      if (fields.has(e.name)) {
        throw new SchemaError(
          [{ field: e.name, error: 'mixin-collision', message: e.name + ' from mixin ' + target + ' collides with existing field' }],
          host.name, host.kind);
      }
      // A mixin field may carry persistence metadata (@unique, {attrs})
      // for the :model that includes it; expanding it into any other
      // kind would silently strip that metadata — reject instead.
      if (host.kind !== 'model' && (e.unique === true || e.attrs)) {
        throw new SchemaError(
          [{ field: e.name, error: 'mixin-persistence',
             message: e.name + ' from mixin ' + target + ' carries persistence metadata (@unique/attrs) — :model-only; a :' + host.kind + ' cannot include it' }],
          host.name, host.kind);
      }
      fields.set(e.name, {
        name: e.name,
        required: e.modifiers.includes('!'),
        optional: e.modifiers.includes('?'),
        unique: e.unique === true,
        attrs: e.attrs || null,
        typeName: e.typeName,
        literals: e.literals || null,
        array: e.array === true,
        coerce: e.coerce === true,
        coercer: e.coercer || null,
        constraints: e.constraints || null,
        transform: e.transform || null,
      });
    }
    ctx.stack.pop();
  }
}

function __schema(descriptor) {
  const def = new __SchemaDef(descriptor);
  // Named schemas land in the registry so nested field types
  // (`address! Address`, `role! Role`) resolve at validate time.
  if (def.name) __SchemaRegistry.register(def);
  return def;
}

const registerCoercer = __schemaRegisterCoercer;

export { __schema, SchemaError, __SchemaRegistry, registerCoercer, __SchemaDef, __schemaInstallPersistence };
