// Shared fixtures for the grammar generator tests.

// Annotated fixture grammar: assignment, binary operators, calls.
// Exercises every annotation shape: literal tag + refs, spread refs,
// pass-through rules, and an empty production.
export const exprGrammar = {
  start: 'Root',
  grammar: {
    Root: [
      ['Line'],
    ],
    Line: [
      ['Assign'],
      ['Expression'],
    ],
    Assign: [
      ['ID = Expression', '["=", 1, 3]', 'assign: operator, target, value'],
    ],
    Expression: [
      ['Expression + Term', '["+", 1, 3]', 'binary: operator, left, right'],
      ['Expression - Term', '["-", 1, 3]', 'binary: operator, left, right'],
      ['Term'],
    ],
    Term: [
      ['Term * Factor', '["*", 1, 3]', 'binary: operator, left, right'],
      ['Factor'],
    ],
    Factor: [
      ['NUMBER'],
      ['ID'],
      ['ID ( Args )', '[1, ...3]', 'call: callee, ...args'],
      ['( Expression )', 2],
    ],
    Args: [
      ['', '[]', '~ empty argument list; call args role owns the span'],
      ['ArgList'],
    ],
    ArgList: [
      ['Expression', '[1]', '~ argument-list plumbing; call args role owns the span'],
      ['ArgList , Expression', '[...1, 3]', '~ argument-list plumbing; call args role owns the span'],
    ],
  },
  operators: [
    ['left', '+', '-'],
    ['left', '*'],
  ],
};

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
