#!/usr/bin/env coffee

# ==============================================================================
# rip: The multilanguage universal runtime powering the Rip ecosystem.
#
# Author: Steve Shreeve <steve.shreeve@gmail.com> and my AI friends.
#  Stats: July 13, 2025 (version 0.5.0) MIT License
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
    @first      = new Set()  # LALR(1) FIRST sets
    @follow     = new Set()  # LALR(1) FOLLOW sets

class Rule # A → B C D
  constructor: (lhs, rhs, id, action = null, precedence = null) ->
    @id         = id          # unique rule id
    @lhs        = lhs         # left-hand side symbol
    @rhs        = rhs         # right-hand side symbol sequence
    @action     = action      # semantic action
    @precedence = precedence  # precedence for conflict resolution

class Item # Rule with a dot position and lookahead: [A → α • β, a]
  @makeCoreKey: (ruleId, dot) -> "#{ruleId}-#{dot}" # Canonical key for core

  constructor: (rule, dot = 0, lookahead = new Set()) ->
    throw new Error("Item dot position") if dot < 0 or dot >= rule.rhs.length
    @rule      = rule      # associated production rule
    @dot       = dot       # dot position (• marker)
    @lookahead = lookahead # LALR(1) lookahead set

  isComplete: -> @dot >= @rule.rhs.length                       # reduction check (is dot at end?)
  nextSymbol: -> @rule.rhs[@dot]                                # next symbol after dot
  advance:    -> new Item(@rule, @dot + 1, new Set(@lookahead)) # new item with dot advanced
  core:       -> new Item(@rule, @dot    , new Set()          ) # LR(0) core (item without lookahead)
  coreKey:    -> @_coreKey ?= Item.makeCoreKey(@rule.id, @dot)  # core key, supports deduplication

  toString: ->
    rhs = @rule.rhs.slice()
    rhs.splice(@dot, 0, '•')
    "#{@rule.lhs} → #{rhs.join(' ')} [#{[...@lookahead].join(',')}]"

class State # Set of LR(0) items
  @idno = 0
  constructor: ->
    @id          = State.idno++ # unique state id
    @items       = []           # collection of items
    @coreMap     = new Map()    # core-based deduplication (core key -> item)
    @transitions = new Map()    # state transitions (symbol -> state)
    @inadequate  = false        # has shift/reduce conflicts?

  # Add item to state, merging lookaheads if core already exists
  addItem: (item) ->
    coreKey = item.coreKey()

    if @coreMap.has(coreKey)

      # Merge lookaheads with existing item
      existingItem = @coreMap.get(coreKey)
      oldSize = existingItem.lookahead.size
      existingItem.lookahead.add(la) for la from item.lookahead

      # Return true if lookaheads were actually added
      existingItem.lookahead.size > oldSize

    else

      # Add new item
      @coreMap.set(coreKey, item)
      @items.push(item)
      true

  # Get core item by rule and dot
  getCoreItem: (ruleId, dot) ->
    @coreMap.get(Item.makeCoreKey(ruleId, dot))

# ==============================================================================
# UNIVERSAL LANGUAGE DEFINITION
# ==============================================================================

class Language
  constructor: (@language = {}, opts = {}) ->
    @timing "🔤 Language constructor"

    # Set debugging level and perform language validation
    @debug = @parseDebug opts.debug ? NORMAL
    @validateLanguage()

    # Input (foundational data)
    @info             = {}        # Language metadata
    @rules            = []        # Language rules
    @operators        = []        # Precedence/associativity
    @start            = null      # Start symbol

    # Output (derived during analysis)
    @analyzed         = false     # Analysis done?
    @symbols          = new Map() # Symbol table
    @tokens           = new Set() # Terminal symbols
    @symbolRules      = new Map() # Lookup rules by symbol
    @precedence       = {}        # Symbol precedence table
    @states           = []        # State machine
    @stateMap         = new Map() # State lookup
    @propagateLinks   = new Map() # LALR(1) lookahead propagation
    @inadequateStates = []        # Conflict states
    @conflicts        = []        # Conflict details
    @table            = null      # Parse table
    @defaultActions   = {}        # Default actions for states
    @cache            = new Map() # Performance cache

    # Statistics
    @stats =

      # Input processing
      sourceRules:           0    # Direct from grammar file
      expandedRules:         0    # Expanded/flattened
      errorRecoveryRules:    0    # Error recovery rules
      augmentedRules:        0    # Augmented start rule

      # LALR(1) computation
      closureCalls:          0    # Closure calls
      cacheHits:             0    # Cache hits
      stateCreations:        0    # State creations
      lookaheadComputations: 0    # Lookahead computations

      # Optimizations
      optimizationTime:      0    # Optimization time

    # Optimization
    @optimizationConfig =
      enabled:          opts.optimize         ? false
      auto:             opts.autoOptimize     ? true
      minStatesForAuto: opts.minStatesForAuto ? 20
      algorithms:       opts.algorithms       ? ['auto']
      skipIfSmall:      opts.skipIfSmall      ? true

    @timing "🔤 Language constructor"

  # Comprehensive language input validation
  validateLanguage: ->
    @timing "🔍 Validate Language"

    errors = []

    # Validate basic structure
    unless @language?
      errors.push "Language object is required"
    else unless typeof @language is 'object'
      errors.push "Language must be an object, got #{typeof @language}"
    else if Object.keys(@language).length == 0
      errors.push "Language cannot be empty"

    # Validate rules
    rules = @language?.rules or []
    unless Array.isArray(rules)
      errors.push "Rules must be an array, got #{typeof rules}"
    else if rules.length == 0
      errors.push "Language must have at least one rule"
    else
      for rule, i in rules
        unless rule?
          errors.push "Rule #{i} is null or undefined"
        else unless typeof rule is 'object'
          errors.push "Rule #{i} must be an object, got #{typeof rule}"
        else
          # Validate LHS
          unless rule.lhs?
            errors.push "Rule #{i} missing left-hand side (lhs)"
          else unless typeof rule.lhs is 'string'
            errors.push "Rule #{i} lhs must be a string, got #{typeof rule.lhs}"
          else unless @isValidSymbolName rule.lhs
            errors.push "Rule #{i} has invalid lhs name '#{rule.lhs}'"

          # Validate RHS
          unless rule.rhs?
            errors.push "Rule #{i} missing right-hand side (rhs)"
          else unless Array.isArray(rule.rhs)
            errors.push "Rule #{i} rhs must be an array, got #{typeof rule.rhs}"
          else
            for symbol, j in rule.rhs
              unless typeof symbol is 'string'
                errors.push "Rule #{i} rhs[#{j}] must be a string, got #{typeof symbol}"
              else unless @isValidSymbolName symbol
                errors.push "Rule #{i} rhs[#{j}] has invalid symbol name '#{symbol}'"

    # Validate start symbol
    if @language?.start?
      unless typeof @language.start is 'string'
        errors.push "Start symbol must be a string, got #{typeof @language.start}"
      else unless @isValidSymbolName @language.start
        errors.push "Invalid start symbol name '#{@language.start}'"

    # Validate operators
    operators = @language?.operators or []
    unless Array.isArray(operators)
      errors.push "Operators must be an array, got #{typeof operators}"
    else
      for group, i in operators
        unless Array.isArray(group)
          errors.push "Operator group #{i} must be an array, got #{typeof group}"
        else if group.length < 2
          errors.push "Operator group #{i} must have at least associativity and one operator"
        else
          [assoc, ...symbols] = group
          unless assoc in ['left', 'right', 'nonassoc']
            errors.push "Invalid associativity '#{assoc}' in operator group #{i}"
          else
            for symbol in symbols
              unless @isValidSymbolName symbol
                errors.push "Invalid operator symbol '#{symbol}' in group #{i}"

    # Throw errors if any found
    if errors.length > 0
      throw new Error "Language validation failed:\n  #{errors.join('\n  ')}"

    @timing "🔍 Validate Language"

  # ============================================================================
  # LANGUAGE ANALYSIS AND CONSTRUCTION
  # ============================================================================

  # Transform input → output
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
      @minimizeStates()          # State minimization
      @optimizeTable()           # Smart table optimization
      @buildDefaultActions()     # @states → @defaultActions

      @analyzed = true
      @timing "🔍 Analysis"

  # ============================================================================
  # PHASE 0: LANGUAGE PREPARATION
  # ============================================================================

  loadLanguage: ->
    @info      = {...(@language.info      or {})}
    @rules     = [...(@language.rules     or [])]
    @operators = [...(@language.operators or [])]
    @start     =      @language.start     or 'Root'

    # Assign unique rule ids
    @rules.forEach(rule, i) -> rule.id = i++

  # Create fundamental LALR(1) symbols
  createSpecialSymbols: ->
    @getSymbol '$accept'
    @getSymbol '$end' , true
    @getSymbol 'error', true; @tokens.add('error') # 'error' is also a terminal

  # Add augmented start rule: $accept → start $end
  augmentStartRule: ->
    @addRule '$accept', [@start, '$end']
    @stats.augmentedRules = 1

  # Create a new rule
  addRule: (lhs, rhs, action = null, precedence = null) ->
    rule = new Rule(lhs, rhs, @rules.length, action, precedence)
    @rules.push(rule)
    rule

  # Get or create a symbol
  getSymbol: (name, isTerminal) ->
    return sym if sym = @symbols.get(name)
    isTerminal = if isTerminal? then !!isTerminal else @tokens.has(name)
    symbol = new Symbol(name, isTerminal, @symbols.size)
    @symbols.set name, symbol
    symbol

  # ============================================================================
  # PHASE 1: SYMBOL AND RULE ANALYSIS
  # ============================================================================

  # Extract symbols from rules and identify terminals
  buildSymbols: ->

    # Add all symbols from rules
    for rule in @rules
      @getSymbol(rule.lhs, false) # Nonterminal
      @getSymbol(symbol, true) for symbol in rule.rhs # Assume terminal initially

    # Mark as terminal if never appears on LHS
    lhsSymbols = new Set(rule.lhs for rule in @rules)
    for [name, symbol] from @symbols
      unless lhsSymbols.has(name)
        symbol.isTerminal = true
        @tokens.add(name)

  # Process operator precedence and associativity
  buildPrecedence: ->
    level = 1
    for group in @operators
      [assoc, ...symbols] = group
      for symbol in symbols
        @precedence[symbol] = {level, assoc}
      level++

  # Create rule lookup by symbol
  buildSymbolRules: ->
    obj = @symbolRules

    # Group rules by LHS in a single pass
    obj.clear()
    for rule in @rules
      lhs = rule.lhs
      if obj.has(lhs) then obj.get(lhs).push(rule) else obj.set(lhs, [rule])

    # Performance optimization: pre-sort rules by LHS for consistent iteration
    for [lhs, rules] from obj
      rules.sort((a, b) -> a.id - b.id)

  # ============================================================================
  # PHASE 2: LALR(1) SET COMPUTATIONS
  # ============================================================================

  # Compute nullable symbols
  computeNullable: ->
    @timing "🔍 Compute Nullable"

    changed = true
    while changed
      changed = false
      for rule in @rules
        lhsSymbol = @getSymbol(rule.lhs)
        continue if lhsSymbol.nullable

        # A nonterminal is nullable if it has an empty rule
        # or if all symbols in one of its rules are nullable
        allNullable = true
        for symbol in rule.rhs
          unless @getSymbol(symbol).nullable
            allNullable = false
            break

        if allNullable
          lhsSymbol.nullable = true
          changed = true

    @timing "🔍 Compute Nullable"

  # Compute FIRST sets for all symbols
  computeFirst: ->
    @timing "🔍 Compute FIRST"

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
        for symbol in rule.rhs
          rhsSymbol = @getSymbol(symbol)

          # Add FIRST(current symbol) to FIRST(LHS)
          lhsSymbol.first.add(item) for item from rhsSymbol.first

          # If current symbol is not nullable, we're done with this rule
          break unless rhsSymbol.nullable

        # Check if we added anything new to trigger another iteration
        changed = true if lhsSymbol.first.size > oldSize

    @timing "🔍 Compute FIRST"

  # Compute FOLLOW sets for all symbols
  computeFollow: ->
    @timing "🔍 Compute FOLLOW"

    # Ensure the start symbol is followed by $end
    @getSymbol(@start).follow.add('$end')

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
            # Add FIRST(β) to FOLLOW(B)
            firstBeta = @firstOfString(beta)
            oldSize = currentSymbol.follow.size
            currentSymbol.follow.add(item) for item from firstBeta
            changed = true if currentSymbol.follow.size > oldSize

            # If β is nullable, also add FOLLOW(A) to FOLLOW(B)
            if beta.every((sym) => @getSymbol(sym).nullable)
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

  # Eliminate unproductive and unreachable symbols
  cleanupGrammar: ->
    @timing "🧹 Cleanup Grammar"

    # Step 1: Remove unproductive symbols

    # A symbol is productive if it can derive a terminal string
    productive = new Set()
    changed = true

    while changed
      changed = false

      for [name, symbol] from @symbols
        # Skip if already marked as productive
        continue if productive.has(name)

        # Terminals are always productive
        if symbol.isTerminal
          productive.add(name)
          changed = true
          continue

        # Check if this nonterminal has a productive rule
        rules = @symbolRules.get(name) or []
        for rule in rules
          # Empty rule (A → ε) is productive
          if rule.rhs.length == 0
            productive.add(name)
            changed = true
            break

          # Rule is productive if all RHS symbols are productive
          if rule.rhs.every (sym) -> productive.has(sym)
            productive.add(name)
            changed = true
            break

    # Remove unproductive symbols from symbols map
    for [name, symbol] from @symbols
      unless productive.has(name)
        @symbols.delete(name)

    # Remove rules involving unproductive symbols
    @rules = @rules.filter (rule) ->
      productive.has(rule.lhs) and rule.rhs.every (sym) -> productive.has(sym)

    # Step 2: Remove unreachable symbols

    # A symbol is reachable if it can be reached from the start symbol
    reachable = new Set()
    reachable.add @start    # Start symbol is always reachable
    reachable.add '$accept' # Special symbols are reachable
    reachable.add '$end'
    reachable.add 'error'

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

    # Remove unreachable symbols from symbols map
    for [name, symbol] from @symbols
      unless reachable.has(name)
        @symbols.delete(name)

    # Remove rules involving unreachable symbols
    @rules = @rules.filter (rule) ->
      reachable.has(rule.lhs) and rule.rhs.every (sym) -> reachable.has(sym)

    # Step 3: Reassign IDs to maintain consistency

    @reassignIds()

    @timing "🧹 Cleanup Grammar"

  # Reassign IDs to maintain consistency after grammar cleanup
  reassignIds: ->
    @rules  .forEach (rule  , i) -> rule  .id = i++
    @symbols.forEach (symbol, i) -> symbol.id = i++

    # Rebuild symbol rules lookup
    @buildSymbolRules()

  # ============================================================================
  # PHASE 4: ERROR RECOVERY
  # ============================================================================

  # Add error recovery rules
  addErrorRecoveryRules: ->
    @timing "🚑 Add Error Recovery Rules"

    # Basic error recovery rules for robust parsing
    errorRules = [
      ['$accept', ['error'  ]] # $accept → error
      ['error'  , ['error'  ]] # error → error
      ['error'  , ['$end'   ]] # error → $end
      ['error'  , ['$accept']] # error → $accept
    ]

    @addRule(lhs, rhs) for [lhs, rhs] in errorRules
    @stats.errorRecoveryRules = errorRules.length

    @timing "🚑 Add Error Recovery Rules"

  # ============================================================================
  # PHASE 5: LALR(1) STATE MACHINE CONSTRUCTION
  # ============================================================================

  # ============================================================================
  # PHASE 6: PARSE TABLE AND OPTIMIZATION
  # ============================================================================


  # ============================================================================
  # HELPER FUNCTIONS
  # ============================================================================

  # Check if a symbol name is valid
  isValidSymbolName: (name) ->
    return false unless name? and typeof name is 'string' and name.length > 0
    # Allow alphanumeric, underscore, hyphen, and some special characters for terminals
    /^[a-zA-Z_][a-zA-Z0-9_?-]*$|^[+\-*/(){}[\];,.'":=<>!&|?~^%$#@\\]+$/.test(name)

  # Determine how much to debug or log
  parseDebug: (level) ->
    switch level
      when 0, 'silent'  then SILENT
      when 1, 'normal'  then NORMAL
      when 2, 'verbose' then VERBOSE
      when 3, 'debug'   then DEBUG
      when true         then VERBOSE # -V --verbose flag
      when false        then NORMAL  # default when verbose=false
      else                   NORMAL  # fallback to normal

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
