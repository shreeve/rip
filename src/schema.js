// Schema DSL — the lexer collapse pass and body sub-parser.
//
// `schema [:kind]` blocks are parsed entirely here, at lexer-rewrite
// time: the pass recognizes a schema declaration, parses its body with
// the schema-specific line grammar below, and collapses the whole
// region into two tokens — SCHEMA and SCHEMA_BODY — so the main
// grammar carries exactly one production and schema body syntax never
// reaches the LR tables.
//
// SCHEMA_BODY's token VALUE is the parsed descriptor object. Its
// toJSON() returns the KIND string, so the s-expression serializes as
// `["schema", "input"]` — the value IS the construct's parsed
// content, exactly as a string token's value is its text. The
// construct's spans reach the side tables through the ordinary
// grammar path: the schema rule's annotation records the SCHEMA_BODY
// span as the `body` role.
//
// Kinds: :input (default), :shape, :mixin, :enum, :union,
// :model. The :model kind carries the persistence surface —
// directives (@timestamps, @softDelete, relations, @unique/@index,
// @idStart, @tableWas), @scope/@defaultScope, lifecycle hook binding,
// field attrs ({was:}) and inline @unique, and the `on:` declaration
// option (a per-schema adapter expression). Every persistence
// spelling stays :model-only on the other kinds. Malformed
// persistence spellings reject HERE, at parse time, positioned — the
// runtime (src/runtime/schema-orm.js) re-rejects at the root, since
// a descriptor is hand-buildable.
//
// Spelling notes (there is no SYMBOL token kind):
//   - a "symbol" is a ':' token followed by an UNSPACED identifier
//     (`:input`, `:admin`, `@on :kind`);
//   - field modifiers arrive as separate unspaced tokens (DAMMIT for
//     `!`, '?' for `?`), not identifier metadata;
//   - `~>` and `!>` are single scan tokens (OPS2), so a trailing one
//     never reads as a line-continuing COMPARE.
//
// The pass runs BEFORE rewriteTypes and the implicit-structure
// passes (a schema body's spellings are schema grammar, not type or
// object syntax), so body token slices are raw; callable bodies are
// sub-compiled at emission (src/emitter.js runs rewriteTypes + the
// tail passes and re-enters the parser over the captured slice).

const VALID_KINDS = new Set(['input', 'shape', 'mixin', 'enum', 'union', 'model']);
const KIND_DEFAULT = 'input';

// Lifecycle hook names — a `name: -> body` callable on a :model whose
// name is in this set binds as a hook (exact match; anything else is
// a plain method — a working reading, so no fuzzy near-miss guard).
// Mirrors the runtime's __SCHEMA_HOOK_NAMES.
const HOOK_NAMES = new Set([
  'beforeValidation', 'afterValidation',
  'beforeSave', 'afterSave',
  'beforeCreate', 'afterCreate',
  'beforeUpdate', 'afterUpdate',
  'beforeDestroy', 'afterDestroy',
  'afterCommit', 'afterRollback',
]);

// The :model directive vocabulary with each name's argument shape —
// the parse-time mirror of the runtime's __SCHEMA_MODEL_DIRECTIVES.
// An unknown name, or a known one with junk-bearing args, rejects
// positioned; relation targets must be canonical PascalCase.
const MODEL_DIRECTIVES = {
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

const RELATION_DIRECTIVES = new Set(['belongs_to', 'has_one', 'has_many', 'one', 'many']);

// The snake_case half of the runtime's naming bijection — the
// column check compares declared names in column space.
const snakeCase = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

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

// Positions where `schema` can legitimately start an expression.
const EXPR_START_PREV = new Set([
  'TERMINATOR', 'INDENT', 'OUTDENT',
  '=', 'COMPOUND_ASSIGN',
  'RETURN', 'THROW', 'YIELD', 'AWAIT', 'EXPORT',
  ',', '(', '[', '{', 'CALL_START', 'PARAM_START', 'INDEX_START',
  '->', '=>', ':', 'WHEN', 'LEADING_WHEN', 'THEN', 'IF', 'UNLESS',
  'UNARY', 'UNARY_MATH',
]);

const SCHEMA_PRAGMA_KEYS = new Set(['defaultMaxString']);

// ── token helpers ────────────────────────────────────────────────────

const isWord = (t) => t && (t.kind === 'IDENTIFIER' || t.kind === 'PROPERTY');

// A keyword-classified token whose value is a plain lowercase word
// (`when` → LEADING_WHEN, `loop` → LOOP): a legitimate NAME in schema
// field position.
const isKeywordWord = (t) =>
  t && typeof t.value === 'string' && /^[a-z]+$/.test(t.value) &&
  (t.kind === t.value.toUpperCase() || t.kind === 'LEADING_WHEN' || t.kind === 'RELATION' || t.kind === 'STATEMENT');

import { ops } from './ops.js';

// The symbol spelling: ':' followed by an UNSPACED word. The kind
// position additionally admits keyword-kind tokens (`:enum` scans the
// ENUM keyword).
const symWordAt = (tokens, i, keywordOk = false) => {
  if (tokens[i]?.kind !== ':') return null;
  const w = tokens[i + 1];
  if (!w || w.spaced) return null;
  if (isWord(w) || (keywordOk && /^[a-z]+$/.test(w.value) && w.kind === w.value.toUpperCase())) return w;
  return null;
};

// ── the pass ─────────────────────────────────────────────────────────

export function rewriteSchema(tokens, mintId, text, fail) {
  // Cheap probe first: files without the word `schema` skip the walk's
  // per-token checks entirely (they still pay one indexOf).
  if (text.indexOf('schema') === -1) return;

  const out = [];
  const config = { defaultMaxString: null };
  let depth = 0;
  let i = 0;
  while (i < tokens.length) {
    if (ops.on) ops.n++;
    const t = tokens[i];
    if (t.kind === 'INDENT') depth++;
    else if (t.kind === 'OUTDENT') depth--;

    const consumed = matchSchemaPragma(tokens, i, config, depth, fail);
    if (consumed > 0) {
      i += consumed;
      continue;
    }
    if (isSchemaStart(tokens, i, fail)) {
      i = collapseSchemaAt(tokens, i, out, config, mintId, fail, text);
      continue;
    }
    out.push(t);
    i++;
  }
  tokens.length = 0;
  for (const t of out) tokens.push(t);
}

// `schema.<key> = <value>` at statement position, file top level.
// Returns tokens consumed (incl. a trailing TERMINATOR) or 0.
function matchSchemaPragma(tokens, i, config, depth, fail) {
  const t = tokens[i];
  if (!t || t.kind !== 'IDENTIFIER' || t.value !== 'schema') return 0;
  if (tokens[i + 1]?.kind !== '.') return 0;
  const keyTok = tokens[i + 2];
  if (!keyTok || keyTok.kind !== 'PROPERTY') return 0;
  if (tokens[i + 3]?.kind !== '=') return 0;
  const prev = tokens[i - 1];
  if (prev && prev.kind !== 'TERMINATOR' && prev.kind !== 'INDENT' && prev.kind !== 'OUTDENT') return 0;
  const key = keyTok.value;
  if (!SCHEMA_PRAGMA_KEYS.has(key)) {
    fail(`unknown schema pragma 'schema.${key}' — known pragmas: ${[...SCHEMA_PRAGMA_KEYS].join(', ')}`, keyTok.start);
  }
  if (depth > 0) {
    fail(`schema pragma 'schema.${key}' must be declared at file top level — inside a nested block it would leak into later top-level schemas`, keyTok.start);
  }
  const valTok = tokens[i + 4];
  if (!valTok || valTok.kind !== 'NUMBER') {
    fail(`pragma 'schema.${key}' requires a number literal — example: schema.${key} = 100`, (valTok ?? keyTok).start);
  }
  const n = Number(valTok.value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    fail(`pragma 'schema.${key}' expects a non-negative integer (got ${valTok.value}); use 0 to disable`, valTok.start);
  }
  config[key] = n === 0 ? null : n;
  let end = i + 5;
  if (tokens[end]?.kind === 'TERMINATOR') end++;
  return end - i;
}

// The KIND spelling is `schema :word`: a SPACED ':' with the word
// unspaced after it — `{schema: shape}` (key colon, unspaced) and
// `{schema:shape}` never match.
const kindSymAt = (tokens, j) => {
  // The scanner mints a SYMBOL token for the spaced `:word` spelling;
  // the raw ':' + word pair survives only where minting was blocked.
  if (tokens[j]?.kind === 'SYMBOL') return tokens[j];
  return tokens[j]?.kind === ':' && tokens[j].spaced ? symWordAt(tokens, j, true) : null;
};

// A kind marker's token width: the minted SYMBOL is one token, the
// raw pair is two.
const kindSymWidth = (tokens, j) => (tokens[j]?.kind === 'SYMBOL' ? 1 : 2);

// The `on:` declaration option after a kind marker: `, on <:> …` up
// to the line end. Returns the index AFTER the option (the position
// of the TERMINATOR/INDENT that ends the head line), or j unchanged.
const scanOnOption = (tokens, j) => {
  if (tokens[j]?.kind !== ',' || !isWord(tokens[j + 1]) || tokens[j + 1].value !== 'on') return j;
  let k = j + 2;
  if (tokens[k]?.kind === ':') k++;
  while (k < tokens.length && tokens[k].kind !== 'TERMINATOR' && tokens[k].kind !== 'INDENT') k++;
  return k;
};

function isSchemaStart(tokens, i, fail) {
  const t = tokens[i];
  if (!t || t.value !== 'schema' || !isWord(t)) return false;
  const prev = tokens[i - 1];
  if (prev) {
    if (prev.kind === '.' || prev.kind === '?.' || prev.kind === '@') return false;
    if (!EXPR_START_PREV.has(prev.kind)) return false;
  }
  let j = i + 1;
  const kind = kindSymAt(tokens, j);
  if (kind) {
    j += kindSymWidth(tokens, j);
    j = scanOnOption(tokens, j);
  }
  if (tokens[j]?.kind === 'TERMINATOR') {
    if (tokens[j].value === ';') return true;
    j++;
  }
  if (tokens[j]?.kind === 'INDENT') return true;
  // A kind marker with no body is unambiguous schema intent — reject
  // rather than let the implicit-object pass silently reshape it
  // (`S = {schema: shape}`).
  if (kind) {
    fail(`expected an indented schema body (or an inline '; field; …' body) after 'schema :${kind.value}'`, t.start);
  }
  return false;
}

// Collapse the region starting at `i` into SCHEMA + SCHEMA_BODY,
// pushing both onto `out`. Returns the index AFTER the region.
function collapseSchemaAt(tokens, i, out, config, mintId, fail, text) {
  const schemaTok = tokens[i];
  let kind = KIND_DEFAULT;
  let kindTok = null;
  let j = i + 1;

  const kw = kindSymAt(tokens, j);
  if (kw) {
    const k = kw.value;
    if (!VALID_KINDS.has(k)) {
      fail(`unknown schema kind :${k} — expected one of :input, :shape, :model, :mixin, :enum, :union`, kw.start);
    }
    kind = k;
    kindTok = kw;
    j += kindSymWidth(tokens, j);
  }

  // `schema :model, on: <expr>` — the per-schema adapter expression,
  // captured raw and sub-compiled at emission (evaluated at
  // declaration time in the user's scope).
  let adapterTokens = null;
  if (tokens[j]?.kind === ',' && isWord(tokens[j + 1]) && tokens[j + 1].value === 'on') {
    if (kind !== 'model') {
      fail(`'on:' (the per-schema adapter) applies to :model only — :${kind} never queries a database`, tokens[j + 1].start);
    }
    let k2 = j + 2;
    if (tokens[k2]?.kind === ':') k2++;
    const exprStart = k2;
    while (k2 < tokens.length && tokens[k2].kind !== 'TERMINATOR' && tokens[k2].kind !== 'INDENT') k2++;
    adapterTokens = tokens.slice(exprStart, k2);
    if (!adapterTokens.length) {
      fail(`'on:' requires an adapter expression — 'schema :model, on: analytics'`, tokens[j + 1].start);
    }
    j = k2;
  }

  let bodyTokens;
  let endIdx;
  let bodyEnd;
  if (tokens[j]?.kind === 'TERMINATOR' && tokens[j].value === ';') {
    // Inline one-liner: `schema [:kind]; field; field; …` up to the
    // first newline-bearing TERMINATOR at depth 0 (the lexer folds
    // `;\n` into one TERMINATOR whose value carries the newline).
    const inlineStart = j + 1;
    let end = inlineStart;
    let depth = 0;
    while (end < tokens.length) {
      const tk = tokens[end];
      const tag = tk.kind;
      if (tag === '(' || tag === '[' || tag === '{' ||
          tag === 'CALL_START' || tag === 'INDEX_START' || tag === 'PARAM_START') depth++;
      else if (tag === ')' || tag === ']' || tag === '}' ||
               tag === 'CALL_END' || tag === 'INDEX_END' || tag === 'PARAM_END') {
        depth--;
        if (depth < 0) break; // the enclosing expression's closer
      } else if (depth === 0 && tag === 'TERMINATOR' && tk.value !== ';') break;
      else if (depth === 0 && tag === 'TERMINATOR' &&
               /\n/.test(text.slice(tk.start, tokens[end + 1]?.start ?? tk.end))) {
        // A trailing `;` at line end folds with its newline into one
        // ';'-valued TERMINATOR — the raw source between it and the
        // next token carries the line break, so the body still ends
        // here (`schema :shape; name!;` never swallows the next line).
        break;
      }
      else if (depth === 0 && (tag === 'INDENT' || tag === 'OUTDENT')) break;
      else if (depth === 0 && tag === '->') {
        fail(`inline schema bodies do not support '->' (methods/hooks/scopes/transforms) — use the indented form`, tk.start);
      } else if (depth === 0 && (tag === 'EFFECT' || tag === '!>')) {
        fail(`inline schema bodies do not support '${tk.value}' (${tag === 'EFFECT' ? 'computed getters' : 'eager-derived fields'}) — use the indented form`, tk.start);
      }
      end++;
    }
    while (end > inlineStart && tokens[end - 1].kind === 'TERMINATOR') end--;
    bodyTokens = tokens.slice(inlineStart, end);
    endIdx = end;
    if (!bodyTokens.length) {
      fail(`inline schema body is empty — add '; field; …' entries or switch to the indented form`, schemaTok.start);
    }
    bodyEnd = bodyTokens[bodyTokens.length - 1].end;
  } else {
    if (tokens[j]?.kind === 'TERMINATOR') j++;
    if (tokens[j]?.kind !== 'INDENT') {
      fail(`expected an indented schema body after 'schema${kindTok ? ' :' + kind : ''}'`, schemaTok.start);
    }
    const indentIdx = j;
    let d = 0;
    let outdentIdx = -1;
    for (let k = indentIdx; k < tokens.length; k++) {
      if (ops.on) ops.n++;
      if (tokens[k].kind === 'INDENT') d++;
      else if (tokens[k].kind === 'OUTDENT') {
        d--;
        if (d === 0) { outdentIdx = k; break; }
      }
    }
    if (outdentIdx < 0) fail('unterminated schema body', tokens[indentIdx].start);
    bodyTokens = tokens.slice(indentIdx + 1, outdentIdx);
    endIdx = outdentIdx + 1;
    bodyEnd = bodyTokens.length ? bodyTokens[bodyTokens.length - 1].end : tokens[indentIdx].end;
  }

  // Scanner-minted SYMBOL tokens split back into ':' + word pairs
  // inside the body — schema grammar reads the two-token spelling
  // everywhere (`@unique [:total, :status]`, `@ensure "…", :pw2`).
  bodyTokens = bodyTokens.flatMap((tk) => tk.kind === 'SYMBOL'
    ? [{ ...tk, kind: ':', value: ':', end: tk.start + 1 },
       { ...tk, kind: 'IDENTIFIER', start: tk.start + 1, spaced: false }]
    : [tk]);

  const descriptor = parseSchemaBody(kind, kindTok, bodyTokens, {
    schemaStart: schemaTok.start,
    defaultMaxString: config.defaultMaxString,
  }, fail);
  if (adapterTokens) descriptor.adapterTokens = adapterTokens;
  descriptor.start = (kindTok ?? bodyTokens[0]).start;
  descriptor.end = bodyEnd;

  out.push({
    id: mintId(), kind: 'SCHEMA', value: 'schema',
    start: schemaTok.start, end: schemaTok.end, spaced: schemaTok.spaced,
  });
  out.push({
    id: mintId(), kind: 'SCHEMA_BODY', value: descriptor,
    start: descriptor.start, end: descriptor.end, spaced: true,
  });
  return endIdx;
}

// ── the body sub-parser ──────────────────────────────────────────────

function parseSchemaBody(kind, kindTok, bodyTokens, ctx, fail) {
  const entries = [];
  const lines = splitBodyLines(bodyTokens);

  // Kind inference: a default-kind body whose first line begins with a
  // symbol is unambiguously an enum (`schema` + `:draft` lines).
  if (kind === KIND_DEFAULT && !kindTok && lines.length > 0 &&
      symWordAt(lines[0], 0)) {
    kind = 'enum';
  }

  if (kind === 'enum') {
    for (const line of lines) parseEnumLine(line, entries, fail);
  } else if (kind === 'union') {
    for (const line of lines) parseUnionLine(line, entries, fail);
    const onCount = entries.filter((e) => e.tag === 'directive' && e.name === 'on').length;
    const members = entries.filter((e) => e.tag === 'union-member');
    if (onCount !== 1) {
      fail(onCount === 0
        ? `:union requires an '@on :field' discriminator — untagged unions are not supported`
        : `:union takes exactly one '@on :field' discriminator (got ${onCount})`, ctx.schemaStart);
    }
    if (members.length < 2) {
      fail(`:union needs at least two constituent schemas (got ${members.length})`, ctx.schemaStart);
    }
  } else {
    for (const line of lines) parseFieldedLine(kind, line, entries, ctx, fail);
    // Capability matrix by kind.
    // `@mixin` adds fields, so every fielded kind takes it; the
    // persistence spellings are :model-only everywhere else.
    if (kind === 'model') {
      finishModelBody(entries, fail);
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
          fail(`:${kind} schemas only accept '@mixin Name'${kind === 'input' ? " and '@ensure'" : ''} — '@${e.name}' is ${['timestamps', 'softDelete', 'belongs_to', 'has_many', 'has_one', 'one', 'many', 'unique', 'index', 'idStart', 'tableWas'].includes(e.name) ? ':model-only' : 'not a schema directive'}`, e.start);
        }
      }
    }
  }

  return {
    kind,
    entries,
    toJSON() { return this.kind; },
  };
}

// Top-level lines of a schema body: nested INDENT/OUTDENT stays inside
// its owning line (callable bodies, multi-line trailers).
function splitBodyLines(tokens) {
  const lines = [];
  let cur = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'INDENT') depth++;
    if (t.kind === 'OUTDENT') depth--;
    if (t.kind === 'TERMINATOR' && depth === 0) {
      if (cur.length) { lines.push(cur); cur = []; }
      continue;
    }
    cur.push(t);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// ── fielded lines: field | directive | callable ─────────────────────
//
// Field-line grammar (locked):
//   name[!|?]*  [type]  [, range]  [, [default]]  [, /regex/]  [, -> transform]
// The `{…}` attrs bracket and inline `@unique` are persistence
// metadata — rejected with the :model surface.

function parseFieldedLine(kind, line, entries, ctx, fail) {
  const first = line[0];
  if (!first) return;

  // Directive: @NAME [args]
  if (first.kind === '@') {
    const nameTok = line[1];
    if (!isWord(nameTok)) {
      fail(`expected a directive name after '@'`, first.start);
    }
    const dname = nameTok.value;

    if (dname === 'ensure') {
      // `@ensure!` (dammit) marks ASYNC refinements.
      let argStart = 2;
      let isAsync = false;
      if (line[2]?.kind === 'DAMMIT' && !line[2].spaced) {
        isAsync = true;
        argStart = 3;
      }
      const pairs = parseEnsurePairs(line.slice(argStart), first, fail);
      for (const p of pairs) {
        entries.push({
          tag: 'ensure', name: 'ensure',
          message: p.message, field: p.field, async: isAsync,
          paramTokens: p.paramTokens, bodyTokens: p.bodyTokens,
          start: first.start,
        });
      }
      return;
    }

    // `@scope :name, fn` and `@defaultScope fn` — named query scopes,
    // :model-only (the matrix rejects the tags elsewhere).
    if (dname === 'scope') {
      const parsed = parseScopeDirective(line.slice(2), first, fail);
      entries.push({
        tag: 'scope', name: parsed.name,
        paramTokens: parsed.paramTokens, bodyTokens: parsed.bodyTokens,
        start: first.start,
      });
      return;
    }
    if (dname === 'defaultScope') {
      const parsed = parseScopeFnTokens(line.slice(2), first, '@defaultScope', fail);
      if (parsed.paramTokens.length) {
        fail(`@defaultScope takes no parameters — write '@defaultScope -> @where(...)'`, first.start);
      }
      entries.push({
        tag: 'defaultScope', name: 'defaultScope',
        paramTokens: [], bodyTokens: parsed.bodyTokens,
        start: first.start,
      });
      return;
    }

    let args = null;
    let argTokens = line.slice(2);
    if (dname === 'mixin') {
      const t0 = argTokens[0];
      if (!isWord(t0)) {
        fail(`@mixin requires a target name — '@mixin Timestamps'`, first.start);
      }
      if (argTokens.length > 1) {
        fail(`@mixin takes exactly one schema name`, argTokens[1].start);
      }
      args = [{ target: t0.value }];
    }
    entries.push({ tag: 'directive', name: dname, args, argTokens, start: first.start, nameStart: nameTok.start });
    return;
  }

  // Callable: `name: -> body` | `name: ~> body` | `name: !> body`
  // (the scanner keys `name:` as PROPERTY).
  if (first.kind === 'PROPERTY') {
    parseCallableLine(kind, first, line, entries, fail);
    return;
  }
  // Field names may spell keywords (`when`, `loop`, `for` are
  // legitimate column names): the scanner classified the word, but in
  // field-name position it is a name.
  if (first.kind !== 'IDENTIFIER' && !isKeywordWord(first)) {
    fail(`unexpected ${first.kind} at schema top level — allowed: fields ('name! type'), directives ('@name'), methods ('name: -> body'), computed getters ('name: ~> body')`, first.start);
  }

  const name = first.value;
  if (line[1]?.kind === ':') {
    fail(`schema fields use 'name type' (space, no colon) — got '${name}:'`, line[1].start);
  }
  // The pk column is runtime-owned on a :model (sequence default,
  // RETURNING absorption) — a declared `id` field would duplicate the
  // DDL column; the runtime rejects the hand-built descriptor too.
  if (kind === 'model' && name === 'id') {
    fail(`field 'id' collides with the runtime-managed primary key — a :model's id is sequence-assigned; drop the declaration`, first.start);
  }

  // Modifiers: adjacent (unspaced) `!` / `?` tokens. A bang after an
  // IDENTIFIER scans DAMMIT; after a keyword-word name it stays
  // UNARY_MATH — both are the `!` modifier here.
  const modifiers = [];
  let pos = 1;
  while (pos < line.length) {
    const tk = line[pos];
    if (tk.spaced) break;
    if (tk.kind === 'DAMMIT' || (tk.kind === 'UNARY_MATH' && tk.value === '!')) { modifiers.push('!'); pos++; continue; }
    if (tk.kind === '?') { modifiers.push('?'); pos++; continue; }
    break;
  }

  // Type slot (optional; default `string`): identifier type, `~type` /
  // `~:name` coercion, or a string-literal union.
  let typeName = 'string';
  let literals = null;
  let coerce = false;
  let coercer = null;
  let coercerArray = false;
  let typeConsumed = false;
  let typeFirst = line[pos];
  if (typeFirst?.kind === 'UNARY_MATH' && typeFirst.value === '~') {
    const sym = symWordAt(line, pos + 1);
    const typeTok = line[pos + 1];
    if (sym) {
      coerce = true;
      coercer = sym.value;
      const out = SCHEMA_NAMED_COERCER_TYPES[coercer];
      if (out && typeof out === 'object') {
        typeName = out.type;
        coercerArray = true;
      } else {
        typeName = out || 'any';
      }
      pos += 3;
    } else if (typeTok?.kind === 'IDENTIFIER' && !typeTok.spaced) {
      if (!SCHEMA_COERCIBLE_TYPES.has(typeTok.value)) {
        fail(`'~${typeTok.value}' is not coercible — built-in coercion exists for: ${[...SCHEMA_COERCIBLE_TYPES].join(', ')}; named coercers use a symbol ('~:${typeTok.value}'); otherwise write a transform ('${name}, -> …')`, typeTok.start);
      }
      coerce = true;
      typeName = typeTok.value;
      pos += 2;
    } else {
      fail(`'~' in the type slot marks coercion and needs a type name ('~integer', '~date', …) or a registered coercer symbol ('~:ssn', …)`, typeFirst.start);
    }
    typeConsumed = true;
  } else if (typeFirst?.kind === 'IDENTIFIER') {
    typeName = typeFirst.value;
    typeConsumed = true;
    pos++;
  } else if (typeFirst?.kind === 'STRING' && typeFirst.value.startsWith('"')) {
    literals = [JSON.parse(typeFirst.value)];
    typeConsumed = true;
    pos++;
    while (line[pos]?.kind === '|' && line[pos + 1]?.kind === 'STRING' && line[pos + 1].value.startsWith('"')) {
      literals.push(JSON.parse(line[pos + 1].value));
      pos += 2;
    }
    if (line[pos]?.kind === '|') {
      fail(`literal unions contain string literals only — '${line[pos + 1]?.kind ?? '<end>'}' is not allowed as a union member; use the '?' modifier for nullability`, line[pos].start);
    }
    typeName = 'literal-union';
  }

  let array = false;
  const arraySuffixAt = (p) =>
    (line[p]?.kind === '[' || line[p]?.kind === 'INDEX_START') &&
    (line[p + 1]?.kind === ']' || line[p + 1]?.kind === 'INDEX_END');
  if (arraySuffixAt(pos)) {
    array = true;
    pos += 2;
    // Nested arrays (`string[][]`) have no validation semantics here —
    // one array dimension validates element-wise; deeper nesting needs
    // `json` or a transform.
    if (arraySuffixAt(pos)) {
      fail(`field '${name}' — nested array types ('${typeName}[][]') are not supported: one '[]' validates element-wise; use 'json' or a '-> transform' for deeper nesting`, line[pos].start);
    }
  }
  if (coerce && array) {
    fail(`coercion ('~${typeName}') does not apply to array types — coerce per-element with a transform instead`, typeFirst.start);
  }
  if (coercerArray) array = true;
  if (array && literals) {
    fail(`array-of-literal-union is not supported — use 'string[]' for an array of strings`, typeFirst.start);
  }

  // Trailers: `,`-separated parts, each self-identifying by head shape.
  let rest = line.slice(pos);
  if (typeConsumed && rest[0]?.kind === '->') {
    fail(`field '${name}' has a transform after the type; a comma is required before '->' — write '${name} ${typeName}, -> …'`, rest[0].start);
  }
  let range = null;
  let bracketDefault = undefined;
  let hasDefault = false;
  let regex = null;
  let transformTokens = null;
  let attrs = null;
  let uniqueAttr = false;

  if (rest.length > 0) {
    if (rest[0]?.kind === ',') rest = rest.slice(1);
    // Multi-line trailers arrive wrapped in one INDENT…OUTDENT pair —
    // strip it when it spans the whole remainder so the inner commas
    // split at top level.
    if (rest.length >= 2 && rest[0].kind === 'INDENT') {
      let d = 0;
      let lastIdx = -1;
      for (let k = 0; k < rest.length; k++) {
        if (rest[k].kind === 'INDENT') d++;
        else if (rest[k].kind === 'OUTDENT' && --d === 0) { lastIdx = k; break; }
      }
      if (lastIdx === rest.length - 1) rest = rest.slice(1, -1);
    }
    const parts = splitTopLevelByComma(rest);
    for (let p = 0; p < parts.length; p++) {
      let part = parts[p];
      while (part.length && (part[0].kind === 'INDENT' || part[0].kind === 'TERMINATOR')) part = part.slice(1);
      if (!part.length) continue;
      if (part[0].kind !== '->') {
        const innerArrow = findTopLevelArrowIdx(part);
        if (innerArrow > 0) {
          fail(`field '${name}' has a transform after other content; a comma is required before '->'`, part[innerArrow].start);
        }
        while (part.length && (part[part.length - 1].kind === 'OUTDENT' || part[part.length - 1].kind === 'TERMINATOR')) part = part.slice(0, -1);
        if (!part.length) continue;
      }
      const head = part[0];
      if (head.kind === '[' || head.kind === 'INDEX_START') {
        if (hasDefault) fail(`field '${name}' has more than one '[…]' default bracket`, head.start);
        bracketDefault = parseDefaultBracket(part, name, fail);
        hasDefault = true;
      } else if (head.kind === '{') {
        // Persistence metadata may also ride a :mixin field — it takes
        // effect when a :model includes the mixin; inclusion into any
        // other kind rejects at expansion (__schemaExpandMixins).
        if (kind !== 'model' && kind !== 'mixin') {
          fail(`field attrs ('{…}') are persistence metadata — :model/:mixin-only ('{was: "old_column"}' annotates a column rename)`, head.start);
        }
        if (attrs) fail(`field '${name}' has more than one '{…}' attrs bracket`, head.start);
        attrs = parseAttrsTokens(part, name, fail);
      } else if (isRangeConstraintTokens(part)) {
        if (range) fail(`field '${name}' has more than one range constraint — one 'min..max' per field`, head.start);
        range = parseRangeTokens(part, name, fail);
      } else if (head.kind === 'REGEX' && part.length === 1) {
        if (regex) fail(`field '${name}' has more than one regex constraint`, head.start);
        regex = parseRegexToken(head, fail);
      } else if (head.kind === '->') {
        if (p !== parts.length - 1) {
          fail(`transform '-> …' must be the last element on the field line for '${name}'`, head.start);
        }
        transformTokens = part.slice(1);
      } else if (head.kind === '@') {
        const attrName = isWord(part[1]) ? part[1].value : null;
        if (kind !== 'model' && kind !== 'mixin') {
          fail(`inline '@${attrName ?? ''}' on field '${name}' is persistence metadata — :model/:mixin-only ('@unique' marks single-column uniqueness)`, head.start);
        }
        if (part.length === 2 && attrName === 'unique') {
          if (uniqueAttr) fail(`field '${name}' has more than one '@unique'`, head.start);
          uniqueAttr = true;
        } else {
          fail(`unknown inline attribute '@${attrName ?? ''}' on field '${name}' — the only inline attribute is '@unique'`, head.start);
        }
      } else {
        fail(`unexpected trailer for field '${name}' — expected '[…]' default, '/regex/', 'min..max' range, or '-> transform'`, head.start);
      }
    }
  }

  if (coerce && transformTokens) {
    fail(`field '${name}' has both '~${typeName}' coercion and a '->' transform — a transform replaces coercion; coerce inside it instead`, first.start);
  }

  // Merge constraints: the pragma default
  // max fills only when nothing narrowed the max; the `!` open-left
  // sugar implies min=1.
  const c = {};
  if (range) {
    if (range.min !== undefined) c.min = range.min;
    if (range.max !== undefined) c.max = range.max;
    if (range.min === undefined && c.min === undefined && modifiers.includes('!')) c.min = 1;
  }
  if (regex) c.regex = regex;
  if (hasDefault) c.default = bracketDefault;
  if (ctx.defaultMaxString != null && !regex && !literals && VARCHAR_TYPES.has(typeName) && c.max === undefined) {
    c.max = ctx.defaultMaxString;
  }
  if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
    fail(`field '${name}' would have impossible constraints min=${c.min} > max=${c.max} after sugar is applied — write an explicit range or drop the conflicting pragma`, first.start);
  }
  const constraints =
    c.min !== undefined || c.max !== undefined || c.default !== undefined || c.regex !== undefined ? c : null;

  entries.push({
    tag: 'field', name, modifiers, typeName, array,
    literals, coerce, coercer, constraints, transformTokens,
    unique: uniqueAttr, attrs,
    start: first.start,
  });
}

// A field's `{key: value}` attrs bracket (:model-only). Known keys
// only — a typo'd attr baked silently into every downstream schema
// would be worse than a hard error. Current keys: `was` (the
// column-rename annotation the migration differ consumes).
const SCHEMA_FIELD_ATTRS = new Set(['was']);

function parseAttrsTokens(part, fieldName, fail) {
  if (part[part.length - 1]?.kind !== '}') {
    fail(`field '${fieldName}' — the '{…}' attrs bracket never closes`, part[0].start);
  }
  const inner = part.slice(1, -1).filter((t) =>
    t.kind !== 'TERMINATOR' && t.kind !== 'INDENT' && t.kind !== 'OUTDENT');
  const attrs = {};
  for (const item of splitTopLevelByComma(inner)) {
    if (!item.length) continue;
    const keyTok = item[0];
    if (!isWord(keyTok)) {
      fail(`field attrs must be '{key: value}' pairs — got ${keyTok.kind}`, keyTok.start);
    }
    const key = keyTok.value;
    if (!SCHEMA_FIELD_ATTRS.has(key)) {
      fail(`unknown field attr '${key}' — known attrs: ${[...SCHEMA_FIELD_ATTRS].join(', ')}`, keyTok.start);
    }
    if (key in attrs) fail(`field '${fieldName}' repeats attr '${key}'`, keyTok.start);
    let vs = 1;
    if (item[vs]?.kind === ':') vs++;
    const valToks = item.slice(vs);
    if (valToks.length !== 1) {
      fail(`field attr '${key}' takes a single literal value`, (valToks[0] ?? keyTok).start);
    }
    const value = literalOf(valToks[0], `field '${fieldName}' attr '${key}'`, fail);
    if (key === 'was' && typeof value !== 'string') {
      fail(`field attr 'was' requires a string column name — {was: "first_name"}`, keyTok.start);
    }
    attrs[key] = value;
  }
  if (!Object.keys(attrs).length) {
    fail(`field '${fieldName}' has an empty '{…}' attrs bracket`, part[0].start);
  }
  return attrs;
}

// `@scope :name, fn` — the name is a :symbol; the fn is `-> body` or
// `(args) -> body` (scopes read the query builder through `this`, so
// most take no arguments).
function parseScopeDirective(argTokens, directiveTok, fail) {
  if (!argTokens.length) {
    fail(`@scope requires ':name, -> body' (or ':name, (args) -> body')`, directiveTok.start);
  }
  const sym = symWordAt(argTokens, 0);
  if (!sym) {
    fail(`@scope name must be a :symbol — '@scope :active, -> @where(active: true)'`, argTokens[0].start);
  }
  const name = sym.value;
  if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
    fail(`@scope name ':${name}' must be a lowercase-first alphanumeric identifier`, sym.start);
  }
  let rest = argTokens.slice(2);
  if (rest[0]?.kind === ',') rest = rest.slice(1);
  if (!rest.length) {
    fail(`@scope :${name} is missing its body — '@scope :${name}, -> @where(...)'`, sym.start);
  }
  const fn = parseScopeFnTokens(rest, sym, `@scope :${name}`, fail);
  return { name, paramTokens: fn.paramTokens, bodyTokens: fn.bodyTokens };
}

// A scope function token slice: `-> body` or `(params) -> body`.
function parseScopeFnTokens(tokens, anchorTok, label, fail) {
  if (!tokens.length) {
    fail(`${label}: expected '-> body' or '(args) -> body'`, anchorTok.start);
  }
  const paramTokens = [];
  let pos = 0;
  const t0 = tokens[0];
  if (t0.kind === '(' || t0.kind === 'PARAM_START' || t0.kind === 'CALL_START') {
    let depth = 1;
    pos = 1;
    while (pos < tokens.length && depth > 0) {
      const tag = tokens[pos].kind;
      if (tag === '(' || tag === 'PARAM_START' || tag === 'CALL_START') depth++;
      if (tag === ')' || tag === 'PARAM_END' || tag === 'CALL_END') {
        depth--;
        if (depth === 0) { pos++; break; }
      }
      paramTokens.push(tokens[pos]);
      pos++;
    }
    if (depth !== 0) fail(`${label}: unclosed '(' in parameters`, t0.start);
  }
  const arrowTok = tokens[pos];
  if (arrowTok?.kind !== '->') {
    fail(`${label}: expected '->' ${paramTokens.length ? 'after parameters' : 'to start the body'}`, (arrowTok ?? anchorTok).start);
  }
  const bodyTokens = tokens.slice(pos + 1);
  if (!bodyTokens.length) fail(`${label}: function body is empty`, arrowTok.start);
  return { paramTokens, bodyTokens };
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
function finishModelBody(entries, fail) {
  // Single-occurrence directives: a second @idStart/@tableWas would
  // silently last-win in the runtime's read loops — reject the
  // duplicate at its own position.
  const seenOnce = new Set();
  for (const e of entries) {
    if (e.tag !== 'directive') continue;
    const shape = MODEL_DIRECTIVES[e.name];
    if (shape === undefined) {
      fail(`unknown directive '@${e.name}' on :model — legal: ${Object.keys(MODEL_DIRECTIVES).map((n) => '@' + n).join(', ')}, @ensure, @scope, @defaultScope`, e.nameStart ?? e.start);
    }
    if (e.name === 'idStart' || e.name === 'tableWas') {
      if (seenOnce.has(e.name)) {
        fail(`duplicate '@${e.name}' — a :model declares it at most once (the second would silently override the first)`, e.nameStart ?? e.start);
      }
      seenOnce.add(e.name);
    }
    if (e.name !== 'mixin') e.args = parseModelDirectiveArgs(e, shape, fail);
  }

  const hasMixin = entries.some((e) => e.tag === 'directive' && e.name === 'mixin');
  if (hasMixin) return;
  // Column OWNERSHIP (the parse-visible twin of the runtime's
  // normalize guard): a field's snake_case column colliding with a
  // belongsTo FK or a directive-managed column is duplicate-column
  // DDL waiting for the database.
  const known = new Set(['id']);
  const fieldBySnake = new Map();
  for (const e of entries) {
    if (e.tag !== 'field') continue;
    const col = snakeCase(e.name);
    fieldBySnake.set(col, e.name);
    known.add(col);
  }
  for (const e of entries) {
    if (e.tag !== 'directive') continue;
    const claim = (col, owner) => {
      if (known.has(col)) {
        const f = fieldBySnake.get(col);
        fail(`${f ? `field '${f}'` : 'an earlier directive'} and ${owner} both own column '${col}' — every table column has exactly one owner; ${f ? 'rename the field or drop the directive' : 'drop the duplicate'}`, e.start);
      }
      known.add(col);
    };
    if (e.name === 'timestamps') { claim('created_at', '@timestamps'); claim('updated_at', '@timestamps'); }
    else if (e.name === 'softDelete') claim('deleted_at', '@softDelete');
    else if (e.name === 'belongs_to') claim(snakeCase(e.args[0].target) + '_id', `the @belongs_to ${e.args[0].target} relation`);
  }
  for (const e of entries) {
    if (e.tag !== 'directive' || (e.name !== 'index' && e.name !== 'unique')) continue;
    e.args[0].fields.forEach((c, ci) => {
      if (!known.has(snakeCase(c))) {
        fail(`@${e.name}: unknown column '${c}' — the table has: ${[...known].sort().join(', ')}`, e.colTokens?.[ci]?.start ?? e.start);
      }
    });
  }
}

// One directive's argument tokens → the serialized args shape
// (the runtime's `_normalize` entry surface).
function parseModelDirectiveArgs(e, shape, fail) {
  const tokens = e.argTokens ?? [];
  const junk = (at, why) => fail(`@${e.name}: ${why}`, at.start);
  switch (shape) {
    case 'none': {
      if (tokens.length) junk(tokens[0], `takes no arguments`);
      return null;
    }
    case 'target': {
      const t0 = tokens[0];
      if (!isWord(t0)) {
        fail(`@${e.name} requires a target name — '@${e.name} User'`, (t0 ?? { start: e.start }).start);
      }
      let optional = false;
      let pos = 1;
      if (tokens[pos]?.kind === '?' && !tokens[pos].spaced) { optional = true; pos++; }
      if (pos < tokens.length) junk(tokens[pos], `takes exactly one target name — unexpected ${tokens[pos].kind} after '${t0.value}${optional ? '?' : ''}'`);
      // The FK/accessor derivation rides the snake_case
      // bijection, which acronym-style names break.
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(t0.value) || /[A-Z]{2,}/.test(t0.value)) {
        fail(`@${e.name}: target '${t0.value}' is not canonical PascalCase — use an uppercase-first, alphanumeric name with no consecutive uppercase letters (e.g. 'MdmUser' not 'MDMUser'); the derived FK column and accessor names ride the snake_case bijection`, t0.start);
      }
      return optional ? [{ target: t0.value, optional: true }] : [{ target: t0.value }];
    }
    case 'columns': {
      const fields = [];
      const colTokens = [];
      const isName = (t) => isWord(t) || isKeywordWord(t);
      let pos = 0;
      if (symWordAt(tokens, 0)) {
        const s = symWordAt(tokens, 0);
        fields.push(s.value);
        colTokens.push(s);
        pos = 2;
      } else if (isName(tokens[0])) {
        fields.push(tokens[0].value);
        colTokens.push(tokens[0]);
        pos = 1;
      } else if (tokens[0]?.kind === '[' || tokens[0]?.kind === 'INDEX_START') {
        let depth = 1;
        pos = 1;
        const inner = [];
        while (pos < tokens.length && depth > 0) {
          const t = tokens[pos];
          if (t.kind === '[' || t.kind === 'INDEX_START') depth++;
          if (t.kind === ']' || t.kind === 'INDEX_END') {
            depth--;
            if (depth === 0) { pos++; break; }
          }
          if (depth >= 1) inner.push(t);
          pos++;
        }
        if (depth !== 0) junk(tokens[0], `unclosed '[' in the column list`);
        for (const item of splitTopLevelByComma(inner)) {
          const s = symWordAt(item, 0);
          const nameTok = s ?? (isName(item[0]) ? item[0] : null);
          if (!nameTok || item.length > (s ? 2 : 1)) {
            junk(item[s ? 2 : 1] ?? item[0] ?? tokens[0], `column names are bare identifiers or :symbols — '@${e.name} [:a, :b]'`);
          }
          fields.push(nameTok.value);
          colTokens.push(nameTok);
        }
      }
      if (!fields.length) {
        fail(`@${e.name} requires a field name or list — '@${e.name} :email' or '@${e.name} [:a, :b]'`, (tokens[0] ?? { start: e.start }).start);
      }
      if (pos < tokens.length) junk(tokens[pos], `unexpected ${tokens[pos].kind} after the column list`);
      e.colTokens = colTokens;
      return [{ fields }];
    }
    case 'int': {
      let sign = 1;
      let pos = 0;
      if (tokens[0]?.kind === '-') { sign = -1; pos = 1; }
      const numTok = tokens[pos];
      if (!numTok || numTok.kind !== 'NUMBER') {
        fail(`@${e.name} requires an integer literal — '@idStart 10001'`, (numTok ?? tokens[0] ?? { start: e.start }).start);
      }
      const n = sign * Number(numTok.value);
      if (!Number.isInteger(n)) {
        fail(`@${e.name} requires an integer literal; got ${numTok.value}`, numTok.start);
      }
      if (pos + 1 < tokens.length) junk(tokens[pos + 1], `unexpected ${tokens[pos + 1].kind} after the integer`);
      return [{ value: n }];
    }
    case 'name': {
      const t0 = tokens[0];
      let name = null;
      if (t0?.kind === 'STRING' && t0.value.startsWith('"')) name = JSON.parse(t0.value);
      else if (isWord(t0) || isKeywordWord(t0)) name = t0.value;
      if (name === null || !name.length) {
        fail(`@${e.name} requires the previous table name — '@tableWas legacy_users'`, (t0 ?? { start: e.start }).start);
      }
      if (tokens.length > 1) junk(tokens[1], `takes one prior table name — unexpected ${tokens[1].kind}`);
      return [{ name }];
    }
  }
  return null;
}

// `name: -> body` (method) | `name: ~> body` (computed) |
// `name: !> body` (eager derived). Methods may take plain-identifier
// parameters; computed/derived are accessor-shaped.
function parseCallableLine(kind, headerTok, line, entries, fail) {
  const name = headerTok.value;
  if (line[1]?.kind !== ':') {
    fail(`expected ':' after '${name}' before the arrow`, headerTok.start);
  }
  let pos = 2;
  const paramTokens = [];
  if (line[pos] && (line[pos].kind === 'PARAM_START' || line[pos].kind === '(' || line[pos].kind === 'CALL_START')) {
    let depth = 1;
    pos++;
    while (pos < line.length && depth > 0) {
      const tag = line[pos].kind;
      if (tag === '(' || tag === 'PARAM_START' || tag === 'CALL_START') depth++;
      if (tag === ')' || tag === 'PARAM_END' || tag === 'CALL_END') {
        depth--;
        if (depth === 0) { pos++; break; }
      }
      paramTokens.push(line[pos]);
      pos++;
    }
    if (depth !== 0) fail(`'${name}': unclosed '(' in parameters`, line[2].start);
  }
  const arrowTok = line[pos];
  let arrow = null;
  let bodyStart = -1;
  // `~>` scans as EFFECT (the reactive head) — inside a schema body it
  // spells the computed getter; the value carries the glyph.
  if (arrowTok?.kind === '->' || arrowTok?.kind === 'EFFECT' || arrowTok?.kind === '!>') {
    arrow = arrowTok.kind === 'EFFECT' ? '~>' : arrowTok.kind;
    bodyStart = pos + 1;
  } else if (isWord(arrowTok) || arrowTok?.kind === 'STRING' || arrowTok?.kind === 'NUMBER') {
    // The common colon mistake: `name: type` where a field was meant.
    fail(`schema fields use 'name type' (space, no colon) — got '${name}:'; for methods/computed use 'name: -> body' or 'name: ~> body'`, line[1].start);
  } else {
    fail(`schema top-level '${name}:' must be followed by '->' (method), '~>' (computed getter), or '!>' (eager derived)`, line[1].start);
  }
  // On a :model, a `->` callable whose name is a recognized lifecycle
  // hook binds as one (exact match — anything else stays a plain
  // method, a working reading).
  const tag = arrow === '~>' ? 'computed'
    : arrow === '!>' ? 'derived'
    : kind === 'model' && HOOK_NAMES.has(name) ? 'hook'
    : 'method';
  if (paramTokens.length && tag !== 'method') {
    fail(`'${name}': ${tag === 'computed' ? 'computed getters (~>)' : tag === 'derived' ? 'eager-derived fields (!>)' : 'lifecycle hooks'} take no parameters — only methods do`, line[1].start);
  }
  entries.push({
    tag, name,
    paramTokens, bodyTokens: line.slice(bodyStart),
    start: headerTok.start,
  });
}

// ── @ensure ──────────────────────────────────────────────────────────
// Inline: `@ensure "msg"[, :field], (args) -> body`
// Array:  `@ensure ["msg", (u) -> body, "msg2", (u) -> body, …]`

function parseEnsurePairs(argTokens, directiveTok, fail) {
  let tokens = argTokens;
  if (!tokens.length) {
    fail(`@ensure requires 'message, (x) -> body' or a '[…]' array of pairs`, directiveTok.start);
  }
  const first = tokens[0];
  if (first.kind === '[' || first.kind === 'INDEX_START') {
    const inner = extractBracketInner(tokens, first, fail);
    const parts = splitEnsureElements(inner);
    if (parts.length === 0) {
      fail(`@ensure […] must contain at least one 'message, fn' pair`, first.start);
    }
    return consumeEnsureTuples(parts, first, fail);
  }
  const parts = splitTopLevelByComma(tokens);
  if (parts.length < 2) {
    fail(`@ensure inline form must be 'message, (x) -> body' — did you forget the comma?`, first.start);
  }
  if (parts.length > 3 || (parts.length === 3 && !isEnsureFieldPart(parts[1]))) {
    fail(`@ensure inline form takes 'message[, :field], fn' (got ${parts.length} comma-separated parts) — use '@ensure […]' for multiple refinements`, first.start);
  }
  return consumeEnsureTuples(parts, first, fail);
}

const isEnsureFieldPart = (part) => part && part.length === 2 && symWordAt(part, 0) !== null;

function consumeEnsureTuples(parts, anchorTok, fail) {
  const pairs = [];
  let i = 0;
  while (i < parts.length) {
    const msgPart = parts[i++];
    let fieldPart = null;
    if (i < parts.length && isEnsureFieldPart(parts[i])) fieldPart = parts[i++];
    if (i >= parts.length) {
      fail(`@ensure: missing function after message${fieldPart ? ' and :field' : ''}`, (msgPart[0] ?? anchorTok).start);
    }
    pairs.push(extractEnsurePair(msgPart, fieldPart, parts[i++], anchorTok, fail));
  }
  return pairs;
}

function extractBracketInner(tokens, openTok, fail) {
  let depth = 0;
  const inner = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === '[' || t.kind === 'INDEX_START') {
      depth++;
      if (depth === 1) continue;
    }
    if (t.kind === ']' || t.kind === 'INDEX_END') {
      depth--;
      if (depth === 0) {
        if (i < tokens.length - 1) {
          fail(`@ensure […] must be the only argument — extra tokens after ']'`, tokens[i + 1].start);
        }
        // Strip one INDENT/OUTDENT pair wrapping the whole inner body.
        if (inner.length >= 2 && inner[0].kind === 'INDENT' && inner[inner.length - 1].kind === 'OUTDENT') {
          let wd = 0;
          let matched = false;
          for (let k = 0; k < inner.length; k++) {
            if (inner[k].kind === 'INDENT') wd++;
            else if (inner[k].kind === 'OUTDENT' && --wd === 0) { matched = k === inner.length - 1; break; }
          }
          if (matched) return inner.slice(1, -1);
        }
        return inner;
      }
    }
    if (depth >= 1) inner.push(t);
  }
  fail(`@ensure: unclosed '['`, openTok.start);
}

// Array-form elements split on both ',' and newlines at depth 0
// (mirroring Rip's array-literal rule).
function splitEnsureElements(tokens) {
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
    if (depth === 0 && (tag === ',' || tag === 'TERMINATOR')) {
      if (cur.length) { parts.push(cur); cur = []; }
      continue;
    }
    cur.push(t);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

function extractEnsurePair(messagePart, fieldPart, fnPart, refTok, fail) {
  if (!messagePart?.length) {
    fail(`@ensure: missing message (expected a string literal)`, refTok.start);
  }
  if (messagePart.length !== 1 || messagePart[0].kind !== 'STRING' || !messagePart[0].value.startsWith('"')) {
    fail(`@ensure: each refinement's first element must be a string literal message`, (messagePart[0] ?? refTok).start);
  }
  const msgTok = messagePart[0];
  const message = JSON.parse(msgTok.value);
  const field = fieldPart ? symWordAt(fieldPart, 0).value : null;
  if (!fnPart?.length) {
    fail(`@ensure: missing function after message`, msgTok.start);
  }
  const t0 = fnPart[0];
  if (t0.kind !== '(' && t0.kind !== 'PARAM_START') {
    fail(`@ensure: expected '(args) -> body' after the message — predicates declare their parameter explicitly ('(u) -> …')`, t0.start);
  }
  let depth = 1;
  let pos = 1;
  const paramTokens = [];
  while (pos < fnPart.length && depth > 0) {
    const tag = fnPart[pos].kind;
    if (tag === '(' || tag === 'PARAM_START') depth++;
    if (tag === ')' || tag === 'PARAM_END') {
      depth--;
      if (depth === 0) { pos++; break; }
    }
    paramTokens.push(fnPart[pos]);
    pos++;
  }
  if (depth !== 0) fail(`@ensure: unclosed '(' in predicate parameters`, t0.start);
  const arrowTok = fnPart[pos];
  if (arrowTok?.kind !== '->') {
    fail(`@ensure: expected '->' after predicate parameters`, (arrowTok ?? msgTok).start);
  }
  const bodyTokens = fnPart.slice(pos + 1);
  if (!bodyTokens.length) fail(`@ensure: predicate function body is empty`, arrowTok.start);
  return { message, field, paramTokens, bodyTokens };
}

// Parameter names from a captured `(a, b)` slice. Each parameter is a
// plain identifier, optionally typed (`other: Money`) — the annotation
// is type-surface only and never reaches the emitted JS, exactly like
// annotations everywhere else in the language.
export function paramNamesOf(paramTokens, what, fail) {
  if (!paramTokens.length) return [];
  return splitTopLevelByComma(paramTokens).map((part) => {
    const toks = part.filter((t) => t.kind !== 'TERMINATOR' && t.kind !== 'INDENT' && t.kind !== 'OUTDENT' && t.kind !== 'TYPE');
    // A typed parameter's name arrives as PROPERTY (the lexer's
    // `word:` tagging) with the raw ':' following it.
    const typed = toks.length >= 3 && (toks[0].kind === 'IDENTIFIER' || toks[0].kind === 'PROPERTY') && toks[1].kind === ':';
    if (!typed && (toks.length !== 1 || toks[0].kind !== 'IDENTIFIER')) {
      fail(`${what}: parameters must be plain identifiers, optionally typed ('name' or 'name: Type')`, (toks[0] ?? part[0]).start);
    }
    return toks[0].value;
  });
}

// ── :union and :enum lines ───────────────────────────────────────────

function parseUnionLine(line, entries, fail) {
  const first = line[0];
  if (!first) return;
  if (first.kind === '@') {
    const nameTok = line[1];
    if (!nameTok || nameTok.value !== 'on') {
      fail(`:union bodies accept only '@on :field' and constituent schema names — '@${nameTok?.value ?? ''}' is not allowed`, (nameTok ?? first).start);
    }
    const sym = symWordAt(line, 2);
    if (!sym) {
      fail(`@on requires the discriminator field as a symbol — '@on :kind'`, (line[2] ?? nameTok).start);
    }
    if (line.length > 4) fail(`@on takes exactly one :field symbol`, line[4].start);
    entries.push({ tag: 'directive', name: 'on', args: [{ field: sym.value }], start: first.start });
    return;
  }
  if (first.kind === 'IDENTIFIER' && line.length === 1) {
    entries.push({ tag: 'union-member', name: first.value, start: first.start });
    return;
  }
  fail(`:union bodies accept only '@on :field' and bare constituent schema names (one per line) — got ${first.kind}${line.length > 1 ? ' followed by ' + line[1].kind : ''}`, first.start);
}

function parseEnumLine(line, entries, fail) {
  const first = line[0];
  if (!first) return;
  if (first.kind === '@') {
    fail(`:enum schemas don't accept '@${line[1]?.value ?? 'directive'}' — enums hold only :symbol members`, first.start);
  }
  const sym = symWordAt(line, 0);
  if (!sym) {
    fail(`enum member must be a :symbol — use ':${first.value ?? 'name'}' for a bare member or ':${first.value ?? 'name'} value' for a valued one`, first.start);
  }
  const name = sym.value;
  const valueTok = line[2];
  if (!valueTok) {
    entries.push({ tag: 'enum-member', name, value: undefined, start: first.start });
    return;
  }
  if (valueTok.kind === ':') {
    fail(`enum member ':${name}' — drop the ':' before the value; use ':${name} value'`, valueTok.start);
  }
  if (line.length > 3 && !(line.length === 4 && valueTok.kind === '-' && line[3].kind === 'NUMBER')) {
    fail(`extra tokens after enum member ':${name}' value`, line[3].start);
  }
  const value = valueTok.kind === '-' && line[3]?.kind === 'NUMBER'
    ? -Number(line[3].value)
    : literalOf(valueTok, `enum member ':${name}' value`, fail);
  entries.push({ tag: 'enum-member', name, value, start: first.start });
}

// ── constraint parsing (values evaluated here, fail-fast) ────────────

function isRangeConstraintTokens(tokens) {
  return tokens.some((t) => t.kind === '..') &&
    tokens.every((t) => t.kind === '..' || t.kind === 'NUMBER' || t.kind === '-');
}

function parseRangeTokens(tokens, fieldName, fail) {
  let i = 0;
  const readOne = () => {
    let sign = 1;
    if (tokens[i]?.kind === '-') { sign = -1; i++; }
    const numTok = tokens[i++];
    if (numTok?.kind !== 'NUMBER') {
      fail(`range endpoints must be numeric literals`, (numTok ?? tokens[0]).start);
    }
    return sign * Number(numTok.value);
  };
  let min;
  if (tokens[i]?.kind !== '..') min = readOne();
  i++; // consume '..'
  let max;
  if (i < tokens.length) max = readOne();
  // A bare '..' constrains nothing — noise, not a range. Omitting the
  // trailer entirely says the same thing loudly less.
  if (min === undefined && max === undefined) {
    fail(`a bare '..' range constrains nothing on field '${fieldName}' — give an endpoint (1.., ..60, 1..60) or drop the range`, tokens[0].start);
  }
  if (min !== undefined && max !== undefined && min > max) {
    fail(`range '${min}..${max}' is reversed — write the smaller endpoint first`, tokens[0].start);
  }
  const out = {};
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  return out;
}

// `[value]` — a single literal default.
function parseDefaultBracket(tokens, fieldName, fail) {
  const inner = tokens.slice(1, -1);
  const items = splitTopLevelByComma(inner);
  if (items.length !== 1) {
    fail(items.length === 2
      ? `size/value ranges use 'min..max' syntax, not brackets — replace the bracket pair with a range`
      : `the constraint bracket takes a single default value (got ${items.length} elements)`, tokens[0].start);
  }
  const part = items[0];
  if (part.length === 1 && part[0].kind === 'REGEX') {
    fail(`regex constraints are written bare, not in brackets — replace '[${part[0].value}]' with '${part[0].value}'`, tokens[0].start);
  }
  if (part.length === 2 && part[0].kind === '-' && part[1].kind === 'NUMBER') {
    return -Number(part[1].value);
  }
  const sym = symWordAt(part, 0);
  if (sym && part.length === 2) return sym.value;
  if (part.length !== 1) {
    fail(`default values must be literals (number, string, boolean, null, :symbol) — field '${fieldName}'`, part[0].start);
  }
  return literalOf(part[0], `field '${fieldName}' default`, fail);
}

function parseRegexToken(tok, fail) {
  const m = /^\/((?:\\.|[^\\/])+)\/([a-z]*)$/.exec(tok.value);
  if (!m) fail(`invalid regex literal ${JSON.stringify(tok.value)}`, tok.start);
  try {
    return new RegExp(m[1], m[2]);
  } catch (e) {
    fail(`invalid regex '${tok.value}': ${e.message}`, tok.start);
  }
}

function literalOf(tok, what, fail) {
  switch (tok.kind) {
    case 'NUMBER': return Number(tok.value);
    case 'STRING':
      if (!tok.value.startsWith('"')) {
        fail(`${what} must be a plain string literal (heredocs have no literal key form)`, tok.start);
      }
      return JSON.parse(tok.value);
    case 'BOOL': return tok.value === 'true';
    case 'NULL': return null;
    case 'UNDEFINED': return undefined;
    default:
      fail(`${what} must be a literal (number, string, boolean, null) — got ${tok.kind}`, tok.start);
  }
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

function findTopLevelArrowIdx(tokens) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tag = tokens[i].kind;
    if (tag === '(' || tag === '[' || tag === '{' ||
        tag === 'CALL_START' || tag === 'INDEX_START' || tag === 'PARAM_START' || tag === 'INDENT') depth++;
    else if (tag === ')' || tag === ']' || tag === '}' ||
             tag === 'CALL_END' || tag === 'INDEX_END' || tag === 'PARAM_END' || tag === 'OUTDENT') depth--;
    else if (depth === 0 && tag === '->') return i;
  }
  return -1;
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
// segment, so the builder records it as a TS-only region and the
// strip gate holds by construction. With `thisTypes` absent every
// segment is plain — the JS emission joins them to the pinned literal.

export function descriptorSegments(descriptor, schemaName, fns, adapterCode = null, thisTypes = null, tsFace = false) {
  const segs = [];
  const emit = (s) => {
    if (segs.length && typeof segs[segs.length - 1] === 'string') segs[segs.length - 1] += s;
    else segs.push(s);
  };
  const emitTs = (s) => segs.push({ ts: s });
  emit(`{kind: ${JSON.stringify(descriptor.kind)}`);
  if (schemaName) emit(`, name: ${JSON.stringify(schemaName)}`);
  emit(`, entries: [`);
  descriptor.entries.forEach((e, i) => {
    if (i > 0) emit(', ');
    entrySegments(e, fns.get(i), thisTypes?.get(i) ?? null, emit, emitTs, tsFace);
  });
  emit(']');
  // `schema :model, on: <expr>` — evaluated at declaration time in
  // the user's scope.
  if (adapterCode) emit(`, adapter: ${adapterCode}`);
  emit('}');
  return segs;
}

const fnText = (fnCode) => (typeof fnCode === 'string' ? fnCode : fnCode.code);

// A compiled callable's code, with the face-only `this: T` parameter
// inserted at the recorded parameter-list offset when the entry
// carries a `this` type.
function fnSegments(fnCode, thisType, emit, emitTs) {
  if (thisType === null || typeof fnCode === 'string') {
    emit(fnText(fnCode));
    return;
  }
  const { code, thisAt } = fnCode;
  emit(code.slice(0, thisAt));
  emitTs(`this: ${thisType}${code[thisAt] === ')' ? '' : ', '}`);
  emit(code.slice(thisAt));
}

function entrySegments(e, fnCode, thisType, emit, emitTs, tsFace = false) {
  switch (e.tag) {
    case 'computed':
    case 'method':
    case 'derived':
    case 'hook':
    case 'scope':
    case 'defaultScope':
      emit(`{tag: ${JSON.stringify(e.tag)}, name: ${JSON.stringify(e.name)}, fn: `);
      fnSegments(fnCode, thisType, emit, emitTs);
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
      if (tsFace && e.tag === 'field' && fnCode !== undefined && typeof fnCode !== 'string' &&
          fnText(fnCode).startsWith('it', fnCode.thisAt)) {
        const whole = entryLiteral(e, fnCode);
        const fn = fnText(fnCode);
        const cut = whole.length - 1 - fn.length + fnCode.thisAt + 'it'.length;
        emit(whole.slice(0, cut));
        emitTs(': any');
        emit(whole.slice(cut));
        return;
      }
      emit(entryLiteral(e, fnCode));
  }
}

function entryLiteral(e, fnCode) {
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
      if (e.literals) obj.push(`literals: ${JSON.stringify(e.literals)}`);
      if (e.coerce) {
        obj.push('coerce: true');
        if (e.coercer) obj.push(`coercer: ${JSON.stringify(e.coercer)}`);
      }
      if (e.constraints) {
        const c = [];
        if (e.constraints.min !== undefined) c.push(`min: ${serializeLiteral(e.constraints.min)}`);
        if (e.constraints.max !== undefined) c.push(`max: ${serializeLiteral(e.constraints.max)}`);
        if (e.constraints.default !== undefined) c.push(`default: ${serializeLiteral(e.constraints.default)}`);
        if (e.constraints.regex !== undefined) c.push(`regex: ${e.constraints.regex.toString()}`);
        if (c.length) obj.push(`constraints: {${c.join(', ')}}`);
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
        if (e.name === 'mixin' || RELATION_DIRECTIVES.has(e.name)) {
          const a = e.args[0];
          obj.push(`args: [{target: ${JSON.stringify(a.target)}${a.optional ? ', optional: true' : ''}}]`);
        } else if (e.name === 'on') {
          obj.push(`args: [{field: ${JSON.stringify(e.args[0].field)}}]`);
        } else if (e.name === 'unique' || e.name === 'index') {
          obj.push(`args: [{fields: ${JSON.stringify(e.args[0].fields)}}]`);
        } else if (e.name === 'idStart') {
          obj.push(`args: [{value: ${e.args[0].value}}]`);
        } else if (e.name === 'tableWas') {
          obj.push(`args: [{name: ${JSON.stringify(e.args[0].name)}}]`);
        }
      }
      return `{${obj.join(', ')}}`;
    }
    case 'ensure': {
      const obj = [
        `tag: "ensure"`,
        `message: ${JSON.stringify(e.message)}`,
        `fn: ${fnCode}`,
      ];
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

function foldStr(n) { return n && n.valueOf ? n.valueOf() : n; }

// True when a descriptor pulls fields in via `@mixin`. The fold can't
// expand mixins (resolution is a runtime `_normalize` concern), so any
// projection over such a base must bail to the runtime call rather than
// silently emit a shape missing the mixin's fields.
function foldHasMixin(descriptor) {
  return descriptor.entries.some((e) => e.tag === 'directive' && e.name === 'mixin');
}

// The `@belongs_to <Target>` FK column name, computed exactly as the
// runtime does (`__schemaCamel(__schemaFkName(target))` in schema-orm.js).
function foldFkName(target) {
  const snake = target.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return (snake + '_id').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// The projectable columns of a descriptor as an ordered Map(name → field
// entry): declared fields, then a :model's implicit id / @timestamps /
// @softDelete / @belongs_to FK columns — matching `projectableFields` in
// runtime/schema-orm.js so a fold yields the same field set the runtime
// would. Returns null (bail) when the base uses `@mixin`.
function foldProjectableMap(descriptor) {
  if (foldHasMixin(descriptor)) return null;
  const map = new Map();
  for (const e of descriptor.entries) {
    if (e.tag === 'field') map.set(e.name, e);
  }
  if (descriptor.kind !== 'model') return map;
  const synth = (name, typeName, required) => {
    if (!map.has(name)) map.set(name, { tag: 'field', name, modifiers: required ? ['!'] : ['?'], typeName, array: false });
  };
  let timestamps = false, softDelete = false;
  const fks = [];
  for (const e of descriptor.entries) {
    if (e.tag !== 'directive') continue;
    if (e.name === 'timestamps') timestamps = true;
    else if (e.name === 'softDelete') softDelete = true;
    else if (e.name === 'belongs_to') {
      const t = e.args && e.args[0] && e.args[0].target;
      if (t) fks.push({ fk: foldFkName(t), required: e.args[0].optional !== true });
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
    if (!Array.isArray(node)) return null;
    const callee = node[0];
    if (!Array.isArray(callee)) return null;
    if (foldStr(callee[0]) !== '.') return null;
    const method = foldStr(callee[2]);
    if (!FOLD_ALGEBRA.has(method)) return null;
    const argNodes = node.slice(1);
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
        const inline = foldStr(a[0]) === 'schema' && a.length === 2 && a[1] &&
          typeof a[1] === 'object' && Array.isArray(a[1].entries) ? a[1] : null;
        if (!inline || (inline.kind !== 'shape' && inline.kind !== 'input')) return null;
        op = { method, otherDescriptor: inline };
      } else {
        const name = foldStr(a);
        if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
        op = { method, otherName: name };
      }
    } else {
      const keys = foldLiteralKeys(argNodes);
      if (!keys || !keys.length) return null;
      op = { method, keys };
    }
    ops.unshift(op);
    const obj = callee[1];
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
      for (let i = 1; i < a.length; i++) {
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

// Walk the program's top-level statements, fold every foldable
// derived-schema assignment in place, and thread folded results into the
// same-file schema map so a later `.extend`/chain can reference an
// already-folded projection. Mutates `sexpr`. Called by compile() only
// when options.foldProjections is set.
export function foldDerivedSchemas(sexpr) {
  if (!Array.isArray(sexpr)) return;
  const head = foldStr(sexpr[0]);
  const stmts = (head === 'program' || head === 'block') ? sexpr.slice(1) : [sexpr];
  const byName = new Map();
  for (const stmt of stmts) {
    if (!Array.isArray(stmt)) continue;
    // Unwrap `export <assign>` to reach the assignment node.
    let assign = stmt;
    if (foldStr(stmt[0]) === 'export' && Array.isArray(stmt[1])) assign = stmt[1];
    if (foldStr(assign[0]) !== '=' || !Array.isArray(assign[2])) continue;
    const name = foldStr(assign[1]);
    if (typeof name !== 'string') continue;

    // Already a schema literal — register its descriptor and move on.
    if (foldStr(assign[2][0]) === 'schema' && assign[2].length === 2 &&
        assign[2][1] && typeof assign[2][1] === 'object' && Array.isArray(assign[2][1].entries)) {
      byName.set(name, assign[2][1]);
      continue;
    }

    const chain = foldParseChain(assign[2]);
    if (!chain) continue;
    const baseDesc = byName.get(chain.base);
    if (!baseDesc) continue; // base not a same-file schema — leave the runtime call
    const folded = foldProjectionDescriptor(baseDesc, chain.ops, byName);
    if (!folded) continue;   // not statically foldable — leave the runtime call

    assign[2] = ['schema', folded];
    byName.set(name, folded);
  }
}
