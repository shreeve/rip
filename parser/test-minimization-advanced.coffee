#!/usr/bin/env coffee

# Advanced test for state minimization functionality
{ Generator } = require('./rip-parser')

# Grammar with more potential for state minimization
# This grammar should create multiple states that can be merged
advancedGrammar = {
  grammar: {
    'Program': [
      ['StatementList', '-> $1']
    ],
    'StatementList': [
      ['Statement', '-> [$1]'],
      ['StatementList Statement', '-> $1.concat([$2])']
    ],
    'Statement': [
      ['Assignment', '-> $1'],
      ['IfStatement', '-> $1'],
      ['WhileStatement', '-> $1'],
      ['Block', '-> $1']
    ],
    'Assignment': [
      ['IDENTIFIER = Expression ;', '-> { type: "assignment", id: $1, value: $3 }']
    ],
    'IfStatement': [
      ['if ( Expression ) Statement', '-> { type: "if", condition: $3, then: $5 }'],
      ['if ( Expression ) Statement else Statement', '-> { type: "if", condition: $3, then: $5, else: $7 }']
    ],
    'WhileStatement': [
      ['while ( Expression ) Statement', '-> { type: "while", condition: $3, body: $5 }']
    ],
    'Block': [
      ['{ StatementList }', '-> { type: "block", statements: $2 }'],
      ['{ }', '-> { type: "block", statements: [] }']
    ],
    'Expression': [
      ['Expression + Term', '-> { type: "add", left: $1, right: $3 }'],
      ['Expression - Term', '-> { type: "sub", left: $1, right: $3 }'],
      ['Term', '-> $1']
    ],
    'Term': [
      ['Term * Factor', '-> { type: "mul", left: $1, right: $3 }'],
      ['Term / Factor', '-> { type: "div", left: $1, right: $3 }'],
      ['Factor', '-> $1']
    ],
    'Factor': [
      ['( Expression )', '-> $2'],
      ['IDENTIFIER', '-> { type: "identifier", name: $1 }'],
      ['NUMBER', '-> { type: "number", value: $1 }']
    ]
  },
  tokens: 'IDENTIFIER NUMBER if else while = + - * / ( ) { } ;',
  start: 'Program'
}

console.log "Advanced State Minimization Test"
console.log "================================"

try
  parser = new Generator()

  # Enable more detailed logging
  console.log "Generating parser with detailed state analysis..."
  result = parser.generate(advancedGrammar)

  console.log "\n✅ Advanced parser generated successfully!"
  console.log "Parser code length: #{result.length} characters"

  # Display detailed statistics
  parser.printStatistics()

  # Test with a simpler grammar to show the difference
  console.log "\n\nComparing with Simple Grammar"
  console.log "============================"

  simpleGrammar = {
    grammar: {
      'E': [
        ['E + T', '-> $1 + $3'],
        ['T', '-> $1']
      ],
      'T': [
        ['T * F', '-> $1 * $3'],
        ['F', '-> $1']
      ],
      'F': [
        ['( E )', '-> $2'],
        ['id', '-> $1']
      ]
    },
    tokens: 'id + * ( )',
    start: 'E'
  }

  parser2 = new Generator()
  result2 = parser2.generate(simpleGrammar)

  console.log "\n✅ Simple parser generated successfully!"
  parser2.printStatistics()

catch error
  console.error "❌ Error:", error.message
  console.error error.stack if error.stack