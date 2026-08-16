// The identifier vocabulary — one definition, for the whole repository.
//
// What counts as an identifier character is a fact about Rip's surface
// syntax, and six other modules need it: the emitter (scaffold names),
// the type-text renderer, `rip check`, the REPL, the sites monitor, and
// the audit's masking. It lived in lexer.js because the scanner is its
// first consumer, which made every one of those an import from a
// 3,900-line module for thirty lines of regex.
//
// A leaf with no imports, so nothing that needs a name test has to
// depend on the lexer to get one. IDENT_START / IDENT_PART are exported
// for the scanner itself, which walks characters rather than calling
// these helpers.

// Identifier characters ([$\w\x7f-\uffff]):
// Unicode BMP letters and astral surrogate pairs are identifier text.
export const IDENT_START = /[$A-Za-z_\x7f-\uffff]/;
export const IDENT_PART = /[$\w\x7f-\uffff]/;

// Is a whole string an identifier? For compiler passes that must
// distinguish identifier atoms from literal spellings.
export function isIdentifierName(value) {
  if (typeof value !== 'string' || value.length === 0 || !IDENT_START.test(value[0])) return false;
  for (let i = 1; i < value.length; i++) {
    if (!IDENT_PART.test(value[i])) return false;
  }
  return true;
}

// Every identifier-shaped run in a text — built from the SAME
// IDENT_START/IDENT_PART classes (one identifier vocabulary in the
// repository), for consumers that mint scaffold names against
// everything a source spells. String.match with /g resets lastIndex
// itself, so the shared regex stays stateless across calls.
const IDENT_RUN_RE = new RegExp(`${IDENT_START.source}${IDENT_PART.source}*`, 'g');
export function identifierRuns(text) {
  return text.match(IDENT_RUN_RE) ?? [];
}
export function identifierRunAt(text, start) {
  if (typeof text !== 'string' || !Number.isInteger(start) || start < 0 || start >= text.length) return null;
  if (!IDENT_START.test(text[start])) return null;
  let end = start + 1;
  while (end < text.length && IDENT_PART.test(text[end])) end++;
  return { value: text.slice(start, end), start, end };
}
