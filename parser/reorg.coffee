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
  # 8. OPTIMIZATION PHASE
  # ============================================================================

  # State minimization to reduce parse table size
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
    # Check if actions conflict for any symbol
    allSymbols = new Set()

    # Collect all symbols from both states
    for [symbol, nextState] from state1.transitions
      allSymbols.add(symbol)
    for [symbol, nextState] from state2.transitions
      allSymbols.add(symbol)

    # Check reduce actions
    for item in state1.items
      if item.isComplete()
        for la from item.lookahead
          allSymbols.add(la)

    for item in state2.items
      if item.isComplete()
        for la from item.lookahead
          allSymbols.add(la)

    # Check each symbol for conflicts
    for symbol from allSymbols
      action1 = @getStateAction(state1, symbol)
      action2 = @getStateAction(state2, symbol)

      # If both states have actions for this symbol, they must be compatible
      if action1 and action2
        # Different action types = conflict
        if action1.type != action2.type
          return false
        # Same type but different targets = conflict
        if action1.type == 'shift' and action1.state != action2.state
          return false
        if action1.type == 'reduce' and action1.rule != action2.rule
          return false
        if action1.type == 'goto' and action1 != action2
          return false

    true

  # Get the action a state would take for a given symbol
  getStateAction: (state, symbol) ->
    # Check transitions first
    if state.transitions.has(symbol)
      nextState = state.transitions.get(symbol)
      if @getSymbol(symbol).isTerminal
        return { type: 'shift', state: nextState.id }
      else
        return { type: 'goto', target: nextState.id }

    # Check reduce actions
    for item in state.items
      if item.isComplete() and item.lookahead.has(symbol)
        if item.rule.lhs == '$accept'
          return { type: 'accept' }
        else
          return { type: 'reduce', rule: item.rule.id }

    null

  # Merge one state into another
  mergeStateInto: (sourceState, targetState) ->
    # Merge items
    for item in sourceState.items
      targetState.addItem(item)

    # Update all transitions pointing to sourceState to point to targetState
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
      when 'CSR'
        @compressedTable = @compressWithCSR()
      else
        @compressedTable = @compressWithDictionary()

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
      'CSR'  # Good general purpose

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

  # Compression algorithm implementations
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

  compressWithCSR: ->
    entries = []
    rowStarts = [0]

    for stateId in [0...@states.length]
      if @table[stateId]
        for symbol, action of @table[stateId]
          symbolId = @symbols.get(symbol)?.id
          if symbolId? and action?
            entries.push([symbolId, @encodeAction(action)])
      rowStarts.push(entries.length)

    originalSize = @states.length * @symbols.size * 8
    compressedSize = entries.length * 8 + rowStarts.length * 4

    {
      method: 'CSR',
      data: { entries, rowStarts },
      compressionRatio: ((originalSize - compressedSize) / originalSize) * 100,
      size: compressedSize
    }

  compressWithDictionary: ->
    actionMap = new Map()
    actionId = 0

    for stateId in [0...@states.length]
      if @table[stateId]
        for symbol, action of @table[stateId]
          actionKey = JSON.stringify(action)
          unless actionMap.has(actionKey)
            actionMap.set(actionKey, actionId++)

    originalSize = @states.length * @symbols.size * 8
    compressedSize = actionMap.size * 16 + @states.length * @symbols.size * 2

    {
      method: 'Dictionary',
      data: actionMap,
      compressionRatio: ((originalSize - compressedSize) / originalSize) * 100,
      size: compressedSize
    }

  # Encode action for compression
  encodeAction: (action) ->
    if action?.type == 'shift'
      (1 << 24) | action.state
    else if action?.type == 'reduce'
      (2 << 24) | action.rule
    else if action?.type == 'accept'
      (3 << 24)
    else
      action  # GOTO action

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
  # 9. DEFAULT ACTIONS PHASE
  # ============================================================================

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

  # Prepare unified states array with dense format + statics optimization
  prepareUnifiedStates: ->
    # Find the maximum state ID to size the array
    maxState = Math.max(...Object.keys(@table || {}).map(Number))
    states = []

    # Initialize array with empty objects for all states
    for i in [0..maxState]
      states[i] = {}

    # SINGLE PASS: For each state, either make it static OR multi-action
    for stateId, stateTable of @table
      state = parseInt(stateId)
      stateObj = states[state]

      # Collect all actions for this state
      actions = []

      # FIRST: Check for default action and add it at symbol 0
      if @defaultActions[state]
        actions.push([0, @defaultActions[state]])

      # THEN: Add regular actions
      for symbol, action of stateTable
        symbolObj = @symbols.get(symbol)
        continue unless symbolObj

        actionArray = if action?.type
          switch action.type
            when 'shift' then [1, action.state]
            when 'reduce' then [2, action.rule]
            when 'accept' then [3, 0]
        else
          [0, action]  # GOTO action

        actions.push([symbolObj.id, actionArray])

      # Decision: Single action = static, Multiple actions = full mapping
      if actions.length == 1
        # Static state: put the action at symbol 0
        stateObj[0] = actions[0][1]
      else
        # Multi-action state: put all actions at their symbol IDs
        for [symbolId, actionArray] in actions
          stateObj[symbolId] = actionArray

    states

  # ============================================================================
  # 10. CODE GENERATION PHASE
  # ============================================================================

  # Generate complete unified CommonJS parser (new default format)
  generateCommonJS: (options = {}) ->
    # Check if high-performance mode is requested
    if options.highPerformance
      return @generateOptimizedCommonJS(options)

    # Initialize source map tracking if requested
    if options.sourceMap
      @sourceMapTracker = new SourceMapTracker(options)

    # Generate unified grammar data
    unifiedGrammarCode = @generateUnifiedGrammarCode()
    unifiedRuntimeFunctions = @generateUnifiedRuntimeFunctions()

    # Get semantic actions from grammar (with optional source map tracking)
    performAction = options.performAction || @buildPerformAction(options.sourceMap)

    # Generate console overrides if needed
    consoleOverrides = @generateConsoleOverrides(options)

    # Generate the unified parser code
    """
/* Generated by rip-parser 1.0.0 - Unified Format */

const parser = (() => {
#{consoleOverrides}
#{unifiedGrammarCode}
#{unifiedRuntimeFunctions}

  // Semantic action dispatch
  const performAction = #{performAction};

  // Main parser implementation
  const parser = {
    // Token handling
    setInput: function(input) {
      if (typeof input === 'string') {
        this.input = input;
        this.tokens = null;
        this.position = 0;
      } else if (Array.isArray(input)) {
        this.tokens = input;
        this.position = 0;
      } else {
        throw new Error('Input must be a string or array of tokens');
      }
    },

    // Lexer interface
    lex: function() {
      if (this.tokens) {
        return this.tokens[this.position++] || 1; // 1 = EOF
      }
      // Basic string tokenization (override with custom lexer)
      return 1; // EOF
    },

    // Main parsing function
    parse: function(input) {
      this.setInput(input);

      const stack = [0];
      const vstack = [null];
      const lstack = [{}];

      let symbol = null;
      let action = null;
      let r = null;
      let recovering = 0;
      let errorCount = 0;

      while (true) {
        const state = stack[stack.length - 1];

        if (symbol === null) {
          symbol = this.lex();
        }

        action = getTableAction(state, symbol);

        if (!action) {
          if (recovering === 0) {
            errorCount++;
            const expected = [];
            for (let i = 0; i < symbols.length; i++) {
              const testAction = getTableAction(state, i);
              if (testAction) {
                expected.push(symbols[i]);
              }
            }

            const errStr = `Parse error at token ${symbol} (${symbols[symbol] || 'unknown'})`;
            throw new Error(errStr + (expected.length > 0 ? `, expected: ${expected.join(', ')}` : ''));
          }

          // Error recovery
          if (recovering === 3) {
            if (symbol === 1) { // EOF
              throw new Error('Parsing halted while recovering from error');
            }
            symbol = null;
            continue;
          }

          recovering = 3;
          continue;
        }

        if (Array.isArray(action)) {
          const [actionType, target] = action;

          if (actionType === 1) { // SHIFT
            stack.push(target);
            vstack.push(symbol);
            lstack.push({});
            symbol = null;
            if (recovering > 0) recovering--;
          } else if (actionType === 2) { // REDUCE
            const rule = getProduction(target);
            if (!rule) {
              throw new Error(`Invalid rule ${target}`);
            }

            const len = rule.length;
            const yyval = {};
            const yyloc = {};

            if (len > 0) {
              // Call semantic action
              const result = performAction.call(
                { $: yyval, _$: yyloc },
                '', 0, 0, {}, target,
                vstack.slice(-len),
                lstack.slice(-len)
              );

              // Pop RHS symbols
              stack.splice(-len);
              vstack.splice(-len);
              lstack.splice(-len);

              yyval.$ = result;
            }

            // Push LHS nonterminal
            const newState = getTableAction(stack[stack.length - 1], rule.lhs);
            if (newState === null) {
              throw new Error(`No goto action for state ${stack[stack.length - 1]}, symbol ${rule.lhs}`);
            }

            stack.push(newState);
            vstack.push(yyval.$);
            lstack.push(yyloc);

          } else if (actionType === 3) { // ACCEPT
            return vstack[vstack.length - 1];
          }
        } else {
          // GOTO action
          stack.push(action);
          vstack.push(symbol);
          lstack.push({});
          symbol = null;
        }
      }
    },

    // Parser metadata
    symbols: symbols,
    terminals: terminals,
    rules: rules,
    states: states,

    // Compatibility methods
    setInput: function(input) { this.setInput(input); },
    parse: function(input) { return this.parse(input); }
  };

  return parser;
})();

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parser;
}

// Browser global
if (typeof window !== 'undefined') {
  window.parser = parser;
}
    """

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
/* High-Performance Parser - Generated by rip-parser */

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

    getTableAction(state, symbol) {
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

    popStacks(count) {
      this.stackTop -= count;
    }

    getCurrentState() {
      return this.stateStack[this.stackTop];
    }

    parse(input) {
      this.initializeStacks();
      let symbol = null;
      let action = null;
      let recovering = 0;
      let errorCount = 0;

      // Setup input handling
      if (typeof input === 'string') {
        // String input - needs tokenization
        this.input = input;
        this.position = 0;
      } else if (Array.isArray(input)) {
        // Token array input
        this.tokens = input;
        this.position = 0;
      }

      while (true) {
        const state = this.getCurrentState();

        if (symbol === null) {
          symbol = this.lex();
          this.stats.tokens++;
        }

        action = this.getTableAction(state, symbol);

        if (!action) {
          if (recovering === 0) {
            errorCount++;
            this.handleError(state, symbol);
          }

          // Error recovery
          if (recovering === 3) {
            if (symbol === EOF) {
              throw new Error('Parsing halted while recovering from error');
            }
            symbol = null;
            continue;
          }

          recovering = 3;
          continue;
        }

        if (Array.isArray(action)) {
          const [actionType, target] = action;

          if (actionType === SHIFT) {
            this.pushState(target, symbol, symbol, {});
            symbol = null;
            if (recovering > 0) recovering--;
            this.stats.shifts++;
          } else if (actionType === REDUCE) {
            const production = productions[target];
            if (!production) {
              throw new Error(`Invalid production ${target}`);
            }

            const [lhs, length] = production;
            const yyval = {};
            const yyloc = {};

            if (length > 0) {
              // Execute semantic action
              if (actionTable[target]) {
                const result = actionTable[target](this.valueStack, this.stackTop - length + 1);
                yyval.$ = result;
              } else {
                yyval.$ = this.valueStack[this.stackTop - length + 1];
              }

              this.popStacks(length);
            }

            // Push LHS nonterminal
            const newState = this.getTableAction(this.getCurrentState(), lhs);
            if (newState === null) {
              throw new Error(`No goto for state ${this.getCurrentState()}, symbol ${lhs}`);
            }

            this.pushState(newState, lhs, yyval.$, yyloc);
            this.stats.reductions++;

          } else if (actionType === ACCEPT) {
            return this.valueStack[this.stackTop];
          }
        } else {
          // GOTO action
          this.pushState(action, symbol, symbol, {});
          symbol = null;
        }
      }
    }

    lex() {
      if (this.tokens) {
        return this.tokens[this.position++] || EOF;
      }
      // Basic string tokenization (override for custom lexer)
      return EOF;
    }

    handleError(state, symbol) {
      const expected = [];
      for (let i = 0; i < 100; i++) { // Check reasonable symbol range
        const testAction = this.getTableAction(state, i);
        if (testAction) {
          expected.push(i);
        }
      }

      const errStr = `Parse error at token ${symbol} in state ${state}`;
      throw new Error(errStr + (expected.length > 0 ? `, expected: ${expected.join(', ')}` : ''));
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

  # Build performAction from grammar
  buildPerformAction: (withSourceMap = false) ->
    actionCases = for rule, i in @rules
      action = rule.action || 'this.$ = $$[$0];'

      # Handle source map tracking if requested
      if withSourceMap
        originalLocation = @getOriginalActionLocation(rule)
        if originalLocation and @sourceMapTracker
          @sourceMapTracker.addMapping(
            { line: @getCurrentGeneratedLine(), column: 6 },
            originalLocation,
            0,
            "case_#{i}"
          )

      # Convert action to string if it's a function
      if typeof action is 'function'
        action = action.toString()
        match = action.match(/^(?:function\s*\([^)]*\)|[^=]+=>)\s*\{?\s*([\s\S]*?)\s*\}?\s*$/)
        if match
          action = match[1]
        else
          match = action.match(/^[^>]+>\s*(.*)$/)
          action = if match then match[1] else action

      # Replace action code patterns (with optional source map support)
      if withSourceMap
        action = @transformActionWithSourceMap(action, rule, originalLocation)
      else
        action = @transformAction(action, rule)

      """
      case #{i}: // #{rule.lhs} → #{rule.rhs.join(' ')}
        var $0 = $$.length - 1;
        #{action}
        break;"""

    """function(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
      switch (yystate) {#{actionCases.join('')}
      }
    }"""

  # Transform action code replacing $1, @1, etc.
  transformAction: (action, rule) ->
    # Handle the special case where CoffeeScript grammar uses @1 and $1 in empty productions
    # These need to be replaced with default values FIRST, before any other processing
    if rule.rhs.length == 0
      # For empty productions, @1 and $1 should use default values
      action = action.replace /@1/g, '{ first_line: 1, first_column: 0, last_line: 1, last_column: 0 }'
      action = action.replace /\$1/g, 'null'

    # Replace @$ with this.$
    action = action.replace /@\$/g, 'this.$'

    # Replace $$ with this.$
    action = action.replace /\$\$/g, 'this.$'

    # Replace positional parameters
    action = action.replace /\$(\d+)/g, (match, n) =>
      paramNum = parseInt(n, 10)
      # Skip validation for $accept rule which legitimately uses $0
      if paramNum < 1 or paramNum > rule.rhs.length
        unless rule.lhs == '$accept' and paramNum == 0
          console.warn "Warning: Parameter $#{paramNum} out of range for rule: #{rule.lhs} → #{rule.rhs.join(' ')}"
        return match

      stackOffset = rule.rhs.length - paramNum
      if stackOffset == 0 then "$$[$0]" else "$$[$0-#{stackOffset}]"

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

  # Transform action code with source map information
  transformActionWithSourceMap: (action, rule, originalLocation) ->
    # Handle the special case where CoffeeScript grammar uses @1 and $1 in empty productions
    # These need to be replaced with default values FIRST, before any other processing
    if rule.rhs.length == 0
      # For empty productions, @1 and $1 should use default values
      action = action.replace /@1/g, '{ first_line: 1, first_column: 0, last_line: 1, last_column: 0 }'
      action = action.replace /\$1/g, 'null'

    # Replace @$ with this.$
    action = action.replace /@\$/g, 'this.$'

    # Replace $$ with this.$
    action = action.replace /\$\$/g, 'this.$'

    # Replace positional parameters with source map annotations
    action = action.replace /\$(\d+)/g, (match, n) =>
      paramNum = parseInt(n, 10)
      if paramNum < 1 or paramNum > rule.rhs.length
        return match

      stackOffset = rule.rhs.length - paramNum
      replacement = if stackOffset == 0 then "$$[$0]" else "$$[$0-#{stackOffset}]"

      # Add source map annotation if available
      if originalLocation and @sourceMapTracker
        @sourceMapTracker.addMapping(
          { line: @getCurrentGeneratedLine(), column: 0 },
          originalLocation,
          0,
          "param_#{paramNum}"
        )

      replacement

    action

  # Prepare rules array for parser table
  prepareRules: (withSourceMap = false) ->
    rules = []
    for rule, i in @rules
      # Track original grammar location if source maps are requested
      if withSourceMap
        originalLocation = @getOriginalRuleLocation(rule)
        if originalLocation and @sourceMapTracker
          @sourceMapTracker.addMapping(
            { line: @getCurrentGeneratedLine(), column: 0 },
            originalLocation,
            0,
            rule.lhs
          )

      ruleData = [rule.lhs, rule.rhs.length]
      rules.push(ruleData)

    rules

  # Generate unified grammar with modern clean format
  generateUnifiedGrammar: ->
    # Get basic compact data
    symbols = @prepareCompactSymbols()
    terminals = @prepareCompactTerminals()
    productions = @prepareCompactProductions()

    # Generate unified states array with symbol 0 optimization
    states = @prepareUnifiedStates()

    {
      symbols: symbols
      terminals: terminals
      rules: productions  # Renamed from productions to rules
      states: states      # Unified array: symbol 0 = statics, other symbols = actions
    }

  # Convert unified grammar to JavaScript code with clean names
  generateUnifiedGrammarCode: ->
    unified = @generateUnifiedGrammar()

    # Convert Map to object for rules
    rulesObject = {}
    for [key, value] from unified.rules
      rulesObject[key] = value

    # Custom stringify for rules that removes all quotes (all keys and values are numeric)
    rulesString = JSON.stringify(rulesObject).replace(/"/g, '')

    # Custom stringify for states that removes all quotes (all keys and values are numeric)
    statesString = JSON.stringify(unified.states).replace(/"/g, '')

    """
    // Modern unified grammar representation - single data structure!
    const symbols = #{JSON.stringify(unified.symbols)};
    const terminals = #{JSON.stringify(unified.terminals)};
    const rules = #{rulesString};
    const states = #{statesString};
    """

  # Generate runtime functions for unified grammar access with O(1) lookups
  generateUnifiedRuntimeFunctions: ->
    """

    // Runtime functions for unified grammar access
function getSymbolId(name) {
  return symbols.indexOf(name);
}

function getSymbolName(id) {
  return symbols[id];
}

function isTerminal(symbolId) {
  return terminals.includes(symbolId);
}

function getRules(lhsId) {
  return rules[lhsId] || [];
}

function getProduction(ruleId) {
  const ruleInfo = rules[ruleId];
  if (!ruleInfo) return null;
  return {
    lhs: ruleInfo[0],
    length: ruleInfo[1]
  };
}

function getStateActions(state) {
  // Return actions for a state - used for error reporting
  const stateActions = states[state];
  if (!stateActions) return {};

  const actions = {};
  for (const symbol in stateActions) {
    if (symbol !== '0') { // Skip static actions (symbol 0)
      actions[symbol] = stateActions[symbol];
    }
  }
  return actions;
}

function getTableAction(state, symbol) {
  // Dense format with statics optimization
  const stateActions = states[state];
  if (!stateActions) return null;

  // Try static action first (symbol 0), then specific symbol
  const action = stateActions[0] || stateActions[symbol];
  if (!action) return null;

  const [type, target] = action;
  switch (type) {
    case 0: // GOTO
      return target;
    case 1: // SHIFT
      return [1, target];
    case 2: // REDUCE
      return [2, target];
    case 3: // ACCEPT
      return [3, 0];
    default:
      return null;
  }
}
    """

  # Generate compact symbols array (symbols__ = ["$accept","$end","error",...])
  prepareCompactSymbols: ->
    # Create array where index = symbol ID, value = symbol name
    symbolArray = new Array(@symbols.size)
    for [name, symbol] from @symbols
      symbolArray[symbol.id] = name
    symbolArray

  # Generate compact terminals array (terminals__ = [2,6,14,32,...])
  prepareCompactTerminals: ->
    terminalIds = []
    for [name, symbol] from @symbols
      if symbol.isTerminal
        terminalIds.push(symbol.id)
    terminalIds.sort((a, b) -> a - b)

  # Generate compact productions map (productions__ = Map {3=>[0,1], 4=>[1,3,2],...})
  prepareCompactProductions: ->
    productions = []
    for rule, id in @rules
      lhsSymbol = @symbols.get(rule.lhs)
      continue unless lhsSymbol
      lhsId = lhsSymbol.id
      rhsLength = rule.rhs.length
      productions[id] = [lhsId, rhsLength]
    productions

  # Generate compact table using nested array format
  prepareCompactTable: ->
    compactTable = []

    for state, i in @states
      continue unless @table[i]

      # Create subarray for this state: [stateId, symbol1, type1, target1, symbol2, type2, target2, ...]
      stateArray = [i]  # Start with state number

      for symbol, action of @table[i]
        symbolObj = @symbols.get(symbol)
        continue unless symbolObj

        # Add symbol ID
        stateArray.push(symbolObj.id)

        # Add type and target based on action
        if action?.type
          switch action.type
            when 'shift'
              stateArray.push(1)  # type: 1=shift
              stateArray.push(action.state)  # target: state number
            when 'reduce'
              stateArray.push(2)  # type: 2=reduce
              stateArray.push(action.rule)  # target: rule number
            when 'accept'
              stateArray.push(3)  # type: 3=accept
              stateArray.push(0)  # target: not used for accept
            else
              continue
        else
          # GOTO action
          stateArray.push(0)  # type: 0=goto
          stateArray.push(action)  # target: state number

      # Only add state if it has symbols (length > 1)
      if stateArray.length > 1
        compactTable.push(stateArray)

    compactTable

  # Prepare optimized table for runtime
  prepareOptimizedTableRuntime: ->
    if @optimizedTable
      switch @optimizedTable.format
        when 'COO' then @prepareCOOTableRuntime()
        when 'CSR' then @prepareCSRTableRuntime()
        when 'Dictionary' then @prepareDictionaryTableRuntime()
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

  prepareCSRTableRuntime: ->
    { entries, rowStarts } = @optimizedTable.data
    """
    const csrValues = #{JSON.stringify(entries)};
    const csrRowStarts = #{JSON.stringify(rowStarts)};
    function getTableEntry(state, symbol) {
      const start = csrRowStarts[state];
      const end = csrRowStarts[state + 1];
      for (let i = start; i < end; i++) {
        if (csrValues[i][0] === symbol) {
          return csrValues[i][1];
        }
      }
      return undefined;
    }
    """

  prepareDictionaryTableRuntime: ->
    { table, dictionary } = @optimizedTable.data
    """
    const dictTable = #{JSON.stringify(table)};
    const dictActions = #{JSON.stringify(dictionary)};
    function getTableEntry(state, symbol) {
      const row = dictTable[state];
      if (!row) return undefined;
      const actionId = row[symbol];
      if (actionId === null || actionId === undefined) return undefined;
      return dictActions[actionId];
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

  # JSON stringify with numeric keys
  jsonStringifyWithNumericKeys: (obj) ->
    # First stringify normally, then replace quoted numeric keys
    # Use word boundaries to ensure we only match complete numbers
    JSON.stringify(obj).replace(/"(\d+)":/g, '$1:')

  # ============================================================================
  # 11. FINAL STEPS
  # ============================================================================

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
      console.log "=================================================="
      for conflict in unresolvedSR
        console.log conflict.explanation
        console.log ""

    # Report resolved conflicts
    if resolvedSR.length > 0
      console.log "✅ RESOLVED SHIFT/REDUCE CONFLICTS:"
      console.log "========================================"
      for conflict in resolvedSR
        console.log conflict.explanation
        console.log ""

    # Report reduce/reduce conflicts
    if rrConflicts.length > 0
      console.log "⚠️  REDUCE/REDUCE CONFLICTS:"
      console.log "=============================="
      for conflict in rrConflicts
        console.log conflict.explanation
        console.log ""

    # Summary and recommendations
    @reportConflictSummary(unresolvedSR.length, resolvedSR.length, rrConflicts.length)

  reportConflictSummary: (unresolved, resolved, reduceReduce) ->
    console.log "📊 CONFLICT SUMMARY:"
    console.log "===================="

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
    Terminals: #{@tokens.size}
    Symbols: #{@symbols.size}
    Rules processed: #{@rules.length}
    States created: #{@states.length}
    #{optimizationText}
    Cache entries: #{cacheSize}
    """

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
# 9. Default Actions: computeDefaultActions(), prepareUnifiedStates()
# 11. Final Steps: reportConflicts(), reportPerformanceStats()

# 🔄 STILL MISSING (Functions that need to be extracted from original file):
# 8. Optimization Phase: minimizeStates(), smartOptimizeTable()
# 10. Code Generation: generateCommonJS(), generateOptimizedCommonJS(), buildPerformAction(),
#     transformAction(), prepareRules(), generateUnifiedGrammarCode(), generateUnifiedRuntimeFunctions()
# Plus various helper functions and utilities

# The reorganization is now approximately 80% complete with all core parsing logic
# and most utility functions implemented. The remaining functions are primarily
# optimization algorithms and code generation utilities.