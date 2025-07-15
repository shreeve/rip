#!/usr/bin/env coffee

# ==============================================================================
# rip: The multilanguage universal runtime powering the Rip ecosystem.
#
# Author: Steve Shreeve <steve.shreeve@gmail.com> and my AI friends.
#  Stats: July 14, 2025 (version 0.6.0) MIT License
# ==============================================================================

SILENT  = 0 # Errors only
NORMAL  = 1 # Basic summary (default)
VERBOSE = 2 # Detailed analysis
DEBUG   = 3 # Everything + internals

class Symbol # Terminal or Nonterminal
  constructor: (name, isTerminal = false, id) ->
    @id         = id         # unique symbol id
    @name       = name       # symbol name (eg - Expression)
    @isTerminal = isTerminal # true if terminal, false if nonterminal
    @nullable   = false      # LALR(1) nullable computation
    @first      = new Set    # LALR(1) FIRST sets
    @follow     = new Set    # LALR(1) FOLLOW sets

class Rule # A → B C D
  constructor: (lhs, rhs, id, action = null, precedence = null) ->
    @id         = id          # unique rule id
    @lhs        = lhs         # left-hand side symbol
    @rhs        = rhs         # right-hand side symbol sequence
    @action     = action      # semantic action
    @precedence = precedence  # precedence for conflict resolution

class Item # Rule with a dot position and lookahead: [A → α • β, a]
  @makeName: (ruleId, dot) -> "#{ruleId}-#{dot}" # Unique name for item

  constructor: (rule, dot = 0, lookahead = new Set) ->
    if dot < 0 or dot > rule.rhs.length
      throw new Error("Rule [#{rule.lhs} → #{rule.rhs.join ' '}] (dot position #{dot} out of bounds)")
    @rule      = rule      # associated production rule
    @dot       = dot       # dot position (• marker)
    @lookahead = lookahead # LALR(1) lookahead set

  # Unique name for this item (something like "3-2")
  name: -> @_name ?= Item.makeName(@rule.id, @dot)

  # Create LR(0) version of this item (without lookahead)
  core: -> new Item(@rule, @dot, new Set)

  # Is this item complete? (dot at end of rule)
  isComplete: -> @dot >= @rule.rhs.length

  # Creates a new Item with the dot moved forward
  advance: ->
    @isComplete() and throw new Error("Cannot advance complete item")
    new Item(@rule, @dot + 1, new Set(@lookahead)) # new item with dot advanced

  # Returns the symbol that comes after the dot
  nextSymbol: ->
    @isComplete() and throw new Error("Cannot get next symbol for complete item")
    @rule.rhs[@dot] # next symbol after dot

  toString: ->
    rhs = @rule.rhs.slice()
    rhs.splice(@dot, 0, '•')
    "#{@rule.lhs} → #{rhs.join(' ')} [#{[...@lookahead].join(',')}]"

class State # Set of LR(0) items
  constructor: ->
    @id          = null      # unique state id
    @items       = []        # collection of items
    @coreMap     = new Map() # core-based deduplication (core key -> item)
    @transitions = new Map() # state transitions (symbol -> state)
    @inadequate  = false     # has shift/reduce conflicts?

  # Unique name for state (something like "3-2|3-3")
  name: -> @_name ?= (item.name() for item in @items).sort().join('|')

  # Get item by rule ID and dot position
  core: (ruleId, dot) -> @coreMap.get(Item.makeName(ruleId, dot))

  # Add item to state, merging lookaheads if core already exists
  # Returns true if item was added or lookaheads were merged
  addItem: (item) ->
    name = item.name()

    # If item already exists, merge lookaheads
    if core = @coreMap.get(name)

      # Merge lookaheads with existing item
      orig = core.lookahead.size
      core.lookahead.add(la) for la from item.lookahead

      # Return true if lookaheads were actually added
      core.lookahead.size > orig

    else

      # Otherwise, add new item
      @_name = null # invalidate cached name
      @coreMap.set(name, item)
      @items.push(item)
      true

# ==============================================================================
# UNIVERSAL LANGUAGE DEFINITION
# ==============================================================================

class Language

  # ============================================================================
  # HELPER FUNCTIONS
  # ============================================================================

  # Check if a symbol name is valid
  # Allows alphanumeric identifiers and operator symbols
  isValidSymbolName: (name) ->
    return false unless name? and typeof name is 'string' and name.length > 0
    # Allow alphanumeric, underscore, hyphen, and some special characters for terminals
    /^[a-zA-Z_][a-zA-Z0-9_?-]*$|^[+\-*/(){}[\];,.'":=<>!&|?~^%$#@\\]+$/.test(name)

  # Determine how much to debug or log
  # Converts various debug level inputs to numeric levels
  parseDebug: (level) ->
    switch level
      when 0, 'silent'  then SILENT
      when 1, 'normal'  then NORMAL
      when 2, 'verbose' then VERBOSE
      when 3, 'debug'   then DEBUG
      when true         then VERBOSE # -V --verbose flag
      when false        then NORMAL  # default when verbose=false
      else                   NORMAL  # fallback to normal

  # Performance timing utility
  # Usage:
  #   @timing "📋 Phase description", => @fn()  # Function wrapper
  #   @timing "📋 Phase description"            # Start timer
  #   @timing "📋 Phase description"            # End timer and show duration
  timing: (description, fn) ->
    @timers ?= new Map()

    if fn?
      # Function wrapper mode - only time if verbose or higher
      if @debug >= VERBOSE
        startTime = Date.now()
        result    = fn.call(this)
        endTime   = Date.now()
        duration  = endTime - startTime
        console.log("#{description}: #{duration}ms")
        result
      else
        fn.call(this)
    else
      # Manual timing mode - only time if verbose or higher
      if @debug >= VERBOSE
        if @timers.has(description)
          # End timer
          startTime = @timers.get(description)
          endTime   = Date.now()
          duration  = endTime - startTime
          console.log("#{description}: #{duration}ms")
          @timers.delete(description)
        else
          # Start timer
          @timers.set(description, Date.now())

      # Return nothing for manual timing mode
      null

  constructor: (@language = {}, opts = {}) ->
    @timing "🔤 Language constructor"

    # Set debugging level and perform language validation
    @debug = @parseDebug opts.debug ? NORMAL
    # @validateLanguage()

    # Input (foundational data)
    @info             = {}      # Language metadata
    @rules            = []      # Language rules
    @operators        = []      # Precedence/associativity
    @start            = null    # Start symbol

    # Output (derived during analysis)
    @analyzed         = false   # Analysis done?
    @tokens           = new Set # Terminal symbols
    @symbols          = new Map # Symbol table
    @symbolRules      = new Map # Lookup rules by symbol
    @precedence       = {}      # Symbol precedence table
    @states           = []      # State machine
    @stateMap         = new Map # State lookup
    @propagateLinks   = new Map # LALR(1) lookahead propagation
    @inadequateStates = []      # Conflict states
    @conflicts        = []      # Conflict details
    @table            = null    # Parse table
    @defaultActions   = {}      # Default actions for states
    @cache            = new Map # Performance cache

    # ID counters
    @ruleId   = 1 # Starts at 1 (0 is reserved for the augmented start rule)
    @symbolId = 2 # Starts at 2 (0 and 1 are reserved for $accept and $end)

    # Statistics
    @stats =

      # Grammar rules
      lhsCount:              0  # LHS count (97)
      sourceRules:           0  # Direct from grammar file (405)
      augmentedRules:        0  # Augmented start rule (1)
      # expandedRules:         0    # Expanded/flattened (0)
      # errorRecoveryRules:    0    # Error recovery rules (4)

      # 206 symbols

      # Operator statistics
      precedenceLevels:      0    # Number of precedence levels (23)
      totalOperators:        0    # Total number of operators (100)
      leftAssocGroups:       0    # Number of left-associative groups (10)
      rightAssocGroups:      0    # Number of right-associative groups (10)
      nonAssocGroups:        0    # Number of non-associative groups (3)

      # LALR(1) computation
      # closureCalls:          0    # Closure calls
      # cacheHits:             0    # Cache hits
      # stateCreations:        0    # State creations
      # lookaheadComputations: 0    # Lookahead computations

      # Optimizations
      # optimizationTime:      0    # Optimization time

    # # Optimization
    # @optimizationConfig =
    #   enabled:          opts.optimize         ? false
    #   auto:             opts.autoOptimize     ? true
    #   minStatesForAuto: opts.minStatesForAuto ? 20
    #   algorithms:       opts.algorithms       ? ['auto']
    #   skipIfSmall:      opts.skipIfSmall      ? true
    #   minimizeStates:   opts.minimizeStates   ? true
    #   safeMinimization: opts.safeMinimization ? true

    @timing "🔤 Language constructor"

  # ============================================================================
  # LANGUAGE ANALYSIS AND CONSTRUCTION
  # ============================================================================

  # Transform input → output using standard LALR(1) algorithm
  # Performs complete grammar analysis and parser generation
  analyze: ->
    unless @analyzed
      @timing "🔍 Analysis"

      # Phase 0: Language Preparation
      @loadLanguage()            # @language → @rules, @start, @operators
      @createSpecialSymbols()    # Create $accept, $end, error symbols
      @augmentStartRule()        # Add $accept → start $end

      # Phase 1: Symbol and Rule Analysis
      @buildSymbols()            # @rules → @symbols, @tokens
      @buildPrecedence()         # @operators → @precedence
      @buildSymbolRules()        # @rules → @symbolRules

      # Phase 2: LALR(1) Set Computations
      @computeNullable()         # @symbols → @nullable
      @computeFirst()            # @symbols → @first
      @computeFollow()           # @symbols → @follow

      # Phase 3: Grammar Cleanup
      @cleanupGrammar()          # Eliminate unproductive/unreachable symbols

      # Phase 4: Error Recovery
      @addErrorRecoveryRules()   # Add error recovery rules

      # Phase 5: LALR(1) State Machine Construction
      @buildStates()             # @rules → @states, @stateMap
      @computeLookaheads()       # @states → @propagateLinks

      # Phase 6: Parse Table and Optimization
      @buildTable()              # @states → @table
      @removeUnreachableStates() # Remove dead states
      @resolveConflicts()        # @states → @conflicts, @inadequateStates
      @minimizeStates() if @optimizationConfig.minimizeStates # State minimization
      @optimizeTable()           # Smart table optimization
      @buildDefaultActions()     # @states → @defaultActions

      @analyzed = true
      @timing "🔍 Analysis"

  # ============================================================================
  # PHASE 0: LANGUAGE PREPARATION
  # ============================================================================

  # Load language definition from input
  # Extracts rules, operators, and metadata
  loadLanguage: ->
    @info      = {...(@language.info      or {})}
    @operators = [...(@language.operators or [])]
    start      =      @language.start

    # Determine where to find the rules
    obj = @language.grammar ? @language.rules
    obj or throw new Error("No rules found in language definition")

    # Load rules from grammar or rules object
    for lhs, rules of obj
        @stats.lhsCount++
        for rule, i in rules
          try
            [pattern, action, options] = rule
            rhs = @parseRulePattern(pattern, lhs)
            @validateActionCode(action, rhs.length, lhs, i) if action?
            @addRule(lhs, rhs, action, options?.prec)
            @stats.sourceRules++
          catch error
            throw new Error("Error processing rule #{i + 1} for '#{lhs}': #{error.message}")

    # Reset tokens, so grammar file doesn't have to do it
    @resetTokens obj

    # Detect start symbol if not provided
    @start = start ? Object.keys(obj)[0]
    @start or throw new Error("No start symbol found")

  # Parse and validate rule pattern (such as 'Body TERMINATOR Line')
  # Splits pattern into individual symbols and validates them
  parseRulePattern: (pattern, lhs) ->
    throw new Error("Pattern must be a string") unless typeof pattern is 'string'

    # Make sure each pattern is a valid symbol name
    symbols = pattern.trim().split(/\s+/).filter((s) -> s.length > 0)
    for symbol in symbols
      unless @isValidSymbolName symbol
        throw new Error("Invalid symbol '#{symbol}'")

    symbols

  # Validate action code for common issues
  # Checks parameter references against RHS length
  validateActionCode: (action, size, lhs, ruleIndex) ->
    return unless action?

    # Check for parameter references beyond RHS length
    string = if typeof action is 'function' then action.toString() else action
    params = string.match(/\$(\d+)/g) || []
    for match in params
      param = parseInt(match.substring(1), 10)
      if param > size and not (size == 0 and param == 1) and not (lhs == '$accept' and param == 0)
        throw new Error("Invalid parameter index #{match} in action for '#{lhs}' rule #{ruleIndex + 1}")

  # Create a new rule with unique ID
  addRule: (lhs, rhs, action = null, precedence = null) ->
    rule = new Rule(lhs, rhs, @ruleId++, action, precedence)
    @rules.push(rule)
    rule

  # Scan grammar to detect and set @tokens (terminals)
  resetTokens: (grammar) ->
    lhsSymbols = new Set
    rhsSymbols = new Set

    @tokens.clear() if @tokens.size > 0

    # Iterate over all LHS and RHS symbols
    for lhs, rules of grammar
      lhsSymbols.add lhs
      for rule in rules
        [pattern] = rule
        if pattern and typeof pattern is 'string'
          symbols = pattern.trim().split(/\s+/).filter((s) -> s.length > 0)
          for symbol in symbols
            rhsSymbols.add(symbol)

    # Terminals are symbols appearing on RHS but not LHS
    for symbol from rhsSymbols
      unless lhsSymbols.has(symbol)
        @tokens.add(symbol)

    @tokens

  # Create fundamental LALR(1) symbols
  # Adds $accept, $end, and error symbols for parser operation
  createSpecialSymbols: ->
    @tokens.add '$end'
    @tokens.add 'error'

    @getSymbol '$accept', false, 0
    @getSymbol '$end'   , true , 1
    @getSymbol 'error'  , true , 2

  # Get or create a symbol with unique ID
  getSymbol: (name, isTerminal, id = null) ->
    return sym if sym = @symbols.get(name)
    isTerminal = if isTerminal? then !!isTerminal else @tokens.has(name)
    symbol = new Symbol(name, isTerminal, id ? @symbolId++)
    @symbols.set name, symbol
    symbol

  # Set first rule as augmented start rule: $accept → start $end
  augmentStartRule: ->

    # Validate start symbol
    throw new Error("No start symbol defined") unless @start
    throw new Error("Invalid start symbol name '#{@start}'") unless @isValidSymbolName(@start)

    # Ensure start symbol has production rules
    hasStartRule = @rules.some (rule) => rule.lhs == @start
    throw new Error("Start symbol '#{@start}' has no production rules") unless hasStartRule

    # Add augmented start rule: $accept → start $end
    @rules[0] ?= new Rule('$accept', [@start, '$end'], 0)
    @stats.augmentedRules = 1

  # ============================================================================
  # PHASE 1: SYMBOL AND RULE ANALYSIS
  # ============================================================================

  # Create Symbol objects from rules using existing terminal classification
  # Uses @tokens set populated by resetTokens() in Phase 0
  buildSymbols: ->
    for rule in @rules
      @getSymbol(rule.lhs, false) # LHS is always nonterminal
      for symbol in rule.rhs
        @getSymbol(symbol, @tokens.has(symbol)) # Use @tokens to classify

  # Process operator precedence and associativity
  # Assigns precedence levels to operator symbols
  buildPrecedence: ->
    level = 1
    @stats.precedenceLevels = @operators.length
    for group in @operators
      [assoc, ...symbols] = group
      @stats.totalOperators += symbols.length
      switch assoc
        when 'left'     then @stats. leftAssocGroups++
        when 'right'    then @stats.rightAssocGroups++
        when 'nonassoc' then @stats.  nonAssocGroups++
      for symbol in symbols
        @precedence[symbol] = {level, assoc}
      level++

  # Create rule lookup by symbol for efficient access
  # Groups rules by left-hand side symbol
  buildSymbolRules: ->
    @symbolRules.clear()

    # Group rules by LHS in a single pass
    for rule in @rules
      lhs = rule.lhs
      @symbolRules.get(lhs)?.push(rule) or @symbolRules.set(lhs, [rule])

    # Sort rules by ID for consistent iteration (needed after reassignIds)
    for [lhs, rules] from @symbolRules
      rules.sort (a, b) -> a.id - b.id

  # ============================================================================
  # PHASE 2: LALR(1) SET COMPUTATIONS
  # ============================================================================

  # Compute nullable symbols using standard algorithm
  # A symbol is nullable if it can derive the empty string ε
  computeNullable: ->
    @timing "🔍 Compute Nullable"

    # Pre-compute rules by LHS for O(1) lookup
    rulesByLhs = new Map()
    for rule in @rules
      rulesByLhs.get(rule.lhs)?.push(rule) or rulesByLhs.set(rule.lhs, [rule])

    # Iterate until no changes (fixed-point algorithm)
    changed = true
    while changed
      changed = false

      # Check each nonterminal that isn't already nullable
      for [lhs, symbol] from @symbols when not (symbol.isTerminal or symbol.nullable)

        # Check if ANY rule makes this symbol nullable
        rules = rulesByLhs.get(lhs) or []
        for rule in rules
          # Empty rule (A → ε) makes symbol nullable
          if rule.rhs.length == 0
            symbol.nullable = true
            changed = true
            break

          # Rule is nullable if all RHS symbols are nullable
          if rule.rhs.every (sym) => @getSymbol(sym).nullable
            symbol.nullable = true
            changed = true
            break

    @timing "🔍 Compute Nullable"

  # Compute FIRST sets for all symbols using standard algorithm
  # FIRST(X) = {a | X →* aα} ∪ {ε | X →* ε}
  computeFirst: ->
    @timing "🔍 Compute FIRST"

    # Initialize: FIRST(terminal) = {terminal}
    for [name, symbol] from @symbols
      if symbol.isTerminal
        symbol.first.add(name)

    # Iterate until no changes (fixed-point algorithm)
    changed = true
    while changed
      changed = false

      for rule in @rules
        lhsSymbol = @getSymbol(rule.lhs)
        oldSize = lhsSymbol.first.size

        # Compute FIRST of the RHS sequence incrementally
        # For rule A → B C D, we need FIRST(B C D)
        allNullable = true
        for symbol in rule.rhs
          rhsSymbol = @getSymbol(symbol)

          # Add FIRST(current symbol) to FIRST(LHS)
          lhsSymbol.first.add(item) for item from rhsSymbol.first

          # If current symbol is not nullable, we're done with this rule
          unless rhsSymbol.nullable
            allNullable = false
            break

        # If entire RHS is nullable, add ε to FIRST(LHS)
        if rule.rhs.length == 0 or allNullable
          lhsSymbol.first.add '' # Add ε (empty string)

        # Check if we added anything new to trigger another iteration
        changed = true if lhsSymbol.first.size > oldSize

    @timing "🔍 Compute FIRST"

  # Compute FOLLOW sets for all symbols using standard algorithm
  # FOLLOW(X) = {a | S →* αXaβ} ∪ {$ | S →* αX}
  computeFollow: ->
    @timing "🔍 Compute FOLLOW"

    # Initialize: FOLLOW(S) = {$} where S is the start symbol
    @getSymbol(@start).follow.add('$end')

    # Iterate until no changes (fixed-point algorithm)
    changed = true
    while changed
      changed = false

      for rule in @rules
        lhsSymbol = @getSymbol(rule.lhs)

        # For each symbol in the RHS, compute what can follow it
        for symbol, i in rule.rhs
          currentSymbol = @getSymbol(symbol)

          # Skip terminals - they don't have FOLLOW sets
          continue if currentSymbol.isTerminal

          # Get the suffix β after the current symbol
          beta = rule.rhs.slice(i + 1)

          if beta.length > 0
            # Case 1: A → αBβ where β is non-empty
            # Add FIRST(β) to FOLLOW(B), excluding empty string
            firstBeta = @firstOfString(beta)
            oldSize = currentSymbol.follow.size
            currentSymbol.follow.add(item) for item from firstBeta when item != ''
            changed = true if currentSymbol.follow.size > oldSize

            # If β is nullable, also add FOLLOW(A) to FOLLOW(B)
            if beta.every (sym) => @getSymbol(sym).nullable
              oldSize = currentSymbol.follow.size
              currentSymbol.follow.add(item) for item from lhsSymbol.follow
              changed = true if currentSymbol.follow.size > oldSize
          else
            # Case 2: A → αB (β is empty)
            # Add FOLLOW(A) to FOLLOW(B)
            oldSize = currentSymbol.follow.size
            currentSymbol.follow.add(item) for item from lhsSymbol.follow
            changed = true if currentSymbol.follow.size > oldSize

    @timing "🔍 Compute FOLLOW"

  # Compute FIRST set of a string of symbols
  # FIRST(α) = {a | α →* aβ} ∪ {ε | α →* ε}
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
  # PHASE 3: GRAMMAR CLEANUP
  # ============================================================================

  # Grammar cleanup for production use
  # For well-formed grammars, cleanup is usually unnecessary
  # See docs/potentially-useful-code.md for comprehensive cleanup implementation
  cleanupGrammar: ->
    # Skip cleanup for well-formed grammars
    # Most production language packs don't need this step
    # Use the comprehensive version in docs/potentially-useful-code.md for debugging malformed grammars
    return

  # ============================================================================
  # PHASE 5: LALR(1) STATE MACHINE CONSTRUCTION
  # ============================================================================

  # Build LR(0) state machine using hybrid approach
  # Combines rip-tiny's clarity with rip-full's optimizations
  buildStates: ->
    @timing "🏗️ Build States"

    # Initialize performance tracking
    @cache = new Map() if not @cache
    @stats.stateCreations = 0
    @stats.closureCalls = 0
    @stats.cacheHits = 0

    # Create initial state with augmented start rule (rule 0)
    startState = new State()
    startState.addItem(new Item(@rules[0], 0, new Set(['$end'])))
    @closure(startState)
    @addState(startState)

    # Build all states using breadth-first search
    workList = [startState]
    while workList.length > 0
      state = workList.shift()

      # Group items by next symbol for efficient transition computation
      transitions = new Map()
      for item in state.items when not item.isComplete()
        nextSym = item.nextSymbol()
        transitions.get(nextSym)?.push(item) or transitions.set(nextSym, [item])

      # Create new states for each transition
      for [symbol, items] from transitions
        newState = new State()
        newState.addItem(item.advance()) for item in items
        @closure(newState)

        # Add or merge state (core-based deduplication)
        existingState = @getState(newState)
        state.transitions.set(symbol, existingState)
        workList.push(newState) if existingState is newState

    if @debug >= VERBOSE
      console.log "🏗️ States: #{@states.length}, Closures: #{@stats.closureCalls}, Cache hits: #{@stats.cacheHits}"

    @timing "🏗️ Build States"

  # Compute closure of a state using optimized LR(0) algorithm
  # Combines rip-tiny's clarity with rip-full's performance optimizations
  closure: (state) ->
    @stats.closureCalls++

    # Check closure cache first for performance (from rip-full)
    coreKey = state.name()
    if @cache.has(coreKey)
      @stats.cacheHits++
      return

    # Compute closure using work queue algorithm (from rip-tiny)
    workList = [...state.items]
    while workList.length > 0
      item = workList.shift()

      # Skip if item is complete (dot at end)
      continue if item.isComplete()

      # Get next symbol after dot
      nextSym = item.nextSymbol()
      nextSymbol = @getSymbol(nextSym)

      # Skip if next symbol is terminal (no closure needed)
      continue if nextSymbol.isTerminal

      # Find all rules for this nonterminal (optimized lookup)
      rules = @symbolRules.get(nextSym) or []
      for rule in rules
        # Create new item: [B → • γ] where B is the nonterminal
        newItem = new Item(rule, 0, new Set())

        # Add to state if not already present
        if state.addItem(newItem)
          workList.push(newItem)

    # Cache the closure result for performance
    @cache.set(coreKey, true)

  # Get existing state or add new one using core-based deduplication
  # Uses rip-tiny's clean approach with proper lookahead merging
  getState: (state) ->
    coreKey = state.name()

    if @stateMap.has(coreKey)
      existingState = @stateMap.get(coreKey)
      # Merge lookaheads from new state into existing state
      for item in state.items
        existingItem = existingState.core(item.rule.id, item.dot)
        if existingItem
          existingItem.lookahead.add(la) for la from item.lookahead
      existingState
    else
      @addState(state)
      state

  # Add state to state list with unique ID
  addState: (state) ->
    state.id = @states.length
    @states.push(state)
    @stateMap.set(state.name(), state)
    @stats.stateCreations++
    state

  # Compute LALR(1) lookahead sets using hybrid approach
  # Combines rip-tiny's simplicity with rip-full's correctness
  computeLookaheads: ->
    @timing "🔍 Compute Lookaheads"

    # Initialize propagation links
    @propagateLinks = new Map()

    # Phase 1: Compute spontaneous lookaheads and propagation links
    # Uses rip-full's correct algorithm
    for state in @states
      for item in state.items
        continue if item.isComplete()

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
          continue if closureItem.isComplete()
          if closureItem.nextSymbol() == nextSym
            advancedItem = closureItem.advance()
            gotoState.addItem(advancedItem)

        # Compute closure of the goto state
        @closureWithLookahead(gotoState)

        # Analyze lookaheads to determine propagation vs spontaneous
        for gotoItem in gotoState.items
          # Find corresponding item in the actual next state
          targetItem = nextState.core(gotoItem.rule.id, gotoItem.dot)
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

    # Phase 2: Propagate lookaheads until convergence
    @propagateLookaheads()

    @timing "🔍 Compute Lookaheads"

  # Specialized closure for lookahead computation
  # Uses rip-full's optimized approach with proper FIRST computation
  closureWithLookahead: (state) ->
    @stats.closureCalls++

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
      rulesForSymbol = @symbolRules.get(nextSym) || []
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

  # Propagate lookaheads until convergence using fixed-point algorithm
  # Uses rip-tiny's clean approach with rip-full's safety checks
  propagateLookaheads: ->
    changed = true
    maxIterations = 1000
    iterationCount = 0

    while changed and iterationCount++ < maxIterations
      changed = false

      for [fromKey, toKeys] from @propagateLinks
        # Parse and validate the from key
        fromParts = fromKey.split('-')
        continue unless fromParts.length >= 3
        [fromStateId, fromRuleId, fromPosition] = fromParts.map (x) -> parseInt(x)
        continue unless fromStateId >= 0 and fromStateId < @states.length

        fromState = @states[fromStateId]
        continue unless fromState # Safety check for invalid state ID

        fromItem = fromState.core(fromRuleId, fromPosition)
        continue unless fromItem

        for toKey from toKeys
          # Parse and validate the to key
          toParts = toKey.split('-')
          continue unless toParts.length >= 3
          [toStateId, toRuleId, toPosition] = toParts.map (x) -> parseInt(x)
          continue unless toStateId >= 0 and toStateId < @states.length

          toState = @states[toStateId]
          continue unless toState # Safety check for invalid state ID

          toItem = toState.core(toRuleId, toPosition)
          continue unless toItem

          # Propagate lookaheads
          oldSize = toItem.lookahead.size
          for la from fromItem.lookahead
            toItem.lookahead.add(la)

          if toItem.lookahead.size > oldSize
            changed = true

    if iterationCount >= maxIterations
      console.warn("⚠️  Lookahead propagation exceeded maximum iterations (#{maxIterations})")
      console.warn("   Consider checking for left recursion or other grammar issues")

  # ============================================================================
  # PHASE 4: ERROR RECOVERY
  # ============================================================================

  # Add error recovery rules for robust parsing
  # Hybrid approach: combines simplicity of tiny with intelligence of full
  addErrorRecoveryRules: ->
    @timing "🚑 Add Error Recovery Rules"

    # Always add the basic fallback rule (from rip-tiny)
    @addRule('$accept', ['error'])
    @stats.errorRecoveryRules = 1

    # Add intelligent error recovery rules (from rip-full)
    # Find promising candidates for error recovery
    candidates = @findErrorRecoveryCandidates()

    # Add error rules for top candidates (limit to avoid conflicts)
    addedCount = 0
    for candidate in candidates.slice(0, 2) # Conservative limit
      @addRule(candidate, ['error'])
      addedCount++

      if @debug >= DEBUG
        console.log "  Added error recovery rule: #{candidate} → error"

    @stats.errorRecoveryRules += addedCount

    if @debug >= NORMAL and @stats.errorRecoveryRules > 1
      console.log "🚑 Added #{@stats.errorRecoveryRules} error recovery rules"

    @timing "🚑 Add Error Recovery Rules"

  # Find good candidates for error recovery rules
  # Uses heuristics from rip-full with safety measures from rip-pain
  findErrorRecoveryCandidates: ->
    candidates = []

    for [name, symbol] from @symbols
      # Skip terminals and essential symbols
      continue if symbol.isTerminal
      continue if name in ['$accept', '$end', 'error', @start]

      # Count rules for this symbol
      ruleCount = (@symbolRules.get(name) or []).length

      # Heuristic: Symbols with multiple rules (likely important constructs)
      if ruleCount >= 2
        candidates.push(name)

    # Sort by rule count (descending) to prioritize important symbols
    candidates.sort (a, b) =>
      rulesA = (@symbolRules.get(a) or []).length
      rulesB = (@symbolRules.get(b) or []).length
      rulesB - rulesA

    candidates

# ==============================================================================
# COMMAND LINE INTERFACE
# ==============================================================================

# Only run CLI if this script is executed directly
unless module.parent

  # Parse command line arguments
  args = process.argv.slice(2)
  options = {}
  inputFile = null

  # Help text
  helpText = """
  rip: The multilanguage universal runtime powering the Rip ecosystem.

  Usage: coffee rip.coffee [options] <language-file>

  Options:
    -h, --help              Show this help message
    -v, --version           Show version information
    -s, --silent            Silent mode (errors only)
    -V, --verbose           Verbose mode (detailed output)
    -d, --debug             Debug mode (everything + internals)
    --debug-level LEVEL     Set debug level: 0=silent, 1=normal, 2=verbose, 3=debug

  Examples:
    coffee rip.coffee grammar.json
    coffee rip.coffee --verbose grammar.json
    coffee rip.coffee --debug-level 2 grammar.json
  """

  # Parse command line arguments
  i = 0
  while i < args.length
    arg = args[i]

    switch arg
      when '-h', '--help'
        console.log helpText
        process.exit 0
      when '-v', '--version'
        console.log "rip version 0.6.0"
        process.exit 0
      when '-s', '--silent'
        options.debug = SILENT
      when '-V', '--verbose'
        options.debug = VERBOSE
      when '-d', '--debug'
        options.debug = DEBUG
      when '--debug-level'
        if i + 1 >= args.length
          console.error "Error: --debug-level requires a value"
          process.exit 1
        level = parseInt(args[i + 1])
        if isNaN(level) or level < 0 or level > 3
          console.error "Error: debug level must be 0, 1, 2, or 3"
          process.exit 1
        options.debug = level
        i++ # Skip the next argument since we consumed it
      else
        # Assume this is the input file
        if inputFile?
          console.error "Error: Multiple input files specified"
          process.exit 1
        inputFile = arg
    i++

  # Validate input file
  unless inputFile?
    console.log helpText
    process.exit 1

  # Check if input file exists
  fs = require 'fs'
  unless fs.existsSync inputFile
    console.error "Error: Input file '#{inputFile}' not found"
    process.exit 1

  # Read and parse input file
  try
    language = require(inputFile)
  catch error
    console.error "Error: Failed to parse input file: #{error.message}"
    process.exit 1

  # Create language instance and analyze
  try
    lang = new Language language, options
    lang.analyze()

    # Show basic results
    console.log "✅ Analysis complete!"
    console.log "   Rules: #{lang.rules.length}"
    console.log "   Symbols: #{lang.symbols.size}"
    console.log "   States: #{lang.states.length}"
    console.log "   Conflicts: #{lang.conflicts.length}"

  catch error
    console.error "❌ Error: #{error.message}"
    process.exit 1
