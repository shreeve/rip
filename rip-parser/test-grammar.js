// Simple test grammar for rip-parser
export default {
  tokens: 'NUMBER PLUS MINUS TIMES DIVIDE LPAREN RPAREN',

  operators: [
    ['left', 'PLUS', 'MINUS'],
    ['left', 'TIMES', 'DIVIDE']
  ],

  startSymbol: 'expression',

  grammar: {
    expression: [
      ['NUMBER', '$$ = Number($1)'],
      ['expression PLUS expression', '$$ = $1 + $3'],
      ['expression MINUS expression', '$$ = $1 - $3'],
      ['expression TIMES expression', '$$ = $1 * $3'],
      ['expression DIVIDE expression', '$$ = $1 / $3'],
      ['LPAREN expression RPAREN', '$$ = $2']
    ]
  }
}