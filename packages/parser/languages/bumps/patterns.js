// Simple pattern string parser for MUMPS pattern atoms
// Supports:
// - counts: n or n.m preceding a unit
// - units: class letters (A,N,U,L,P,...), quoted strings "...", and parenthesized groups (...)
// - sequences: concatenation of atoms; groups can contain commas which are treated as separators between atoms
// Returns a structured AST describing the pattern

function parsePattern(input) {
  const s = String(input || '');
  let i = 0;

  function eof() { return i >= s.length; }
  function peek() { return s[i]; }
  function next() { return s[i++]; }
  function isDigit(ch) { return ch >= '0' && ch <= '9'; }
  function readNumber() {
    let start = i;
    while (!eof() && isDigit(peek())) i++;
    return Number(s.slice(start, i));
  }
  function readString() {
    // Assumes current char is '"'
    let value = '';
    next(); // skip opening quote
    while (!eof()) {
      const ch = next();
      if (ch === '"') break;
      if (ch === '\\' && !eof()) {
        value += next();
      } else {
        value += ch;
      }
    }
    return value;
  }

  function parseCount() {
    if (!isDigit(peek())) return null;
    const min = readNumber();
    if (peek() === '.') {
      next();
      const max = readNumber();
      return { min, max };
    }
    return { min, max: min };
  }

  function applyCount(node, count) {
    if (!count) return node;
    return { ...node, min: count.min, max: count.max };
  }

  function parseAtom() {
    const count = parseCount();
    if (eof()) return null;
    const ch = peek();
    if (ch === '"') {
      const str = readString();
      return applyCount({ type: 'String', value: str }, count);
    }
    if (ch === '(') {
      next(); // '('
      const items = [];
      while (!eof() && peek() !== ')') {
        // allow commas inside groups as separators
        if (peek() === ',') { next(); continue; }
        const a = parseAtom();
        if (a) items.push(a); else break;
      }
      if (peek() === ')') next();
      return applyCount({ type: 'Group', items }, count);
    }
    // Class letter (single char)
    if (/^[A-Za-z]$/.test(ch)) {
      next();
      return applyCount({ type: 'Class', name: ch.toUpperCase() }, count);
    }
    // Fallback: treat as literal char
    next();
    return applyCount({ type: 'Char', value: ch }, count);
  }

  function parseSeq(endChar) {
    const items = [];
    while (!eof() && peek() !== endChar) {
      const atom = parseAtom();
      if (atom) items.push(atom); else break;
    }
    return { type: 'PatternSeq', items };
  }

  return parseSeq(undefined);
}

module.exports = { parsePattern };
