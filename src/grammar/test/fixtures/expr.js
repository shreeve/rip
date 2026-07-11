// Annotated fixture grammar: assignment, binary operators, calls.
// Exercises every annotation shape: literal tag + refs, spread refs,
// pass-through rules, and an empty production.
export default {
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
