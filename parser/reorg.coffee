#!/usr/bin/env coffee

# ==============================================================================
# rip-parser: A modern, LALR(1) parser generator for the rip ecosystem
# REORGANIZED VERSION - Functions ordered by execution flow
#
# Author: Steve Shreeve <steve.shreeve@gmail.com> and Claude 4 Opus/Sonnet
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

  # ============================================================================
  # 1. ENTRY POINT - Main orchestration function
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

    # Generate the parser code using unified format
    @generateCommonJS(options)

  # ============================================================================
  # 2. GRAMMAR PROCESSING PHASE
  # ============================================================================

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

    # Throw error if any validation failed
    if errors.length > 0
      throw new Error("Grammar validation failed:\n  #{errors.join('\n  ')}")

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
      if paramNum > rhsLength and not (rhsLength == 0 and paramNum == 1) and not (nonterminal == '$accept' and paramNum == 0)
        console.warn("Warning: Parameter #{match} in action for '#{nonterminal}' production #{productionIndex} exceeds RHS length (#{rhsLength})")

  # Operator precedence and associativity
  processOperators: (operators) ->
    @precedence = {}
    precedenceLevel = 1

    for group in operators
      [assoc, symbols...] = group
      for symbol in symbols
        @precedence[symbol] = { level: precedenceLevel, assoc }
      precedenceLevel++

  # Add error recovery productions to the grammar
  addErrorRecoveryProductions: ->
    # Find non-terminals that could benefit from error recovery
    candidateNonTerminals = []

    for [name, symbol] from @symbols
      if not symbol.isTerminal
        # Look for non-terminals that appear in multiple rules
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

  # Check if a symbol name is valid
  isValidSymbolName: (name) ->
    return false unless name? and typeof name is 'string'
    return false if name.length == 0
    # Allow alphanumeric, underscore, hyphen, and some special characters for terminals
    /^[a-zA-Z_][a-zA-Z0-9_?-]*$|^[+\-*/(){}[\];,.'":=<>!&|?~^%$#@\\]+$/.test(name)

  # Get or create a symbol
  getSymbol: (name, isTerminal) ->
    return sym if sym = @symbols.get(name)
    isTerminal = if isTerminal? then !!isTerminal else @tokens.has(name)
    symbol = new Symbol(name, isTerminal, @symbols.size)
    @symbols.set name, symbol
    symbol

  # ============================================================================
  # 3. GRAMMAR CLEANUP PHASE
  # ============================================================================

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

  # ============================================================================
  # 4. LALR(1) ANALYSIS PHASE
  # ============================================================================

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
  # 5. STATE MACHINE CONSTRUCTION
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
  # 6. LOOKAHEAD COMPUTATION
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
  # 7. PARSING TABLE CONSTRUCTION
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
            # Conflict! Try to resolve with precedence
            existing = table[state.id][la]
            if existing.type is 'shift'
              # Shift/reduce conflict
              resolved = @resolveConflict(item.rule, la)
              if resolved == 'reduce'
                table[state.id][la] = { type: 'reduce', rule: item.rule.id }
                @conflicts.push({
                  type: 'shift/reduce'
                  state: state.id
                  lookahead: la
                  resolved: true
                  resolution: 'reduce'
                })
              else if resolved == 'shift'
                @conflicts.push({
                  type: 'shift/reduce'
                  state: state.id
                  lookahead: la
                  resolved: true
                  resolution: 'shift'
                })
              else
                # unresolved conflict
                conflicts.sr++
                state.inadequate = true
                @inadequateStates.push(state) unless @inadequateStates.includes(state)
                @conflicts.push({
                  type: 'shift/reduce'
                  state: state.id
                  lookahead: la
                  resolved: false
                  resolution: 'shift'
                })
            else if existing.type is 'reduce'
              # Reduce/reduce conflict - use first rule (earliest in grammar)
              existingRuleId = existing.rule
              if item.rule.id < existingRuleId
                table[state.id][la] = { type: 'reduce', rule: item.rule.id }
              @conflicts.push({
                type: 'reduce/reduce'
                state: state.id
                lookahead: la
                resolved: true
                resolution: "rule #{Math.min(item.rule.id, existingRuleId)}"
              })
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
        else null

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

# ============================================================================
# REORGANIZATION STATUS
# ============================================================================

# ✅ COMPLETED PHASES (Functions already implemented above):
# 1. Entry Point: generate()
# 2. Grammar Processing: processGrammar(), validateGrammarInput(), parseProductionPattern(),
#    validateActionCode(), processOperators(), addErrorRecoveryProductions(), buildRuleLookupCache()
# 3. Grammar Cleanup: eliminateUnproductive(), eliminateUnreachable(), reassignIds()
# 4. LALR Analysis: computeNullable(), computeFirst(), computeFollow(), firstOfString()
# 5. State Construction: buildStates(), closure(), findOrAddState(), computeCore()
# 6. Lookahead: computeLookaheads(), closureWithLookahead(), propagateLookaheads(), validateLookaheads()
# 7. Table Construction: buildTable(), resolveConflict(), getRulePrecedence()

# 🔄 STILL MISSING (Functions that need to be extracted from original file):
# 8. Optimization Phase: minimizeStates(), smartOptimizeTable()
# 9. Default Actions: computeDefaultActions(), prepareUnifiedStates()
# 10. Code Generation: generateCommonJS(), generateOptimizedCommonJS(), buildPerformAction(),
#     transformAction(), prepareRules(), generateUnifiedGrammarCode(), generateUnifiedRuntimeFunctions()
# 11. Final Steps: reportConflicts(), reportPerformanceStats()
# Plus various helper functions and utilities

# The reorganization is approximately 70% complete with all core parsing logic implemented.
# The remaining functions are primarily optimization and code generation utilities.