# Simple test grammar for rip-parser analysis testing
# Calculator grammar with proper precedence

o = (pattern, action) -> [pattern, action]

grammar =
  # Expressions with operator precedence
  Expression: [
    o 'Expression + Term',     -> @$ = @$1 + @$3
    o 'Expression - Term',     -> @$ = @$1 - @$3  
    o 'Term',                  -> @$ = @$1
  ]
  
  Term: [
    o 'Term * Factor',         -> @$ = @$1 * @$3
    o 'Term / Factor',         -> @$ = @$1 / @$3
    o 'Factor',                -> @$ = @$1
  ]
  
  Factor: [
    o '( Expression )',        -> @$ = @$2
    o 'NUMBER',                -> @$ = parseFloat(@$1)
    o 'IDENTIFIER',            -> @$ = @$1
  ]

# Operator precedence (lowest to highest)
operators = [
  ['left', '+', '-']          # Addition and subtraction
  ['left', '*', '/']          # Multiplication and division
]

module.exports = {
  grammar: grammar
  operators: operators
  start: 'Expression'
  tokens: 'NUMBER IDENTIFIER + - * / ( )'
}
