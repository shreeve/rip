#!/usr/bin/env coffee

# Test state minimization functionality
{ Generator } = require('./rip-parser')

# Test grammar with redundant states (proper format)
testGrammar = {
  grammar: {
    'S': [
      ['A B', '-> $1 + $2'],
      ['A C', '-> $1 + $2']
    ],
    'A': [
      ['a', '-> $1'],
      ['a x', '-> $1 + $2']
    ],
    'B': [
      ['b', '-> $1']
    ],
    'C': [
      ['c', '-> $1']
    ]
  },
  tokens: 'a b c x',
  start: 'S'
}

console.log "Testing State Minimization"
console.log "=========================="

try
  parser = new Generator()
  result = parser.generate(testGrammar)

  console.log "\n✅ Parser generated successfully!"
  console.log "Check the output above for state minimization details."

  # Test with a more complex grammar that should have more opportunities for minimization
  complexGrammar = {
    grammar: {
      'Expr': [
        ['Expr + Term', '-> $1 + $3'],
        ['Expr - Term', '-> $1 - $3'],
        ['Term', '-> $1']
      ],
      'Term': [
        ['Term * Factor', '-> $1 * $3'],
        ['Term / Factor', '-> $1 / $3'],
        ['Factor', '-> $1']
      ],
      'Factor': [
        ['( Expr )', '-> $2'],
        ['NUMBER', '-> $1'],
        ['IDENTIFIER', '-> $1']
      ]
    },
    tokens: 'NUMBER IDENTIFIER + - * / ( )',
    start: 'Expr'
  }

  console.log "\n\nTesting Complex Grammar"
  console.log "======================="

  parser2 = new Generator()
  result2 = parser2.generate(complexGrammar)

  console.log "\n✅ Complex grammar parsed successfully!"

catch error
  console.error "❌ Error:", error.message
  console.error error.stack if error.stack