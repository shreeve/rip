// Shared type-text machinery for the two type-rendering consumers:
// declaration emission (src/dts.js, the canonical pipeline) and the
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
      while (i < raw.length && raw[i] !== '\n') i++;
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

// ── type/interface declaration rendering ─────────────────────────────
// The TYPE_DECL text is the raw source of the whole statement
// (the opaque collapse), structured here: header, generic
// parameters, extends clause, and body members — Rip's indented
// bodies become TS braces. Members joining respects bracket/angle
// balance so a generic wrapped across body lines stays one member.

// Nested anonymous type blocks : a
// member whose type is the bare keyword `type` opens an indented
// sub-block of members — folded here into an inline object type
// (`data: type` + children → `data: { items: string[]; total: number }`),
// recursively, BEFORE memberLines discards indentation. Lines that
// don't end in `: type` pass through untouched.
const foldAnonBlocks = (body) => {
  const lines = body.split('\n');
  const indentOf = (l) => /^[ \t]*/.exec(l)[0].length;
  const foldFrom = (i0) => {
    const line = lines[i0];
    const m = /^([ \t]*)(.+?):[ \t]*type[ \t]*$/.exec(line);
    if (m === null) return { text: line, next: i0 + 1 };
    const ind = indentOf(line);
    const parts = [];
    let j = i0 + 1;
    while (j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > ind)) {
      if (lines[j].trim() === '') { j++; continue; }
      const r = foldFrom(j);
      parts.push(r.text.trim());
      j = r.next;
    }
    return { text: `${m[1]}${m[2]}: { ${parts.join('; ')} }`, next: j };
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

const memberLines = (body) => {
  const members = [];
  let depth = 0;
  for (const rawLine of foldAnonBlocks(body).split('\n')) {
    const line = normalizeTypeText(rawLine);
    if (line === '') continue;
    if (depth > 0 && members.length > 0) members[members.length - 1] += ` ${line}`;
    else members.push(line);
    const current = members[members.length - 1];
    depth = 0;
    let inStr = null;
    for (let i = 0; i < current.length; i++) {
      const c = current[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === inStr) inStr = null;
      } else if (c === '"' || c === "'") inStr = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === '<') depth++;
      else if (c === '>' && current[i - 1] !== '=') depth--;
    }
  }
  return members;
};

// The first depth-0 '=' of an alias header line (a generic
// parameter default's '=' sits inside its angles).
const aliasEq = (text) => {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('<([{'.includes(c)) depth++;
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
  const header = (nl === -1 ? text : text.slice(0, nl)).trimEnd();
  const body = nl === -1 ? null : text.slice(nl + 1);

  if (header.startsWith('interface')) {
    lines.push(`${exp}${header} {`);
    for (const m of memberLines(body ?? '')) lines.push(`  ${m};`);
    lines.push('}');
    return lines;
  }

  if (body === null) {
    const eq = aliasEq(header);
    lines.push(`${exp}${header.slice(0, eq).trimEnd()} = ${normalizeTypeText(header.slice(eq + 1))};`);
    return lines;
  }

  const members = memberLines(body);
  const head = header.trimEnd(); // ends with the alias '='

  // A block alias body is one of exactly four shapes; anything else
  // rejects (never a space-join of unclassified lines):
  //   UNION      — every member after the first starts with `|`; the
  //                first is `|`-prefixed too, or a plain leading
  //                variant. Variants join onto one line.
  //   OBJECT     — every member is a recognized OBJECT MEMBER (the
  //                grammar above); the body braces, one member per
  //                line.
  //   SINGLE     — exactly one member that is no object member AND
  //                carries no member colon: a type wrapped across
  //                body lines, rejoined. A lone line that LOOKS
  //                member-shaped but failed the grammar rejects —
  //                SINGLE is for types, never for failed members.
  //   (rejected) — everything else.
  const union =
    members.length > 0 &&
    members.slice(1).every((m) => m.startsWith('|')) &&
    (members[0].startsWith('|') || (members.length > 1 && !isObjectMember(members[0])));
  if (union) {
    lines.push(`${exp}${head} ${members.map((m) => m.replace(/^\|\s*/, '')).join(' | ')};`);
    return lines;
  }
  if (members.length > 0 && members.every(isObjectMember)) {
    lines.push(`${exp}${head} {`);
    for (const m of members) lines.push(`  ${m};`);
    lines.push('};');
    return lines;
  }
  if (members.length === 1 && !hasMemberColon(members[0])) {
    lines.push(`${exp}${head} ${members[0]};`);
    return lines;
  }
  // The offender is the first line that breaks the dominant reading:
  // a non-member, non-variant line when one exists; otherwise the
  // variant/member mixed into the other kind's body.
  const offender =
    members.find((m) => !isObjectMember(m) && !m.startsWith('|')) ??
    members.find((m) => !isObjectMember(m)) ??
    members[0];
  throw new TypeTextError(
    `unrecognized member '${offender}' in the block body of ` +
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

export const renderParams = (params, isOptional) => `(${params.map((p) => renderParam(p, isOptional)).join(', ')})`;

export const paramTyped = (p) =>
  isTypedWrapper(p) ||
  (isNode(p) && (p[0] === 'default' || p[0] === 'rest') && isTypedWrapper(p[1]));
