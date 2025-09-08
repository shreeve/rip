###
Complete Grammar DSL Helper Functions (CoffeeScript)
For Rip parser generator with o/x distinction
###

# Split pattern on pipes for alternatives
alts = (pattern) ->
  if pattern.includes '|'
    pattern.split('|').map((p) -> p.trim()).filter(Boolean)
  else
    [pattern]

# Validate pattern string
validatePattern = (pattern) ->
  throw new Error "Pattern must be string, got #{typeof pattern}" unless typeof pattern is 'string'
  throw new Error "Pattern \"#{pattern}\" has double spaces - likely a typo" if pattern.includes '  '

# o() - BUILD/CREATE helper
# Creates new AST nodes (with auto-typing in parser generator)
o = (pattern, node, precedence) ->
  validatePattern pattern
  alts(pattern).map (p) -> [p, { $node: node }, precedence or null]

# x() - FORWARD/PASS helper
# Passes values through without modification
x = (pattern, value = '$1') ->
  validatePattern pattern
  alts(pattern).map (p) -> [p, { $pass: value }, null]

# Binary operators helper
binOp = (operators, precedence) ->
  alts(operators).map (op) ->
    [
      "Expression #{op} Expression"
      { $node: { left: '$1', op: op, right: '$3' } }
      precedence or op
    ]

# Unary operators helper
unaryOp = (operators, precedence) ->
  alts(operators).map (op) ->
    [
      "#{op} Expression"
      { $node: { op: op, argument: '$2' } }
      precedence or null
    ]

# Keywords/literals helper
keywords = (words, nodeTemplate) ->
  alts(words).map (word) ->
    node = if typeof nodeTemplate is 'function'
      nodeTemplate word
    else
      nodeTemplate or { value: word }
    [word, { $node: node }, null]

# Optional elements helper (? in EBNF)
opt = (pattern, presentValue = '$1', absentValue = null) ->
  [
    x('', absentValue)...
    x(pattern, presentValue)...
  ]

# One-or-more repetition (+ in EBNF)
plus = (itemName, separator) ->
  if separator
    [
      o(itemName, ['$1'])...
      o("#{itemName}List #{separator} #{itemName}", { $concat: ['$1', '$3'] })...
    ]
  else
    [
      o(itemName, ['$1'])...
      o("#{itemName}List #{itemName}", { $concat: ['$1', '$2'] })...
    ]

# Zero-or-more repetition (* in EBNF)
star = (itemName, separator) ->
  if separator
    [
      o('', [])...  # Empty produces empty array
      o(itemName, ['$1'])...
      o("#{itemName}List #{separator} #{itemName}", { $concat: ['$1', '$3'] })...
    ]
  else
    [
      o('', [])...  # Empty produces empty array
      o(itemName, ['$1'])...
      o("#{itemName}List #{itemName}", { $concat: ['$1', '$2'] })...
    ]

# List building helper (handles trailing separators)
list = (itemName, separator = ',') ->
  [
    o(itemName, ['$1'])...
    o("#{itemName}List #{separator} #{itemName}", { $concat: ['$1', '$3'] })...
    x("#{itemName}List #{separator}")...  # Pass through with trailing separator
  ]

# Wrapped/parenthetical expressions helper
wrapped = (openToken, closeToken, innerRule = 'Expression') ->
  [
    o("#{openToken} #{closeToken}", null)...  # Empty
    x("#{openToken} #{innerRule} #{closeToken}", '$2')...  # Pass through inner
  ]

# Type guard for marked node specs
isNodeSpec = (spec) ->
  spec and typeof spec is 'object' and '$node' of spec

# Type guard for pass specs
isPassSpec = (spec) ->
  spec and typeof spec is 'object' and '$pass' of spec

# Type guard for special operators
hasSpecialOperators = (node) ->
  node and typeof node is 'object' and
    (node.$concat or node.$slice or node.$array)

# Parser generator's node expansion function
# Interprets $node and $pass markers from o() and x()
expandNodeSpec = (lhs, nodeSpec) ->
  # Handle o() nodes - BUILD with auto-typing
  if isNodeSpec nodeSpec
    node = nodeSpec.$node

    return '$1' if not node?
    return { $array: node } if Array.isArray node

    if typeof node is 'object'
      # Special operators pass through
      return node if hasSpecialOperators node

      # AUTO-TYPE: Add type field if not present
      if not node.type and not node.$noType
        return { type: lhs, node... }
      return node

    return node

  # Handle x() values - PASS without modification
  if isPassSpec nodeSpec
    return nodeSpec.$pass

  throw new Error "Production for #{lhs} missing o() or x() wrapper"

# Process grammar for parser generator
# Flattens arrays and validates structure
processGrammar = (grammar) ->
  processed = {}

  for own lhs, rule of grammar
    # Validate LHS
    throw new Error "Invalid LHS: #{lhs}" unless lhs and typeof lhs is 'string'

    # Handle both array format and direct function call format
    # Array format: Body: [o(...), x(...)]
    # Direct format: Assignable: x 'SimpleAssignable | Array | Object'
    if not Array.isArray rule
      throw new Error "Invalid rule format for #{lhs} - must be array"

    # Check if it's a direct production array (from inline x() or o())
    # These return arrays like [[pattern, spec, prec]]
    firstElem = rule[0]
    if firstElem and Array.isArray(firstElem) and firstElem.length is 3 and typeof firstElem[0] is 'string'
      # It's already an array of productions
      processed[lhs] = rule
    else if rule.length > 0 and not Array.isArray(rule[0])
      # It looks like a malformed rule
      throw new Error "Invalid rule format for #{lhs} - expected array of productions"
    else
      # It's an array containing helper function calls - flatten one level
      processed[lhs] = rule.flat()

    # Validate each production
    for production in processed[lhs]
      unless Array.isArray(production) and production.length is 3
        throw new Error "Invalid production format in #{lhs}"
      [pattern, spec, precedence] = production
      unless typeof pattern is 'string'
        throw new Error "Invalid pattern in #{lhs}: #{pattern}"

  processed

# Export all functions
module.exports = {
  o
  x
  binOp
  unaryOp
  keywords
  opt
  plus
  star
  list
  wrapped
  expandNodeSpec
  processGrammar
}
