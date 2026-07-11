// Minimal offset-based lexer for fixture grammars. Implements the lexer
// protocol the generated parser expects: setInput(input), lex() → token
// name (falsy at EOF), with .text and .loc = {start, end} exposed after
// each lex(). Offsets are UTF-16 code units.
const RULES = [
  [/^\d+/, 'NUMBER'],
  [/^[A-Za-z_]\w*/, 'ID'],
  [/^\(/, '('],
  [/^\)/, ')'],
  [/^\+/, '+'],
  [/^-/, '-'],
  [/^\*/, '*'],
  [/^=/, '='],
  [/^,/, ','],
];

export function makeLexer() {
  return {
    setInput(input) {
      this.input = input;
      this.pos = 0;
      this.text = '';
      this.loc = null;
    },
    lex() {
      while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) this.pos++;
      if (this.pos >= this.input.length) return null;
      const rest = this.input.slice(this.pos);
      for (const [re, tag] of RULES) {
        const m = rest.match(re);
        if (m) {
          const start = this.pos;
          this.pos += m[0].length;
          this.text = m[0];
          this.loc = { start, end: this.pos };
          return tag;
        }
      }
      throw new Error(`fixture lexer: cannot tokenize at offset ${this.pos}: '${rest[0]}'`);
    },
  };
}
