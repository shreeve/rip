# Universal Parser Runtime
# A generic LALR(1) parser that works with any language pack
#
# This implements the standard LALR(1) parsing algorithm using:
# - State stack for tracking parser states
# - Value stack for building AST nodes
# - State table for shift/reduce/goto decisions
# - Semantic actions for language-specific AST construction
#
# Usage:
#   languagePack = require('./coffeescript-language-pack.js')
#   parser = new UniversalParser(languagePack)
#   ast = parser.parse(sourceCode)

class UniversalParser
  constructor: (@languagePack) ->
    unless @languagePack
      throw new Error("Language pack is required")

    # Extract language-specific data from the pack
    @symbols = @languagePack.symbols or []           # Symbol names: ["Root", "Body", "Expression", ...]
    @rules = @languagePack.rules or {}               # Grammar rules: {0: [lhs, rhsLength], ...}
    @states = @languagePack.states or []             # LALR(1) state table: [{token: [action, target], ...}, ...]
    @actions = @languagePack.actions or {}           # AST builders: {ruleIndex: function, ...}

    # Determine terminals automatically (symbols that aren't left-hand sides of rules)
    @terminals = @getTerminals()

    # Validate the language pack
    @validateLanguagePack()

    # Initialize parser stacks (will be reset for each parse)
    @stateStack = []      # Stack of parser states
    @valueStack = []      # Stack of semantic values (AST nodes)
    @locationStack = []   # Stack of source locations

  # Get terminals from language pack or determine automatically
  getTerminals: ->
    terminals = @languagePack.terminals

    # Handle different terminal formats
    if typeof terminals is 'function'
      # Language pack provides a function to compute terminals
      return terminals.call(@languagePack)
    else if Array.isArray(terminals)
      # Language pack provides explicit terminal list
      return terminals
    else if terminals?
      # Language pack provides some other format
      return terminals
    else
      # No terminals provided, determine automatically
      return @determineTerminals()

  # Automatically determine terminals from symbols and rules
  determineTerminals: ->
    UniversalParser.determineTerminals(@symbols, @rules)

  validateLanguagePack: ->
    required = ['symbols', 'rules', 'states']
    for prop in required
      unless @languagePack[prop]?
        throw new Error("Language pack missing required property: #{prop}")

    unless @symbols.length > 0
      throw new Error("Language pack must have at least one symbol")

    unless @states.length > 0
      throw new Error("Language pack must have at least one state")

  # Main parsing method - implements standard LALR(1) algorithm
  parse: (input, options = {}) ->
    # Initialize lexer for tokenizing input
    @lexer = @createLexer(input, options)

    # Initialize parser stacks
    @stateStack = [0]        # Start in state 0
    @valueStack = [null]     # Placeholder for bottom of stack
    @locationStack = [null]  # Placeholder for bottom of stack

    # Main parsing loop
    loop
      # Get current parser state
      currentState = @stateStack[@stateStack.length - 1]

      # Get next token from lexer
      lookahead = @lexer.lex()

      # Look up action in state table
      # states[state][token] = [actionType, target]
      # actionType: 1=shift, 2=reduce, 3=accept
      tableEntry = @states[currentState]?[lookahead]

      unless tableEntry?
        @throwParseError("Unexpected token: #{@getTokenName(lookahead)}", lookahead)

      [actionType, target] = tableEntry

      switch actionType
        when 1  # SHIFT: push token and go to new state
          @performShift(lookahead, target)

        when 2  # REDUCE: apply grammar rule
          accepted = @performReduce(target)
          if accepted
            return @valueStack[1]  # Return the completed AST

        when 3  # ACCEPT: parsing complete
          return @valueStack[1]  # Return the parsed AST

        else
          @throwParseError("Invalid state table entry: #{actionType}", lookahead)

  # SHIFT operation: consume token and transition to new state
  performShift: (token, newState) ->
    @stateStack.push(newState)
    @valueStack.push(@lexer.yytext)    # Push token text
    @locationStack.push(@lexer.yylloc) # Push source location

  # REDUCE operation: apply grammar rule and execute semantic action
  performReduce: (ruleIndex) ->
    rule = @rules[ruleIndex]
    unless rule?
      throw new Error("Invalid rule index: #{ruleIndex}")

    [leftHandSide, rightHandSideLength] = rule

    # Pop right-hand side symbols from stacks
    if rightHandSideLength > 0
      @stateStack.splice(-rightHandSideLength)
      rightHandSideValues = @valueStack.splice(-rightHandSideLength)
      rightHandSideLocations = @locationStack.splice(-rightHandSideLength)
    else
      # Empty rule (A -> ε)
      rightHandSideValues = []
      rightHandSideLocations = []

    # Execute semantic action to build AST node
    astNode = @executeAction(ruleIndex, rightHandSideValues, rightHandSideLocations)

    # Check for accept condition (start symbol reduction)
    if ruleIndex is 0
      return true  # Signal acceptance

    # Push left-hand side result onto value stack
    @valueStack.push(astNode)
    @locationStack.push(@mergeSourceLocations(rightHandSideLocations))

    # GOTO: transition to next state based on left-hand side symbol
    currentState = @stateStack[@stateStack.length - 1]
    gotoEntry = @states[currentState]?[leftHandSide]

    unless gotoEntry?
      throw new Error("No goto entry for symbol #{leftHandSide} in state #{currentState}")

    # Goto entries are encoded as [0, targetState] to distinguish from shift/reduce
    [gotoType, targetState] = gotoEntry
    @stateStack.push(targetState)

    false  # Continue parsing

  # Execute semantic action to build AST node
  executeAction: (ruleIndex, rightHandSideValues, rightHandSideLocations) ->
    action = @actions[ruleIndex]

    if typeof action is 'function'
      # Call language-specific semantic action
      return action.call(@, rightHandSideValues, rightHandSideLocations, @)
    else
      # Default action: return first child (common for pass-through rules)
      return rightHandSideValues[0] or null

  # Create lexer instance (delegated to language pack)
  createLexer: (input, options) ->
    if @languagePack.createLexer
      return @languagePack.createLexer(input, options)
    else
      # Fallback to basic character-by-character lexer
      return @createBasicLexer(input)

  # Basic lexer implementation (for testing/fallback)
  createBasicLexer: (input) ->
    position = 0

    lex: ->
      return 'EOF' if position >= input.length

      character = input[position]
      position++

      # Look up terminal ID for character
      terminalId = @terminals.indexOf(character)
      if terminalId >= 0
        return terminalId
      else
        return 'UNKNOWN'

    yytext: ''  # Current token text
    yylloc: {   # Current token location
      first_line: 1, first_column: 1,
      last_line: 1, last_column: 1
    }

  # Utility: Get human-readable token name
  getTokenName: (token) ->
    if typeof token is 'number'
      return @symbols[token] or "TOKEN(#{token})"
    else
      return token.toString()

  # Utility: Merge source locations from multiple tokens
  mergeSourceLocations: (locations) ->
    return null unless locations?.length > 0

    first = locations[0]
    last = locations[locations.length - 1]

    return null unless first and last

    first_line: first.first_line
    first_column: first.first_column
    last_line: last.last_line
    last_column: last.last_column

  # Error handling
  throwParseError: (message, token) ->
    error = new Error(message)
    error.token = token
    error.parseStack = @stateStack.slice()  # Copy of state stack for debugging
    throw error

# Static utility method for determining terminals from symbols and rules
# This can be used by both the parser and the generator
#
# Algorithm: A symbol is a terminal if it never appears as the left-hand side of any rule.
# This works for most grammars and eliminates the need for explicit terminal lists.
#
# Usage:
#   terminals = UniversalParser.determineTerminals(symbols, rules)
#
# Parameters:
#   symbols - Array of symbol names: ['Root', 'Body', 'IDENTIFIER', 'NUMBER']
#   rules - Object or Array of rules:
#           Object format: {0: [lhsSymbol, rhsLength], 1: [lhsSymbol, rhsLength]}
#           Array format: [{lhs: 'Root', rhs: [...]}, {lhs: 'Body', rhs: [...]}]
#
# Returns:
#   Array of terminal symbol indices: [2, 3] (for 'IDENTIFIER', 'NUMBER')
UniversalParser.determineTerminals = (symbols, rules) ->
  # Get all symbols that appear as left-hand sides of rules (non-terminals)
  nonTerminals = new Set()

  # Handle different rule formats
  if typeof rules is 'object' and not Array.isArray(rules)
    # Rules as object: {0: [lhsSymbol, rhsLength]} or {0: [lhsIndex, rhsLength]}
    for ruleId, rule of rules
      if rule and rule.length >= 2
        nonTerminals.add(rule[0])  # Add left-hand side symbol/index
  else if Array.isArray(rules)
    # Rules as array of rule objects with .lhs property
    for rule in rules
      if rule?.lhs
        nonTerminals.add(rule.lhs)

  # All symbols that aren't non-terminals are terminals
  terminals = []
  for symbol, index in symbols
    # Check both symbol name and index (handles different rule formats)
    unless nonTerminals.has(symbol) or nonTerminals.has(index)
      terminals.push(index)

  return terminals

# Export for use
module.exports = UniversalParser