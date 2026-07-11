// The expr.js fixture with every semantic annotation replaced by a
// opt-out ('~ reason'). Opt-outs produce NO side-table entries, so this
// grammar proves that annotations never change generated tables or parser
// behavior. For generators with no
// annotation argument), tests strip the third-string args first.
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
      ['ID = Expression', '["=", 1, 3]', '~ plain fixture'],
    ],
    Expression: [
      ['Expression + Term', '["+", 1, 3]', '~ plain fixture'],
      ['Expression - Term', '["-", 1, 3]', '~ plain fixture'],
      ['Term'],
    ],
    Term: [
      ['Term * Factor', '["*", 1, 3]', '~ plain fixture'],
      ['Factor'],
    ],
    Factor: [
      ['NUMBER'],
      ['ID'],
      ['ID ( Args )', '[1, ...3]', '~ plain fixture'],
      ['( Expression )', 2],
    ],
    Args: [
      ['', '[]', '~ plain fixture'],
      ['ArgList'],
    ],
    ArgList: [
      ['Expression', '[1]', '~ plain fixture'],
      ['ArgList , Expression', '[...1, 3]', '~ plain fixture'],
    ],
  },
  operators: [
    ['left', '+', '-'],
    ['left', '*'],
  ],
};
