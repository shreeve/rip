# Calculator Grammar (Parser-Agnostic)
# This grammar defines a simple calculator that can handle basic arithmetic operations

# Jison DSL
# ---------

# Since we're going to be wrapped in a function by the parser generator in any case, if our
# action immediately returns a value, we can optimize by removing the function
# wrapper and just returning the value directly.
unwrap = /^function\s*\(\)\s*\{\s*return\s*([\s\S]*);\s*\}/

# Our handy DSL for grammar generation
o = (patternString, action, options) ->
  patternString = patternString.replace /\s{2,}/g, ' '
  patternCount = patternString.split(' ').length
  if action
    # This code block does string replacements in the generated parser file
    action = if match = unwrap.exec action then match[1] else "(#{action}())"
    performActionFunctionString = "$$ = #{action};"
  else
    performActionFunctionString = '$$ = $1;'

  [patternString, performActionFunctionString, options]

# Grammatical Rules
# -----------------

# In all of the rules that follow, you'll see the name of the nonterminal as
# the key to a list of alternative matches. With each match's action, the
# dollar-sign variables are provided by the parser as references to the value of
# their numeric position.
grammar =

  # The **Root** is the top-level node in the syntax tree.
  Root: [
    o 'Expression',                             -> $1
  ]

  # All the different types of expressions in our calculator language.
  Expression: [
    o 'Expression + Expression',                -> $1 + $3
    o 'Expression - Expression',                -> $1 - $3
    o 'Expression * Expression',                -> $1 * $3
    o 'Expression / Expression',                -> $1 / $3
    o '( Expression )',                         -> $2
    o '- Expression',                           (-> -$2), prec: 'UMINUS'
    o 'NUMBER',                                 -> Number($1)
  ]

# Precedence
# ----------

# Operators at the top of this list have higher precedence than the ones lower
# down. Following these rules is what makes `2 + 3 * 4` parse as:
#
#     2 + (3 * 4)
#
# And not:
#
#     (2 + 3) * 4
operators = [
  ['right',     'UMINUS']
  ['left',      '*', '/']
  ['left',      '+', '-']
]

# Extract tokens from grammar
# ---------------------------

# Extract all tokens from the grammar rules
tokens = []
for name, alternatives of grammar
  grammar[name] = for alt in alternatives
    for token in alt[0].split ' '
      tokens.push token unless grammar[token]
    alt

# Export the grammar data (parser-agnostic)
# -----------------------------------------

# Export the grammar data that any parser generator can use
exports.grammar = grammar
exports.tokens = tokens.join ' '
exports.operators = operators
exports.startSymbol = 'Root'
