// The code mask behind the mapping census's population — extracted so it can be
// exercised directly: `runner.js` is a script that runs the audit on import, so
// nothing there is reachable from a test, and this function now decides which
// bytes count as reads for a gated contract invariant.

// Whole-source code mask for the occurrence scan: blank STRING-LITERAL bytes
// but KEEP `#{…}` interpolation expressions (a read inside an interpolation is
// real code), track string state ACROSS lines (a multi-line template's body
// stays blanked), and cut comments — all offset-preserving. Unlike the per-line
// `codeOf`, which cannot see a multi-line string and blanks interpolations
// wholesale. Single-quoted strings do not interpolate, so `#{` inside one is
// literal. Interpolation depth is tracked per string on a stack, so nested
// strings/braces inside `#{…}` resolve correctly.
//
// REGEX literals blank on the same rule, and for the same reason a string does:
// their bytes are content, not reads. `/^[A-Z]{2}-\d+$/` spells no identifier —
// `A`, `Z` and the `\d` escape's `d` are pattern syntax, and counting them asks
// the compiler for a span that cannot exist. Both spellings cut: the plain
// `/…/flags` form, and the heregex `///…///flags`, whose body additionally
// carries `#` comments and `#{…}` interpolation — the interpolation stays LIVE,
// exactly as inside a template string.
//
// A leading `/` is a regex only in VALUE position; after a value it is division.
// `lastCode` is the last significant code byte seen, and the test is the
// standard one — an identifier, digit, `)` or `]` before it means divide.
//
// The last byte alone is not enough, because a KEYWORD ends in one: after
// `return` or `yield` the preceding byte is a letter, so the byte test calls it
// division and leaves the pattern unmasked — `return /^[A-Z]+$/` would then
// contribute `A` and `Z` to a population of reads that can never own a row.
// `lastWord` carries the identifier run so a keyword can say VALUE position.
// The run ENDS where the source's does, which `lastCode` cannot say: it skips
// whitespace by design (the divides-after test wants the last significant
// byte), so continuing the run on it welds `ok` and `not` into one word and no
// keyword is ever recognized past the first one on a line. The preceding SOURCE
// byte is what bounds a run, and it is in hand at every position.
const REGEX_DIVIDES_AFTER = /[\w$)\]]/;
const REGEX_FOLLOWS_WORD = new Set([
  'return', 'yield', 'await', 'typeof', 'instanceof', 'delete', 'void', 'new',
  'in', 'of', 'case', 'do', 'else', 'then', 'when', 'and', 'or', 'not', 'is',
  'isnt', 'if', 'unless', 'while', 'until', 'by', 'throw',
]);
export function codeMask(src) {
  const out = [];
  const stack = [];   // string contexts: { delim, interp, brace } — brace>0 ⇒ inside its #{…}
  let lastCode = '';  // last non-space code byte emitted, for the regex/division test
  let lastWord = '';  // the identifier run ending at it, '' when that byte is not one
  // A keyword SPELLING is not a keyword after a dot: `total.of` is a
  // property read — a value — so a following `/` is division. Without
  // this bit, `share = total.of / parts / 2` blanks `/ parts /` as a
  // regex and `parts` vanishes from every population built on the mask
  // (over-blanking, the dangerous direction).
  let lastWordDotted = false;
  // Blank [from, to) wholesale, keeping newlines so line numbers survive.
  const blank = (from, to) => { for (let k = from; k < to; k++) out.push(src[k] === '\n' ? '\n' : ' '); };
  // Copy a `#{…}` interpolation body verbatim from `at` (the `#`), blanking only
  // its delimiters; returns the index just past the closing brace.
  const keepInterp = (at) => {
    out.push(' ', ' ');
    let k = at + 2, depth = 1;
    for (; k < src.length && depth > 0; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) { out.push(' '); break; }
      out.push(src[k]);
    }
    return k + 1;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top && top.brace === 0) {                              // inside a string LITERAL
      if (c === '\\') { out.push(' '); if (i + 1 < src.length) { out.push(' '); i++; } continue; }
      if (src.startsWith(top.delim, i)) { stack.pop(); out.push(top.delim); i += top.delim.length - 1; continue; }
      if (top.interp && c === '#' && src[i + 1] === '{') { top.brace = 1; out.push(' ', ' '); i++; continue; }
      out.push(c === '\n' ? '\n' : ' ');                       // literal content — blank, keep newlines
      continue;
    }
    if (top && top.brace > 0) {                                // interpolation code — track its braces
      if (c === '{') { top.brace++; out.push(c); continue; }
      if (c === '}') { top.brace--; out.push(top.brace === 0 ? ' ' : c); continue; }
    }
    if (!stack.length && c === '#' && src[i + 1] !== '{') {    // comment (top-level only)
      while (i < src.length && src[i] !== '\n') { out.push(' '); i++; }
      i--; continue;                                           // leave the newline for the loop
    }
    if (!stack.length && c === '/' && src.startsWith('///', i)) {   // heregex
      blank(i, i + 3);
      let k = i + 3;
      while (k < src.length && !src.startsWith('///', k)) {
        if (src[k] === '\\') { blank(k, Math.min(k + 2, src.length)); k += 2; continue; }
        if (src[k] === '#' && src[k + 1] === '{') { k = keepInterp(k); continue; }
        out.push(src[k] === '\n' ? '\n' : ' ');
        k++;
      }
      if (src.startsWith('///', k)) { blank(k, k + 3); k += 3; }
      while (k < src.length && /[a-z]/.test(src[k])) { out.push(' '); k++; }   // flags
      i = k - 1; lastCode = '/'; lastWord = ''; continue;
    }
    if (!stack.length && c === '/' &&
        (!REGEX_DIVIDES_AFTER.test(lastCode) || (REGEX_FOLLOWS_WORD.has(lastWord) && !lastWordDotted))) {
      // Commit only if a close on the SAME line exists — otherwise this `/` is
      // division (or a stray) and the bytes after it stay code.
      let k = i + 1, inClass = false, end = -1;
      for (; k < src.length && src[k] !== '\n'; k++) {
        if (src[k] === '\\') { k++; continue; }
        if (src[k] === '[') inClass = true;
        else if (src[k] === ']') inClass = false;
        else if (src[k] === '/' && !inClass) { end = k; break; }
      }
      if (end !== -1) {
        blank(i, end + 1);
        k = end + 1;
        while (k < src.length && /[a-z]/.test(src[k])) { out.push(' '); k++; }  // flags
        i = k - 1; lastCode = '/'; lastWord = ''; continue;
      }
    }
    if (c === "'" || c === '"' || c === '`') {
      // A heredoc's delimiter is the whole run of three. Read as `''` plus a
      // `'`, its body would end at the first apostrophe the prose contains.
      const delim = (c !== '`' && src.startsWith(c.repeat(3), i)) ? c.repeat(3) : c;
      stack.push({ delim, interp: c !== "'", brace: 0 });
      out.push(delim);
      i += delim.length - 1;
      lastCode = c;
      continue;
    }
    out.push(c);
    if (/[\w$]/.test(c)) {
      const continues = /[\w$]/.test(src[i - 1] ?? '');
      if (!continues) lastWordDotted = src[i - 1] === '.';
      lastWord = continues ? lastWord + c : c;
    } else if (!/\s/.test(c)) lastWord = '';
    if (!/\s/.test(c)) lastCode = c;
  }
  return out.join('');
}
