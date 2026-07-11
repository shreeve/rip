// Position translation between LSP coordinates and MappingStore rows.
//
// Pure functions only — no protocol, no I/O — so the root test suite
// exercises the mapping logic without the extension's dependencies.
// Offsets are UTF-16 code units throughout, which is also
// LSP's default position encoding ('utf-16'), so a line/character pair
// converts to an offset with no unit change.
//
// Mapping policy:
//   - source → generated (hover requests): the innermost row containing
//     the source offset via bestAtSource; EXACT rows map the offset
//     linearly (emitted text corresponds verbatim), other kinds land at
//     the row's generated start.
//   - generated → source (diagnostics, hover ranges): bestAtGenerated;
//     exact rows map linearly, cover rows answer with the whole source
//     span. SYNTHETIC rows answer null — their generated text has no
//     corresponding source bytes (injected runtime/import lines), and a
//     diagnostic there must be dropped, never pinned to unrelated code.

// The implicit-any diagnostic family, suppressed AS A CLASS (the
// gradual-typing posture): the server compiles the TS FACE, so annotations
// flow through and annotated code never fires these — what remains of
// the family is UNANNOTATED Rip, which is legal and idiomatic, so the
// codes are noise there, not defects. noImplicitAny stays ON in the
// governing tsconfig because it is what activates TypeScript's
// evolving-`let` inference — an unannotated hoisted `let x; x = 42`
// reads as number at use sites, which is exactly what hover and the
// real error classes (TS2322/TS2339 etc.) need.
export const SUPPRESSED_TS_CODES = new Set([
  7005, // variable implicitly any
  7006, // parameter implicitly any
  7008, // member implicitly any
  7010, // function lacking return-type annotation
  7011, // function expression lacking return-type annotation
  7015, // element implicitly any (index expression)
  7019, // rest parameter implicitly any[]
  7022, // implicitly any from own-initializer reference
  7023, // implicitly any return type from self-reference
  7031, // binding element implicitly any
  7034, // variable implicitly any in some locations
  7043, // variable implicitly any — inferable suggestion
  7044, // parameter implicitly any — inferable suggestion
  7045, // member implicitly any — inferable suggestion
  7053, // element implicitly any (no index signature)
]);

// TypeScript classifies diagnostics for rendering — reportsUnnecessary
// (fade the span) and reportsDeprecated (strike it through) — and tsgo
// delivers them as LSP diagnostic tags when the client declares
// tagSupport in the PULL slot (textDocument.diagnostic.tagSupport —
// probed against the pinned tsgo; the push-slot declaration alone yields no
// tags on pulled items). Without the tag, VS Code renders these
// hint-severity items as a dotted underline that reads like a type
// error on legal Rip (the evolving-let acceptance fixture:
// `total = count + ratio` as an implicit return draws TS6133 on
// `total`). tsgo-supplied tags govern; these sets are the FALLBACK
// for any item tsgo leaves untagged, mirroring TypeScript's own
// reportsUnnecessary/reportsDeprecated classifications exactly (the
// translate.test.js pin cites the verification) — never a broader
// class. 6205 (all type parameters unused) is deliberately absent:
// TypeScript does not flag it, and tsgo delivers it untagged.
export const UNNECESSARY_TS_CODES = new Set([
  2695, // left side of comma operator is unused (error severity, still flagged)
  6133, // declared but its value is never read
  6138, // property declared but its value is never read
  6192, // all imports in import declaration are unused
  6196, // declared but never used
  6198, // all destructured elements are unused
  6199, // all variables are unused
  7027, // unreachable code detected
  7028, // unused label
]);

export const DEPRECATED_TS_CODES = new Set([
  6385, // '{0}' is deprecated
  6387, // the signature '{0}' of '{1}' is deprecated
]);

// LSP DiagnosticTag values: 1 = Unnecessary, 2 = Deprecated.
export function diagnosticTagsFor(code) {
  if (UNNECESSARY_TS_CODES.has(code)) return [1];
  if (DEPRECATED_TS_CODES.has(code)) return [2];
  return [];
}

// Line-start offsets of `text`: lineStarts[n] is the offset of line n
// (0-based). Same construction as SourceFile.lineStarts; duplicated here
// so this module stays importable in the staged extension, where the
// compiler lives at a different relative path.
export function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export function offsetToPosition(lineStarts, offset) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - lineStarts[lo] };
}

export function positionToOffset(lineStarts, textLength, { line, character }) {
  if (line < 0) return 0;
  if (line >= lineStarts.length) return textLength;
  const start = lineStarts[line];
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : textLength;
  return Math.min(start + Math.max(0, character), end);
}

// The PRECISE source→generated mapping shared by both query flavors:
// an EXACT row maps linearly; failing that, a cover row whose emission
// is VERBATIM from its start through the offset (an import clause is
// one cover row whose names correspond byte-for-byte until the
// re-quoted specifier) maps linearly too, verified against the actual
// texts. Null when neither answers.
function preciseSourceToGenerated(mappings, offset, source, code) {
  const direct = mappings.directAtSource(offset);
  if (direct && direct.mappingKind === 'exact') {
    const delta = Math.min(offset - direct.sourceStart, direct.generatedEnd - direct.generatedStart);
    return direct.generatedStart + delta;
  }
  if (source !== null && code !== null) {
    for (const r of mappings.atSource(offset)) {
      if (r.mappingKind !== 'cover') continue;
      const delta = offset - r.sourceStart;
      if (r.generatedStart + delta <= r.generatedEnd &&
          source.slice(r.sourceStart, offset) === code.slice(r.generatedStart, r.generatedStart + delta)) {
        return r.generatedStart + delta;
      }
    }
  }
  return null;
}

// Source offset → generated offset, or null when no row contains it.
// The LENIENT flavor (hover — informational): a position with no
// precise mapping still lands at its innermost cover row's generated
// start, so hovering a lowered construct's interior answers about the
// construct.
export function sourceOffsetToGenerated(mappings, offset, source = null, code = null) {
  const precise = preciseSourceToGenerated(mappings, offset, source, code);
  if (precise !== null) return precise;
  return mappings.bestAtSource(offset)?.generatedStart ?? null;
}

// The STRICT flavor (definition, references, rename — anything that
// identifies or MUTATES a symbol): only the precise mapping answers.
// A position with no verbatim generated twin — a comment, a keyword
// glyph, synthetic-only territory — answers null rather than landing
// a destructive request on whatever sits at a cover row's start.
export function sourceOffsetToGeneratedExact(mappings, offset, source = null, code = null) {
  return preciseSourceToGenerated(mappings, offset, source, code);
}

// The stale-hover alignment guard: an offset map between the CURRENT
// buffer text and the last-good compiled text. Serving stale hover is
// legitimate only where coordinates verifiably align — the common
// PREFIX and common SUFFIX of the two texts, where the offset delta is
// exact by construction. Offsets inside the changed middle region
// answer null (the server returns no hover rather than a wrong one).
// toGood maps current-buffer offsets into last-good coordinates for the
// request; toCurrent maps last-good offsets back for the response range.
//
// The comparison aligns UTF-16 CODE UNITS, not characters: a surrogate pair differing only in its low unit yields
// prefix = 1 — mid-character, but exact, since every offset in this
// pipeline is a code-unit offset.
//
// A span's EXCLUSIVE end at the prefix boundary (end === prefix) covers
// only aligned code units, so end-position mapping accepts it —
// `exclusiveEnd: true` is how range ends travel; plain positions at the
// boundary sit ON the first changed unit and stay null.
export function staleOffsetMap(currentText, goodText) {
  if (currentText === goodText) {
    const identity = (offset) => offset;
    return { toGood: identity, toCurrent: identity };
  }
  const minLen = Math.min(currentText.length, goodText.length);
  let prefix = 0;
  while (prefix < minLen && currentText[prefix] === goodText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    currentText[currentText.length - 1 - suffix] === goodText[goodText.length - 1 - suffix]
  ) suffix++;
  const delta = currentText.length - goodText.length;
  return {
    toGood(offset, { exclusiveEnd = false } = {}) {
      if (offset < prefix || (exclusiveEnd && offset === prefix)) return offset;
      if (offset >= currentText.length - suffix) return offset - delta;
      return null;
    },
    toCurrent(offset, { exclusiveEnd = false } = {}) {
      if (offset < prefix || (exclusiveEnd && offset === prefix)) return offset;
      if (offset >= goodText.length - suffix) return offset + delta;
      return null;
    },
  };
}

// Generated [start, end) span → source [start, end) span, or null when
// the position is unmapped or synthetic-only.
export function generatedSpanToSource(mappings, start, end = start) {
  const row = mappings.bestAtGenerated(start);
  if (!row || row.mappingKind === 'synthetic') return null;
  if (row.mappingKind === 'exact') {
    const s = row.sourceStart + (start - row.generatedStart);
    const e = end <= row.generatedEnd
      ? row.sourceStart + Math.max(end - row.generatedStart, start - row.generatedStart)
      : row.sourceEnd;
    return [s, Math.max(e, s)];
  }
  return [row.sourceStart, row.sourceEnd];
}

// A generated [start, end) span → the PRECISE source span it verbatim
// corresponds to, or null. Stricter than generatedSpanToSource: an
// EDIT must replace exactly the bytes the user sees, so a span with no
// exact row maps through a cover row only when the row's emission is
// verbatim from its start through the span's end (checked against the
// actual texts — an import statement whose face differs from source
// only in later bytes still maps its early names linearly). Anything
// unverifiable answers null; the caller refuses rather than guesses.
export function generatedEditSpanToSource(mappings, start, end, source, code) {
  const direct = mappings.directAtGenerated(start);
  if (direct && direct.mappingKind === 'exact' && end <= direct.generatedEnd) {
    const s = direct.sourceStart + (start - direct.generatedStart);
    return [s, s + (end - start)];
  }
  for (const row of mappings.atGenerated(start)) {
    if (row.mappingKind !== 'cover' || end > row.generatedEnd) continue;
    const len = end - row.generatedStart;
    if (source.slice(row.sourceStart, row.sourceStart + len) === code.slice(row.generatedStart, end)) {
      const s = row.sourceStart + (start - row.generatedStart);
      return [s, s + (end - start)];
    }
  }
  return null;
}

// A CURSOR position (completions, signature help) → generated offset.
// Cursors sit one past the construct they complete (`msg.sub|`), where
// the exclusive row end no longer contains them — so an offset that has
// no exact row of its own answers from the exact row ending exactly
// there, shifted past its generated end. Cover fallbacks are wrong for
// cursors (they land at a construct's generated START, misplacing the
// completion context), so anything else answers null.
export function sourceCursorToGenerated(mappings, offset) {
  const at = mappings.directAtSource(offset);
  if (at && at.mappingKind === 'exact') {
    return at.generatedStart + Math.min(offset - at.sourceStart, at.generatedEnd - at.generatedStart);
  }
  if (offset > 0) {
    const before = mappings.directAtSource(offset - 1);
    if (before && before.mappingKind === 'exact' && before.sourceEnd === offset) {
      return before.generatedStart + (before.generatedEnd - before.generatedStart);
    }
  }
  return null;
}

// A generated INSERTION point (a zero-width edit — auto-import lines,
// names merged into an existing import's braces) → source insertion
// offset, or null. Three tiers, all side-table driven:
//   1. Inside an exact row: linear (verbatim correspondence).
//   2. Inside a cover row whose bytes from its start UP TO the point
//      match the source verbatim: linear — verified against the actual
//      texts, so a point inside an import statement's braces lands
//      between the same names in the Rip spelling.
//   3. Between constructs (hoisting reorders, no row contains the
//      point): the earliest source offset of anything emitted AT OR
//      AFTER the point — everything already emitted stays before,
//      which is the order an import-line insertion needs. Trusted only
//      as a WHOLE-LINE insertion (both points at line starts); a
//      mid-line point with no verbatim anchor answers null rather than
//      landing somewhere plausible.
export function generatedInsertionToSource(mappings, offset, source, code) {
  const direct = mappings.directAtGenerated(offset);
  if (direct && direct.mappingKind === 'exact') {
    return direct.sourceStart + (offset - direct.generatedStart);
  }
  for (const row of mappings.atGenerated(offset)) {
    if (row.mappingKind !== 'cover') continue;
    const delta = offset - row.generatedStart;
    // delta 0 verifies ZERO bytes — a vacuous match that anchors to
    // whatever structural row (program body/$self) happens to START at
    // the point. Tier 1 declare-in-place puts the body row's start
    // exactly at post-import line starts, so the guard matters: no
    // verified bytes → fall through to tier 3's whole-line rule.
    if (delta === 0) continue;
    if (source.slice(row.sourceStart, row.sourceStart + delta) === code.slice(row.generatedStart, offset)) {
      return row.sourceStart + delta;
    }
  }
  let earliest = null;
  for (const r of mappings.rows) {
    if (r.mappingKind !== 'exact' || r.generatedStart < offset) continue;
    if (earliest === null || r.sourceStart < earliest) earliest = r.sourceStart;
  }
  if (earliest === null) return null;
  const atCodeLineStart = offset === 0 || code[offset - 1] === '\n';
  const atSourceLineStart = earliest === 0 || source[earliest - 1] === '\n';
  return atCodeLineStart && atSourceLineStart ? earliest : null;
}

// The whole-import-line edit mapper: the organizeImports
// family rewrites COMPLETE face import lines, and those spans never
// verify verbatim — the face re-quotes specifiers and appends `;` — so
// the byte-for-byte seam refuses them. This mapper accepts exactly the
// statement-granular shape instead, structurally:
//   - the generated range is whole lines, and every line in it is ONE
//     import/export statement's single-line emission (the statement's
//     $self row from the side table, its node kind from the stores —
//     never a scan of generated text; the only text reads are
//     verifications) with nothing after it but the `;` glyph;
//   - the statements' SOURCE lines are whole lines too (a trailing
//     comment refuses — an edit must never delete bytes tsgo never
//     saw) and contiguous up to whitespace-only gap lines (a comment
//     line inside the block refuses likewise);
//   - the replacement text substitutes SOURCE bytes line-for-line
//     where a newText line byte-equals a face import line (a pure
//     reorder/deletion preserves the user's own spelling — quotes and
//     all); lines with no face twin (a NARROWED clause, a COMBINED
//     import) fall back to ripImportText with the module specifier
//     RE-QUOTED to the user's own style — the specifier is
//     semantically untouched by a clause rewrite, so its bytes must
//     not change. The user's style comes from the FIRST source
//     import/export statement (source order) naming that module,
//     FILE-WIDE — the deterministic rule, whatever
//     produced the rewritten line; a specifier with no source
//     statement to read the style from refuses the whole edit. The
//     rewritten CLAUSE itself takes the face's spelling (brace
//     spacing) — that region IS the semantic change.
// Anything outside that shape answers null; the caller drops the
// action, never applies an unverifiable edit.
export function wholeImportLinesEdit(face, start, end, newText) {
  const { mappings, stores, source, code } = face;
  if (!stores) return null;
  const atLineStart = (text, off) => off === 0 || text[off - 1] === '\n';
  if (!atLineStart(code, start) || !(atLineStart(code, end) || end === code.length)) return null;

  // Every import/export statement the face emits on a single line:
  // generated line span (statement + `;` + newline) and source span.
  const lines = [];
  for (const kind of ['import', 'export']) {
    for (const node of stores.nodesByKind(kind)) {
      for (const r of mappings.rows) {
        if (r.nodeId !== node.nodeId || r.role !== '$self') continue;
        if (!atLineStart(code, r.generatedStart)) continue;
        const nl = code.indexOf('\n', r.generatedEnd);
        const genLineEnd = nl < 0 ? code.length : nl;
        if (!/^;?$/.test(code.slice(r.generatedEnd, genLineEnd))) continue;
        lines.push({ row: r, genStart: r.generatedStart, genEnd: nl < 0 ? code.length : nl + 1 });
      }
    }
  }
  lines.sort((a, b) => a.genStart - b.genStart);

  // The edit range must be EXACTLY a run of those lines, butted.
  const inRange = lines.filter((l) => l.genStart >= start && l.genEnd <= end);
  let cursor = start;
  for (const l of inRange) {
    if (l.genStart !== cursor) return null;
    cursor = l.genEnd;
  }
  if (cursor !== end || inRange.length === 0) return null;

  // Source side: each statement fills its line(s) — leading and
  // trailing residue is whitespace only — and consecutive statements
  // are contiguous up to whitespace-only gap lines.
  const srcLineStartOf = (off) => source.lastIndexOf('\n', off - 1) + 1;
  const srcLineEndOf = (off) => {
    const nl = source.indexOf('\n', off);
    return nl < 0 ? source.length : nl + 1;
  };
  let srcStart = null;
  let srcCursor = null;
  for (const l of inRange) {
    const s = srcLineStartOf(l.row.sourceStart);
    const e = srcLineEndOf(l.row.sourceEnd);
    if (/\S/.test(source.slice(s, l.row.sourceStart)) || /\S/.test(source.slice(l.row.sourceEnd, e))) return null;
    if (srcStart === null) {
      srcStart = s;
    } else if (s < srcCursor || /\S/.test(source.slice(srcCursor, s))) {
      return null;
    }
    srcCursor = e;
  }

  // The user's quote style per module specifier: the FIRST source
  // import/export statement (source order) naming that module. Rip
  // specifiers are '- or "-quoted only (backticks reject at the
  // lexer), and an import statement contains exactly one string.
  const specifierIn = (text) => /(['"])([^'"]+)\1/.exec(text);
  const quoteStyle = new Map();
  for (const l of [...lines].sort((a, b) => a.row.sourceStart - b.row.sourceStart)) {
    const m = specifierIn(source.slice(l.row.sourceStart, l.row.sourceEnd));
    if (m && !quoteStyle.has(m[2])) quoteStyle.set(m[2], m[1]);
  }

  // newText translation: face import lines become their statements'
  // SOURCE lines; anything else becomes idiomatic Rip with the
  // specifier re-quoted to the user's style. Null refuses the edit.
  const sourceLineFor = (textLine) => {
    for (const l of lines) {
      if (code.slice(l.genStart, l.genEnd).replace(/\n$/, '') !== textLine) continue;
      return source.slice(srcLineStartOf(l.row.sourceStart), srcLineEndOf(l.row.sourceEnd)).replace(/\n$/, '');
    }
    const line = ripImportText(textLine);
    const m = specifierIn(line);
    if (!m) return line; // no specifier (`export { total }`) — nothing to re-quote
    const userQuote = quoteStyle.get(m[2]);
    if (!userQuote) return null; // no source statement carries this module's style
    if (userQuote === m[1]) return line;
    return line.slice(0, m.index) + userQuote + m[2] + userQuote + line.slice(m.index + m[0].length);
  };
  const trailingNewline = newText.endsWith('\n');
  const parts = (trailingNewline ? newText.slice(0, -1) : newText).split('\n');
  const translatedParts = parts.map(sourceLineFor);
  if (newText !== '' && translatedParts.includes(null)) return null;
  const translated = newText === '' ? '' :
    translatedParts.join('\n') + (trailingNewline ? '\n' : '');

  return { span: [srcStart, srcCursor], newText: translated };
}

// The file-level directive spelling: `# @ts-nocheck` rows must stay
// the file's FIRST line (the push direction), while attached
// `# @ts-expect-error` / `# @ts-ignore` rows must stay ADJACENT to
// their governed line (the hoist direction). The row itself does not
// carry the kind; its recorded SOURCE span does — read at the exact
// span, never scanned. Generated offset cannot discriminate: a
// hoist-free file puts an ATTACHED directive's row at generated
// offset 0 too, and tsgo (probed) anchors its import
// insertion AFTER a leading comment line — between the pair — so an
// offset test would exempt exactly the case that splits.
export function isNocheckDirectiveRow(row, source) {
  return /^#[ \t]*@ts-nocheck(?=\s|$)/.test(source.slice(row.sourceStart, row.sourceEnd));
}

// A whole-line insertion anchored DIRECTLY beneath a placed NEXT-LINE
// directive (`# @ts-expect-error` / `# @ts-ignore` above the statement
// they govern) would split the directive from that statement — TS2578
// and the suppressed error both resurface, visibly. The anchor hoists
// ABOVE the directive line, so the pair shifts down together. The
// opposite of the file-level `# @ts-nocheck` push: nocheck rows
// are excluded by SPELLING (isNocheckDirectiveRow — nocheck must stay
// first, never hoisted above), an attached directive must stay
// ADJACENT wherever its row landed in the face. Stacked directive
// lines hoist one at a time. Only line-start anchors qualify — a
// mid-line insertion cannot sit beneath a directive line.
export function insertionAboveAttachedDirectives(mappings, at, source) {
  for (;;) {
    if (at !== 0 && source[at - 1] !== '\n') return at;
    const above = mappings.rows.find((r) => {
      if (r.role !== 'tsDirective' || isNocheckDirectiveRow(r, source)) return false;
      if (r.sourceEnd >= at) return false;
      const between = source.slice(r.sourceEnd, at);
      // Attached means the directive's own line ends exactly at the
      // anchor: trailing whitespace, ONE newline, nothing else.
      return between.endsWith('\n') && between.indexOf('\n') === between.length - 1 && !/\S/.test(between);
    });
    if (!above) return at;
    at = source.lastIndexOf('\n', above.sourceStart - 1) + 1;
  }
}

// A generated CURSOR position → source offset: the reverse of
// sourceCursorToGenerated, for results that are anchors rather than
// spans (inlay-hint positions). Inside an exact row it maps linearly;
// one past an exact row's end (a type hint sits right after the name
// it annotates — `let k‸`) it maps one past the row's source end.
// Cover rows answer only where the emission is verbatim from the row
// start through the position. Anything else — synthetic bytes,
// generated-only scaffolding — answers null and the result drops.
export function generatedCursorToSource(mappings, offset, source, code) {
  const direct = mappings.directAtGenerated(offset);
  if (direct && direct.mappingKind === 'exact') {
    return direct.sourceStart + (offset - direct.generatedStart);
  }
  if (offset > 0) {
    const before = mappings.directAtGenerated(offset - 1);
    if (before && before.mappingKind === 'exact' && before.generatedEnd === offset) {
      return before.sourceEnd;
    }
  }
  for (const row of mappings.atGenerated(offset)) {
    if (row.mappingKind !== 'cover') continue;
    const delta = offset - row.generatedStart;
    if (source.slice(row.sourceStart, row.sourceStart + delta) === code.slice(row.generatedStart, offset)) {
      return row.sourceStart + delta;
    }
  }
  return null;
}

// Exact-row lookup for ASCENDING generated-span queries (semantic
// tokens arrive in generated order). Any exact row containing the whole
// span maps it linearly — exact rows correspond verbatim, so nested
// candidates agree. One sweep over the sorted rows with a small active
// set, instead of a per-token scan of every row.
export function exactSpanMapper(mappings) {
  const rows = mappings.rows
    .filter((r) => r.mappingKind === 'exact' && r.generatedEnd > r.generatedStart)
    .sort((a, b) => a.generatedStart - b.generatedStart);
  let next = 0;
  const active = [];
  return (start, end) => {
    while (next < rows.length && rows[next].generatedStart <= start) active.push(rows[next++]);
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].generatedEnd <= start) active.splice(i, 1);
    }
    for (const row of active) {
      if (end <= row.generatedEnd) return row.sourceStart + (start - row.generatedStart);
    }
    return null;
  };
}

// Compiler-owned spellings that must never surface as completion items:
// the `__`-prefixed runtime namespace (inlined runtime exports and
// their internals) and the `_ref` temp family (hoisted chain-comparison
// caches). Both namespaces are the compiler's by construction — temps
// dodge every user identifier, and the runtime ships under `__`.
export function isScaffoldingLabel(label) {
  return /^__/.test(label) || /^_ref\d*$/.test(label);
}

// TS-face spellings scrubbed from user-visible STRINGS (labels,
// details, documentation — never positions): the definite-assignment
// `!` the face puts on bare typed forwards (`let y!: number` is a face
// artifact; the Rip declaration has no `!`), and mirror-file import
// specifiers (`./util.rip.ts` resolves between mirrors; the Rip
// spelling is `./util.rip`).
export function scrubFaceArtifacts(text) {
  return text
    .replace(/([A-Za-z_$][\w$]*)!:/g, '$1:')
    .replace(/\.rip\.ts(?=["'`])/g, '.rip');
}

// Inserted-import text made idiomatic Rip: statement semicolons drop
// (Rip parses them, but no Rip author writes them) and mirror-path
// specifiers lose their face extension.
export function ripImportText(newText) {
  return newText
    .replace(/\.rip\.ts(?=["'`])/g, '.rip')
    .replace(/^(\s*(?:import|export)\b[^\n]*?);([ \t]*)$/gm, '$1$2');
}
