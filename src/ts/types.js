// Shared type-text machinery for the two type-rendering consumers:
// declaration emission (src/ts/dts.js, the canonical pipeline) and the
// TS-face emission (src/emitter.js, the editor face). Both render
// from the SAME recorded data — annotation spans in the side tables and
// the lexer's opaque TYPE_DECL/def-sig values — through these
// functions, so the surfaces cannot drift in DECLARATION STRUCTURE
// (alias/interface bodies, signature shapes, rejection classes).
// Type-TEXT spelling is a narrower guarantee, by design: positions
// whose emitted bytes should map EXACTLY (the face's implementation-
// param and hoist-line annotations) render the SOURCE spelling
// (annotationText's normalized slice), while lexer-value positions
// (dts params, overload rows) render the token value through
// tidyType — so `number|string` may print with different spacing
// across the two paths. Structure is shared; verbatim spelling is
// the mapping contract's, deliberately.
//
// Everything here is pure text/tree work: no stores, no builder, no I/O.
// Rejections throw TypeTextError with the core message (no consumer
// prefix); dts wraps them as DtsError ("declaration emission: …") and
// the TS face as a positioned emitter diagnostic ("emitter: …").

import { identifierRunAt } from '../ident.js';

export class TypeTextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TypeTextError';
  }
}

const isNode = (x) => Array.isArray(x);

// Split type text on a DEPTH-0 delimiter character, string-aware
// (a '|' inside quotes, brackets, or generic angles never splits).
export const splitTopLevel = (t, delim) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  let inStr = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && t[i - 1] !== '=')) depth--;
    else if (c === delim && depth === 0) {
      parts.push(t.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(t.slice(start));
  return parts.map((p) => p.trim());
};

// Lexer-normalized type strings (typed-var wrappers, def-sig return
// types) compact `]` against its neighbors, eating the space before a
// top-level union bar (`number[]| string[]`); rejoin the arms. Span-
// sliced annotation text never routes through here — it keeps the
// user's spelling.
export const tidyType = (t) => splitTopLevel(t, '|').join(' | ');

// Is this (normalized) type text an ARRAY-shaped type — the shapes a
// rest parameter's declared type may take? A top-level UNION is
// array-shaped only when EVERY arm is; a single arm is `T[]` (any
// depth), a tuple literal, or an Array/ReadonlyArray head.
export const isArrayShapedType = (t) => {
  const arms = splitTopLevel(t, '|');
  if (arms.length > 1) return arms.every(isArrayShapedType);
  return t.endsWith('[]') || t.startsWith('[') || /^(Array|ReadonlyArray)\s*</.test(t);
};

// The rip boolean spellings a TYPE position lowers to TS's (the
// lexer's BOOL aliases, src/lexer.js ALIASES). Null-prototype: the
// table is indexed by USER identifier text, so an inherited
// Object.prototype member (`constructor`, `toString`, `hasOwnProperty`,
// …) must never satisfy the lookup — a member NAMED `constructor` is
// a legal TS member and keeps its spelling.
const BOOLEAN_WORDS = { __proto__: null, yes: 'true', on: 'true', no: 'false', off: 'false' };

// Is the identifier run at [start, end) of `raw` a NAME rather than a
// type — a position the boolean lowering must leave alone? Mirrors
// the lexer's key rule (a word directly keyed by `:` is a property
// before it is anything else; a word after `.` is a member), applied
// to the type-text grammar: an object member key (`{ on: T }`,
// `{ on?: T }`, `readonly on: T`), a parameter or index-signature
// name (`(on: T) => U`, `[on: K]: T`), a mapped-type or predicate
// name (`[on in K]`, `on is T`), an `infer` binding, and a qualified
// segment (`Colors.on`) all keep their spelling. The conditional
// type's true branch (`T extends U ? on : off`) is the one colon-
// headed TYPE position — the lexer's TERNARY guard — and lowers.
// `outBefore` is the normalized text emitted so far (its tail is the
// preceding significant character).
const isNamePosition = (raw, start, end, outBefore) => {
  const before = outBefore.trimEnd();
  const prev = before[before.length - 1];
  if (prev === '.') return true;
  if (/\binfer$/.test(before)) return true;
  let j = end;
  while (j < raw.length && /\s/.test(raw[j])) j++;
  if (raw[j] === '?') {
    j++;
    while (j < raw.length && /\s/.test(raw[j])) j++;
  }
  if (raw[j] === ':') return prev !== '?';
  const next = identifierRunAt(raw, j)?.value;
  return next === 'is' || next === 'in';
};

// ── type-text normalization ──────────────────────────────────────────
// Annotation roles carry SPANS; the type text is the source slice with
// its layout collapsed: comments dropped, whitespace runs (wrapped
// generics, block-structural fields) folded to single spaces, and a
// newline field separator inside braces rendered as '; ' (the same
// seam collectTypeRun emits for the token value). String literals in
// type position pass through untouched.
export const normalizeTypeText = (raw) => {
  let out = '';
  let brace = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < raw.length && raw[j] !== ch) j += raw[j] === '\\' ? 2 : 1;
      // String-literal TYPES display double-quoted across the TS
      // ecosystem (tsc/tsgo/editors — and the hovers): normalize the
      // rip author's single quotes here so the face, dts, and tsgo's
      // declaration-echoing hovers (TS7 echoes syntax verbatim) all
      // speak the convention. Content re-escapes: `"` gains a
      // backslash, `\'` loses one.
      if (ch === "'") {
        const body = raw.slice(i + 1, j).replace(/\\'/g, "'").replace(/"/g, '\\"');
        out += `"${body}"`;
      } else {
        out += raw.slice(i, j + 1);
      }
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      // A comment and the whitespace that introduced it are ONE run of
      // trivia: dropping the comment alone would leave that space
      // standing as the preceding character, and the field-separator
      // rule below reads the character before a newline to decide
      // whether the seam needs a ';' — against a space it always does,
      // so a braced type wrapped with commented lines would collect a
      // stray separator per comment ('{ ; a: T ; ; b: U }').
      out = out.trimEnd();
      while (i < raw.length && raw[i] !== '\n') i++;
      continue;
    }
    const run = identifierRunAt(raw, i);
    if (run) {
      const lowered = BOOLEAN_WORDS[run.value];
      out += lowered !== undefined && !isNamePosition(raw, run.start, run.end, out) ? lowered : run.value;
      i = run.end;
      continue;
    }
    if (ch === '{') { brace++; out += ch; i++; continue; }
    if (ch === '}') { brace--; out += ch; i++; continue; }
    if (/\s/.test(ch)) {
      let j = i;
      let sawNewline = false;
      while (j < raw.length && /\s/.test(raw[j])) {
        if (raw[j] === '\n') sawNewline = true;
        j++;
      }
      const prev = out[out.length - 1];
      const next = raw[j];
      if (prev !== undefined && next !== undefined) {
        out += sawNewline && brace > 0 && !'{,;|&<('.includes(prev) && next !== '}' ? '; ' : ' ';
      }
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out.trim();
};

// ── the block-body member grammar ────────────────────────────────────
// The OBJECT-MEMBER grammar for a block alias body — the member
// shapes the braced restructuring recognizes, checked on the
// normalized member text:
//   keyed property  — [readonly] KEY[?]: T
//                     KEY = identifier | "string" | 'string' | number
//   index signature — [readonly] [k: K]: T    (the member colon after
//                     the key's BALANCED close distinguishes it from
//                     a wrapped TUPLE type — `[A, B]` alone is a
//                     type, not a member; the key's own brackets may
//                     nest, `[k: A[B]]: number`)
//   call signature  — [<T>](…): T             (its return colon
//                     distinguishes it from a parenthesized TYPE —
//                     `(A | B)` is a wrapped type, not a member)
// Everything else — union bars, intersection lines, bare type text —
// is NOT an object member; a body mixing member and non-member lines
// rejects rather than joining them into unvetted text. Method
// shorthand and `new` construct signatures never reach here: the
// type-token vocabulary rejects both in ALIAS bodies at the lexer
// (methods are interface-only; `new` is code-shaped).
const MEMBER_KEY = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d[\w.]*|[A-Za-z_$][\w$]*)`;
const MEMBER_PROPERTY = new RegExp(String.raw`^(?:readonly\s+)?${MEMBER_KEY}\??\s*:`);
const MEMBER_SIGNATURE = /^(?:<.*>\s*)?\(.*\)\s*:/;
// Method shorthand member (`addItem(item: CartItem): void` — the
// interface/block-alias form).
const MEMBER_METHOD = new RegExp(String.raw`^${MEMBER_KEY}\??\s*(?:<.*>\s*)?\(.*\)\s*:`);
const isIndexSignature = (m) => {
  const s = m.replace(/^readonly\s+/, '');
  if (s[0] !== '[') return false;
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return /^\s*:/.test(s.slice(i + 1));
  }
  return false;
};
const isObjectMember = (m) =>
  MEMBER_PROPERTY.test(m) || isIndexSignature(m) || MEMBER_SIGNATURE.test(m) || MEMBER_METHOD.test(m);

// Does a lone body line carry a top-level MEMBER colon — a depth-0
// ':' that no conditional-type '?' opened? (An optional marker's '?'
// glues directly to ':' and leaves the colon a member's.) This is
// the SINGLE-branch boundary: a lone line WITH a member colon is an
// ATTEMPTED member — if the grammar above did not recognize it, it
// rejects rather than shipping unbraced as a "type"; a lone line
// without one is a wrapped type (whose only depth-0 colons are
// conditional-type else-branches).
const hasMemberColon = (m) => {
  let depth = 0;
  let ternary = 0;
  let inStr = null;
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && m[i - 1] !== '=')) depth--;
    else if (depth === 0 && c === '?' && m[i + 1] !== ':') ternary++;
    else if (depth === 0 && c === ':') {
      if (ternary > 0) ternary--;
      else return true;
    }
  }
  return false;
};

// The KEY of a member colon at `at` — the run back to whatever opened
// or separated the member. Reported as-is; the caller owns the fix.
const memberKeyBefore = (t, at) => {
  let start = 0;
  for (let i = 0; i < at; i++) if ('{;,'.includes(t[i])) start = i + 1;
  return t.slice(start, at).trim();
};

// A member colon with NOTHING after it — the normalized text puts the
// field separator, the closing brace, or the end of the type straight
// against the ':'. Inside brackets an indented run beneath such a
// colon is LAYOUT and not structure (the type run collapses
// INDENT/OUTDENT there, and the annotation and member paths render
// those lines as siblings), so the colon takes no block and simply
// carries no type. Returns the offending key, or null.
const untypedMemberColon = (t) => {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && t[i - 1] !== '=')) depth--;
    else if (c === ':') {
      let j = i + 1;
      while (j < t.length && t[j] === ' ') j++;
      if (j >= t.length || ';,}'.includes(t[j])) return memberKeyBefore(t, i);
    }
  }
  return null;
};

// ── type/interface declaration rendering ─────────────────────────────
// The TYPE_DECL text is the raw source of the whole statement
// (the opaque collapse), structured here: header, generic
// parameters, extends clause, and body members — Rip's indented
// bodies become TS braces. Members joining respects bracket/angle
// balance so a generic wrapped across body lines stays one member.

// Net bracket/angle depth of a normalized text run — the balance
// memberLines and the nesting fold both join continuation lines by.
const netDepth = (text) => {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '<') depth++;
    else if (c === '>' && text[i - 1] !== '=') depth--;
  }
  return depth;
};

// ── layout nesting: bare-colon heads ─────────────────────────────────
// A body line whose NORMALIZED text ends at a depth-0 ':' takes its
// type from the indented block beneath it — the same bare-colon
// nesting object literals use at the value level, for every key shape
// the member grammar knows (property, index-signature, method/call
// heads alike). The sub-block classifies like a block alias body,
// recursively:
//   member children  → an inline object type
//                      (`inner?:` + `x?: number` → `inner?: { x?: number }`)
//   `|` variants     → a union annotation
//   one other child  → the annotation wrapped onto its own line
// Anything else rejects — never a silent flatten into the parent.
// Each line normalizes FIRST (a trailing `#` comment is trivia here as
// everywhere) and then joins bracket continuations BEFORE any head
// reading, so a wrapped `handler: (` consumes its interior lines and
// never donates them as heads. A bare ':' with nothing beneath it
// carries no type and rejects. The ':' itself is the one block
// opener: an annotation spelled as the bare word `type` above a
// deeper line rejects with the fix rather than reading as a type
// named 'type'.
const noTypeError = (key) => new TypeTextError(
  `member '${key}' carries no type — write one after ':', or nest an indented block of members beneath it`,
);
const foldNestedBlocks = (body) => {
  const lines = body.split('\n');
  const indentOf = (l) => /^[ \t]*/.exec(l)[0].length;
  const foldFrom = (i0) => {
    let norm = normalizeTypeText(lines[i0]);
    let j = i0 + 1;
    if (norm === '') return { text: '', next: j };
    while (netDepth(norm) > 0 && j < lines.length) {
      const cont = normalizeTypeText(lines[j]);
      j++;
      if (cont !== '') norm += ` ${cont}`;
    }
    const ind = indentOf(lines[i0]);
    if (/:\s*type$/.test(norm)) {
      let k = j;
      while (k < lines.length && normalizeTypeText(lines[k]) === '') k++;
      if (k < lines.length && indentOf(lines[k]) > ind) {
        throw new TypeTextError(
          `the block under '${norm.replace(/:\s*type$/, '').trim()}' opens from the bare ':' — drop the 'type' keyword`,
        );
      }
    }
    if (!norm.endsWith(':')) {
      // A member that already carries a type takes no block. Left alone the
      // block's members fold into the PARENT as siblings and the line emits
      // with whatever operator it trailed off on — a face that does not
      // parse, blamed on the alias head rather than on this line. The
      // nesting form opens from the bare ':' and nowhere else.
      let k = j;
      while (k < lines.length && normalizeTypeText(lines[k]) === '') k++;
      if (k < lines.length && indentOf(lines[k]) > ind) {
        throw new TypeTextError(
          `the block under '${norm}' opens only from a bare ':' — finish the type on this line, or brace the block`,
        );
      }
      return { text: norm, next: j };
    }
    const key = norm.slice(0, -1).trim();
    const parts = [];
    while (j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > ind)) {
      if (lines[j].trim() === '') { j++; continue; }
      const r = foldFrom(j);
      j = r.next;
      if (r.text !== '') parts.push(r.text);
    }
    if (parts.length === 0) throw noTypeError(key);
    const c = classifyMembers(parts);
    if (c.kind === 'union') return { text: `${key}: ${c.arms.join(' | ')}`, next: j };
    if (c.kind === 'object') return { text: `${key}: { ${parts.join('; ')} }`, next: j };
    if (c.kind === 'single') return { text: `${key}: ${parts[0]}`, next: j };
    throw new TypeTextError(
      `unrecognized member '${c.offender}' in the nested block of '${key}' — a nested block is a ` +
      `union (| variants), an object type (keyed properties, index/call signatures), or one wrapped type`,
    );
  };
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const r = foldFrom(i);
    out.push(r.text);
    i = r.next;
  }
  return out.join('\n');
};

// The block-body classification — one judgment for a member list at
// every nesting depth, so a body cannot read differently at top level
// than one indent deeper. Exactly one of:
//   UNION  — every member after the first starts with `|`; the first
//            is `|`-prefixed too, or a plain leading variant.
//   OBJECT — every member is a recognized OBJECT MEMBER (the grammar
//            above).
//   SINGLE — exactly one member that is no object member AND carries
//            no member colon: a type wrapped across lines. A lone
//            member-shaped line that failed the grammar rejects —
//            SINGLE is for types, never for failed members.
//   reject — everything else, blaming the first line that breaks the
//            dominant reading.
const classifyMembers = (members) => {
  const union =
    members.length > 0 &&
    members.slice(1).every((m) => m.startsWith('|')) &&
    (members[0].startsWith('|') || (members.length > 1 && !isObjectMember(members[0])));
  if (union) return { kind: 'union', arms: members.map((m) => m.replace(/^\|\s*/, '')) };
  if (members.length > 0 && members.every(isObjectMember)) return { kind: 'object' };
  if (members.length === 1 && !hasMemberColon(members[0])) return { kind: 'single' };
  const offender =
    members.find((m) => !isObjectMember(m) && !m.startsWith('|')) ??
    members.find((m) => !isObjectMember(m)) ??
    members[0];
  return { kind: 'reject', offender };
};

const memberLines = (body) => {
  // Fold output arrives normalized and bracket-joined — one member per
  // non-empty line.
  const members = foldNestedBlocks(body).split('\n').filter((l) => l !== '');
  // A member that still ends at its ':' has no type at all — a shape
  // that evaded the fold must reject here rather than ship an empty
  // annotation TypeScript error-recovers to `any`.
  for (const m of members) {
    if (m.endsWith(':')) throw noTypeError(m.slice(0, -1).trim());
  }
  return members;
};

// A declaration header with its trailing comment dropped. The header
// is one line, so a '#' outside a string literal opens trivia that
// runs to its end. Stripped HERE, at the one place the header is
// read, so no branch can emit it: the header text lands verbatim in
// the interface line and in a block alias's head, and '#' is not
// TypeScript.
const stripHeaderComment = (text) => {
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === '#') return text.slice(0, i).trimEnd();
  }
  return text;
};

// The first depth-0 '=' of an alias header line (a generic
// parameter default's '=' sits inside its angles). String-aware, like
// every other depth walk here: a bracket inside a string-literal type
// is TEXT, and counting it leaves the depth standing where the real
// '=' reads as nested — `type X<K extends "a(b"> = T` would report no
// '=' at all, and the caller slices the declaration against -1.
const aliasEq = (text) => {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if ('<([{'.includes(c)) depth++;
    else if ('>)]}'.includes(c) && text[i - 1] !== '=') depth--;
    else if (c === '=' && depth === 0 && text[i + 1] !== '>') return i;
  }
  return -1;
};

// A TYPE_DECL statement's raw text → the rendered TS declaration lines
// (no trailing newline; the caller owns layout). Throws TypeTextError
// on any body that does not classify.
export const renderTypeDecl = (rawText) => {
  const lines = [];
  let text = rawText;
  let exp = '';
  if (text.startsWith('export ')) {
    exp = 'export ';
    text = text.slice('export '.length);
  }
  const nl = text.indexOf('\n');
  const header = stripHeaderComment((nl === -1 ? text : text.slice(0, nl)).trimEnd());
  const body = nl === -1 ? null : text.slice(nl + 1);

  if (header.startsWith('interface')) {
    lines.push(`${exp}${header} {`);
    for (const m of memberLines(body ?? '')) lines.push(`  ${m};`);
    lines.push('}');
    return lines;
  }

  // The alias '=' is the ONE block opener — the top-level reading of a
  // member's bare ':'. A header carrying type text PAST the '=' has
  // already begun the type: what follows is that one expression
  // WRAPPED across lines — an open bracket holding the run together
  // (`= A & {` … `}`), or a trailing operator continuing it (`= A &`
  // … ) — and rejoins as a single-line alias. Only a header that ends
  // AT the '=' opens a block whose lines are members. Reading the
  // wrapped forms as members instead would classify them by their
  // CONTENT, so one shape rendered three ways: `= A &` over `| B`
  // joined as a union, over `b: B` silently braced into an object,
  // over `B &` rejected outright.
  const eq = aliasEq(header);
  // Every alias the lexer claims carries its '='; slicing against -1
  // would silently emit a truncated, doubled declaration instead.
  if (eq === -1) throw new TypeTextError(`a type alias needs '=' — '${header}' declares no type`);
  const headRhs = normalizeTypeText(header.slice(eq + 1));
  if (body === null || headRhs !== '') {
    const wrapped = body === null ? headRhs : normalizeTypeText(text.slice(eq + 1));
    // A member left without a type never reaches TypeScript as one.
    // The block-body remedy does NOT apply inside a wrap — that is the
    // whole point of the message — so it names the rule the wrap obeys
    // instead of pointing at a block that opens nothing.
    const untyped = untypedMemberColon(wrapped);
    if (untyped !== null) {
      throw new TypeTextError(
        `member '${untyped}' carries no type — write one after ':'; an indented block ` +
        'beneath it opens a type only in a brace-free block body',
      );
    }
    // A type EXPRESSION carries no depth-0 member colon: a property's
    // sits inside braces, a parameter's inside parens, and the one
    // bare colon type syntax has — a conditional's else — is spoken
    // for by its '?'. A colon left at depth 0 means the lines were
    // written as block members under a head that already carries a
    // type, and joining them would ship a face that does not parse.
    if (hasMemberColon(wrapped)) {
      throw new TypeTextError(body === null
        ? `a type alias takes a type after '=', and '${wrapped}' is a member — brace it as ` +
          `'{ ${wrapped} }'`
        : `the block under '${header}' opens only from the alias '=' — ` +
          'finish the type on this line, or brace the block');
    }
    lines.push(`${exp}${text.slice(0, eq).trimEnd()} = ${wrapped};`);
    return lines;
  }

  const members = memberLines(body);
  const head = header; // ends AT the alias '=' — the block opener

  // The body reads through the shared classifyMembers judgment: a
  // union joins its variants onto one line, an object braces one
  // member per line, a single wrapped type rejoins; anything else
  // rejects (never a space-join of unclassified lines).
  const c = classifyMembers(members);
  if (c.kind === 'union') {
    lines.push(`${exp}${head} ${c.arms.join(' | ')};`);
    return lines;
  }
  if (c.kind === 'object') {
    lines.push(`${exp}${head} {`);
    for (const m of members) lines.push(`  ${m};`);
    lines.push('};');
    return lines;
  }
  if (c.kind === 'single') {
    lines.push(`${exp}${head} ${members[0]};`);
    return lines;
  }
  throw new TypeTextError(
    `unrecognized member '${c.offender}' in the block body of ` +
    `'${head.replace(/\s*=$/, '')}' — a block alias body is a union (| variants), an ` +
    `object type (keyed properties, index/call signatures), or one wrapped type`,
  );
};

// ── parameter rendering (signatures) ─────────────────────────────────
// Renders a params array as fully-typed signature text — declaration
// files (every def/assign the dts declares) and TS-face overload
// signatures (def-sig statements). Binding patterns re-render from the
// tree with defaults DROPPED (a parameter initializer is illegal in
// ambient declarations, TS1039, and carries no meaning in an overload
// signature); optionality moves to the declared type instead.
const isTypedWrapper = (x) => isNode(x) && x[0] === 'typed-var' && x.length === 3;

export const renderPattern = (p) => {
  if (!isNode(p)) return p === null ? '' : String(p);
  if (p[0] === 'object') {
    const props = p.slice(1).map((pair) => {
      if (pair[0] === null) return renderPattern(pair[1]);
      if (pair[0] === ':') return `${pair[1]}: ${renderPattern(pair[2])}`;
      if (pair[0] === '=') return renderPattern(pair[1]);
      if (pair[0] === '...') return `...${renderPattern(pair[1])}`;
      throw new TypeTextError(`unsupported object-pattern member '${pair[0]}'`);
    });
    return `{${props.join(', ')}}`;
  }
  if (p[0] === 'array') return `[${p.slice(1).map(renderPattern).join(', ')}]`;
  if (p[0] === '=') return renderPattern(p[1]);
  if (p[0] === 'default') return renderPattern(p[1]);
  throw new TypeTextError(`unsupported pattern element '${p[0]}'`);
};

// The structural type an UNTYPED pattern declares: every leaf is an
// explicit `any`; a rest property widens to a string index of
// unknown (its keys are whatever the pattern did not name).
export const patternType = (p) => {
  if (!isNode(p)) return 'any';
  if (p[0] === 'object') {
    const props = p.slice(1).map((pair) => {
      if (pair[0] === null) return `${pair[1]}: any`;
      if (pair[0] === ':') return `${pair[1]}: ${patternType(pair[2])}`;
      if (pair[0] === '=') return `${pair[1]}?: any`;
      if (pair[0] === '...') return '[key: string]: unknown';
      return `${pair[1]}: any`;
    });
    return `{${props.join(', ')}}`;
  }
  if (p[0] === 'array') return `[${p.slice(1).map(patternType).join(', ')}]`;
  return 'any';
};

const renderTarget = (target, type, optional) => {
  const name = renderPattern(target);
  return `${name}${optional ? '?' : ''}: ${tidyType(type)}`;
};

// Is this parameter optional? The `?` is the side-band optionalMarker
// role (the grammar drops the token), so answering takes the stores —
// and BOTH signature emitters must answer it the same way.
//
// This is the single definition, and `renderParam` REQUIRES it. It used
// to be an optional argument defaulting to "not optional", which made
// correctness opt-in: `dts.js` once forgot to pass it and every optional
// param lost its `?` in the declarations; later the TS face's overload
// rows (`tsOverloadSigs`) forgot it too, and emitted `b: string` where
// the `.d.ts` said `b?: string`. Both outputs type-check in isolation,
// so tsc can never catch that class — only the two disagreeing can.
// A forgetful caller now throws instead of silently dropping the marker.
export const optionalReader = (stores) => (p) => {
  const id = stores.idOf(p);
  return id !== null && !!stores.role(id, 'optionalMarker');
};

export const renderParam = (p, isOptional) => {
  if (typeof isOptional !== 'function') {
    throw new TypeTextError(
      'renderParam: an optionality reader is required (use optionalReader(stores)) — ' +
      'omitting it silently drops every `?` marker, which type-checks and so cannot be caught downstream',
    );
  }
  const opt = isOptional(p);
  if (typeof p === 'string') return `${p}${opt ? '?' : ''}: any`;
  if (isTypedWrapper(p)) {
    // A bare optional param (`title?`) is a typed-var with no type —
    // default it to `any` (a declaration cannot carry an implicit any).
    const type = p[2] === '' || p[2] == null ? 'any' : p[2];
    return renderTarget(p[1], type, opt);
  }
  if (p[0] === 'default') {
    const inner = p[1];
    if (isTypedWrapper(inner)) return renderTarget(inner[1], inner[2], true);
    if (typeof inner === 'string') return `${inner}?: any`;
    return renderTarget(inner, patternType(inner), true);
  }
  if (p[0] === 'rest') {
    const inner = p[1];
    if (isTypedWrapper(inner)) {
      // A rest parameter's annotation is the WHOLE rest type —
      // `...args: number[]` types `args`, not its elements (the
      // TypeScript reading; there is no element-type spelling). A
      // non-array annotation therefore has no valid declaration
      // (TS2370) and rejects with the accepted shapes named rather
      // than shipping an invalid artifact or silently rewrapping
      // the user's type.
      if (!isArrayShapedType(inner[2])) {
        throw new TypeTextError(
          `a rest parameter's annotation types the whole rest ` +
          `array — '...${renderPattern(inner[1])}: ${tidyType(inner[2])}' needs an array ` +
          `type (T[], [T, U], Array<T>, ReadonlyArray<T>; a union qualifies only when ` +
          `every arm does)`,
        );
      }
      return `...${renderPattern(inner[1])}: ${tidyType(inner[2])}`;
    }
    return `...${renderPattern(inner)}: any[]`;
  }
  if (p[0] === 'expansion') {
    throw new TypeTextError("the '...' expansion parameter has no declaration form");
  }
  return renderTarget(p, patternType(p), opt);
};

// The indices JS ARITY makes optional: the TRAILING run of bare,
// unannotated names. In rip — as in JavaScript — calling with fewer
// arguments is legal and yields `undefined`, and `arguments.length`
// branching on it is idiomatic, so a parameter the author never annotated
// was never promised to be required.
//
// Trailing because TypeScript rejects a required parameter after an
// optional one, so the run has to reach the end. Scanning back, a default
// or a rest is passed OVER — both are already call-site optional, and
// stopping at one would leave `(a, opts = {})` demanding its first
// argument. An ANNOTATED parameter stops the scan: the author said
// something about it, and `x?` is theirs to write.
//
// One definition, both signature emitters — the face reads it through
// `emitParams`, the `.d.ts` through `renderParams` below. It is
// POSITIONAL, so it cannot ride `optionalReader`'s per-param shape, and
// letting each emitter work it out separately is precisely how the `?`
// marker has drifted before, in both directions.
export const jsArityOptional = (params) => {
  const out = new Set();
  for (let i = params.length - 1; i >= 0; i--) {
    const p = params[i];
    if (typeof p === 'string') { out.add(i); continue; }
    if (Array.isArray(p) && (p[0] === 'default' || p[0] === 'rest')) continue;
    break;
  }
  return out;
};

export const renderParams = (params, isOptional, firstType = null) => {
  const arity = jsArityOptional(params);
  // An injected FIRST-param type (the onError envelope, the event seam)
  // applies only to a bare untyped name — an annotated, defaulted, rest
  // or pattern param is the author's own shape and is never overridden.
  const inject = firstType !== null && typeof params[0] === 'string';
  return `(${params.map((p, i) => (inject && i === 0
    ? `${p}: ${firstType}`
    : renderParam(p, (q) => isOptional(q) || arity.has(i)))).join(', ')})`;
};

export const paramTyped = (p) =>
  isTypedWrapper(p) ||
  (isNode(p) && (p[0] === 'default' || p[0] === 'rest') && isTypedWrapper(p[1]));
