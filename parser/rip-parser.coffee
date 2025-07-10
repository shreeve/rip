#!/usr/bin/env coffee

# ==============================================================================
# rip-parser: A modern, LALR(1) parser generator for the rip ecosystem
#
# Author: Steve Shreeve <steve.shreeve@gmail.com> and Claude 4 Opus
#  Stats: July 10, 2025 (version 0.3.0) MIT License
# ==============================================================================

class Symbol # Terminal or Nonterminal
  constructor: (@name, @isTerminal = false, id = 0) ->
    @id         = id
    @nullable   = false
    @first      = new Set()
    @follow     = new Set()

class Rule # A → B C D
  @idno = 0
  constructor: (@lhs, @rhs, @action = null, @precedence = null) ->
    @id = Rule.idno++ # unique id

# An Item is a rule with its dot position and lookahead
# Example: Expr → Expr + • Term, {';', ')', '$'}
class Item
  constructor: (@rule, @dot = 0, @lookahead = new Set()) ->

  # Check if the dot is at the end
  isComplete: -> @dot >= @rule.rhs.length

  # Get the symbol after the dot
  nextSymbol: -> @rule.rhs[@dot]

  # Create a new item with the dot moved forward
  advance: -> new Item(@rule, @dot + 1, new Set(@lookahead))

  # Create item without lookahead (for LR(0) core)
  core: -> new Item(@rule, @dot, new Set())

  # Generate core key from rule ID and dot position
  @makeCoreKey: (ruleId, dot) -> "#{ruleId}-#{dot}"

  # Get the core key (without lookaheads) for deduplication
  coreKey: -> @_coreKey ?= Item.makeCoreKey(@rule.id, @dot)

  # String for debugging
  toString: ->
    rhs = @rule.rhs.slice()
    rhs.splice(@dot, 0, '•')
    "#{@rule.lhs} → #{rhs.join(' ')} [#{[...@lookahead].join(',')}]"

class State # Set of LR(0) items
  @idno = 0
  constructor: ->
    @id          = State.idno++ # unique id
    @items       = []           # Array of Items
    @coreMap     = new Map()    # Core key -> Item (for LR(0) cores)
    @transitions = new Map()    # symbol -> state
    @inadequate  = false        # Has shift/reduce conflicts?

  # Add item to state, merging lookaheads if core already exists
  addItem: (item) ->
    coreKey = item.coreKey()

    if @coreMap.has(coreKey)
      # Merge lookaheads with existing item
      existingItem = @coreMap.get(coreKey)
      oldSize = existingItem.lookahead.size
      for la from item.lookahead
        existingItem.lookahead.add(la)
      # Return true if lookaheads were actually added
      return existingItem.lookahead.size > oldSize
    else
      # Add new item
      @coreMap.set(coreKey, item)
      @items.push(item)
      return true

  # Get core item by rule and dot
  getCoreItem: (ruleId, dot) ->
    @coreMap.get(Item.makeCoreKey(ruleId, dot))

# ==[ LALR(1) Parser Generator ]================================================

class Generator
  constructor: (opts = {}) ->
    @grammar           = null      # Store grammar
    @start             = null      # Start symbol
    @tokens            = null      # Store tokens for terminal identification
    @symbols           = new Map() # name -> Symbol
    @rules             = []        # Array of Rules
    @precedence        = {}        # symbol -> {level, assoc}
    @states            = []        # Array of States
    @stateMap          = new Map() # core hash -> State
    @propagateLinks    = new Map() # "stateId-itemKey" -> Set of "stateId-itemKey"
    @inadequateStates  = []        # States with conflicts
    @conflicts         = []        # Detailed conflict information
    @onDemandLookahead = opts.onDemandLookahead ? true

    # Table optimization configuration (Bug #20 Fix)
    @optimizationConfig = {
      enabled: opts.optimize ? false           # Default: disabled for performance
      auto: opts.autoOptimize ? true           # Auto-enable for large grammars
      minStatesForAuto: opts.minStatesForAuto ? 20  # Threshold for auto-optimization
      verbose: opts.optimizeVerbose ? false    # Detailed logging
      algorithms: opts.algorithms ? ['auto']   # Which compression algorithms to try
      skipIfSmall: opts.skipIfSmall ? true     # Skip for small tables
    }

    # Performance optimization caches
    @rulesByLHS        = new Map() # LHS -> [Rules] for O(1) rule lookup
    @coreCache         = new Map() # state -> core hash for memoization
    @closureCache      = new Map() # state core -> closure items for memoization
    @performanceStats  = {        # Track performance metrics
      closureCalls: 0,
      cacheHits: 0,
      stateCreations: 0,
      lookaheadComputations: 0,
      optimizationTime: 0         # Track optimization overhead
    }

  findUnreachableSymbols: ->
    # Mark all symbols as unreachable initially
    reachable = new Set()

    # Start symbol is always reachable
    reachable.add(@start)
    reachable.add('$accept')  # Special case

    # Fixed-point iteration to find all reachable symbols
    changed = true
    while changed
      changed = false

      for rule in @rules
        # If LHS is reachable, all RHS symbols become reachable
        if reachable.has(rule.lhs)
          for symbol in rule.rhs
            unless reachable.has(symbol)
              reachable.add(symbol)
              changed = true

    # Find unreachable non-terminals
    unreachable = []
    for [name, symbol] from @symbols
      if !symbol.isTerminal and !reachable.has(name)
        unreachable.push(name)

    unreachable

  eliminateUnreachable: ->
    totalRemoved = 0

    # Iterate until no more unreachable symbols found
    loop
      unreachable = @findUnreachableSymbols()
      break if unreachable.length == 0

      if totalRemoved == 0
        console.warn "\n⚠️  Found unreachable non-terminals: #{unreachable.join(', ')}"

      # Remove rules with unreachable LHS or RHS
      initialRuleCount = @rules.length
      @rules = @rules.filter (rule) =>
        # Remove if LHS is unreachable
        if rule.lhs in unreachable
          console.warn "  Removing rule with unreachable LHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
          return false

        # Remove if any RHS symbol is unreachable (and not a terminal)
        for symbol in rule.rhs
          if symbol in unreachable and not @getSymbol(symbol).isTerminal
            console.warn "  Removing rule with unreachable RHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
            return false

        true

      # Remove unreachable symbols from symbol table
      for symbol in unreachable
        @symbols.delete(symbol)

      totalRemoved += unreachable.length

      # If no rules were removed, we're done (prevents infinite loop)
      break if @rules.length == initialRuleCount

    if totalRemoved > 0
      console.warn "  Total unreachable symbols removed: #{totalRemoved}"
      @reassignIds()

  findUnproductiveSymbols: ->
    # A symbol is productive if it can derive a string of terminals
    productive = new Set()

    # All terminals are productive
    for [name, symbol] from @symbols
      if symbol.isTerminal
        productive.add(name)

    # Find productive non-terminals
    changed = true
    while changed
      changed = false

      for rule in @rules
        continue if productive.has(rule.lhs)

        # Check if all RHS symbols are productive
        allProductive = true
        for symbol in rule.rhs
          unless productive.has(symbol)
            allProductive = false
            break

        if allProductive
          productive.add(rule.lhs)
          changed = true

    # Find unproductive non-terminals
    unproductive = []
    for [name, symbol] from @symbols
      if !symbol.isTerminal and !productive.has(name)
        unproductive.push(name)

    unproductive

  eliminateUnproductive: ->
    totalRemoved = 0

    # Iterate until no more unproductive symbols found
    loop
      unproductive = @findUnproductiveSymbols()
      break if unproductive.length == 0

      if totalRemoved == 0
        console.warn "\n⚠️  Found unproductive non-terminals: #{unproductive.join(', ')}"

      # Remove rules containing unproductive symbols
      initialRuleCount = @rules.length
      @rules = @rules.filter (rule) =>
        # Remove if LHS is unproductive
        if rule.lhs in unproductive
          console.warn "  Removing rule with unproductive LHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
          return false

        # Remove if any RHS symbol is unproductive (and not a terminal)
        for symbol in rule.rhs
          if symbol in unproductive and not @getSymbol(symbol).isTerminal
            console.warn "  Removing rule with unproductive RHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
            return false

        true

      # Remove unproductive symbols from symbol table
      for symbol in unproductive
        @symbols.delete(symbol)

      totalRemoved += unproductive.length

      # If no rules were removed, we're done (prevents infinite loop)
      break if @rules.length == initialRuleCount

    if totalRemoved > 0
      console.warn "  Total unproductive symbols removed: #{totalRemoved}"
      @reassignIds()

  # Helper method to reassign rule and symbol IDs after elimination
  reassignIds: ->
    # Reset rule IDs
    Rule.idno = 0
    for rule in @rules
      rule.id = Rule.idno++

    # Reassign symbol IDs to maintain consistency
    symbolId = 0
    for [name, symbol] from @symbols
      symbol.id = symbolId++

    # Rebuild rule lookup cache after ID reassignment
    @buildRuleLookupCache()

  # Build optimized rule lookup cache for O(1) access by LHS
  buildRuleLookupCache: ->
    @rulesByLHS.clear()

    for rule in @rules
      unless @rulesByLHS.has(rule.lhs)
        @rulesByLHS.set(rule.lhs, [])
      @rulesByLHS.get(rule.lhs).push(rule)

    # Performance optimization: pre-sort rules by LHS for consistent iteration
    for [lhs, rules] from @rulesByLHS
      rules.sort((a, b) -> a.id - b.id)

  # Work starts here
  processGrammar: ({ grammar, operators, start, tokens }) ->
    # Comprehensive input validation
    @validateGrammarInput({ grammar, operators, start, tokens })

    # Convert tokens to a set
    @tokens = new Set(tokens.trim().split(/\s+/))

    # Create special symbols (starts with id = 0, 1, 2)
    @getSymbol '$accept'
    @getSymbol '$end' , true
    @getSymbol 'error', true; @tokens.add('error')

    # Process all rules with enhanced validation
    for nonterminal, productions of grammar
      for production, i in productions
        try
          [pattern, action, options] = production

          # Validate and parse the pattern
          rhs = @parseProductionPattern(pattern, nonterminal, i)

          # Validate action code
          @validateActionCode(action, rhs.length, nonterminal, i) if action?

          # Create the rule
          rule = new Rule(nonterminal, rhs, action)
          rule.precedence = options?.prec

          @rules.push(rule)

          # Track nonterminal
          @getSymbol(nonterminal, false)

          # Track terminals in RHS
          for symbol in rhs
            @getSymbol(symbol)

        catch error
          throw new Error("Error processing production #{i} for '#{nonterminal}': #{error.message}")

    # Set start symbol
    @start = switch
      when grammar[start ] then start
      when grammar['Root'] then 'Root'
      else Object.keys(grammar)[0]
    throw new Error('Start symbol not found') unless @start

    # Add augmented start rule: $accept → start $end
    @rules.push(new Rule('$accept', [@start, '$end']))

    # Build performance optimization caches
    @buildRuleLookupCache()

    # Process operators (precedence and associativity)
    @processOperators(operators) if operators

    # Add error recovery productions
    @addErrorRecoveryProductions()

  # Add error recovery productions to the grammar
  addErrorRecoveryProductions: ->
    # Find non-terminals that could benefit from error recovery
    # Typically these are statement-level constructs
    candidateNonTerminals = []

    for [name, symbol] from @symbols
      if not symbol.isTerminal
        # Look for non-terminals that appear in multiple rules
        # These are good candidates for error recovery
        ruleCount = 0
        for rule in @rules
          if rule.lhs == name
            ruleCount++

        if ruleCount >= 2 or name.toLowerCase().includes('stmt') or
           name.toLowerCase().includes('expr') or name.toLowerCase().includes('decl')
          candidateNonTerminals.push(name)

    # Add error productions for promising candidates
    for ntName in candidateNonTerminals.slice(0, 3) # Limit to avoid too many
      # Add: NonTerminal → error
      errorRule = new Rule(ntName, ['error'], '/* error recovery */')
      @rules.push(errorRule)

      console.log("Added error recovery rule: #{ntName} → error")

  # Operator precedence and associativity
  processOperators: (operators) ->
    @precedence = {}
    precedenceLevel = 1

    for group in operators
      [assoc, symbols...] = group
      for symbol in symbols
        @precedence[symbol] = { level: precedenceLevel, assoc }
      precedenceLevel++

  # Comprehensive grammar input validation
  validateGrammarInput: ({ grammar, operators, start, tokens }) ->
    errors = []

    # 1. Basic structure validation
    unless grammar?
      errors.push("Grammar object is required")

    unless typeof grammar is 'object'
      errors.push("Grammar must be an object, got #{typeof grammar}")

    unless tokens?
      errors.push("Tokens string is required")

    unless typeof tokens is 'string'
      errors.push("Tokens must be a string, got #{typeof tokens}")

    # Early exit if basic structure is invalid
    if errors.length > 0
      throw new Error("Grammar validation failed:\n  #{errors.join('\n  ')}")

    # 2. Grammar structure validation
    if Object.keys(grammar).length == 0
      errors.push("Grammar cannot be empty")

    # 3. Validate each non-terminal and its productions
    for nonterminal, productions of grammar
      # Validate non-terminal name
      unless @isValidSymbolName(nonterminal)
        errors.push("Invalid non-terminal name '#{nonterminal}': must be alphanumeric with underscores")

      # Validate productions array
      unless Array.isArray(productions)
        errors.push("Productions for '#{nonterminal}' must be an array, got #{typeof productions}")
        continue

      if productions.length == 0
        errors.push("Non-terminal '#{nonterminal}' has no productions")
        continue

      # Validate each production
      for production, i in productions
        unless Array.isArray(production)
          errors.push("Production #{i} for '#{nonterminal}' must be an array, got #{typeof production}")
          continue

        if production.length == 0
          errors.push("Production #{i} for '#{nonterminal}' cannot be empty")
          continue

        [pattern, action, options] = production

        # Validate pattern
        if pattern? and typeof pattern isnt 'string'
          errors.push("Pattern in production #{i} for '#{nonterminal}' must be a string, got #{typeof pattern}")

        # Validate action if present
        if action? and typeof action isnt 'string' and typeof action isnt 'function'
          errors.push("Action in production #{i} for '#{nonterminal}' must be a string or function, got #{typeof action}")

        # Validate options if present
        if options? and typeof options isnt 'object'
          errors.push("Options in production #{i} for '#{nonterminal}' must be an object, got #{typeof options}")

        # Validate symbols in pattern
        if pattern?
          symbols = pattern.trim().split(/\s+/)
          for symbol in symbols when symbol
            unless @isValidSymbolName(symbol)
              errors.push("Invalid symbol '#{symbol}' in production #{i} for '#{nonterminal}'")

    # 4. Validate start symbol
    if start?
      unless typeof start is 'string'
        errors.push("Start symbol must be a string, got #{typeof start}")
      else unless @isValidSymbolName(start)
        errors.push("Invalid start symbol name '#{start}'")

    # 5. Validate operators if present
    if operators?
      unless Array.isArray(operators)
        errors.push("Operators must be an array, got #{typeof operators}")
      else
        for group, i in operators
          unless Array.isArray(group)
            errors.push("Operator group #{i} must be an array, got #{typeof group}")
            continue

          if group.length < 2
            errors.push("Operator group #{i} must have at least associativity and one operator")
            continue

          [assoc, symbols...] = group
          unless assoc in ['left', 'right', 'nonassoc']
            errors.push("Invalid associativity '#{assoc}' in operator group #{i}, must be 'left', 'right', or 'nonassoc'")

          for symbol in symbols
            unless @isValidSymbolName(symbol)
              errors.push("Invalid operator symbol '#{symbol}' in group #{i}")

    # 6. Validate tokens
    tokenList = tokens.trim().split(/\s+/)
    for token in tokenList when token
      unless @isValidSymbolName(token)
        errors.push("Invalid token name '#{token}'")

    # 7. Check for circular dependencies (disabled - LALR(1) can handle these)
    # Note: Circular dependencies through parentheses and other constructs are valid
    # if grammar
    #   @checkCircularDependencies(grammar, errors)

    # Throw error if any validation failed
    if errors.length > 0
      throw new Error("Grammar validation failed:\n  #{errors.join('\n  ')}")

  # Check if a symbol name is valid
  isValidSymbolName: (name) ->
    return false unless name? and typeof name is 'string'
    return false if name.length == 0

    # Allow alphanumeric, underscore, hyphen, and some special characters for terminals
    /^[a-zA-Z_][a-zA-Z0-9_-]*$|^[+\-*/(){}[\];,.'":=<>!&|?~^%$#@\\]+$/.test(name)

    # Check for problematic circular dependencies (excluding valid left recursion)
  checkCircularDependencies: (grammar, errors) ->
    # Build dependency graph - only track non-leftmost dependencies
    dependencies = new Map()

    for nonterminal, productions of grammar
      deps = new Set()

      for production in productions
        [pattern] = production
        if pattern?
          symbols = pattern.trim().split(/\s+/)
          # Skip the first symbol to allow left recursion (A → A α is valid)
          for symbol in symbols.slice(1) when symbol and grammar[symbol]
            deps.add(symbol)

      dependencies.set(nonterminal, deps)

    # Check for cycles in non-leftmost positions (these are problematic)
    visited = new Set()
    recursionStack = new Set()

    checkCycle = (node, path = []) =>
      if recursionStack.has(node)
        cycle = path.slice(path.indexOf(node)).concat([node])
        # Only report if this is a non-trivial cycle (length > 1)
        if cycle.length > 2
          errors.push("Problematic circular dependency detected: #{cycle.join(' → ')}")
        return true

      if visited.has(node)
        return false

      visited.add(node)
      recursionStack.add(node)
      path.push(node)

      deps = dependencies.get(node) || new Set()
      for dep from deps
        if checkCycle(dep, path.slice())
          return true

      recursionStack.delete(node)
      path.pop()
      return false

    for nonterminal of grammar
      unless visited.has(nonterminal)
        checkCycle(nonterminal)

  # Enhanced processGrammar with better error handling
  processGrammarSafely: ({ grammar, operators, start, tokens }) ->
    try
      # Process all rules with enhanced validation
      for nonterminal, productions of grammar
        for production, i in productions
          try
            [pattern, action, options] = production

            # Validate and parse the pattern
            rhs = @parseProductionPattern(pattern, nonterminal, i)

            # Validate action code
            @validateActionCode(action, rhs.length, nonterminal, i) if action?

            # Create the rule
            rule = new Rule(nonterminal, rhs, action)
            rule.precedence = options?.prec

            @rules.push(rule)

            # Track nonterminal
            @getSymbol(nonterminal, false)

            # Track terminals in RHS
            for symbol in rhs
              @getSymbol(symbol)

          catch error
            throw new Error("Error processing production #{i} for '#{nonterminal}': #{error.message}")

    catch error
      throw new Error("Grammar processing failed: #{error.message}")

  # Parse and validate production pattern
  parseProductionPattern: (pattern, nonterminal, productionIndex) ->
    unless pattern?
      return [] # Empty production (epsilon)

    unless typeof pattern is 'string'
      throw new Error("Pattern must be a string")

    # Split into symbols and validate each
    symbols = pattern.trim().split(/\s+/).filter((s) -> s.length > 0)

    for symbol in symbols
      unless @isValidSymbolName(symbol)
        throw new Error("Invalid symbol '#{symbol}' in pattern")

    symbols

  # Validate action code for common issues
  validateActionCode: (action, rhsLength, nonterminal, productionIndex) ->
    return unless action?

    actionStr = if typeof action is 'function' then action.toString() else action

    # Check for parameter references beyond RHS length
    paramMatches = actionStr.match(/\$(\d+)/g) || []
    for match in paramMatches
      paramNum = parseInt(match.substring(1), 10)
      if paramNum > rhsLength
        console.warn("Warning: Parameter #{match} in action for '#{nonterminal}' production #{productionIndex} exceeds RHS length (#{rhsLength})")

    # Check for common syntax issues
    if actionStr.includes('$$') and not actionStr.includes('this.$')
      console.warn("Warning: Use 'this.$' instead of '$$' in action for '#{nonterminal}' production #{productionIndex}")

  # Get or create a symbol
  getSymbol: (name, isTerminal) ->
    return sym if sym = @symbols.get(name)
    isTerminal = if isTerminal? then !!isTerminal else @tokens.has(name)
    symbol = new Symbol(name, isTerminal, @symbols.size)
    @symbols.set name, symbol
    symbol

  # ============================================================================
  # Grammar Analysis
  # ============================================================================

  validateGrammar: ->
    errors = []
    warnings = []

    # 1. Check all RHS symbols are defined
    for rule in @rules
      for symbol in rule.rhs
        unless @symbols.has(symbol)
          errors.push("Undefined symbol '#{symbol}' in rule: #{rule.lhs} → #{rule.rhs.join(' ')}")

    # 2. Check start symbol is defined and is a non-terminal
    unless @symbols.has(@start)
      errors.push("Start symbol '#{@start}' is not defined")
    else if @getSymbol(@start).isTerminal
      errors.push("Start symbol '#{@start}' cannot be a terminal")

    # 3. Check for unreachable symbols (symbols that can't be derived from start)
    reachable = new Set()
    workList = [@start]
    reachable.add(@start)

    while workList.length > 0
      current = workList.shift()
      for rule in @rules
        if rule.lhs == current
          for symbol in rule.rhs
            unless reachable.has(symbol)
              reachable.add(symbol)
              workList.push(symbol) unless @getSymbol(symbol).isTerminal

    # Report unreachable non-terminals
    for [name, symbol] from @symbols
      if not symbol.isTerminal and not reachable.has(name)
        warnings.push("Non-terminal '#{name}' is unreachable from start symbol '#{@start}'")

    # 4. Check for unproductive symbols (symbols that can't derive terminal strings)
    productive = new Set()

    # First, all terminals are productive
    for [name, symbol] from @symbols
      if symbol.isTerminal
        productive.add(name)

    # Iterate until no more productive symbols found
    changed = true
    while changed
      changed = false
      for rule in @rules
        # If all RHS symbols are productive, then LHS is productive
        if not productive.has(rule.lhs)
          allProductive = true
          for symbol in rule.rhs
            unless productive.has(symbol)
              allProductive = false
              break

          if allProductive
            productive.add(rule.lhs)
            changed = true

    # Report unproductive non-terminals
    for [name, symbol] from @symbols
      if not symbol.isTerminal and not productive.has(name)
        warnings.push("Non-terminal '#{name}' is unproductive (cannot derive any terminal string)")

    # 5. Check for left recursion (warning, not error)
    @checkLeftRecursion(warnings)

    # 6. Check for empty grammar
    if @rules.length == 0
      errors.push("Grammar has no rules")

    # 7. Check for rules with same LHS and RHS (useless rules)
    for rule in @rules
      if rule.rhs.length == 1 and rule.lhs == rule.rhs[0]
        warnings.push("Useless rule: #{rule.lhs} → #{rule.rhs[0]} (unit production to self)")

    # 8. Check for duplicate rules
    ruleStrings = new Set()
    for rule in @rules
      ruleStr = "#{rule.lhs} → #{rule.rhs.join(' ')}"
      if ruleStrings.has(ruleStr)
        warnings.push("Duplicate rule: #{ruleStr}")
      else
        ruleStrings.add(ruleStr)

    # Report results
    if warnings.length > 0
      console.warn("\n=== GRAMMAR WARNINGS ===")
      for warning in warnings
        console.warn("Warning: #{warning}")

    if errors.length > 0
      console.error("\n=== GRAMMAR ERRORS ===")
      for error in errors
        console.error("Error: #{error}")
      throw new Error("Grammar validation failed with #{errors.length} errors")

    if warnings.length > 0
      console.warn("\nGrammar has #{warnings.length} warnings but is valid")
    else
      console.log("Grammar validation passed")

    # Check for left recursion
  checkLeftRecursion: (warnings) ->
    # Check for immediate left recursion (A → A α)
    for rule in @rules
      if rule.rhs.length > 0 and rule.lhs == rule.rhs[0]
        warnings.push("Immediate left recursion in rule: #{rule.lhs} → #{rule.rhs.join(' ')}")

    # Check for indirect left recursion using a simplified approach
    # For each non-terminal, see if it can derive itself as the leftmost symbol
    for [name, symbol] from @symbols
      continue if symbol.isTerminal

      if @canDeriveLeftmost(name, name, new Set())
        # Check if we already reported immediate left recursion for this symbol
        hasImmediate = false
        for rule in @rules
          if rule.lhs == name and rule.rhs.length > 0 and rule.rhs[0] == name
            hasImmediate = true
            break

        unless hasImmediate
          warnings.push("Indirect left recursion involving non-terminal '#{name}'")

  # Helper method to check if a non-terminal can derive itself as leftmost symbol
  canDeriveLeftmost: (start, target, visited) ->
    return false if visited.has(start)
    visited.add(start)

    for rule in @rules
      if rule.lhs == start and rule.rhs.length > 0
        leftmost = rule.rhs[0]

        # If leftmost symbol is the target, we found left recursion
        if leftmost == target
          return true

        # If leftmost is a non-terminal, check recursively
        if not @getSymbol(leftmost).isTerminal
          if @canDeriveLeftmost(leftmost, target, new Set(visited))
            return true

    false

  # Compute nullable symbols
  computeNullable: ->
    changed = true
    while changed
      changed = false
      for rule in @rules
        continue if @getSymbol(rule.lhs).nullable

        # A nonterminal is nullable if it has an empty production
        # or if all symbols in one of its productions are nullable
        allNullable = true
        for symbol in rule.rhs
          unless @getSymbol(symbol).nullable
            allNullable = false
            break

        if allNullable
          @getSymbol(rule.lhs).nullable = true
          changed = true

    # Compute FIRST sets
  computeFirst: ->
    # First(terminal) = {terminal}
    for [name, symbol] from @symbols
      if symbol.isTerminal
        symbol.first.add(name)

    changed = true
    while changed
      changed = false
      for rule in @rules
        lhsSymbol = @getSymbol(rule.lhs)
        oldSize = lhsSymbol.first.size

        # Compute FIRST of the RHS sequence incrementally
        # For rule A → B C D, we need FIRST(B C D)
        for i in [0...rule.rhs.length]
          rhsSymbol = @getSymbol(rule.rhs[i])

          # Add FIRST(current symbol) to FIRST(LHS)
          for item from rhsSymbol.first
            lhsSymbol.first.add(item)

          # If current symbol is not nullable, we're done with this rule
          break unless rhsSymbol.nullable

        # Check if we added anything new to trigger another iteration
        if lhsSymbol.first.size > oldSize
          changed = true

  # Compute FOLLOW sets
  computeFollow: ->
    # Follow(start) includes EOF
    @getSymbol(@start).follow.add('$end')

    changed = true
    while changed
      changed = false

      for rule in @rules
        # For each symbol in the RHS, compute what can follow it
        for i in [0...rule.rhs.length]
          lhsSymbol = @getSymbol(rule.lhs)
          currentSymbol = @getSymbol(rule.rhs[i])

          # Skip terminals - they don't have FOLLOW sets
          continue if currentSymbol.isTerminal

          # Get the suffix β after the current symbol
          beta = rule.rhs.slice(i + 1)

          if beta.length > 0
            # Case 1: A → αBβ where β is non-empty
            # Add FIRST(β) to FOLLOW(B)
            firstBeta = @firstOfString(beta)
            for item from firstBeta
              unless currentSymbol.follow.has(item)
                currentSymbol.follow.add(item)
                changed = true

            # If β is nullable, also add FOLLOW(A) to FOLLOW(B)
            betaNullable = true
            for sym in beta
              unless @getSymbol(sym).nullable
                betaNullable = false
                break

            if betaNullable
              for item from lhsSymbol.follow
                unless currentSymbol.follow.has(item)
                  currentSymbol.follow.add(item)
                  changed = true
          else
            # Case 2: A → αB (β is empty)
            # Add FOLLOW(A) to FOLLOW(B)
            for item from lhsSymbol.follow
              unless currentSymbol.follow.has(item)
                currentSymbol.follow.add(item)
                changed = true

  # Compute FIRST set of a string of symbols
  firstOfString: (symbols, startIndex = 0) ->
    first = new Set()

    for i in [startIndex...symbols.length]
      symbol = @getSymbol(symbols[i])

      # Add FIRST(symbol) to result
      for item from symbol.first
        first.add(item)

      # If symbol is not nullable, we're done
      break unless symbol.nullable

    first

  # ============================================================================
  # State Construction
  # ============================================================================

  # Build LR(0) states
  buildStates: ->
    # Find the augmented start rule ($accept → start $end)
    startRule = null
    for rule in @rules
      if rule.lhs is '$accept'
        startRule = rule
        break

    unless startRule
      throw new Error("No augmented start rule found")

    # Create initial state with augmented start rule
    startState = new State()
    startItem = new Item(startRule, 0, new Set(['$end']))
    startState.addItem(startItem)
    @closure(startState)
    @addState(startState)

    # Build all states
    workList = [startState]
    while workList.length > 0
      state = workList.shift()

      # Group items by next symbol
      transitions = new Map()
      for item in state.items
        continue if item.isComplete()

        nextSym = item.nextSymbol()
        unless transitions.has(nextSym)
          transitions.set(nextSym, [])
        transitions.get(nextSym).push(item)

      # Create new states for each transition
      for [symbol, items] from transitions
        newState = new State()

        # Add advanced items
        for item in items
          throw new Error("Cannot advance completed item") if item.isComplete()
          newState.addItem(item.advance())

        # Compute closure
        @closure(newState)

        # Add or merge state
        existingState = @findOrAddState(newState)
        state.transitions.set(symbol, existingState)

        if existingState is newState
          workList.push(newState)

  # Compute closure of a state (LR(0) - no lookaheads yet) - OPTIMIZED
  closure: (state) ->
    @performanceStats.closureCalls++

    # Check closure cache first
    coreKey = @computeCore(state)
    if @closureCache.has(coreKey)
      @performanceStats.cacheHits++
      # Apply cached closure items to current state
      cachedItems = @closureCache.get(coreKey)
      for item in cachedItems
        state.addItem(item)
      return

    # Track original items to cache the closure
    originalItems = state.items.slice()

    # Use work queue instead of fixed-point iteration for better performance
    workQueue = state.items.slice()
    processedSymbols = new Set()

    while workQueue.length > 0
      item = workQueue.shift()
      continue if item.isComplete()

      nextSym = item.nextSymbol()
      continue if @getSymbol(nextSym).isTerminal
      continue if processedSymbols.has(nextSym)

      # Mark symbol as processed to avoid redundant work
      processedSymbols.add(nextSym)

      # Use optimized rule lookup instead of linear search
      rulesForSymbol = @rulesByLHS.get(nextSym) || []
      for rule in rulesForSymbol
        # For LR(0) construction, use empty lookahead
        newItem = new Item(rule, 0, new Set())
        # addItem now handles merging automatically
        if state.addItem(newItem)
          workQueue.push(newItem)

    # Cache the closure items (only the new ones added)
    newItems = state.items.slice(originalItems.length)
    @closureCache.set(coreKey, newItems)

  # Find existing state or add new one
  findOrAddState: (newState) ->
    # Compute core hash (items without lookahead)
    core = @computeCore(newState)

    if @stateMap.has(core)
      @stateMap.get(core) # Return existing state with same core
    else
      @addState(newState) # Add new state
      @stateMap.set(core, newState)
      newState

  addState: (state) ->
    state.id = @states.length
    @states.push(state)
    state

  computeCore: (state) ->
    # Check cache first
    if @coreCache.has(state)
      return @coreCache.get(state)

    # Use the core keys from the coreMap for consistent hashing
    coreKeys = Array.from(state.coreMap.keys()).sort()
    core = coreKeys.join('|')

    # Cache the result
    @coreCache.set(state, core)
    core

  # ============================================================================
  # LALR Lookaheads
  # ============================================================================

  # Compute initial (spontaneous) lookaheads and propagation links
  computeLookaheads: ->
    # Validate that we have states to process
    return unless @states?.length > 0

    # For each state and item, determine spontaneous lookaheads and propagation links
    for state in @states
      continue unless state?.items?.length > 0
      for item in state.items
        continue if item.isComplete()

        # J = goto(I, X) where X is the next symbol
        nextSym = item.nextSymbol()
        nextState = state.transitions.get(nextSym)
        continue unless nextState

        # Standard LALR(1) lookahead computation algorithm:
        # 1. Create closure of current state with dummy "#" lookahead
        # 2. Advance all items on the transition symbol
        # 3. Determine which lookaheads are spontaneous vs propagated

        # Create a temporary state with the current item having "#" lookahead
        tempState = new State()
        dummyItem = new Item(item.rule, item.dot, new Set(['#']))
        tempState.addItem(dummyItem)
        @closureWithLookahead(tempState)

        # Now advance all items in the closure on the transition symbol
        gotoState = new State()
        for closureItem in tempState.items
          if closureItem.nextSymbol() == nextSym
            advancedItem = closureItem.advance()
            gotoState.addItem(advancedItem)

        # Compute closure of the goto state
        @closureWithLookahead(gotoState)

        # Analyze lookaheads to determine propagation vs spontaneous
        for gotoItem in gotoState.items
          # Find corresponding item in the actual next state
          targetItem = nextState.getCoreItem(gotoItem.rule.id, gotoItem.dot)
          continue unless targetItem

          # Check each lookahead in the goto item
          for la from gotoItem.lookahead
            if la == '#'
              # This indicates propagation from the original item
              fromKey = "#{state.id}-#{item.rule.id}-#{item.dot}"
              toKey = "#{nextState.id}-#{targetItem.rule.id}-#{targetItem.dot}"

              unless @propagateLinks.has(fromKey)
                @propagateLinks.set(fromKey, new Set())
              @propagateLinks.get(fromKey).add(toKey)
            else
              # This is a spontaneous lookahead
              targetItem.lookahead.add(la)

    # Add initial lookahead for start state
    if @states.length > 0 and @states[0].items.length > 0
      startItem = @states[0].items[0]
      startItem.lookahead.add('$end')
    else
      throw new Error("No start state or start item found during lookahead computation")

  # Closure with lookahead computation - OPTIMIZED
  closureWithLookahead: (state) ->
    @performanceStats.closureCalls++

    # Use work queue for better performance
    workQueue = state.items.slice()
    processedItems = new Set()

    while workQueue.length > 0
      item = workQueue.shift()
      continue if item.isComplete()

      # Create unique key for this item to avoid reprocessing
      itemKey = "#{item.rule.id}-#{item.dot}-#{[...item.lookahead].sort().join(',')}"
      continue if processedItems.has(itemKey)
      processedItems.add(itemKey)

      nextSym = item.nextSymbol()
      continue if @getSymbol(nextSym).isTerminal

      # Compute lookahead for new items
      # For A → α • B β, la
      # Add B → • γ with FIRST(β la)
      beta = item.rule.rhs.slice(item.dot + 1)

      # Use optimized rule lookup instead of linear search
      rulesForSymbol = @rulesByLHS.get(nextSym) || []
      for rule in rulesForSymbol
        # Compute FIRST(β la)
        newLookahead = new Set()

        # First, add FIRST(β)
        firstBeta = @firstOfString(beta)

        # If β is nullable or empty, include the original lookahead
        allNullable = beta.length == 0
        if beta.length > 0
          allNullable = true
          for sym in beta
            unless @getSymbol(sym).nullable
              allNullable = false
              break

        if allNullable
          # Add original lookahead
          for la from item.lookahead
            newLookahead.add(la)

        # Add FIRST(β)
        for f from firstBeta
          newLookahead.add(f)

        newItem = new Item(rule, 0, newLookahead)

        # addItem now handles lookahead merging automatically
        if state.addItem(newItem)
          workQueue.push(newItem)

  # Propagate lookaheads until convergence
  propagateLookaheads: ->
    changed = true

    while changed
      changed = false

      for [fromKey, toKeys] from @propagateLinks
        # Parse and validate the from key
        fromParts = fromKey.split('-')
        continue unless fromParts.length >= 3
        [fromStateId, fromRuleId, fromPosition] = fromParts.map (x) -> parseInt(x)
        continue unless fromStateId >= 0 and fromStateId < @states.length

        fromState = @states[fromStateId]
        continue unless fromState # Safety check for invalid state ID

        fromItem = fromState.getCoreItem(fromRuleId, fromPosition)
        continue unless fromItem

        for toKey from toKeys
          # Parse and validate the to key
          toParts = toKey.split('-')
          continue unless toParts.length >= 3
          [toStateId, toRuleId, toPosition] = toParts.map (x) -> parseInt(x)
          continue unless toStateId >= 0 and toStateId < @states.length

          toState = @states[toStateId]
          continue unless toState # Safety check for invalid state ID

          toItem = toState.getCoreItem(toRuleId, toPosition)
          continue unless toItem

          # Propagate lookaheads
          oldSize = toItem.lookahead.size
          for la from fromItem.lookahead
            toItem.lookahead.add(la)

          if toItem.lookahead.size > oldSize
            changed = true

  validateLookaheads: ->
    # Ensure all items have at least one lookahead
    for state in @states
      for item in state.items
        if item.isComplete() and item.lookahead.size == 0
          console.warn "Warning: Item has no lookaheads: #{item.toString()}"

  # ============================================================================
  # Table Building
  # ============================================================================

  # Build parse table
  buildTable: ->
    table = []
    conflicts = { sr: 0, rr: 0 }

    for state in @states
      table[state.id] = {}

      # Shift actions and GOTO
      for [symbol, nextState] from state.transitions
        if @getSymbol(symbol).isTerminal
          table[state.id][symbol] = { type: 'shift', state: nextState.id }
        else
          table[state.id][symbol] = nextState.id  # GOTO

      # Reduce actions
      for item in state.items
        continue unless item.isComplete()

        # Special case for accept
        if item.rule.lhs is '$accept'
          table[state.id]['$end'] = { type: 'accept' }
          continue

        # Add reduce action for each lookahead
        for la from item.lookahead
          if table[state.id][la]?
            # Conflict!
            existing = table[state.id][la]
            if existing.type is 'shift'
              # Shift/reduce conflict - try to resolve with precedence
              resolved = @resolveConflict(item.rule, la)
              if resolved == 'reduce'
                table[state.id][la] = { type: 'reduce', rule: item.rule.id }
                # Add resolved conflict information
                conflict = {
                  type: 'shift/reduce'
                  state: state.id
                  lookahead: la
                  shiftTo: existing.state
                  reduceBy: item.rule
                  resolved: true
                  resolution: 'reduce'
                  explanation: @explainShiftReduceConflict(state, item, existing, la, 'reduce')
                }
                @conflicts.push(conflict)
              else if resolved == 'shift'
                # keep existing shift (default)
                # Add resolved conflict information
                conflict = {
                  type: 'shift/reduce'
                  state: state.id
                  lookahead: la
                  shiftTo: existing.state
                  reduceBy: item.rule
                  resolved: true
                  resolution: 'shift'
                  explanation: @explainShiftReduceConflict(state, item, existing, la, 'shift')
                }
                @conflicts.push(conflict)
              else
                # unresolved conflict
                conflicts.sr++
                state.inadequate = true
                @inadequateStates.push(state) unless @inadequateStates.includes(state)

                # Add detailed conflict information
                conflict = {
                  type: 'shift/reduce'
                  state: state.id
                  lookahead: la
                  shiftTo: existing.state
                  reduceBy: item.rule
                  resolved: false
                  resolution: 'shift' # default resolution
                  explanation: @explainShiftReduceConflict(state, item, existing, la)
                }
                @conflicts.push(conflict)

            else
              # Reduce/reduce conflict - use first rule (earliest in grammar)
              if existing.type is 'reduce'
                existingRuleId = existing.rule
              else
                # Unexpected: existing action is not shift or reduce
                console.warn "Warning: Unexpected existing action type in reduce/reduce conflict: #{existing.type || 'undefined'}"
                existingRuleId = existing.rule || existing

              # Compare rule IDs and keep the earlier rule (lower ID)
              winningRule = if item.rule.id < existingRuleId then item.rule else @rules[existingRuleId]
              losingRule = if item.rule.id < existingRuleId then @rules[existingRuleId] else item.rule

              if item.rule.id < existingRuleId
                table[state.id][la] = { type: 'reduce', rule: item.rule.id }
              # else keep the existing action (it has a lower rule ID)

              # Add reduce/reduce conflict information
              conflict = {
                type: 'reduce/reduce'
                state: state.id
                lookahead: la
                rule1: winningRule
                rule2: losingRule
                resolved: true
                resolution: "rule #{winningRule.id} (first declared)"
                explanation: @explainReduceReduceConflict(state, winningRule, losingRule, la)
              }
              @conflicts.push(conflict)

              conflicts.rr++
          else
            table[state.id][la] = { type: 'reduce', rule: item.rule.id }

    if conflicts.sr > 0 or conflicts.rr > 0
      console.warn("Grammar has conflicts: #{conflicts.sr} shift/reduce, #{conflicts.rr} reduce/reduce")

    table

  # Resolve shift/reduce conflicts using precedence and associativity
  resolveConflict: (rule, lookahead) ->
    # Get precedence of the rule (from its precedence or rightmost terminal)
    rulePrecedence = @getRulePrecedence(rule)

    # Get precedence of the lookahead token
    tokenPrecedence = @precedence[lookahead]

    # If either lacks precedence, can't resolve
    return false unless rulePrecedence and tokenPrecedence

    # Higher precedence wins
    if rulePrecedence.level > tokenPrecedence.level
      'reduce'
    else if rulePrecedence.level < tokenPrecedence.level
      'shift'
    else
      # Same precedence - use associativity
      switch rulePrecedence.assoc
        when 'left'     then 'reduce'
        when 'right'    then 'shift'
        when 'nonassoc' then 'error'
        else null # Neither, also an error

  # Get precedence for a rule
  getRulePrecedence: (rule) ->
    # If rule has explicit precedence, use it
    if rule.precedence
      return @precedence[rule.precedence]

    # Otherwise, use precedence of rightmost terminal
    for i in [rule.rhs.length - 1..0] by -1
      symbol = rule.rhs[i]
      if @tokens.has(symbol) and @precedence[symbol]
        return @precedence[symbol]

    null

  # Explain a shift/reduce conflict in detail
  explainShiftReduceConflict: (state, reduceItem, shiftAction, lookahead, resolution = null) ->
    explanation = []
    explanation.push "Shift/Reduce conflict in state #{state.id}:"
    explanation.push ""
    explanation.push "When seeing '#{lookahead}', the parser could either:"
    explanation.push "  1. Shift to state #{shiftAction.state}"
    explanation.push "  2. Reduce using: #{reduceItem.rule.lhs} → #{reduceItem.rule.rhs.join(' ')}"
    explanation.push ""

    if resolution
      explanation.push "Resolution: #{resolution} (#{@getResolutionReason(reduceItem.rule, lookahead, resolution)})"
    else
      explanation.push "Resolution: shift (default - no precedence declared)"

    explanation.push ""
    explanation.push @suggestShiftReduceFixes(reduceItem.rule, lookahead)

    explanation.join('\n')

  # Explain a reduce/reduce conflict in detail
  explainReduceReduceConflict: (state, rule1, rule2, lookahead) ->
    explanation = []
    explanation.push "Reduce/Reduce conflict in state #{state.id}:"
    explanation.push ""
    explanation.push "When seeing '#{lookahead}', the parser could reduce using either:"
    explanation.push "  1. #{rule1.lhs} → #{rule1.rhs.join(' ')} (rule #{rule1.id})"
    explanation.push "  2. #{rule2.lhs} → #{rule2.rhs.join(' ')} (rule #{rule2.id})"
    explanation.push ""
    explanation.push "Resolution: Using rule #{rule1.id} (first declared in grammar)"
    explanation.push ""
    explanation.push @suggestReduceReduceFixes(rule1, rule2, lookahead)

    explanation.join('\n')

  # Get the reason for conflict resolution
  getResolutionReason: (rule, lookahead, resolution) ->
    rulePrecedence = @getRulePrecedence(rule)
    tokenPrecedence = @precedence[lookahead]

    return "no precedence declared" unless rulePrecedence and tokenPrecedence

    if rulePrecedence.level > tokenPrecedence.level
      "rule has higher precedence"
    else if rulePrecedence.level < tokenPrecedence.level
      "token has higher precedence"
    else
      switch rulePrecedence.assoc
        when 'left' then "left associative"
        when 'right' then "right associative"
        when 'nonassoc' then "non-associative"
        else "same precedence, unknown associativity"

  # Suggest fixes for shift/reduce conflicts
  suggestShiftReduceFixes: (rule, lookahead) ->
    fixes = []
    fixes.push "Possible solutions:"

    rulePrecedence = @getRulePrecedence(rule)
    tokenPrecedence = @precedence[lookahead]

    if not rulePrecedence and not tokenPrecedence
      fixes.push "  - Add precedence declarations for '#{lookahead}' and rule symbols"
      fixes.push "  - Use %left, %right, or %nonassoc to declare precedence"
    else if not rulePrecedence
      fixes.push "  - Add precedence declaration for rule: %prec SYMBOL"
    else if not tokenPrecedence
      fixes.push "  - Add precedence declaration for token '#{lookahead}'"
    else
      fixes.push "  - Adjust precedence levels to resolve ambiguity"

    fixes.push "  - Rewrite grammar to be unambiguous"
    fixes.push "  - Accept the default resolution (shift)"

    fixes.join('\n')

  # Suggest fixes for reduce/reduce conflicts
  suggestReduceReduceFixes: (rule1, rule2, lookahead) ->
    fixes = []
    fixes.push "Possible solutions:"
    fixes.push "  - Combine similar rules if they represent the same construct"
    fixes.push "  - Add distinguishing tokens to make rules unambiguous"
    fixes.push "  - Use semantic predicates if available"
    fixes.push "  - Restructure grammar to eliminate ambiguity"
    fixes.push "  - Accept the default resolution (first rule declared)"

    # Check if rules have similar structure
    if rule1.rhs.length == rule2.rhs.length
      similarities = 0
      for i in [0...rule1.rhs.length]
        if rule1.rhs[i] == rule2.rhs[i]
          similarities++

      if similarities > rule1.rhs.length / 2
        fixes.push "  - Rules appear similar - consider if they can be merged"

    fixes.join('\n')

  # Comprehensive state minimization
  minimizeStates: ->
    initialStateCount = @states.length

    # Step 1: Remove unreachable states
    reachableStates = @findReachableStates()
    unreachableCount = @states.length - reachableStates.size
    if unreachableCount > 0
      @removeUnreachableStates(reachableStates)

    # Step 2: Merge equivalent states (same actions for all symbols)
    mergedCount = @mergeEquivalentStates()

    # Step 3: Merge weakly compatible states
    weakMergedCount = @mergeWeaklyCompatibleStates()

    # Step 4: Rebuild table with minimized states
    @rebuildTableAfterMinimization()

    finalStateCount = @states.length
    reduction = initialStateCount - finalStateCount
    reductionPercent = Math.round((reduction / initialStateCount) * 100)

    # Report minimization results
    unreachableText = if unreachableCount > 0 then "Removed #{unreachableCount} unreachable states" else ""
    mergedText = if mergedCount > 0 then "Merged #{mergedCount} equivalent states" else ""
    weakMergedText = if weakMergedCount > 0 then "Merged #{weakMergedCount} weakly compatible states" else ""
    reductionText = if reduction > 0 then "Reduction: #{reduction} states (#{reductionPercent}%)" else "No states eliminated"

    console.log """

    🔧 State Minimization:
    Initial states: #{initialStateCount}
    #{unreachableText}
    #{mergedText}
    #{weakMergedText}
    Final states: #{finalStateCount}
    #{reductionText}
    """

  # Find all states reachable from the start state
  findReachableStates: ->
    reachable = new Set()
    workList = [@states[0]] # Start with initial state
    reachable.add(@states[0])

    while workList.length > 0
      state = workList.shift()

      for [symbol, nextState] from state.transitions
        unless reachable.has(nextState)
          reachable.add(nextState)
          workList.push(nextState)

    reachable

  # Remove unreachable states
  removeUnreachableStates: (reachableStates) ->
    # Filter states to keep only reachable ones
    @states = @states.filter (state) -> reachableStates.has(state)

    # Reassign state IDs
    for state, i in @states
      state.id = i

    # Update inadequate states list
    @inadequateStates = @inadequateStates.filter (state) -> reachableStates.has(state)

  # Merge states that have identical actions for all symbols
  mergeEquivalentStates: ->
    mergedCount = 0
    stateGroups = new Map() # action signature -> [states]

    # Group states by their action signatures
    for state in @states
      signature = @computeActionSignature(state)
      unless stateGroups.has(signature)
        stateGroups.set(signature, [])
      stateGroups.get(signature).push(state)

    # Merge groups with multiple states
    for [signature, states] from stateGroups
      if states.length > 1
        # Keep the first state, merge others into it
        targetState = states[0]

        for i in [1...states.length]
          sourceState = states[i]
          @mergeStateInto(sourceState, targetState)
          mergedCount++

    # Remove merged states and reassign IDs
    @states = Array.from(stateGroups.values()).map (group) -> group[0]
    for state, i in @states
      state.id = i

    mergedCount

  # Compute a signature representing the actions available in a state
  computeActionSignature: (state) ->
    actions = []

    # Add shift actions
    for [symbol, nextState] from state.transitions
      if @getSymbol(symbol).isTerminal
        actions.push("shift:#{symbol}")
      else
        actions.push("goto:#{symbol}")

    # Add reduce actions
    for item in state.items
      if item.isComplete()
        for la from item.lookahead
          actions.push("reduce:#{la}:#{item.rule.id}")

    actions.sort().join('|')

    # Merge weakly compatible states (experimental)
  mergeWeaklyCompatibleStates: ->
    mergedCount = 0

    # Find pairs of states that are weakly compatible
    # (have no conflicting actions for any symbol)
    i = 0
    while i < @states.length
      j = i + 1
      merged = false
      while j < @states.length
        state1 = @states[i]
        state2 = @states[j]

        # Safety check - ensure states exist and have required properties
        if state1 and state2 and state1.transitions and state2.transitions and @areWeaklyCompatible(state1, state2)
          # Merge state2 into state1
          @mergeStateInto(state2, state1)
          @states.splice(j, 1) # Remove state2
          mergedCount++
          merged = true
          break # Restart the inner loop
        else
          j++

      if not merged
        i++

    # Reassign state IDs
    for state, i in @states
      state.id = i

    mergedCount

    # Check if two states are weakly compatible
  areWeaklyCompatible: (state1, state2) ->
    # Safety checks
    return false unless state1 and state2
    return false unless state1.transitions and state2.transitions
    return false unless state1.items and state2.items

    # Get all symbols that have actions in either state
    symbols = new Set()

    for [symbol, _] from state1.transitions
      symbols.add(symbol)
    for [symbol, _] from state2.transitions
      symbols.add(symbol)

    for item in state1.items
      if item and item.isComplete and item.isComplete()
        for la from item.lookahead
          symbols.add(la)

    for item in state2.items
      if item and item.isComplete and item.isComplete()
        for la from item.lookahead
          symbols.add(la)

    # Check each symbol for conflicts
    for symbol from symbols
      action1 = @getStateAction(state1, symbol)
      action2 = @getStateAction(state2, symbol)

      # If both states have actions for this symbol, they must be the same
      if action1 and action2 and not @actionsEqual(action1, action2)
        return false

    true

  # Get the action for a symbol in a state
  getStateAction: (state, symbol) ->
    # Check transitions first
    if state.transitions.has(symbol)
      nextState = state.transitions.get(symbol)
      if @getSymbol(symbol).isTerminal
        return { type: 'shift', state: nextState.id }
      else
        return { type: 'goto', state: nextState.id }

    # Check reduce actions
    for item in state.items
      if item.isComplete() and item.lookahead.has(symbol)
        if item.rule.lhs is '$accept'
          return { type: 'accept' }
        else
          return { type: 'reduce', rule: item.rule.id }

    null

  # Check if two actions are equal
  actionsEqual: (action1, action2) ->
    return false if action1.type != action2.type

    switch action1.type
      when 'shift', 'goto'
        action1.state == action2.state
      when 'reduce'
        action1.rule == action2.rule
      when 'accept'
        true
      else
        false

    # Merge one state into another
  mergeStateInto: (sourceState, targetState) ->
    # Safety checks
    return unless sourceState and targetState
    return unless sourceState.items and targetState.items

    # Merge items (this is complex due to lookaheads)
    for sourceItem in sourceState.items
      continue unless sourceItem and sourceItem.rule

      # Find corresponding item in target state
      targetItem = targetState.getCoreItem(sourceItem.rule.id, sourceItem.dot)

      if targetItem
        # Merge lookaheads
        if sourceItem.lookahead
          for la from sourceItem.lookahead
            targetItem.lookahead.add(la)
      else
        # Add the item to target state
        targetState.addItem(sourceItem)

    # Update all transitions that point to sourceState
    for state in @states
      continue unless state and state.transitions
      for [symbol, nextState] from state.transitions
        if nextState == sourceState
          state.transitions.set(symbol, targetState)

  # Rebuild the parsing table after state minimization
  rebuildTableAfterMinimization: ->
    # Clear existing table
    @table = []

    # Rebuild from minimized states
    @table = @buildTable()

  computeDefaultActions: ->
    @defaultActions = {}

    # A state can have a default action if:
    # 1. All actions in the state are reduces by the same rule, OR
    # 2. The state has no shift actions and only one unique reduce action
    for state in @states
      continue unless @table[state.id] # Skip if no table entry

      actions = @table[state.id]
      actionTypes = new Set()
      reduceRules = new Set()
      hasShift = false

      # Analyze all actions in this state
      for symbol, action of actions
        if action.type is 'shift'
          hasShift = true
        else if action.type is 'reduce'
          actionTypes.add('reduce')
          reduceRules.add(action.rule)
        else if action.type is 'accept'
          actionTypes.add('accept')
          # Accept states cannot have default actions
          hasShift = true # Prevent default action

      # Can use default reduction if:
      # - No shift actions
      # - Only reduce actions
      # - All reduces are for the same rule
      if not hasShift and actionTypes.size <= 1 and reduceRules.size == 1
        ruleId = [...reduceRules][0]
        @defaultActions[state.id] = [2, ruleId]

  # Report performance statistics
  reportPerformanceStats: ->
    hitRateText = if @performanceStats.closureCalls > 0
      hitRate = Math.round((@performanceStats.cacheHits / @performanceStats.closureCalls) * 100)
      "Cache hit rate: #{hitRate}%"
    else
      ""

    optimizationText = if @performanceStats.optimizationTime > 0
      if @optimizedTable
        """Table optimization: #{@performanceStats.optimizationTime}ms
        Optimization method: #{@optimizedTable.format}"""
      else
        """Table optimization: #{@performanceStats.optimizationTime}ms
        Optimization: skipped (small grammar)"""
    else
      ""

    cacheSize = @coreCache.size + @closureCache.size

    console.log """

    📊 Performance Statistics:
    =========================
    Closure computations: #{@performanceStats.closureCalls}
    Cache hits: #{@performanceStats.cacheHits}
    #{hitRateText}
    States created: #{@states.length}
    Rules processed: #{@rules.length}
    Symbols: #{@symbols.size}
    #{optimizationText}
    Cache entries: #{cacheSize}
    """

  # ============================================================================
  # Code Generation
  # ============================================================================

  # Generate parser code
  generate: (options = {}) ->
    try
      @processGrammar(options)
    catch error
      # Enhanced error reporting for grammar validation failures
      console.error("\n❌ GRAMMAR VALIDATION ERROR:")
      console.error("=" * 50)
      console.error(error.message)
      console.error("\n💡 Common fixes:")
      console.error("  - Check grammar object structure")
      console.error("  - Verify all non-terminals have valid productions")
      console.error("  - Ensure symbol names are valid identifiers")
      console.error("  - Check for typos in production patterns")
      console.error("  - Validate action code syntax")
      throw error

    # Grammar cleanup - iterate until no more changes
    # Order matters: unproductive first, then unreachable
    loop
      initialRuleCount = @rules.length
      initialSymbolCount = @symbols.size

      @eliminateUnproductive()
      @eliminateUnreachable()

      # Stop if no changes were made
      break if @rules.length == initialRuleCount and @symbols.size == initialSymbolCount

    @computeNullable()
    @computeFirst()
    @computeFollow()
    @buildStates()
    @computeLookaheads()
    @propagateLookaheads()
    @table = @buildTable()

    # State minimization and optimization
    @minimizeStates()

    # Smart table optimization (Bug #20 Fix) - only when beneficial
    @smartOptimizeTable()

    @computeDefaultActions()

    # Report conflicts if any
    @reportConflicts() if @conflicts.length > 0

    # Report performance statistics
    @reportPerformanceStats()

    # Now generate the parser code
    @generateCommonJS(options)

  # Build performAction from grammar
  buildPerformAction: ->

    # Process each rule and its action
    # Parameter mapping for rule A → B C D (length=3):
    # $1 → B → $$[$0-2], $2 → C → $$[$0-1], $3 → D → $$[$0]
    # @1 → B → _$[_$.length-1-2], @2 → C → _$[_$.length-1-1], @3 → D → _$[_$.length-1]
    for rule, i in @rules
    actionCases = for rule, i in @rules
      action = rule.action || 'this.$ = $$[$0];'

      # Convert action to string if it's a function
      if typeof action is 'function'
        action = action.toString()
        # Extract function body
        match = action.match(/^(?:function\s*\([^)]*\)|[^=]+=>)\s*\{?\s*([\s\S]*?)\s*\}?\s*$/)
        if match
          action = match[1]
        else
          # Handle arrow functions without braces
          match = action.match(/^[^>]+>\s*(.*)$/)
          action = if match then match[1] else action

      # Replace @$ with this.$
      action = action.replace /@\$/g, 'this.$'

      # First replace standalone $$ with this.$ (assignment target)
      # This must be done before replacing $1, $2, etc.
      action = action.replace /\$\$/g, 'this.$'

      # Then replace positional parameters ($1, $2, etc.) with stack references
      # For rule A → B C D, the stack has [..., B, C, D] where:
      # $1 should access B (at $$[$0-2]), $2 → C (at $$[$0-1]), $3 → D (at $$[$0])
      action = action.replace /\$(\d+)/g, (match, n) ->
        paramNum = parseInt(n, 10)
        if paramNum < 1 or paramNum > rule.rhs.length
          console.warn "Warning: Parameter $#{paramNum} out of range for rule with #{rule.rhs.length} symbols: #{rule.lhs} → #{rule.rhs.join(' ')}"
          return match # Leave unchanged if invalid

        # Calculate stack offset: $1 is at the bottom, $N is at the top
        stackOffset = rule.rhs.length - paramNum
        if stackOffset == 0
          "$$[$0]"  # Top of stack
        else
          "$$[$0-#{stackOffset}]"  # Offset from top

      # Replace $0 with rule length
      action = action.replace /\$0/g, rule.rhs.length.toString()

      # Replace @ location references (@1, @2, etc.) with JavaScript equivalents
      action = action.replace /@(\d+)/g, (match, n) ->
        paramNum = parseInt(n, 10)
        if paramNum < 1 or paramNum > rule.rhs.length
          console.warn "Warning: Location parameter @#{paramNum} out of range for rule with #{rule.rhs.length} symbols: #{rule.lhs} → #{rule.rhs.join(' ')}"
          return match # Leave unchanged if invalid

        # Calculate location stack offset: @1 is at the bottom, @N is at the top
        stackOffset = rule.rhs.length - paramNum
        if stackOffset == 0
          "_$[_$.length - 1]"  # Top of location stack
        else
          "_$[_$.length - 1 - #{stackOffset}]"  # Offset from top

      # Generate case statement
      """
      case #{i}: // #{rule.lhs} → #{rule.rhs.join(' ')}
        var $0 = $$.length - 1;
        #{action}
        break;"""

    """performAction: function(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
      switch (yystate) {#{actionCases.join('')}
      }
    }"""

  # Convert table to format expected by parser
  prepareTable: ->
    table = []
    for state, i in @states
      stateTable = {}
      if @table[i]
        for symbol, action of @table[i]
          symbolId = @symbols.get(symbol)?.id
          if symbolId?
            if action.type?
              # Terminal action (shift/reduce/accept)
              if action.type == 'shift'
                stateTable[symbolId] = [1, action.state]
              else if action.type == 'reduce'
                stateTable[symbolId] = [2, action.rule]
              else if action.type == 'accept'
                stateTable[symbolId] = [3]
            else
              # Nonterminal goto
              stateTable[symbolId] = action
      table.push stateTable
    table

  # Prepare rules array for parser
  prepareRules: ->
    rulesArray = [0, 0] # seed with zeroes
    # two elements are nonterminal_id and handle_length
    for rule in @rules
      nonterminalId = @symbols.get(rule.lhs)?.id || 0
      handleLength = rule.rhs.length
      rulesArray.push nonterminalId, handleLength
    rulesArray

  # Prepare symbols object
  prepareSymbols: ->
    symbols = {}
    for [name, symbol] from @symbols
      symbols[name] = symbol.id
    symbols

  # Prepare tokens object (terminals only)
  prepareTokens: ->
    tokens = {}
    # tokens[v.id] = k for [k, v] from @symbols when v.isTerminal
    tokens[v.id] = k for [k, v] from @symbols when @tokens.has(k)
    tokens

  # JSON stringify with numeric keys
  jsonStringifyWithNumericKeys: (obj) ->
    # First stringify normally, then replace quoted numeric keys
    # Use word boundaries to ensure we only match complete numbers
    JSON.stringify(obj).replace(/"(\d+)":/g, '$1:')

  # Generate CommonJS module
  generateCommonJS: (options = {}) ->
    # Check if high-performance mode is requested
    if options.highPerformance
      return @generateOptimizedCommonJS(options)

    # Check if source maps are requested
    if options.sourceMap
      return @generateWithSourceMap(options)

    # Prepare data structures
    table   = @prepareOptimizedTable()
    rules   = @prepareRules()
    symbols = @prepareSymbols()
    tokens  = @prepareTokens()

    # Get semantic actions from grammar
    performAction = options.performAction || @buildPerformAction()

    # Generate console overrides if needed
    consoleOverrides = @generateConsoleOverrides(options)

    """
/* Generated by rip-parser 1.0.0 */

const parser = (() => {
#{consoleOverrides}
  const parser = {
    trace: () => { },
    yy: { },
    symbols_: #{ JSON.stringify(symbols) },
    terminals_: #{ @jsonStringifyWithNumericKeys(tokens) },
    productions_: #{ JSON.stringify(rules) },
    #{performAction},
    table: #{ @jsonStringifyWithNumericKeys(table) },
    defaultActions: #{ JSON.stringify(@defaultActions) },

    parseError(str, hash) {
      if (hash.recoverable) {
        this.trace(str);
      } else {
        const err = new Error(str);
        err.hash = hash;
        throw err;
      }
    },

    attemptErrorRecovery(errStr, hash, stack, vstack, lstack, symbol, lex, unlex) {
      // Error recovery strategies:
      // 1. Look for error productions in current state
      // 2. Panic mode: pop stack until we find a state that can handle 'error'
      // 3. Skip tokens until we find a synchronizing token

      const TERROR = 2;
      const errorSymbol = TERROR;

      // Strategy 1: Check if current state has an error production
      let state = stack[stack.length - 1];
      if (this.table[state] && this.table[state][errorSymbol]) {
        // Shift the error token
        stack.push(errorSymbol);
        vstack.push(hash);
        lstack.push(hash.loc || {});
        stack.push(this.table[state][errorSymbol][1]);
        return true; // Recovery successful
      }

      // Strategy 2: Panic mode - pop stack until we find a state with error production
      let popCount = 0;
      const maxPops = Math.min(stack.length / 2, 10); // Limit stack unwinding

      while (popCount < maxPops && stack.length > 2) {
        // Pop one symbol from stack
        stack.pop(); // state
        stack.pop(); // symbol
        vstack.pop();
        lstack.pop();
        popCount++;

        state = stack[stack.length - 1];
        if (this.table[state] && this.table[state][errorSymbol]) {
          // Found a state that can handle error
          stack.push(errorSymbol);
          vstack.push(hash);
          lstack.push(hash.loc || {});
          stack.push(this.table[state][errorSymbol][1]);

          // Skip tokens until we find a synchronizing token
          this.skipToSynchronizingToken(lex, unlex, hash.expected || []);
          return true; // Recovery successful
        }
      }

      // Strategy 3: If we can't find error production, try simple token skipping
      if (this.skipToSynchronizingToken(lex, unlex, hash.expected || [])) {
        return false; // Let caller decide what to do
      }

      return false; // Recovery failed
    },

    skipToSynchronizingToken(lex, unlex, expected) {
      // Common synchronizing tokens (customize based on language)
      const syncTokens = new Set([
        ';', '}', ')', ']', 'EOF', 'NEWLINE', 'INDENT', 'OUTDENT'
      ]);

      // Also consider expected tokens as potential sync points
      for (const exp of expected) {
        if (exp && typeof exp === 'string') {
          syncTokens.add(exp.replace(/'/g, '')); // Remove quotes
        }
      }

      let skipped = 0;
      const maxSkip = 20; // Prevent infinite loops

      while (skipped < maxSkip) {
        const token = lex();
        if (!token || token === 1) { // EOF
          return false;
        }

        const tokenName = this.terminals_[token] || token;
        if (syncTokens.has(tokenName)) {
          // Found a synchronizing token, put it back for normal processing
          unlex(token);
          return true;
        }

        skipped++;
      }

      return false; // Couldn't find sync token
    },

    parse(input) {
      const self = this;
      let stack = [0];
      let vstack = [null];
      let lstack = [];
      let yytext = '';
      let yylineno = 0;
      let yyleng = 0;
      let recovering = 0;
      let TERROR = 2;
      let EOF = 1;

      const args = [].slice.call(arguments, 1);

      // The generated parser doesn't have a lexer, it's provided externally
      const lexer = Object.assign({}, this.lexer, this.yy.lexer);
      const sharedState = { yy: {} };

      // Copy state
      for (const k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
          sharedState.yy[k] = this.yy[k];
        }
      }

      lexer.setInput(input, sharedState.yy);
      sharedState.yy.lexer = lexer;
      sharedState.yy.parser = this;

      if (typeof lexer.yylloc === 'undefined') {
        lexer.yylloc = {};
      }
      let yyloc = lexer.yylloc;
      lstack.push(yyloc);

      const ranges = lexer.options && lexer.options.ranges;

      if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
      } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
      }

      let symbol, preErrorSymbol, state, action, r, yyval = {}, p, len, newState, expected;
      let tokenBuffer = []; // Buffer for putting back tokens during error recovery

      while (true) {
        // Retrieve state from top of stack
        state = stack[stack.length - 1];

        // Use default action if available
        if (this.defaultActions[state]) {
          action = this.defaultActions[state];
        } else {
          if (symbol === null || symbol === undefined) {
            symbol = lex();
          }
          // Get action from table
          action = this.table[state] && this.table[state][symbol];
        }

        // Handle parsing error
        if (typeof action === 'undefined' || !action.length || !action[0]) {
          let errStr = '';

          // Collect expected tokens
          expected = [];
          for (p in this.table[state]) {
            if (this.terminals_[p] && p > TERROR) {
              expected.push("'" + this.terminals_[p] + "'");
            }
          }

          if (lexer.showPosition) {
            errStr = 'Parse error on line ' + (yylineno + 1) + ":\\n" + lexer.showPosition() + "\\nExpecting " + expected.join(', ') + ", got '" + (this.terminals_[symbol] || symbol) + "'";
          } else {
            errStr = 'Parse error on line ' + (yylineno + 1) + ": Unexpected " +
                     (symbol == EOF ? "end of input" :
                      ("'" + (this.terminals_[symbol] || symbol) + "'"));
          }

          // Try error recovery
          if (this.attemptErrorRecovery(errStr, {
            text: lexer.match,
            token: this.terminals_[symbol] || symbol,
            line: lexer.yylineno,
            loc: yyloc,
            expected: expected,
            recoverable: true
          }, stack, vstack, lstack, symbol, lex, unlex)) {
            // Recovery successful, continue parsing
            recovering = 3; // Set recovery mode for next few tokens
            symbol = null; // Force getting next token
            continue;
          }

          // Recovery failed, call parseError
          this.parseError(errStr, {
            text: lexer.match,
            token: this.terminals_[symbol] || symbol,
            line: lexer.yylineno,
            loc: yyloc,
            expected: expected
          });
        }

        // Execute action
        if (action[0] instanceof Array && action.length > 1) {
          throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }

        switch (action[0]) {
          case 1: // shift
            stack.push(symbol);
            vstack.push(lexer.yytext);
            lstack.push(lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
              yyleng = lexer.yyleng;
              yytext = lexer.yytext;
              yylineno = lexer.yylineno;
              yyloc = lexer.yylloc;
              if (recovering > 0) {
                recovering--;
              }
            } else {
              symbol = preErrorSymbol;
              preErrorSymbol = null;
            }
            break;

          case 2: // reduce
            len = this.productions_[action[1] * 2 + 1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
              first_line: lstack[lstack.length - (len || 1)].first_line,
              last_line: lstack[lstack.length - 1].last_line,
              first_column: lstack[lstack.length - (len || 1)].first_column,
              last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
              yyval._$.range = [
                lstack[lstack.length - (len || 1)].range[0],
                lstack[lstack.length - 1].range[1]
              ];
            }
            r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], vstack, lstack].concat(args));

            if (typeof r !== 'undefined') {
              return r;
            }

            if (len) {
              stack = stack.slice(0, -1 * len * 2);
              vstack = vstack.slice(0, -1 * len);
              lstack = lstack.slice(0, -1 * len);
            }

            stack.push(this.productions_[action[1] * 2]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = this.table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;

          case 3: // accept
            return true;
        }
      }

      function lex() {
        // First check if we have buffered tokens from error recovery
        if (tokenBuffer.length > 0) {
          return tokenBuffer.shift();
        }

        let token = lexer.lex() || EOF;
        // Convert string tokens to numeric IDs
        if (typeof token !== 'number') {
          // Handle CoffeeScript's empty string as EOF
          if (token === '') {
            token = EOF;
          } else {
            token = self.symbols_[token] || token;
          }
        }
        return token;
      }

      // Function to put a token back for later consumption
      function unlex(token) {
        tokenBuffer.unshift(token);
      }
    }
  };

  // Export parser and Parser class
  parser.Parser = parser.Parser || function Parser() { this.yy = {}; };
  parser.Parser.prototype = parser;
  parser.parse = parser.parse;
  return parser;
})();

// CommonJS module export
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  module.exports = {
    parser,
    Parser: parser.Parser,
    parse: (...args) => parser.parse(...args),
    main(args = process.argv.slice(1)) {
      const [prog, file] = args;
      if (!file) {
        console.error(`Usage: ${prog} FILE`);
        process.exit(1);
      }
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(path.resolve(file), 'utf8');
      return parser.parse(source);
    }
  };
  if (require.main === module) {
    module.exports.main();
  }
}
    """

  # ============================================================================
  # High-Performance Parser Generation (Bug #21 Fix)
  # ============================================================================

  # Generate optimized high-performance parser
  generateOptimizedCommonJS: (options = {}) ->
    # Prepare optimized data structures
    optimizedTable = @prepareOptimizedTableRuntime()
    optimizedActions = @prepareOptimizedActionDispatch()
    optimizedSymbols = @prepareOptimizedSymbolMapping()
    rules = @prepareRules()

    # Generate console overrides if needed
    consoleOverrides = @generateConsoleOverrides(options)

    """
/* High-Performance Parser - Generated by rip-parser (Bug #21 Fix) */

const parser = (() => {
  "use strict";
#{consoleOverrides}
  // Pre-compiled constants for maximum performance
  const TERROR = 2;
  const EOF = 1;
  const ACCEPT = 3;
  const SHIFT = 1;
  const REDUCE = 2;

  #{optimizedTable}
  #{optimizedSymbols}
  #{optimizedActions}

  // Production metadata for reductions
  const productions = #{JSON.stringify(rules)};
  const defaultActions = #{JSON.stringify(@defaultActions)};

  // High-performance parser class
  class OptimizedParser {
    constructor() {
      this.yy = {};
      this.lexer = null;

      // Pre-allocated stacks for better performance
      this.stateStack = new Int32Array(1000);
      this.symbolStack = new Int32Array(1000);
      this.valueStack = new Array(1000);
      this.locationStack = new Array(1000);
      this.stackTop = 0;

      // Performance counters
      this.stats = { tokens: 0, reductions: 0, shifts: 0, tableHits: 0 };
      this.recovering = 0;
      this.errorCount = 0;
      this.initializeStacks();
    }

    initializeStacks() {
      this.stateStack[0] = 0;
      this.stackTop = 0;
    }

    getAction(state, symbol) {
      this.stats.tableHits++;
      return getTableEntry(state, symbol);
    }

    pushState(state, symbol, value, location) {
      this.stackTop++;
      if (this.stackTop >= this.stateStack.length) {
        this.resizeStacks();
      }
      this.stateStack[this.stackTop] = state;
      this.symbolStack[this.stackTop] = symbol;
      this.valueStack[this.stackTop] = value;
      this.locationStack[this.stackTop] = location;
    }

    resizeStacks() {
      const newSize = this.stateStack.length * 2;
      const newStateStack = new Int32Array(newSize);
      const newSymbolStack = new Int32Array(newSize);
      const newValueStack = new Array(newSize);
      const newLocationStack = new Array(newSize);

      newStateStack.set(this.stateStack);
      newSymbolStack.set(this.symbolStack);
      for (let i = 0; i <= this.stackTop; i++) {
        newValueStack[i] = this.valueStack[i];
        newLocationStack[i] = this.locationStack[i];
      }

      this.stateStack = newStateStack;
      this.symbolStack = newSymbolStack;
      this.valueStack = newValueStack;
      this.locationStack = newLocationStack;
    }

    parse(input) {
      this.lexer.setInput(input, this.yy);
      this.initializeStacks();

      let symbol = null;
      let action = null;
      let state = 0;

      while (true) {
        state = this.stateStack[this.stackTop];

        if (defaultActions[state]) {
          action = defaultActions[state];
        } else {
          if (symbol === null) {
            symbol = this.nextToken();
            this.stats.tokens++;
          }
          action = this.getAction(state, symbol);
        }

        if (!action) {
          throw new Error(\`Parse error at token \${symbol}\`);
        }

        switch (action[0]) {
          case SHIFT:
            this.stats.shifts++;
            this.pushState(action[1], symbol, this.lexer.yytext, this.lexer.yylloc);
            symbol = null;
            break;

          case REDUCE:
            this.stats.reductions++;
            const ruleId = action[1];
            const ruleLength = productions[ruleId * 2 + 1];

            // Fast semantic action
            let result = null;
            if (actionTable[ruleId]) {
              result = actionTable[ruleId].call(this, this.valueStack, this.stackTop - ruleLength + 1);
            } else {
              result = ruleLength > 0 ? this.valueStack[this.stackTop - ruleLength + 1] : null;
            }

            // Pop stack
            this.stackTop -= ruleLength;

            // Push LHS and new state
            const lhs = productions[ruleId * 2];
            const lhsId = symbolToId[lhs];
            const newState = this.getAction(this.stateStack[this.stackTop], lhsId);
            this.pushState(newState, lhsId, result, {});

            if (result !== undefined && typeof result === 'object' && result._return) {
              return result._return;
            }
            break;

          case ACCEPT:
            return this.valueStack[this.stackTop];
        }
      }
    }

    nextToken() {
      let token = this.lexer.lex();
      if (!token || token === '') return EOF;
      return typeof token === 'number' ? token : (symbolToId[token] || token);
    }

    getStats() {
      return { ...this.stats, errorCount: this.errorCount, stackSize: this.stackTop + 1 };
    }

    reset() {
      this.initializeStacks();
      this.stats = { tokens: 0, reductions: 0, shifts: 0, tableHits: 0 };
    }
  }

  const parser = new OptimizedParser();
  parser.Parser = OptimizedParser;
  parser.parse = function(input) { return parser.parse(input); };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = parser;
  }
  return parser;
})();
    """

  # Prepare optimized table for runtime
  prepareOptimizedTableRuntime: ->
    if @optimizedTable
      switch @optimizedTable.format
        when 'COO' then @prepareCOOTableRuntime()
        when 'CSR' then @prepareCSRTableRuntime()
        when 'Dictionary' then @prepareDictionaryTableRuntime()
        when 'RLE' then @prepareRLETableRuntime()
        else @prepareSimpleTableRuntime()
    else
      @prepareSimpleTableRuntime()

  prepareSimpleTableRuntime: ->
    """
    const tableData = #{JSON.stringify(@table)};
    function getTableEntry(state, symbol) {
      const row = tableData[state];
      return row ? row[symbol] : undefined;
    }
    """

  prepareCOOTableRuntime: ->
    entries = @optimizedTable.data
    """
    const tableEntries = #{JSON.stringify(entries)};
    const tableLookup = new Map();
    for (const [state, symbol, action] of tableEntries) {
      tableLookup.set((state << 16) | symbol, action);
    }
    function getTableEntry(state, symbol) {
      return tableLookup.get((state << 16) | symbol);
    }
    """

  prepareOptimizedActionDispatch: ->
    actionEntries = for rule, i in @rules when rule.action and rule.action != 'this.$ = $$[$0];'
      actionCode = @convertActionToOptimized(rule.action, rule.rhs.length)
      "  #{i}: #{actionCode},"

    """
    const actionTable = {
#{actionEntries.join('\n')}
    };
    """

  convertActionToOptimized: (action, rhsLength) ->
    optimizedAction = action.replace(/\$\$/g, 'result')
    optimizedAction = optimizedAction.replace /\$(\d+)/g, (match, n) ->
      paramNum = parseInt(n, 10)
      if paramNum < 1 or paramNum > rhsLength then match
      else "valueStack[stackBase + #{paramNum - 1}]"

    """function(valueStack, stackBase) {
      let result = null;
      #{optimizedAction}
      return result;
    }"""

  prepareOptimizedSymbolMapping: ->
    symbolToId = {}
    for [name, symbol] from @symbols
      symbolToId[name] = symbol.id

    """
    const symbolToId = #{JSON.stringify(symbolToId)};
    """

  # ============================================================================
  # Debugging and Development Tools
  # ============================================================================

  printStatistics: ->
    console.log "\n=== GRAMMAR STATISTICS ==="
    console.log "Rules: #{@rules.length}"
    console.log "Symbols: #{@symbols.size}"
    console.log "  Terminals: #{[...@symbols.values()].filter((s) -> s.isTerminal).length}"
    console.log "  Non-terminals: #{[...@symbols.values()].filter((s) -> !s.isTerminal).length}"
    console.log "States: #{@states.length}"
    console.log "Inadequate states: #{@inadequateStates.length}"

  debugStateComparison: ->
    console.log "\n=== STATE CORES ==="
    for [core, state] from @stateMap
      console.log "\nState #{state.id}:"
      console.log "Core: #{core}"
      console.log "Items: #{state.items.length}"

  # Generate comprehensive debugging information
  generateDebugInfo: ->
    debugInfo = {
      grammar: @generateGrammarDebugInfo()
      states: @generateStateDebugInfo()
      conflicts: @generateConflictDebugInfo()
      symbols: @generateSymbolDebugInfo()
      rules: @generateRuleDebugInfo()
      table: @generateTableDebugInfo()
      performance: @performanceStats
    }
    debugInfo

  # Generate grammar debugging information
  generateGrammarDebugInfo: ->
    {
      startSymbol: @start
      ruleCount: @rules.length
      symbolCount: @symbols.size
      terminalCount: [...@symbols.values()].filter((s) -> s.isTerminal).length
      nonterminalCount: [...@symbols.values()].filter((s) -> !s.isTerminal).length
      stateCount: @states.length
      conflictCount: @conflicts.length
      inadequateStateCount: @inadequateStates.length
      hasLeftRecursion: @checkForLeftRecursion()
      hasRightRecursion: @checkForRightRecursion()
      cyclomaticComplexity: @calculateGrammarComplexity()
    }

  # Generate detailed state debugging information
  generateStateDebugInfo: ->
    stateInfo = []
    for state in @states
      stateData = {
        id: state.id
        itemCount: state.items.length
        items: state.items.map (item) -> item.toString()
        transitions: {}
        isInadequate: state.inadequate
        conflicts: @getStateConflicts(state.id)
        reductions: @getStateReductions(state)
        shifts: @getStateShifts(state)
        gotos: @getStateGotos(state)
      }

      # Add transition information
      for [symbol, nextState] from state.transitions
        stateData.transitions[symbol] = nextState.id

      stateInfo.push(stateData)
    stateInfo

  # Generate conflict debugging information
  generateConflictDebugInfo: ->
    conflictInfo = {
      total: @conflicts.length
      shiftReduce: @conflicts.filter((c) -> c.type == 'shift/reduce').length
      reduceReduce: @conflicts.filter((c) -> c.type == 'reduce/reduce').length
      resolved: @conflicts.filter((c) -> c.resolved).length
      unresolved: @conflicts.filter((c) -> !c.resolved).length
      details: @conflicts.map (conflict) -> {
        type: conflict.type
        state: conflict.state
        symbol: conflict.lookahead
        resolved: conflict.resolved
        resolution: conflict.resolution
        explanation: conflict.explanation
      }
    }
    conflictInfo

  # Generate symbol debugging information
  generateSymbolDebugInfo: ->
    symbolInfo = {}
    for [name, symbol] from @symbols
      symbolInfo[name] = {
        id: symbol.id
        isTerminal: symbol.isTerminal
        nullable: symbol.nullable
        first: [...symbol.first]
        follow: [...symbol.follow]
        usedInRules: @getRulesUsingSymbol(name)
        definedInRules: if symbol.isTerminal then [] else @getRulesDefiningSymbol(name)
      }
    symbolInfo

  # Generate rule debugging information
  generateRuleDebugInfo: ->
    ruleInfo = []
    for rule in @rules
      ruleInfo.push {
        id: rule.id
        lhs: rule.lhs
        rhs: rule.rhs
        action: rule.action
        precedence: rule.precedence
        isRecursive: @isRuleRecursive(rule)
        recursionType: @getRuleRecursionType(rule)
        length: rule.rhs.length
        usedInStates: @getStatesUsingRule(rule)
      }
    ruleInfo

  # Generate parsing table debugging information
  generateTableDebugInfo: ->
    tableInfo = {
      size: @states.length
      totalActions: 0
      actionTypes: { shift: 0, reduce: 0, goto: 0, accept: 0 }
      defaultActions: Object.keys(@defaultActions).length
      sparsity: 0
    }

    totalCells = 0
    filledCells = 0

    for state in @states
      if @table[state.id]
        for symbol, action of @table[state.id]
          totalCells++
          if action?
            filledCells++
            tableInfo.totalActions++

            if action.type
              tableInfo.actionTypes[action.type]++
            else
              tableInfo.actionTypes.goto++

      totalCells += @symbols.size

    tableInfo.sparsity = Math.round((1 - filledCells / totalCells) * 100)
    tableInfo

  # Interactive debugging methods
  exploreState: (stateId) ->
    return "Invalid state ID" unless stateId >= 0 and stateId < @states.length

    state = @states[stateId]
    console.log "\n🔍 EXPLORING STATE #{stateId}"
    console.log "=" * 30
    console.log "Items:"
    for item in state.items
      console.log "  #{item.toString()}"

    console.log "\nTransitions:"
    for [symbol, nextState] from state.transitions
      symbolType = if @getSymbol(symbol).isTerminal then "T" else "NT"
      console.log "  #{symbol} (#{symbolType}) → State #{nextState.id}"

    if @table[stateId]
      console.log "\nActions:"
      for symbol, action of @table[stateId]
        if action.type
          console.log "  #{symbol}: #{action.type} #{action.state || action.rule || ''}"
        else
          console.log "  #{symbol}: goto #{action}"

    conflicts = @getStateConflicts(stateId)
    if conflicts.length > 0
      console.log "\nConflicts:"
      for conflict in conflicts
        console.log "  #{conflict.type} on '#{conflict.lookahead}'"

  exploreRule: (ruleId) ->
    return "Invalid rule ID" unless ruleId >= 0 and ruleId < @rules.length

    rule = @rules[ruleId]
    console.log "\n🔍 EXPLORING RULE #{ruleId}"
    console.log "=" * 30
    console.log "Production: #{rule.lhs} → #{rule.rhs.join(' ')}"
    console.log "Action: #{rule.action || 'default'}"
    console.log "Precedence: #{rule.precedence || 'none'}"

    # Find states containing this rule
    statesWithRule = []
    for state in @states
      for item in state.items
        if item.rule.id == ruleId
          statesWithRule.push({ state: state.id, dot: item.dot, lookahead: [...item.lookahead] })

    if statesWithRule.length > 0
      console.log "\nUsed in states:"
      for usage in statesWithRule
        console.log "  State #{usage.state}: dot at #{usage.dot}, lookahead [#{usage.lookahead.join(', ')}]"

  exploreConflict: (conflictIndex) ->
    return "Invalid conflict index" unless conflictIndex >= 0 and conflictIndex < @conflicts.length

    conflict = @conflicts[conflictIndex]
    console.log "\n🔍 EXPLORING CONFLICT #{conflictIndex}"
    console.log "=" * 35
    console.log conflict.explanation

    # Show the state causing the conflict
    console.log "\nState #{conflict.state} details:"
    @exploreState(conflict.state)

  # Generate visual representation of the automaton
  generateStateMachineVisualization: (format = 'dot') ->
    switch format
      when 'dot'
        @generateDotVisualization()
      when 'mermaid'
        @generateMermaidVisualization()
      else
        "Unsupported format. Use 'dot' or 'mermaid'"

  generateDotVisualization: ->
    stateDeclarations = for state in @states
      label = "#{state.id}"
      if state.inadequate
        "  #{state.id} [label=\"#{label}\", color=red];"
      else
        "  #{state.id} [label=\"#{label}\"];"

    transitions = for state in @states
      for [symbol, nextState] from state.transitions
        "  #{state.id} -> #{nextState.id} [label=\"#{symbol}\"];"

    """
digraph LALR1_Automaton {
  rankdir=LR;
  node [shape=circle];

#{stateDeclarations.join('\n')}

#{transitions.flat().join('\n')}
}"""

  generateMermaidVisualization: ->
    stateNodes = for state in @states
      if state.inadequate
        "  #{state.id}[\"State #{state.id}\"]:::conflict"
      else
        "  #{state.id}[\"State #{state.id}\"]"

    transitions = for state in @states
      for [symbol, nextState] from state.transitions
        "  #{state.id} -->|#{symbol}| #{nextState.id}"

    """
graph LR

#{stateNodes.join('\n')}

#{transitions.flat().join('\n')}

  classDef conflict fill:#ffcccc,stroke:#ff0000"""

  # Helper methods for debugging information
  checkForLeftRecursion: ->
    for rule in @rules
      if @isLeftRecursive(rule.lhs, new Set())
        return true
    false

  checkForRightRecursion: ->
    for rule in @rules
      if @isRightRecursive(rule.lhs, new Set())
        return true
    false

  calculateGrammarComplexity: ->
    # Simple complexity metric based on rule count and branching factor
    totalBranching = 0
    for [name, symbol] from @symbols
      unless symbol.isTerminal
        rulesForSymbol = @rulesByLHS.get(name) || []
        totalBranching += rulesForSymbol.length

    Math.round(totalBranching / @symbols.size)

  getStateConflicts: (stateId) ->
    @conflicts.filter (conflict) -> conflict.state == stateId

  getStateReductions: (state) ->
    reductions = []
    for item in state.items
      if item.isComplete() and item.rule.lhs != '$accept'
        reductions.push {
          rule: item.rule.id
          lookahead: [...item.lookahead]
        }
    reductions

  getStateShifts: (state) ->
    shifts = []
    for [symbol, nextState] from state.transitions
      if @getSymbol(symbol).isTerminal
        shifts.push { symbol, nextState: nextState.id }
    shifts

  getStateGotos: (state) ->
    gotos = []
    for [symbol, nextState] from state.transitions
      unless @getSymbol(symbol).isTerminal
        gotos.push { symbol, nextState: nextState.id }
    gotos

  getRulesUsingSymbol: (symbolName) ->
    rules = []
    for rule in @rules
      if symbolName in rule.rhs
        rules.push rule.id
    rules

  getRulesDefiningSymbol: (symbolName) ->
    rules = []
    for rule in @rules
      if rule.lhs == symbolName
        rules.push rule.id
    rules

  isRuleRecursive: (rule) ->
    rule.lhs in rule.rhs

  getRuleRecursionType: (rule) ->
    return 'none' unless @isRuleRecursive(rule)
    return 'left' if rule.rhs[0] == rule.lhs
    return 'right' if rule.rhs[rule.rhs.length - 1] == rule.lhs
    'middle'

  getStatesUsingRule: (rule) ->
    states = []
    for state in @states
      for item in state.items
        if item.rule.id == rule.id
          states.push state.id
    states

  isLeftRecursive: (symbol, visited) ->
    return false if visited.has(symbol)
    visited.add(symbol)

    rulesForSymbol = @rulesByLHS.get(symbol) || []
    for rule in rulesForSymbol
      if rule.rhs.length > 0 and rule.rhs[0] == symbol
        return true
      if rule.rhs.length > 0 and not @getSymbol(rule.rhs[0]).isTerminal
        if @isLeftRecursive(rule.rhs[0], new Set(visited))
          return true

    false

  isRightRecursive: (symbol, visited) ->
    return false if visited.has(symbol)
    visited.add(symbol)

    rulesForSymbol = @rulesByLHS.get(symbol) || []
    for rule in rulesForSymbol
      if rule.rhs.length > 0 and rule.rhs[rule.rhs.length - 1] == symbol
        return true
      if rule.rhs.length > 0 and not @getSymbol(rule.rhs[rule.rhs.length - 1]).isTerminal
        if @isRightRecursive(rule.rhs[rule.rhs.length - 1], new Set(visited))
          return true

    false

  # Generate enhanced parser with debugging capabilities
  generateDebugParser: (options = {}) ->
    debugOptions = Object.assign({
      traceEnabled: true
      stepMode: false
      showStack: true
      showLookahead: true
      logActions: true
    }, options.debug || {})

    # Generate base parser
    baseParser = @generateCommonJS(options)

    # Add debugging enhancements
    debugEnhancements = @generateDebugEnhancements(debugOptions)

    # Inject debugging code into parser
    baseParser.replace(
      'const parser = {'
      "const parser = {\n#{debugEnhancements}"
    )

  # Generate debugging enhancements for parser
  generateDebugEnhancements: (options) ->
    """
    // Enhanced debugging capabilities
    _debugOptions: #{JSON.stringify(options)},
    _parseTrace: [],
    _stepMode: #{options.stepMode},
    _currentStep: 0,

    // Enable/disable debugging
    enableDebug: function() { this._debugOptions.traceEnabled = true; },
    disableDebug: function() { this._debugOptions.traceEnabled = false; },

    // Step-by-step debugging
    enableStepMode: function() { this._stepMode = true; },
    disableStepMode: function() { this._stepMode = false; },

    // Get parse trace
    getParseTrace: function() { return this._parseTrace; },
    clearTrace: function() { this._parseTrace = []; },

    // Debug trace method
    debugTrace: function(action, state, symbol, stack, vstack) {
      if (!this._debugOptions.traceEnabled) return;

      const traceEntry = {
        step: this._currentStep++,
        action: action,
        state: state,
        symbol: symbol,
        stackSize: stack.length / 2,
        stack: this._debugOptions.showStack ? [...stack] : null,
        valueStack: this._debugOptions.showStack ? [...vstack] : null,
        timestamp: Date.now()
      };

      this._parseTrace.push(traceEntry);

      if (this._debugOptions.logActions) {
        console.log(`Step ${traceEntry.step}: ${action} in state ${state} on symbol '${symbol}'`);
        if (this._debugOptions.showStack) {
          console.log(`  Stack: [${stack.join(', ')}]`);
        }
      }

      // Step mode: pause for user input
      if (this._stepMode && typeof window !== 'undefined') {
        const continueStep = confirm(`Step ${traceEntry.step}: ${action} in state ${state} on symbol '${symbol}'\\nContinue?`);
        if (!continueStep) {
          throw new Error('Debugging stopped by user');
        }
      }
    },

    // Inspect parser state
    inspectState: function(stateId) {
      const stateInfo = this._getStateInfo(stateId);
      console.table(stateInfo);
      return stateInfo;
    },

    // Get detailed state information
    _getStateInfo: function(stateId) {
      const actions = this.table[stateId] || {};
      const info = [];

      for (const symbol in actions) {
        const action = actions[symbol];
        info.push({
          symbol: symbol,
          action: action.type || 'goto',
          target: action.state || action.rule || action,
          description: this._describeAction(action, symbol)
        });
      }

      return info;
    },

    // Describe an action in human-readable form
    _describeAction: function(action, symbol) {
      if (!action.type) return `Go to state ${action}`;

      switch (action.type) {
        case 'shift': return `Shift '${symbol}' and go to state ${action.state}`;
        case 'reduce': return `Reduce by rule ${action.rule}`;
        case 'accept': return 'Accept input';
        default: return `Unknown action: ${action.type}`;
      }
    },

    // Export debug information
    exportDebugInfo: function() {
      return {
        trace: this._parseTrace,
        options: this._debugOptions,
        statistics: {
          totalSteps: this._currentStep,
          traceSize: this._parseTrace.length
        }
      };
    }
    """

  debugTable: ->
    console.log "\n=== PARSER STATES ==="
    for state in @states
      console.log "\nState #{state.id}:"
      for item in state.items
        console.log "  #{item.toString()}"

      console.log "  Transitions:"
      for [sym, target] from state.transitions
        console.log "    #{sym} -> #{target.id}"

    console.log "\n=== SYMBOL TABLE ==="
    for [name, sym] from @symbols
      console.log "  #{sym.id}: #{name} (#{if sym.isTerminal then 'terminal' else 'non-terminal'})"

  reportConflicts: ->
    return unless @conflicts.length > 0

    console.log "\n=== DETAILED CONFLICT ANALYSIS ==="
    console.log "Total conflicts: #{@conflicts.length}"

    # Group conflicts by type
    srConflicts = @conflicts.filter (c) -> c.type == 'shift/reduce'
    rrConflicts = @conflicts.filter (c) -> c.type == 'reduce/reduce'

    resolvedSR = srConflicts.filter (c) -> c.resolved
    unresolvedSR = srConflicts.filter (c) -> not c.resolved

    console.log "  Shift/Reduce: #{srConflicts.length} (#{resolvedSR.length} resolved, #{unresolvedSR.length} unresolved)"
    console.log "  Reduce/Reduce: #{rrConflicts.length} (all resolved by default)"
    console.log ""

    # Report unresolved conflicts first (most important)
    if unresolvedSR.length > 0
      console.log "🚨 UNRESOLVED CONFLICTS (require attention):"
      console.log "=" * 50
      for conflict in unresolvedSR
        console.log conflict.explanation
        console.log ""

    # Report resolved conflicts
    if resolvedSR.length > 0
      console.log "✅ RESOLVED SHIFT/REDUCE CONFLICTS:"
      console.log "=" * 40
      for conflict in resolvedSR
        console.log conflict.explanation
        console.log ""

    # Report reduce/reduce conflicts
    if rrConflicts.length > 0
      console.log "⚠️  REDUCE/REDUCE CONFLICTS:"
      console.log "=" * 30
      for conflict in rrConflicts
        console.log conflict.explanation
        console.log ""

    # Summary and recommendations
    @reportConflictSummary(unresolvedSR.length, resolvedSR.length, rrConflicts.length)

  reportConflictSummary: (unresolved, resolved, reduceReduce) ->
    console.log "📊 CONFLICT SUMMARY:"
    console.log "=" * 20

    if unresolved > 0
      console.log "❌ #{unresolved} unresolved shift/reduce conflicts need attention"
      console.log "   These use default shift resolution but may cause unexpected parsing"
      console.log "   Consider adding precedence declarations or restructuring grammar"

    if resolved > 0
      console.log "✅ #{resolved} shift/reduce conflicts resolved by precedence/associativity"
      console.log "   These are handled correctly but you may want to verify the resolution"

    if reduceReduce > 0
      console.log "⚠️  #{reduceReduce} reduce/reduce conflicts resolved by rule order"
      console.log "   These indicate grammar ambiguity and should be fixed if possible"

    if unresolved + reduceReduce == 0
      console.log "🎉 All conflicts are properly resolved!"
    else
      console.log ""
      console.log "💡 GENERAL RECOMMENDATIONS:"
      console.log "   - Use %left, %right, %nonassoc to declare operator precedence"
      console.log "   - Use %prec to assign precedence to specific rules"
      console.log "   - Restructure ambiguous grammar rules when possible"
      console.log "   - Test parser behavior with edge cases"

  # Generate a conflict report for external tools
  generateConflictReport: ->
    report = {
      total: @conflicts.length
      shiftReduce: {
        total: @conflicts.filter((c) -> c.type == 'shift/reduce').length
        resolved: @conflicts.filter((c) -> c.type == 'shift/reduce' and c.resolved).length
        unresolved: @conflicts.filter((c) -> c.type == 'shift/reduce' and not c.resolved).length
      }
      reduceReduce: {
        total: @conflicts.filter((c) -> c.type == 'reduce/reduce').length
      }
      details: @conflicts
    }
    report

  # ============================================================================
  # Advanced Table Optimization and Compression (Bug #20 Fix)
  # ============================================================================

  # Comprehensive table optimization pipeline
  optimizeTable: ->
    console.log "\n🔧 Table Optimization:"
    console.log "====================="

    # Step 1: Analyze table characteristics
    tableStats = @analyzeTableCharacteristics()
    console.log "Original table size: #{tableStats.totalCells} cells"
    console.log "Sparsity: #{tableStats.sparsity}%"
    console.log "Unique rows: #{tableStats.uniqueRows}"
    console.log "Unique columns: #{tableStats.uniqueColumns}"

    # Step 2: Optimize symbol encoding based on frequency
    @optimizeSymbolEncoding()

    # Step 3: Apply row/column compression
    @compressTableRows()
    @compressTableColumns()

    # Step 4: Split action and goto tables
    @splitActionGotoTables()

    # Step 5: Apply sparse table compression
    @applySparseTableCompression()

    # Step 6: Bit-pack actions for maximum compression
    @bitPackActions()

    # Step 7: Generate final optimized table
    @generateOptimizedTable()

    # Report optimization results
    @reportOptimizationResults(tableStats)

  # Analyze table characteristics for optimization
  analyzeTableCharacteristics: ->
    totalCells = 0
    filledCells = 0
    rowHashes = new Set()
    columnHashes = new Map()
    actionFrequency = new Map()

    # Analyze each state's table row
    for state in @states
      if @table[state.id]
        rowData = []
        for symbolId in [0...@symbols.size]
          action = @table[state.id][symbolId]
          if action?
            filledCells++
            rowData.push(JSON.stringify(action))

            # Track action frequency
            actionKey = @getActionKey(action)
            actionFrequency.set(actionKey, (actionFrequency.get(actionKey) || 0) + 1)
          else
            rowData.push(null)
          totalCells++

        # Create row hash for deduplication
        rowHash = @hashArray(rowData)
        rowHashes.add(rowHash)

        # Track column patterns
        for i in [0...rowData.length]
          unless columnHashes.has(i)
            columnHashes.set(i, new Set())
          columnHashes.get(i).add(rowData[i])

    sparsity = Math.round(((totalCells - filledCells) / totalCells) * 100)
    uniqueColumns = [...columnHashes.values()].reduce(((sum, set) -> sum + set.size), 0)

    {
      totalCells,
      filledCells,
      sparsity,
      uniqueRows: rowHashes.size,
      uniqueColumns,
      actionFrequency,
      mostFrequentActions: [...actionFrequency.entries()]
        .sort((a, b) -> b[1] - a[1])
        .slice(0, 10)
    }

  # Optimize symbol encoding based on frequency analysis
  optimizeSymbolEncoding: ->
    console.log "Optimizing symbol encoding..."

    # Calculate symbol usage frequency
    symbolFrequency = new Map()
    for state in @states
      if @table[state.id]
        for symbol, action of @table[state.id]
          symbolId = @symbols.get(symbol)?.id
          if symbolId?
            symbolFrequency.set(symbolId, (symbolFrequency.get(symbolId) || 0) + 1)

    # Sort symbols by frequency (most frequent first)
    sortedSymbols = [...symbolFrequency.entries()]
      .sort((a, b) -> b[1] - a[1])
      .map(([id, freq]) -> id)

    # Create optimized symbol mapping
    @optimizedSymbolMap = new Map()
    @reverseSymbolMap = new Map()

    for newId, oldId of sortedSymbols
      @optimizedSymbolMap.set(oldId, newId)
      @reverseSymbolMap.set(newId, oldId)

    console.log "Symbol encoding optimized (#{sortedSymbols.length} symbols)"

  # Compress table rows by finding identical patterns
  compressTableRows: ->
    console.log "Compressing table rows..."

    rowMap = new Map()
    @rowCompression = new Map()
    compressedRowId = 0

    for state in @states
      if @table[state.id]
        # Create canonical row representation
        rowData = []
        for symbolId in [0...@symbols.size]
          action = @table[state.id][symbolId]
          rowData.push(if action then JSON.stringify(action) else null)

        rowHash = @hashArray(rowData)

        if rowMap.has(rowHash)
          # Reuse existing row
          @rowCompression.set(state.id, rowMap.get(rowHash))
        else
          # Create new compressed row
          rowMap.set(rowHash, compressedRowId)
          @rowCompression.set(state.id, compressedRowId)
          compressedRowId++

    originalRows = @states.length
    compressedRows = rowMap.size
    reduction = Math.round(((originalRows - compressedRows) / originalRows) * 100)

    console.log "Row compression: #{originalRows} → #{compressedRows} (#{reduction}% reduction)"

  # Compress table columns by finding patterns
  compressTableColumns: ->
    console.log "Analyzing column patterns..."

    columnPatterns = new Map()
    @columnCompression = new Map()

    # Analyze each symbol column
    for symbolId in [0...@symbols.size]
      columnData = []
      for state in @states
        action = @table[state.id]?[symbolId]
        columnData.push(if action then JSON.stringify(action) else null)

      columnHash = @hashArray(columnData)

      unless columnPatterns.has(columnHash)
        columnPatterns.set(columnHash, [])
      columnPatterns.get(columnHash).push(symbolId)

    # Group symbols with identical column patterns
    for [hash, symbols] from columnPatterns
      if symbols.length > 1
        # Multiple symbols share the same column pattern
        representative = symbols[0]
        for symbol in symbols.slice(1)
          @columnCompression.set(symbol, representative)

    compressedColumns = columnPatterns.size
    originalColumns = @symbols.size
    reduction = Math.round(((originalColumns - compressedColumns) / originalColumns) * 100)

    console.log "Column analysis: #{originalColumns} → #{compressedColumns} unique patterns (#{reduction}% reduction)"

  # Split action and goto tables for better organization
  splitActionGotoTables: ->
    console.log "Splitting action and goto tables..."

    @actionTable = []
    @gotoTable = []

    for state in @states
      actionRow = {}
      gotoRow = {}

      if @table[state.id]
        for symbol, action of @table[state.id]
          symbolObj = @symbols.get(symbol)
          if symbolObj?.isTerminal
            actionRow[symbolObj.id] = action
          else
            gotoRow[symbolObj.id] = action

      @actionTable.push(actionRow)
      @gotoTable.push(gotoRow)

    console.log "Tables split: action table (#{@actionTable.length} rows), goto table (#{@gotoTable.length} rows)"

  # Apply sparse table compression using various algorithms
  applySparseTableCompression: ->
    console.log "Applying sparse table compression..."

    # Try different compression strategies
    strategies = [
      @compressWithCOO.bind(this),      # Coordinate format
      @compressWithCSR.bind(this),      # Compressed Sparse Row
      @compressWithDictionary.bind(this), # Dictionary encoding
      @compressWithRLE.bind(this)       # Run-length encoding
    ]

    bestCompression = null
    bestRatio = 0

    for strategy in strategies
      result = strategy()
      if result.compressionRatio > bestRatio
        bestRatio = result.compressionRatio
        bestCompression = result

    @compressedTable = bestCompression
    console.log "Best compression: #{bestCompression.method} (#{Math.round(bestRatio)}% reduction)"

  # Coordinate (COO) format compression
  compressWithCOO: ->
    entries = []

    for stateId in [0...@states.length]
      if @table[stateId]
        for symbol, action of @table[stateId]
          symbolId = @symbols.get(symbol)?.id
          if symbolId? and action?
            entries.push([stateId, symbolId, @encodeAction(action)])

    originalSize = @states.length * @symbols.size * 8  # Estimate 8 bytes per cell
    compressedSize = entries.length * 12  # 3 integers per entry

    {
      method: 'COO',
      data: entries,
      compressionRatio: ((originalSize - compressedSize) / originalSize) * 100,
      size: compressedSize
    }

  # Compressed Sparse Row (CSR) format
  compressWithCSR: ->
    values = []
    columnIndices = []
    rowPointers = [0]

    for stateId in [0...@states.length]
      if @table[stateId]
        for symbol, action of @table[stateId]
          symbolId = @symbols.get(symbol)?.id
          if symbolId? and action?
            values.push(@encodeAction(action))
            columnIndices.push(symbolId)

      rowPointers.push(values.length)

    originalSize = @states.length * @symbols.size * 8
    compressedSize = values.length * 4 + columnIndices.length * 4 + rowPointers.length * 4

    {
      method: 'CSR',
      data: { values, columnIndices, rowPointers },
      compressionRatio: ((originalSize - compressedSize) / originalSize) * 100,
      size: compressedSize
    }

  # Dictionary encoding compression
  compressWithDictionary: ->
    actionDictionary = new Map()
    dictionaryId = 0

    # Build action dictionary
    for stateId in [0...@states.length]
      if @table[stateId]
        for symbol, action of @table[stateId]
          if action?
            actionKey = JSON.stringify(action)
            unless actionDictionary.has(actionKey)
              actionDictionary.set(actionKey, dictionaryId++)

    # Encode table using dictionary
    compressedTable = []
    for stateId in [0...@states.length]
      row = []
      if @table[stateId]
        for symbolId in [0...@symbols.size]
          action = @table[stateId][symbolId]
          if action?
            actionKey = JSON.stringify(action)
            row.push(actionDictionary.get(actionKey))
          else
            row.push(null)
      compressedTable.push(row)

    originalSize = @states.length * @symbols.size * 8
    compressedSize = compressedTable.length * @symbols.size * 2 + actionDictionary.size * 20

    {
      method: 'Dictionary',
      data: { table: compressedTable, dictionary: [...actionDictionary.entries()] },
      compressionRatio: ((originalSize - compressedSize) / originalSize) * 100,
      size: compressedSize
    }

  # Run-length encoding compression
  compressWithRLE: ->
    compressedRows = []

    for stateId in [0...@states.length]
      if @table[stateId]
        row = []
        for symbolId in [0...@symbols.size]
          action = @table[stateId][symbolId]
          row.push(if action then @encodeAction(action) else null)

        # Apply RLE to row
        compressedRow = @runLengthEncode(row)
        compressedRows.push(compressedRow)
      else
        compressedRows.push([])

    originalSize = @states.length * @symbols.size * 8
    compressedSize = compressedRows.reduce(((sum, row) -> sum + row.length * 8), 0)

    {
      method: 'RLE',
      data: compressedRows,
      compressionRatio: ((originalSize - compressedSize) / originalSize) * 100,
      size: compressedSize
    }

  # Bit-pack actions for maximum compression
  bitPackActions: ->
    console.log "Bit-packing actions..."

    # Analyze action types and ranges
    actionTypes = new Set()
    stateRanges = { min: Infinity, max: -Infinity }
    ruleRanges = { min: Infinity, max: -Infinity }

    for stateId in [0...@states.length]
      if @table[stateId]
        for symbol, action of @table[stateId]
          if action?.type
            actionTypes.add(action.type)
            if action.type == 'shift'
              stateRanges.min = Math.min(stateRanges.min, action.state)
              stateRanges.max = Math.max(stateRanges.max, action.state)
            else if action.type == 'reduce'
              ruleRanges.min = Math.min(ruleRanges.min, action.rule)
              ruleRanges.max = Math.max(ruleRanges.max, action.rule)

    # Calculate required bits
    typeBits = Math.ceil(Math.log2(actionTypes.size + 1))
    stateBits = Math.ceil(Math.log2(stateRanges.max + 1))
    ruleBits = Math.ceil(Math.log2(ruleRanges.max + 1))

    @bitPackingInfo = {
      typeBits,
      stateBits,
      ruleBits,
      totalBits: Math.max(typeBits + stateBits, typeBits + ruleBits, 8)
    }

    console.log "Bit-packing: #{@bitPackingInfo.totalBits} bits per action"

  # Generate final optimized table
  generateOptimizedTable: ->
    console.log "Generating optimized table..."

    @optimizedTable = {
      format: @compressedTable.method,
      data: @compressedTable.data,
      metadata: {
        states: @states.length,
        symbols: @symbols.size,
        compression: @compressedTable.method,
        symbolMap: @optimizedSymbolMap or new Map(),
        rowCompression: @rowCompression or new Map(),
        columnCompression: @columnCompression or new Map(),
        bitPacking: @bitPackingInfo
      }
    }

  # Report optimization results
  reportOptimizationResults: (originalStats) ->
    console.log "\n📊 Optimization Results:"
    console.log "========================"

    if @compressedTable
      console.log "Compression method: #{@compressedTable.method}"
      console.log "Size reduction: #{Math.round(@compressedTable.compressionRatio)}%"
      console.log "Original size: #{originalStats.totalCells} cells"
      console.log "Compressed size: #{@compressedTable.size} bytes"

    if @rowCompression
      rowReduction = Math.round(((originalStats.uniqueRows - @rowCompression.size) / originalStats.uniqueRows) * 100)
      console.log "Row compression: #{rowReduction}% reduction"

    if @bitPackingInfo
      console.log "Bit-packing: #{@bitPackingInfo.totalBits} bits per action"

    console.log "Table optimization complete!"

  # Helper methods for table optimization

  getActionKey: (action) ->
    if action?.type
      "#{action.type}:#{action.state || action.rule || ''}"
    else
      "goto:#{action}"

  hashArray: (array) ->
    # Simple hash function for arrays
    hash = 0
    str = JSON.stringify(array)
    for i in [0...str.length]
      char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash  # Convert to 32-bit integer
    hash

  encodeAction: (action) ->
    if action?.type == 'shift'
      (1 << 24) | action.state
    else if action?.type == 'reduce'
      (2 << 24) | action.rule
    else if action?.type == 'accept'
      (3 << 24)
    else
      action  # GOTO action

  runLengthEncode: (array) ->
    if array.length == 0
      return []

    result = []
    current = array[0]
    count = 1

    for i in [1...array.length]
      if array[i] == current
        count++
      else
        result.push([current, count])
        current = array[i]
        count = 1

    result.push([current, count])
    result

  # Enhanced table preparation with optimization
  prepareOptimizedTable: ->
    if @optimizedTable
      # Return optimized table format
      switch @optimizedTable.format
        when 'COO'
          @prepareCOOTable()
        when 'CSR'
          @prepareCSRTable()
        when 'Dictionary'
          @prepareDictionaryTable()
        when 'RLE'
          @prepareRLETable()
        when 'Simple'
          @prepareTable()  # Use original for simple optimization
        else
          @prepareTable()  # Fallback to original
    else
      @prepareTable()  # No optimization, use original

  prepareCOOTable: ->
    # Generate COO format table for parser
    entries = @optimizedTable.data

    # Create lookup function
    """
    // COO format table lookup
    const tableEntries = #{JSON.stringify(entries)};
    const tableLookup = new Map();

    // Build lookup map
    for (const [state, symbol, action] of tableEntries) {
      const key = (state << 16) | symbol;
      tableLookup.set(key, action);
    }

    // Table access function
    function getTableEntry(state, symbol) {
      const key = (state << 16) | symbol;
      return tableLookup.get(key);
    }
    """

  prepareCSRTable: ->
    # Generate CSR format table for parser
    { values, columnIndices, rowPointers } = @optimizedTable.data

    """
    // CSR format table
    const values = #{JSON.stringify(values)};
    const columnIndices = #{JSON.stringify(columnIndices)};
    const rowPointers = #{JSON.stringify(rowPointers)};

    // Table access function
    function getTableEntry(state, symbol) {
      const start = rowPointers[state];
      const end = rowPointers[state + 1];

      for (let i = start; i < end; i++) {
        if (columnIndices[i] === symbol) {
          return values[i];
        }
      }
      return undefined;
    }
    """

  prepareDictionaryTable: ->
    # Generate dictionary-compressed table for parser
    { table, dictionary } = @optimizedTable.data

    """
    // Dictionary-compressed table
    const actionDict = #{JSON.stringify(dictionary)};
    const compressedTable = #{JSON.stringify(table)};

    // Build reverse dictionary
    const reverseDict = new Map();
    for (const [action, id] of actionDict) {
      reverseDict.set(id, JSON.parse(action));
    }

    // Table access function
    function getTableEntry(state, symbol) {
      const row = compressedTable[state];
      if (row && row[symbol] !== null) {
        return reverseDict.get(row[symbol]);
      }
      return undefined;
    }
    """

  prepareRLETable: ->
    # Generate RLE-compressed table for parser
    compressedRows = @optimizedTable.data

    """
    // RLE-compressed table
    const compressedRows = #{JSON.stringify(compressedRows)};

    // Decompress row on demand
    function decompressRow(rowData) {
      const row = [];
      for (const [value, count] of rowData) {
        for (let i = 0; i < count; i++) {
          row.push(value);
        }
      }
      return row;
    }

    // Table access function with caching
    const rowCache = new Map();
    function getTableEntry(state, symbol) {
      if (!rowCache.has(state)) {
        rowCache.set(state, decompressRow(compressedRows[state]));
      }
      return rowCache.get(state)[symbol];
    }
    """

  # ============================================================================
  # Smart Table Optimization (Bug #20 Fix - Performance Conscious)
  # ============================================================================

  # Smart optimization that only runs when beneficial
  smartOptimizeTable: ->
    startTime = Date.now()

    # Check if optimization should run
    shouldOptimize = @shouldRunOptimization()

    if shouldOptimize
      if @optimizationConfig.verbose
        console.log "\n🔧 Smart Table Optimization:"
        console.log "============================="
        console.log "Grammar size: #{@states.length} states, #{@symbols.size} symbols"
        console.log "Optimization triggered: #{@getOptimizationReason()}"

      @optimizeTableConditional()
    else
      if @optimizationConfig.verbose
        console.log "\n⚡ Skipping table optimization (small grammar, better performance without)"

      # For small grammars, use fast path
      @optimizedTable = null

    @performanceStats.optimizationTime = Date.now() - startTime

  # Determine if optimization should run
  shouldRunOptimization: ->
    # Explicit enable/disable
    return true if @optimizationConfig.enabled
    return false unless @optimizationConfig.auto

    # Auto-optimization criteria
    stateCount = @states.length
    symbolCount = @symbols.size
    tableSize = stateCount * symbolCount

    # Don't optimize very small grammars
    return false if stateCount < @optimizationConfig.minStatesForAuto
    return false if @optimizationConfig.skipIfSmall and tableSize < 100

    # Estimate sparsity quickly
    filledCells = 0
    totalCells = 0

    # Sample a few states for quick sparsity estimate
    sampleSize = Math.min(5, @states.length)
    for i in [0...sampleSize]
      state = @states[i]
      if @table[state.id]
        for symbol, action of @table[state.id]
          filledCells++ if action?
        totalCells += symbolCount

    sparsity = if totalCells > 0 then ((totalCells - filledCells) / totalCells) * 100 else 0

    # Optimize if sparse enough or large enough
    return true if sparsity > 50  # Sparse tables benefit from compression
    return true if stateCount > 50  # Large grammars benefit from optimization
    return true if tableSize > 1000  # Large tables benefit from compression

    false

  # Get reason for optimization (for logging)
  getOptimizationReason: ->
    return "explicitly enabled" if @optimizationConfig.enabled

    stateCount = @states.length
    symbolCount = @symbols.size
    tableSize = stateCount * symbolCount

    return "large grammar (#{stateCount} states)" if stateCount > 50
    return "large table (#{tableSize} cells)" if tableSize > 1000
    return "auto-optimization threshold met"

  # Conditional optimization with performance focus
  optimizeTableConditional: ->
    # Quick analysis for decision making
    quickStats = @quickAnalyzeTable()

    if @optimizationConfig.verbose
      console.log "Quick analysis: #{quickStats.sparsity}% sparse, #{quickStats.uniqueRows} unique rows"

    # Step 1: Always do symbol encoding (low cost, good benefit)
    @optimizeSymbolEncodingFast()

    # Step 2: Row compression (medium cost, good benefit for many states)
    if @states.length > 10
      @compressTableRowsFast()

    # Step 3: Sparse compression (higher cost, only for sparse tables)
    if quickStats.sparsity > 30
      @applySparseTableCompressionFast()
    else
      # For dense tables, use simpler approach
      @generateSimpleOptimizedTable()

    # Step 4: Generate final optimized table
    @generateOptimizedTableFast()

  # Quick table analysis (minimal overhead)
  quickAnalyzeTable: ->
    totalCells = @states.length * @symbols.size
    filledCells = 0
    rowHashes = new Set()

    for state in @states
      if @table[state.id]
        rowData = []
        for symbolId in [0...@symbols.size]
          action = @table[state.id][symbolId]
          if action?
            filledCells++
            rowData.push(JSON.stringify(action))
          else
            rowData.push(null)

        rowHash = @quickHash(rowData.join('|'))
        rowHashes.add(rowHash)

    sparsity = if totalCells > 0 then Math.round(((totalCells - filledCells) / totalCells) * 100) else 0

    {
      totalCells,
      filledCells,
      sparsity,
      uniqueRows: rowHashes.size
    }

  # Fast symbol encoding (simplified)
  optimizeSymbolEncodingFast: ->
    # Only reorder if significant benefit expected
    return unless @symbols.size > 10

    symbolFrequency = new Map()
    for state in @states
      if @table[state.id]
        for symbol, action of @table[state.id]
          symbolId = @symbols.get(symbol)?.id
          if symbolId?
            symbolFrequency.set(symbolId, (symbolFrequency.get(symbolId) || 0) + 1)

    # Only create mapping if there's significant variation
    frequencies = [...symbolFrequency.values()]
    if frequencies.length > 0
      maxFreq = Math.max(...frequencies)
      minFreq = Math.min(...frequencies)

      # Only optimize if there's significant frequency variation
      if maxFreq > minFreq * 2
        sortedSymbols = [...symbolFrequency.entries()]
          .sort((a, b) -> b[1] - a[1])
          .map(([id, freq]) -> id)

        @optimizedSymbolMap = new Map()
        for newId, oldId of sortedSymbols
          @optimizedSymbolMap.set(oldId, newId)

  # Fast row compression (simplified)
  compressTableRowsFast: ->
    rowMap = new Map()
    @rowCompression = new Map()
    compressedRowId = 0

    for state in @states
      if @table[state.id]
        # Create simple row signature
        signature = Object.keys(@table[state.id]).sort().join(',')

        if rowMap.has(signature)
          @rowCompression.set(state.id, rowMap.get(signature))
        else
          rowMap.set(signature, compressedRowId)
          @rowCompression.set(state.id, compressedRowId)
          compressedRowId++

  # Fast sparse compression (single algorithm)
  applySparseTableCompressionFast: ->
    # Choose best algorithm based on table characteristics
    algorithm = @chooseBestAlgorithmFast()

    switch algorithm
      when 'COO'
        @compressedTable = @compressWithCOO()
      when 'Dictionary'
        @compressedTable = @compressWithDictionary()
      else
        @compressedTable = @compressWithRLE()

  # Choose compression algorithm without testing all
  chooseBestAlgorithmFast: ->
    stateCount = @states.length
    symbolCount = @symbols.size

    # Quick heuristics based on table characteristics
    if stateCount > symbolCount * 2
      'COO'  # Good for tall, sparse tables
    else if symbolCount > 20
      'Dictionary'  # Good for many symbols with repeated patterns
    else
      'RLE'  # Good general purpose

  # Generate simple optimized table for dense tables
  generateSimpleOptimizedTable: ->
    @compressedTable = {
      method: 'Simple',
      data: @table,
      compressionRatio: 0,
      size: @states.length * @symbols.size * 8
    }

  # Fast table generation
  generateOptimizedTableFast: ->
    @optimizedTable = {
      format: @compressedTable.method,
      data: @compressedTable.data,
      metadata: {
        states: @states.length,
        symbols: @symbols.size,
        compression: @compressedTable.method,
        symbolMap: @optimizedSymbolMap or new Map(),
        rowCompression: @rowCompression or new Map(),
        optimizationTime: @performanceStats.optimizationTime
      }
    }

  # Simple hash function (faster than JSON.stringify)
  quickHash: (str) ->
    hash = 0
    return hash if str.length == 0

    for i in [0...Math.min(str.length, 100)]  # Limit for performance
      char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash  # Convert to 32-bit integer
    hash

  # ============================================================================
  # Source Map Generation (Bug #22 Fix - Part 1)
  # ============================================================================

  # Generate parser with optional source maps
  generateCommonJS: (options = {}) ->
    # Check if high-performance mode is requested
    if options.highPerformance
      return @generateOptimizedCommonJS(options)

    # Check if source maps are requested
    if options.sourceMap
      return @generateWithSourceMap(options)

    # Prepare data structures
    table   = @prepareOptimizedTable()
    rules   = @prepareRulesWithSourceMap()
    symbols = @prepareSymbols()
    tokens  = @prepareTokens()

    # Build performAction with source map support
    performAction = @buildPerformActionWithSourceMap()

    # Generate the parser code with embedded source map information
    parserCode = @generateParserCodeWithSourceMap(table, rules, symbols, tokens, performAction)

    # Generate the source map
    sourceMap = @sourceMapTracker.generateSourceMap()

    if options.sourceMap == 'inline'
      # Inline source map
      sourceMapBase64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      parserCode + "\n//# sourceMappingURL=data:application/json;base64,#{sourceMapBase64}"
    else if options.sourceMap == 'external'
      # External source map file
      sourceMapFile = options.sourceMapFile || 'parser.js.map'
      parserCode + "\n//# sourceMappingURL=#{sourceMapFile}"
    else
      # Return both parser and source map
      {
        code: parserCode
        map: sourceMap
        mapFile: options.sourceMapFile || 'parser.js.map'
      }

  # Source Map Tracker class for managing mappings
  class SourceMapTracker
    constructor: (@options = {}) ->
      @mappings = []
      @sources = [@options.sourceFile || 'grammar.coffee']
      @sourcesContent = [@options.sourceContent || '']
      @names = []
      @nameMap = new Map()
      @currentLine = 0
      @currentColumn = 0
      @version = 3

    # Add a mapping from generated position to original position
    addMapping: (generated, original, source = 0, name = null) ->
      nameIndex = null
      if name?
        unless @nameMap.has(name)
          @nameMap.set(name, @names.length)
          @names.push(name)
        nameIndex = @nameMap.get(name)

      @mappings.push({
        generatedLine: generated.line
        generatedColumn: generated.column
        originalLine: original.line
        originalColumn: original.column
        source: source
        name: nameIndex
      })

    # Generate the final source map object
    generateSourceMap: ->
      {
        version: @version
        file: @options.file || 'parser.js'
        sourceRoot: @options.sourceRoot || ''
        sources: @sources
        sourcesContent: @sourcesContent
        names: @names
        mappings: @encodeVLQ(@mappings)
      }

    # Encode mappings using VLQ (Variable Length Quantity)
    encodeVLQ: (mappings) ->
      # Sort mappings by generated position
      sortedMappings = mappings.sort((a, b) ->
        if a.generatedLine != b.generatedLine
          a.generatedLine - b.generatedLine
        else
          a.generatedColumn - b.generatedColumn
      )

      result = []
      prevGeneratedLine = 0
      prevGeneratedColumn = 0
      prevOriginalLine = 0
      prevOriginalColumn = 0
      prevSource = 0
      prevName = 0

      for mapping in sortedMappings
        # Add line separators
        while prevGeneratedLine < mapping.generatedLine
          result.push(';')
          prevGeneratedLine++
          prevGeneratedColumn = 0

        if result.length > 0 and result[result.length - 1] != ';'
          result.push(',')

        # Encode the mapping
        segment = []
        segment.push(@encodeVLQValue(mapping.generatedColumn - prevGeneratedColumn))
        prevGeneratedColumn = mapping.generatedColumn

        if mapping.source?
          segment.push(@encodeVLQValue(mapping.source - prevSource))
          prevSource = mapping.source
          segment.push(@encodeVLQValue(mapping.originalLine - prevOriginalLine))
          prevOriginalLine = mapping.originalLine
          segment.push(@encodeVLQValue(mapping.originalColumn - prevOriginalColumn))
          prevOriginalColumn = mapping.originalColumn

          if mapping.name?
            segment.push(@encodeVLQValue(mapping.name - prevName))
            prevName = mapping.name

        result.push(segment.join(''))

      result.join('')

    # Encode a single VLQ value
    encodeVLQValue: (value) ->
      vlq = if value < 0 then ((-value) << 1) | 1 else value << 1
      result = ''

      while vlq > 31
        result += @base64Chars[32 | (vlq & 31)]
        vlq >>>= 5

      result += @base64Chars[vlq]
      result

    # Base64 characters for VLQ encoding
    base64Chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  # Prepare rules with source map information
  prepareRulesWithSourceMap: ->
    rules = []
    for rule, i in @rules
      # Track original grammar location if available
      originalLocation = @getOriginalRuleLocation(rule)

      ruleData = [rule.lhs, rule.rhs.length]
      rules.push(ruleData)

      # Add source mapping for this rule
      if originalLocation
        @sourceMapTracker.addMapping(
          { line: @getCurrentGeneratedLine(), column: 0 },
          originalLocation,
          0,
          rule.lhs
        )

    rules

  # Build performAction with source map support
  buildPerformActionWithSourceMap: ->
    actions = []

    for rule, i in @rules
      action = rule.action || 'this.$ = $$[$0];'
      originalLocation = @getOriginalActionLocation(rule)

      # Convert action to string if it's a function
      if typeof action is 'function'
        action = action.toString()
        match = action.match(/^(?:function\s*\([^)]*\)|[^=]+=>)\s*\{?\s*([\s\S]*?)\s*\}?\s*$/)
        if match
          action = match[1]
        else
          match = action.match(/^[^>]+>\s*(.*)$/)
          action = if match then match[1] else action

      # Replace action code patterns with source map support
      action = @transformActionWithSourceMap(action, rule, originalLocation)

      # Add case with source map annotation
      @sourceMapTracker.addMapping(
        { line: @getCurrentGeneratedLine(), column: 6 },
        originalLocation,
        0,
        "case_#{i}"
      ) if originalLocation

      actions.push "      case #{i}: // #{rule.lhs} → #{rule.rhs.join(' ')}"
      actions.push "        var $0 = $$.length - 1;"
      actions.push "        #{action}"
      actions.push "        break;"

    """performAction: function(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
      switch (yystate) {
#{actions.join('\n')}
      }
    }"""

  # Transform action code with source map information
  transformActionWithSourceMap: (action, rule, originalLocation) ->
    # Replace @$ with this.$
    action = action.replace /@\$/g, 'this.$'

    # Replace $$ with this.$
    action = action.replace /\$\$/g, 'this.$'

    # Replace positional parameters with source map annotations
    action = action.replace /\$(\d+)/g, (match, n) =>
      paramNum = parseInt(n, 10)
      if paramNum < 1 or paramNum > rule.rhs.length
        console.warn "Warning: Parameter $#{paramNum} out of range for rule: #{rule.lhs} → #{rule.rhs.join(' ')}"
        return match

      stackOffset = rule.rhs.length - paramNum
      stackRef = if stackOffset == 0 then "$$[$0]" else "$$[$0-#{stackOffset}]"

      # Add source map annotation for parameter access
      if originalLocation
        @sourceMapTracker.addMapping(
          { line: @getCurrentGeneratedLine(), column: 0 },
          { line: originalLocation.line, column: originalLocation.column + match.index || 0 },
          0,
          "$#{paramNum}"
        )

      stackRef

    # Replace location references
    action = action.replace /@(\d+)/g, (match, n) =>
      paramNum = parseInt(n, 10)
      if paramNum < 1 or paramNum > rule.rhs.length
        return match

      stackOffset = rule.rhs.length - paramNum
      if stackOffset == 0
        "_$[_$.length - 1]"
      else
        "_$[_$.length - 1 - #{stackOffset}]"

    action

  # Generate parser code with source map support
  generateParserCodeWithSourceMap: (table, rules, symbols, tokens, performAction) ->
    @currentGeneratedLine = 1

    """/* Generated by rip-parser 1.0.0 with source maps */

const parser = (() => {
  const parser = {
    trace: () => { },
    yy: { },
    symbols_: #{JSON.stringify(symbols)},
    terminals_: #{@jsonStringifyWithNumericKeys(tokens)},
    productions_: #{JSON.stringify(rules)},
    #{performAction},
    table: #{@jsonStringifyWithNumericKeys(table)},
    defaultActions: #{JSON.stringify(@defaultActions)},

    parseError(str, hash) {
      if (hash.recoverable) {
        this.trace(str);
      } else {
        const err = new Error(str);
        err.hash = hash;
        throw err;
      }
    },

    parse(input) {
      const self = this;
      let stack = [0];
      let vstack = [null];
      let lstack = [];
      let yytext = '';
      let yylineno = 0;
      let yyleng = 0;
      let recovering = 0;
      let TERROR = 2;
      let EOF = 1;

      const args = [].slice.call(arguments, 1);
      const lexer = Object.assign({}, this.lexer, this.yy.lexer);
      const sharedState = { yy: {} };

      for (const k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
          sharedState.yy[k] = this.yy[k];
        }
      }

      lexer.setInput(input, sharedState.yy);
      sharedState.yy.lexer = lexer;
      sharedState.yy.parser = this;

      if (typeof lexer.yylloc === 'undefined') {
        lexer.yylloc = {};
      }
      let yyloc = lexer.yylloc;
      lstack.push(yyloc);

      const ranges = lexer.options && lexer.options.ranges;

      if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
      } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
      }

      let symbol, preErrorSymbol, state, action, r, yyval = {}, p, len, newState, expected;

      while (true) {
        state = stack[stack.length - 1];

        if (this.defaultActions[state]) {
          action = this.defaultActions[state];
        } else {
          if (symbol === null || symbol === undefined) {
            symbol = lex();
          }
          action = this.table[state] && this.table[state][symbol];
        }

        if (typeof action === 'undefined' || !action.length || !action[0]) {
          let errStr = '';
          expected = [];
          for (p in this.table[state]) {
            if (this.terminals_[p] && p > TERROR) {
              expected.push("'" + this.terminals_[p] + "'");
            }
          }

          if (lexer.showPosition) {
            errStr = 'Parse error on line ' + (yylineno + 1) + ":\\n" + lexer.showPosition() + "\\nExpecting " + expected.join(', ') + ", got '" + (this.terminals_[symbol] || symbol) + "'";
          } else {
            errStr = 'Parse error on line ' + (yylineno + 1) + ": Unexpected " +
                     (symbol == EOF ? "end of input" :
                      ("'" + (this.terminals_[symbol] || symbol) + "'"));
          }

          this.parseError(errStr, {
            text: lexer.match,
            token: this.terminals_[symbol] || symbol,
            line: lexer.yylineno,
            loc: yyloc,
            expected: expected
          });
        }

        if (action[0] instanceof Array && action.length > 1) {
          throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }

        switch (action[0]) {
          case 1: // shift
            stack.push(symbol);
            vstack.push(lexer.yytext);
            lstack.push(lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
              yyleng = lexer.yyleng;
              yytext = lexer.yytext;
              yylineno = lexer.yylineno;
              yyloc = lexer.yylloc;
              if (recovering > 0) {
                recovering--;
              }
            } else {
              symbol = preErrorSymbol;
              preErrorSymbol = null;
            }
            break;

          case 2: // reduce
            len = this.productions_[action[1] * 2 + 1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
              first_line: lstack[lstack.length - (len || 1)].first_line,
              last_line: lstack[lstack.length - 1].last_line,
              first_column: lstack[lstack.length - (len || 1)].first_column,
              last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
              yyval._$.range = [
                lstack[lstack.length - (len || 1)].range[0],
                lstack[lstack.length - 1].range[1]
              ];
            }
            r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], vstack, lstack].concat(args));

            if (typeof r !== 'undefined') {
              return r;
            }

            if (len) {
              stack = stack.slice(0, -1 * len * 2);
              vstack = vstack.slice(0, -1 * len);
              lstack = lstack.slice(0, -1 * len);
            }

            stack.push(this.productions_[action[1] * 2]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = this.table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;

          case 3: // accept
            return true;
        }
      }

      function lex() {
        let token = lexer.lex() || EOF;
        if (typeof token !== 'number') {
          if (token === '') {
            token = EOF;
          } else {
            token = self.symbols_[token] || token;
          }
        }
        return token;
      }
    }
  };

  parser.Parser = parser.Parser || function Parser() { this.yy = {}; };
  parser.Parser.prototype = parser;
  parser.parse = parser.parse;
  return parser;
})();

if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  module.exports = {
    parser,
    Parser: parser.Parser,
    parse: (...args) => parser.parse(...args)
  };
}
    """

  # Generate parser with source maps
  generateWithSourceMap: (options = {}) ->
    # Initialize source map tracking
    @sourceMapTracker = new SourceMapTracker(options)

    # Prepare data structures with source tracking
    table = @prepareOptimizedTable()
    rules = @prepareRulesWithSourceMap()
    symbols = @prepareSymbols()
    tokens = @prepareTokens()

    # Build performAction with source map support
    performAction = @buildPerformActionWithSourceMap()

    # Generate the parser code with embedded source map information
    parserCode = @generateParserCodeWithSourceMap(table, rules, symbols, tokens, performAction)

    # Generate the source map
    sourceMap = @sourceMapTracker.generateSourceMap()

    if options.sourceMap == 'inline'
      # Inline source map
      sourceMapBase64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      parserCode + "\n//# sourceMappingURL=data:application/json;base64,#{sourceMapBase64}"
    else if options.sourceMap == 'external'
      # External source map file
      sourceMapFile = options.sourceMapFile || 'parser.js.map'
      parserCode + "\n//# sourceMappingURL=#{sourceMapFile}"
    else
      # Return both parser and source map
      {
        code: parserCode
        map: sourceMap
        mapFile: options.sourceMapFile || 'parser.js.map'
      }

  # Source Map Tracker class for managing mappings
  class SourceMapTracker
    constructor: (@options = {}) ->
      @mappings = []
      @sources = [@options.sourceFile || 'grammar.coffee']
      @sourcesContent = [@options.sourceContent || '']
      @names = []
      @nameMap = new Map()
      @currentLine = 0
      @currentColumn = 0
      @version = 3

    # Add a mapping from generated position to original position
    addMapping: (generated, original, source = 0, name = null) ->
      nameIndex = null
      if name?
        unless @nameMap.has(name)
          @nameMap.set(name, @names.length)
          @names.push(name)
        nameIndex = @nameMap.get(name)

      @mappings.push({
        generatedLine: generated.line
        generatedColumn: generated.column
        originalLine: original.line
        originalColumn: original.column
        source: source
        name: nameIndex
      })

    # Generate the final source map object
    generateSourceMap: ->
      {
        version: @version
        file: @options.file || 'parser.js'
        sourceRoot: @options.sourceRoot || ''
        sources: @sources
        sourcesContent: @sourcesContent
        names: @names
        mappings: @encodeVLQ(@mappings)
      }

    # Encode mappings using VLQ (Variable Length Quantity)
    encodeVLQ: (mappings) ->
      # Sort mappings by generated position
      sortedMappings = mappings.sort((a, b) ->
        if a.generatedLine != b.generatedLine
          a.generatedLine - b.generatedLine
        else
          a.generatedColumn - b.generatedColumn
      )

      result = []
      prevGeneratedLine = 0
      prevGeneratedColumn = 0
      prevOriginalLine = 0
      prevOriginalColumn = 0
      prevSource = 0
      prevName = 0

      for mapping in sortedMappings
        # Add line separators
        while prevGeneratedLine < mapping.generatedLine
          result.push(';')
          prevGeneratedLine++
          prevGeneratedColumn = 0

        if result.length > 0 and result[result.length - 1] != ';'
          result.push(',')

        # Encode the mapping - build segment as string
        segmentParts = [@encodeVLQValue(mapping.generatedColumn - prevGeneratedColumn)]
        prevGeneratedColumn = mapping.generatedColumn

        if mapping.source?
          segmentParts.push(@encodeVLQValue(mapping.source - prevSource))
          prevSource = mapping.source
          segmentParts.push(@encodeVLQValue(mapping.originalLine - prevOriginalLine))
          prevOriginalLine = mapping.originalLine
          segmentParts.push(@encodeVLQValue(mapping.originalColumn - prevOriginalColumn))
          prevOriginalColumn = mapping.originalColumn

          if mapping.name?
            segmentParts.push(@encodeVLQValue(mapping.name - prevName))
            prevName = mapping.name

        result.push(segmentParts.join(''))

      result.join('')

    # Encode a single VLQ value
    encodeVLQValue: (value) ->
      vlq = if value < 0 then ((-value) << 1) | 1 else value << 1
      result = ''

      while vlq > 31
        result += @base64Chars[32 | (vlq & 31)]
        vlq >>>= 5

      result += @base64Chars[vlq]
      result

    # Base64 characters for VLQ encoding
    base64Chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  # Prepare rules with source map information
  prepareRulesWithSourceMap: ->
    rules = []
    for rule, i in @rules
      # Track original grammar location if available
      originalLocation = @getOriginalRuleLocation(rule)

      ruleData = [rule.lhs, rule.rhs.length]
      rules.push(ruleData)

      # Add source mapping for this rule
      if originalLocation
        @sourceMapTracker.addMapping(
          { line: @getCurrentGeneratedLine(), column: 0 },
          originalLocation,
          0,
          rule.lhs
        )

    rules

  # Build performAction with source map support
  buildPerformActionWithSourceMap: ->
    actionCases = for rule, i in @rules
      action = rule.action || 'this.$ = $$[$0];'
      originalLocation = @getOriginalActionLocation(rule)

      # Convert action to string if it's a function
      if typeof action is 'function'
        action = action.toString()
        match = action.match(/^(?:function\s*\([^)]*\)|[^=]+=>)\s*\{?\s*([\s\S]*?)\s*\}?\s*$/)
        if match
          action = match[1]
        else
          match = action.match(/^[^>]+>\s*(.*)$/)
          action = if match then match[1] else action

      # Replace action code patterns with source map support
      action = @transformActionWithSourceMap(action, rule, originalLocation)

      # Add case with source map annotation
      @sourceMapTracker.addMapping(
        { line: @getCurrentGeneratedLine(), column: 6 },
        originalLocation,
        0,
        "case_#{i}"
      ) if originalLocation

      """
      case #{i}: // #{rule.lhs} → #{rule.rhs.join(' ')}
        var $0 = $$.length - 1;
        #{action}
        break;"""

    """performAction: function(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
      switch (yystate) {#{actionCases.join('')}
      }
    }"""

  # Transform action code with source map information
  transformActionWithSourceMap: (action, rule, originalLocation) ->
    # Replace @$ with this.$
    action = action.replace /@\$/g, 'this.$'

    # Replace $$ with this.$
    action = action.replace /\$\$/g, 'this.$'

    # Replace positional parameters with source map annotations
    action = action.replace /\$(\d+)/g, (match, n) =>
      paramNum = parseInt(n, 10)
      if paramNum < 1 or paramNum > rule.rhs.length
        console.warn "Warning: Parameter $#{paramNum} out of range for rule: #{rule.lhs} → #{rule.rhs.join(' ')}"
        return match

      stackOffset = rule.rhs.length - paramNum
      stackRef = if stackOffset == 0 then "$$[$0]" else "$$[$0-#{stackOffset}]"

      # Add source map annotation for parameter access
      if originalLocation
        @sourceMapTracker.addMapping(
          { line: @getCurrentGeneratedLine(), column: 0 },
          { line: originalLocation.line, column: originalLocation.column + match.index || 0 },
          0,
          "$#{paramNum}"
        )

      stackRef

    # Replace location references
    action = action.replace /@(\d+)/g, (match, n) =>
      paramNum = parseInt(n, 10)
      if paramNum < 1 or paramNum > rule.rhs.length
        return match

      stackOffset = rule.rhs.length - paramNum
      if stackOffset == 0
        "_$[_$.length - 1]"
      else
        "_$[_$.length - 1 - #{stackOffset}]"

    action

  # Generate parser code with source map support
  generateParserCodeWithSourceMap: (table, rules, symbols, tokens, performAction) ->
    @currentGeneratedLine = 1

    """/* Generated by rip-parser 1.0.0 with source maps */

const parser = (() => {
  const parser = {
    trace: () => { },
    yy: { },
    symbols_: #{JSON.stringify(symbols)},
    terminals_: #{@jsonStringifyWithNumericKeys(tokens)},
    productions_: #{JSON.stringify(rules)},
    #{performAction},
    table: #{@jsonStringifyWithNumericKeys(table)},
    defaultActions: #{JSON.stringify(@defaultActions)},

    parseError(str, hash) {
      if (hash.recoverable) {
        this.trace(str);
      } else {
        const err = new Error(str);
        err.hash = hash;
        throw err;
      }
    },

    parse(input) {
      const self = this;
      let stack = [0];
      let vstack = [null];
      let lstack = [];
      let yytext = '';
      let yylineno = 0;
      let yyleng = 0;
      let recovering = 0;
      let TERROR = 2;
      let EOF = 1;

      const args = [].slice.call(arguments, 1);
      const lexer = Object.assign({}, this.lexer, this.yy.lexer);
      const sharedState = { yy: {} };

      for (const k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
          sharedState.yy[k] = this.yy[k];
        }
      }

      lexer.setInput(input, sharedState.yy);
      sharedState.yy.lexer = lexer;
      sharedState.yy.parser = this;

      if (typeof lexer.yylloc === 'undefined') {
        lexer.yylloc = {};
      }
      let yyloc = lexer.yylloc;
      lstack.push(yyloc);

      const ranges = lexer.options && lexer.options.ranges;

      if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
      } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
      }

      let symbol, preErrorSymbol, state, action, r, yyval = {}, p, len, newState, expected;

      while (true) {
        state = stack[stack.length - 1];

        if (this.defaultActions[state]) {
          action = this.defaultActions[state];
        } else {
          if (symbol === null || symbol === undefined) {
            symbol = lex();
          }
          action = this.table[state] && this.table[state][symbol];
        }

        if (typeof action === 'undefined' || !action.length || !action[0]) {
          let errStr = '';
          expected = [];
          for (p in this.table[state]) {
            if (this.terminals_[p] && p > TERROR) {
              expected.push("'" + this.terminals_[p] + "'");
            }
          }

          if (lexer.showPosition) {
            errStr = 'Parse error on line ' + (yylineno + 1) + ":\\n" + lexer.showPosition() + "\\nExpecting " + expected.join(', ') + ", got '" + (this.terminals_[symbol] || symbol) + "'";
          } else {
            errStr = 'Parse error on line ' + (yylineno + 1) + ": Unexpected " +
                     (symbol == EOF ? "end of input" :
                      ("'" + (this.terminals_[symbol] || symbol) + "'"));
          }

          this.parseError(errStr, {
            text: lexer.match,
            token: this.terminals_[symbol] || symbol,
            line: lexer.yylineno,
            loc: yyloc,
            expected: expected
          });
        }

        if (action[0] instanceof Array && action.length > 1) {
          throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }

        switch (action[0]) {
          case 1: // shift
            stack.push(symbol);
            vstack.push(lexer.yytext);
            lstack.push(lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
              yyleng = lexer.yyleng;
              yytext = lexer.yytext;
              yylineno = lexer.yylineno;
              yyloc = lexer.yylloc;
              if (recovering > 0) {
                recovering--;
              }
            } else {
              symbol = preErrorSymbol;
              preErrorSymbol = null;
            }
            break;

          case 2: // reduce
            len = this.productions_[action[1] * 2 + 1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
              first_line: lstack[lstack.length - (len || 1)].first_line,
              last_line: lstack[lstack.length - 1].last_line,
              first_column: lstack[lstack.length - (len || 1)].first_column,
              last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
              yyval._$.range = [
                lstack[lstack.length - (len || 1)].range[0],
                lstack[lstack.length - 1].range[1]
              ];
            }
            r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], vstack, lstack].concat(args));

            if (typeof r !== 'undefined') {
              return r;
            }

            if (len) {
              stack = stack.slice(0, -1 * len * 2);
              vstack = vstack.slice(0, -1 * len);
              lstack = lstack.slice(0, -1 * len);
            }

            stack.push(this.productions_[action[1] * 2]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = this.table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;

          case 3: // accept
            return true;
        }
      }

      function lex() {
        let token = lexer.lex() || EOF;
        if (typeof token !== 'number') {
          if (token === '') {
            token = EOF;
          } else {
            token = self.symbols_[token] || token;
          }
        }
        return token;
      }
    }
  };

  parser.Parser = parser.Parser || function Parser() { this.yy = {}; };
  parser.Parser.prototype = parser;
  parser.parse = parser.parse;
  return parser;
})();

if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  module.exports = {
    parser,
    Parser: parser.Parser,
    parse: (...args) => parser.parse(...args)
  };
}
    """

  # Helper methods for source map generation
  getCurrentGeneratedLine: ->
    @currentGeneratedLine || 1

  getOriginalRuleLocation: (rule) ->
    # Try to extract original location from rule metadata
    if rule.location
      rule.location
    else if rule.originalSource
      { line: rule.originalSource.line || 1, column: rule.originalSource.column || 0 }
    else
      null

  getOriginalActionLocation: (rule) ->
    # Try to extract original action location
    if rule.actionLocation
      rule.actionLocation
    else if rule.location
      { line: rule.location.line, column: rule.location.column + 10 } # Estimate action position
    else
      null

  # Helper method to generate console function overloading
  generateConsoleOverrides: (options = {}) ->
    return "" unless options.production or options.silentParser or options.logLevel in ['minimal', 'silent']

    if options.silentParser or options.logLevel == 'silent'
      # Complete silence - all console functions become no-ops
      """
  // Console function overrides for silent operation
  const console = {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    dir: () => {},
    time: () => {},
    timeEnd: () => {},
    group: () => {},
    groupEnd: () => {},
    clear: () => {},
    count: () => {},
    assert: () => {},
    table: () => {}
  };
"""
    else if options.logLevel == 'minimal'
      # Minimal logging - only errors and warnings
      """
  // Console function overrides for minimal logging
  const originalConsole = (typeof window !== 'undefined' ? window.console : global.console) || console;
  const console = {
    log: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    dir: () => {},
    time: () => {},
    timeEnd: () => {},
    group: () => {},
    groupEnd: () => {},
    clear: () => {},
    count: () => {},
    table: () => {},
    warn: originalConsole.warn.bind(originalConsole),
    error: originalConsole.error.bind(originalConsole),
    assert: originalConsole.assert.bind(originalConsole)
  };
"""
    else if options.production
      # Production mode - no debug output, only errors
      """
  // Console function overrides for production
  const originalConsole = (typeof window !== 'undefined' ? window.console : global.console) || console;
  const console = {
    log: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    dir: () => {},
    time: () => {},
    timeEnd: () => {},
    group: () => {},
    groupEnd: () => {},
    clear: () => {},
    count: () => {},
    table: () => {},
    warn: () => {},
    error: originalConsole.error.bind(originalConsole),
    assert: originalConsole.assert.bind(originalConsole)
  };
"""
    else
      ""

# ==[ Export ]===============================================================

module.exports = { Generator }

# ============================================================================
# COMPREHENSIVE CLI INTERFACE
# ============================================================================

if !module.parent
  # CLI Implementation
  fs = require 'fs'
  path = require 'path'

  # CLI Configuration and Options
  class CLIOptions
    constructor: ->
      @inputFile = null
      @outputFile = null
      @verbose = false
      @debug = false
      @quiet = false
      @showStats = false
      @showStates = false
      @showConflicts = false
      @showGrammar = false
      @generateReport = false
      @reportFile = null
      @optimize = 'auto'  # auto, on, off
      @compression = 'auto'  # auto, coo, csr, dictionary, rle, off
      @minimization = true
      @sourceMap = false
      @sourceMapFile = null
      @format = 'commonjs'  # commonjs, es6, umd
      @namespace = 'parser'
      @performance = false
      @interactive = false
      @help = false
      @version = false
      @production = false  # NEW: Generate production-ready parser (no console output)
      @silentParser = false  # NEW: Completely silent parser (all console functions as no-ops)
      @logLevel = 'normal'  # NEW: normal, minimal, silent

  # Parse command line arguments
  parseArgs = (args) ->
    options = new CLIOptions()
    i = 0

    while i < args.length
      arg = args[i]

      switch arg
        when '-h', '--help'
          options.help = true
        when '-v', '--version'
          options.version = true
        when '-V', '--verbose'
          options.verbose = true
        when '-d', '--debug'
          options.debug = true
        when '-q', '--quiet'
          options.quiet = true
        when '--stats'
          options.showStats = true
        when '--states'
          options.showStates = true
        when '--conflicts'
          options.showConflicts = true
        when '--grammar'
          options.showGrammar = true
        when '--report'
          options.generateReport = true
          if args[i + 1] and not args[i + 1].startsWith('-')
            options.reportFile = args[++i]
        when '--optimize'
          if args[i + 1] and not args[i + 1].startsWith('-')
            options.optimize = args[++i]
          else
            options.optimize = 'on'
        when '--compression'
          if args[i + 1] and not args[i + 1].startsWith('-')
            options.compression = args[++i]
          else
            options.compression = 'auto'
        when '--no-minimize'
          options.minimization = false
        when '--source-map'
          options.sourceMap = true
          if args[i + 1] and not args[i + 1].startsWith('-')
            options.sourceMapFile = args[++i]
        when '--format'
          if args[i + 1] and not args[i + 1].startsWith('-')
            options.format = args[++i]
        when '--namespace'
          if args[i + 1] and not args[i + 1].startsWith('-')
            options.namespace = args[++i]
        when '--performance'
          options.performance = true
        when '--interactive'
          options.interactive = true
        when '-o', '--output'
          if args[i + 1] and not args[i + 1].startsWith('-')
            options.outputFile = args[++i]
          else
            console.error "Error: --output requires a filename"
            process.exit(1)
        when '--production'
          options.production = true
          options.logLevel = 'silent'
        when '--silent-parser'
          options.silentParser = true
        when '--log-level'
          if args[i + 1] and not args[i + 1].startsWith('-')
            logLevel = args[++i]
            if logLevel in ['normal', 'minimal', 'silent']
              options.logLevel = logLevel
            else
              console.error "Error: Invalid log level '#{logLevel}'. Use: normal, minimal, silent"
              process.exit(1)
          else
            console.error "Error: --log-level requires a value"
            process.exit(1)
        else
          if not arg.startsWith('-')
            options.inputFile = arg
          else
            console.error "Error: Unknown option '#{arg}'"
            showUsage()
            process.exit(1)

      i++

    options

  # Show help and usage information
  showUsage = ->
    console.log """
    rip-parser - Advanced LALR(1) Parser Generator

    USAGE:
      rip-parser [OPTIONS] GRAMMAR_FILE

    OPTIONS:
      -h, --help              Show this help message
      -v, --version           Show version information
      -V, --verbose           Enable verbose output
      -d, --debug             Enable debug mode with detailed tracing
      -q, --quiet             Suppress all output except errors
      -o, --output FILE       Output file (default: stdout)

    ANALYSIS & REPORTING:
      --stats                 Show detailed statistics
      --states                Show state machine information
      --conflicts             Show shift/reduce conflicts analysis
      --grammar               Show processed grammar information
      --report [FILE]         Generate comprehensive analysis report
      --performance           Show performance metrics and timing

    OPTIMIZATION:
      --optimize [auto|on|off]    Control table optimization (default: auto)
      --compression [METHOD]      Compression method: auto, coo, csr, dictionary, rle, off
      --no-minimize              Disable state minimization
      --source-map [FILE]        Generate source maps for debugging

    OUTPUT FORMAT:
      --format [commonjs|es6|umd] Output format (default: commonjs)
      --namespace NAME           Namespace for UMD format (default: parser)

    CONSOLE OUTPUT CONTROL:
      --production               Generate production-ready parser (silent console output)
      --silent-parser            Generate completely silent parser (all console functions as no-ops)
      --log-level [LEVEL]        Console output level: normal, minimal, silent (default: normal)

    INTERACTIVE:
      --interactive              Start interactive mode for grammar exploration

    EXAMPLES:
      # Basic parser generation
      rip-parser grammar.coffee -o parser.js

      # Verbose generation with optimization
      rip-parser grammar.coffee --verbose --optimize on --stats

      # Generate comprehensive report
      rip-parser grammar.coffee --report analysis.md --conflicts --states

      # Performance analysis
      rip-parser grammar.coffee --performance --compression csr

      # Interactive exploration
      rip-parser grammar.coffee --interactive

      # Debug mode with source maps
      rip-parser grammar.coffee --debug --source-map parser.js.map

      # Production-ready parser (no console output)
      rip-parser grammar.coffee --production -o parser.js

      # Completely silent parser
      rip-parser grammar.coffee --silent-parser -o parser.js

      # Minimal console output
      rip-parser grammar.coffee --log-level minimal -o parser.js
    """

  # Show version information
  showVersion = ->
    console.log """
    rip-parser 1.0.0
    Advanced LALR(1) Parser Generator with Comprehensive Optimizations

    Features:
    • Correct LALR(1) algorithm implementation
    • State minimization and table optimization
    • Multiple compression algorithms (COO, CSR, Dictionary, RLE)
    • Source map generation for debugging
    • Comprehensive conflict analysis and resolution
    • Interactive grammar exploration tools
    • High-performance runtime generation
    • Professional development and debugging tools

    Copyright (c) 2025 - Licensed under MIT
    """

  # Main CLI function
  main = (args = process.argv.slice(2)) ->
    try
      options = parseArgs(args)

      if options.help
        showUsage()
        return

      if options.version
        showVersion()
        return

      unless options.inputFile
        console.error "Error: No grammar file specified"
        showUsage()
        process.exit(1)

      unless fs.existsSync(options.inputFile)
        console.error "Error: Grammar file '#{options.inputFile}' not found"
        process.exit(1)

      # Configure output verbosity
      if options.quiet
        console.log = -> # Suppress normal output
      else if options.verbose
        console.log "🚀 rip-parser - Advanced LALR(1) Parser Generator"
        console.log "📁 Input: #{options.inputFile}"

      # Read and parse grammar file
      grammarSource = fs.readFileSync(options.inputFile, 'utf8')
      grammar = parseGrammarFile(grammarSource, options)

      # Create generator with appropriate configuration
      generator = new Generator()
      configureGenerator(generator, options)

      # Generate the parser
      startTime = Date.now()
      parser = generateParser(generator, grammar, options)
      generationTime = Date.now() - startTime

      # Output results
      outputResults(parser, options, generationTime)

      # Generate reports if requested
      if options.generateReport or options.showStats or options.showStates or options.showConflicts
        generateReports(generator, options)

      # Interactive mode
      if options.interactive
        startInteractiveMode(generator, options)

    catch error
      console.error "❌ Error: #{error.message}"
      if options.debug
        console.error error.stack
      process.exit(1)

  # Parse grammar file based on format
  parseGrammarFile = (source, options) ->
    try
      # Try to evaluate as CoffeeScript/JavaScript
      if options.inputFile.endsWith('.coffee')
        # CoffeeScript grammar file
        CoffeeScript = require('coffeescript')
        compiledSource = CoffeeScript.compile(source, { bare: true })
        grammar = eval(compiledSource)
      else if options.inputFile.endsWith('.js')
        # JavaScript grammar file
        grammar = eval(source)
      else
        # Try JSON format
        grammar = JSON.parse(source)

      if options.verbose
        console.log """
        ✅ Grammar file parsed successfully
        📊 Productions: #{Object.keys(grammar.grammar || {}).length}
        🎯 Start symbol: #{grammar.start || 'unknown'}
        """

      grammar

    catch error
      throw new Error("Failed to parse grammar file: #{error.message}")

  # Configure generator based on CLI options
  configureGenerator = (generator, options) ->
    # Set optimization configuration
    generator.optimizationConfig = {
      enabled: options.optimize == 'on'
      auto: options.optimize == 'auto'
      skipIfSmall: options.optimize == 'auto'
      minStatesForAuto: 20
      verbose: options.verbose or options.debug
      compression: options.compression
      minimization: options.minimization
      performance: options.performance
    }

    # Set debug configuration
    generator.debugConfig = {
      enabled: options.debug
      verbose: options.verbose
      showStates: options.showStates
      showConflicts: options.showConflicts
      showGrammar: options.showGrammar
      interactive: options.interactive
    }

    # Set console output configuration
    generator.consoleConfig = {
      production: options.production
      silentParser: options.silentParser
      logLevel: options.logLevel
    }

    if options.verbose
      console.log """
      ⚙️  Configuration:
         Optimization: #{options.optimize}
         Compression: #{options.compression}
         Minimization: #{options.minimization}
         Source Maps: #{options.sourceMap}
      """

  # Generate parser with configured options
  generateParser = (generator, grammar, options) ->
    if options.verbose
      console.log "\n🔧 Generating parser..."

    # Generate the parser using the complete workflow
    parser = generator.generate({
      grammar: grammar.grammar
      operators: grammar.operators
      start: grammar.start
      tokens: grammar.tokens
      format: options.format
      namespace: options.namespace
      sourceMap: options.sourceMap
      sourceMapFile: options.sourceMapFile
      performance: options.performance
      production: options.production
      silentParser: options.silentParser
      logLevel: options.logLevel
    })

    if options.verbose
      console.log "✅ Parser generated successfully"

    parser

  # Output results to file or stdout
  outputResults = (parser, options, generationTime) ->
    # Determine output content
    if typeof parser == 'string'
      content = parser
      sourceMap = null
    else
      content = parser.code
      sourceMap = parser.map

    # Write main output
    if options.outputFile
      fs.writeFileSync(options.outputFile, content, 'utf8')
      if options.verbose
        console.log """
        📝 Parser written to: #{options.outputFile}
        📏 Size: #{content.length} characters
        ⏱️  Generation time: #{generationTime}ms
        """
    else
      console.log content

    # Write source map if generated
    if sourceMap and options.sourceMapFile
      fs.writeFileSync(options.sourceMapFile, JSON.stringify(sourceMap, null, 2), 'utf8')
      if options.verbose
        console.log "🗺️  Source map written to: #{options.sourceMapFile}"

  # Generate comprehensive reports
  generateReports = (generator, options) ->
    reports = []

    if options.showStats
      reports.push(generateStatsReport(generator))

    if options.showStates
      reports.push(generateStatesReport(generator))

    if options.showConflicts
      reports.push(generateConflictsReport(generator))

    if options.showGrammar
      reports.push(generateGrammarReport(generator))

    if options.performance
      reports.push(generatePerformanceReport(generator))

    # Combine all reports
    fullReport = reports.join('\n\n')

    if options.generateReport
      reportFile = options.reportFile || 'parser-analysis.md'
      fs.writeFileSync(reportFile, fullReport, 'utf8')
      console.log "📊 Analysis report written to: #{reportFile}"
    else
      console.log fullReport

  # Generate statistics report
  generateStatsReport = (generator) ->
    stats = generator.getStatistics()

    """
    ## Parser Statistics

    **Grammar:**
    - Productions: #{stats.productions}
    - Non-terminals: #{stats.nonterminals}
    - Terminals: #{stats.terminals}
    - Start symbol: #{stats.start}

    **Parsing Table:**
    - States: #{stats.states}
    - Table size: #{stats.tableSize} cells
    - Filled cells: #{stats.filledCells}
    - Sparsity: #{stats.sparsity}%

    **Optimizations:**
    - State minimization: #{if stats.minimized then 'enabled' else 'disabled'}
    - Table compression: #{stats.compression || 'none'}
    - Optimization time: #{stats.optimizationTime}ms
    """

  # Generate states report
  generateStatesReport = (generator) ->
    stateReports = for state, i in generator.states
      items = ("  - #{item.toString()}" for item in state.items).join('\n')

      transitions = if state.transitions?.size > 0
        transitionList = ("  - #{symbol} → State #{nextState.id}" for [symbol, nextState] from state.transitions).join('\n')
        "\nTransitions:\n#{transitionList}"
      else
        ""

      "**State #{i}:**\nItems:\n#{items}#{transitions}"

    """
## State Machine Analysis

#{stateReports.join('\n\n')}
"""

  # Generate conflicts report
  generateConflictsReport = (generator) ->
    if generator.conflicts?.length > 0
      conflictReports = for conflict in generator.conflicts
        explanationText = if conflict.explanation then "\n- Explanation: #{conflict.explanation}" else ""

        suggestionsText = if conflict.suggestions?.length > 0
          suggestionList = ("  - #{suggestion}" for suggestion in conflict.suggestions).join('\n')
          "\n- Suggestions:\n#{suggestionList}"
        else
          ""

        """**#{conflict.type} Conflict in State #{conflict.state}:**
- Lookahead: #{conflict.lookahead}
- Actions: #{conflict.actions.map((a) -> JSON.stringify(a)).join(', ')}
- Resolved: #{conflict.resolved}#{explanationText}#{suggestionsText}"""

      """
## Conflicts Analysis

#{conflictReports.join('\n\n')}
"""
    else
      """
## Conflicts Analysis

✅ No conflicts detected!
"""

  # Generate grammar report
  generateGrammarReport = (generator) ->
    productions = ("- #{rule.lhs} → #{rule.rhs.join(' ')}" for rule in generator.rules).join('\n')

    firstSets = for [symbol, symbolObj] from generator.symbols when not symbolObj.isTerminal and symbolObj.first?.size > 0
      "- FIRST(#{symbol}) = {#{[...symbolObj.first].join(', ')}}"

    followSets = for [symbol, symbolObj] from generator.symbols when not symbolObj.isTerminal and symbolObj.follow?.size > 0
      "- FOLLOW(#{symbol}) = {#{[...symbolObj.follow].join(', ')}}"

    """
## Grammar Analysis

**Productions:**
#{productions}

**First Sets:**
#{firstSets.join('\n')}

**Follow Sets:**
#{followSets.join('\n')}
"""

  # Generate performance report
  generatePerformanceReport = (generator) ->
    perf = generator.performanceStats

    """
    ## Performance Analysis

    **Generation Times:**
    - Total: #{perf.totalTime}ms
    - Grammar processing: #{perf.grammarTime}ms
    - Table construction: #{perf.tableTime}ms
    - Optimization: #{perf.optimizationTime}ms
    - Code generation: #{perf.codeGenTime}ms

    **Cache Performance:**
    - Closure calls: #{perf.closureCalls}
    - Cache hits: #{perf.cacheHits}
    - Hit rate: #{Math.round((perf.cacheHits / perf.closureCalls) * 100)}%

    **Memory Usage:**
    - Peak memory: #{perf.peakMemory}MB
    - Final memory: #{perf.finalMemory}MB
    """

  # Interactive mode for grammar exploration
  startInteractiveMode = (generator, options) ->
    readline = require('readline')

    rl = readline.createInterface({
      input: process.stdin
      output: process.stdout
      prompt: 'rip-parser> '
    })

    console.log """

    🎮 Interactive Mode - Grammar Explorer
    =====================================

    Commands:
      states              - List all states
      state <id>          - Explore specific state
      conflicts           - Show all conflicts
      grammar             - Show grammar rules
      symbols             - Show symbol information
      stats               - Show statistics
      optimize            - Run optimization
      help                - Show this help
      exit                - Exit interactive mode
    """

    rl.prompt()

    rl.on 'line', (input) ->
      try
        handleInteractiveCommand(input.trim(), generator, rl)
      catch error
        console.log "❌ Error: #{error.message}"
      rl.prompt()

    rl.on 'close', ->
      console.log '\n👋 Goodbye!'
      process.exit(0)

  # Handle interactive commands
  handleInteractiveCommand = (command, generator, rl) ->
    [cmd, ...args] = command.split(' ')

    switch cmd
      when 'states'
        console.log "\n📊 States (#{generator.states.length} total):"
        for state, i in generator.states
          inadequate = if state.inadequate then ' (inadequate)' else ''
          console.log "  #{i}: #{state.items.length} items#{inadequate}"

      when 'state'
        if args.length > 0
          stateId = parseInt(args[0], 10)
          if stateId >= 0 and stateId < generator.states.length
            generator.exploreState(stateId)
          else
            console.log "❌ Invalid state ID: #{stateId}"
        else
          console.log "❌ Usage: state <id>"

      when 'conflicts'
        if generator.conflicts?.length > 0
          console.log "\n⚠️  Conflicts (#{generator.conflicts.length} total):"
          for conflict, i in generator.conflicts
            console.log "  #{i + 1}. #{conflict.type} in state #{conflict.state}"
        else
          console.log "\n✅ No conflicts!"

      when 'grammar'
        console.log "\n📝 Grammar Rules:"
        for rule, i in generator.rules
          console.log "  #{i}: #{rule.lhs} → #{rule.rhs.join(' ')}"

      when 'symbols'
        console.log "\n🔤 Symbols:"
        for [name, symbol] from generator.symbols
          type = if symbol.isTerminal then 'T' else 'NT'
          console.log "  #{name} (#{type})"

      when 'stats'
        stats = generator.getStatistics()
        console.log """

        📊 Statistics:
          States: #{stats.states}
          Productions: #{stats.productions}
          Terminals: #{stats.terminals}
          Non-terminals: #{stats.nonterminals}
        """

      when 'optimize'
        console.log "\n🔧 Running optimization..."
        generator.optimizeTables()
        console.log "✅ Optimization complete!"

      when 'help'
        console.log """

        Available commands:
          states              - List all states
          state <id>          - Explore specific state
          conflicts           - Show all conflicts
          grammar             - Show grammar rules
          symbols             - Show symbol information
          stats               - Show statistics
          optimize            - Run optimization
          help                - Show this help
          exit                - Exit interactive mode
        """

      when 'exit'
        rl.close()

      when ''
        # Empty command, do nothing

      else
        console.log "❌ Unknown command: #{cmd}. Type 'help' for available commands."

  # Run the CLI
  main()
