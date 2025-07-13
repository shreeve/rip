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
  constructor: (name, isTerminal = false, id = 0) ->
    @id         = id         # unique symbol id
    @name       = name       # symbol name (eg - Expression)
    @isTerminal = isTerminal # true if terminal, false if nonterminal
    @nullable   = false      # LALR(1) nullable computation
    @first      = new Set()  # LALR(1) FIRST sets
    @follow     = new Set()  # LALR(1) FOLLOW sets

class Rule # A → B C D
  @idno = 0
  constructor: (lhs, rhs, action = null, precedence = null) ->
    @id         = Rule.idno++ # unique rule id
    @lhs        = lhs         # left-hand side symbol
    @rhs        = rhs         # right-hand side symbol sequence
    @action     = action      # semantic action
    @precedence = precedence  # precedence for conflict resolution

class Item # Rule with a dot position and lookahead: [A → α • β, a]
  @makeCoreKey: (ruleId, dot) -> "#{ruleId}-#{dot}" # Canonical key for core

  constructor: (rule, dot = 0, lookahead = new Set()) ->
    unless rule?
        throw new Error("Item constructor requires a rule")
    unless typeof dot is 'number' or dot < 0
        throw new Error("Item dot position must be non-negative number")
    unless dot <= rule.rhs.length
        throw new Error("Item dot position (#{dot}) cannot exceed rule RHS length (#{rule.rhs.length})")

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
    @items       = []           # collection of item
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

    # FIXME: Not sure which of these are used

    # Optimization
    @optimizationConfig =
      enabled:          opts.optimize         ? false
      auto:             opts.autoOptimize     ? true
      minStatesForAuto: opts.minStatesForAuto ? 20
      algorithms:       opts.algorithms       ? ['auto']
      skipIfSmall:      opts.skipIfSmall      ? true

    @timing "🔤 Language constructor"

  # ============================================================================
  # LANGUAGE ANALYSIS AND CONSTRUCTION
  # ============================================================================

  # Transform input → output
  analyze: ->
    unless @analyzed
      @timing "🔍 Analysis"

      # Phase 0: Language Preparation
      @createSpecialSymbols() # Create fundamental LALR(1) symbols

      # Phase 1: Symbol and Rule Analysis
      @buildSymbols()        # @rules → @symbols, @tokens
      @buildPrecedence()     # @operators → @precedence
      @buildSymbolRules()    # @rules → @symbolRules

      # Phase 2: LALR(1) State Machine Construction
      @augmentStartRule()    # Add $accept → start $end
      @buildStates()         # @rules → @states, @stateMap
      @computeLookaheads()   # @states → @propagateLinks

      # Phase 3: Parse Table and Optimization
      @buildTable()          # @states → @table
      @resolveConflicts()    # @states → @conflicts, @inadequateStates
      @buildDefaultActions() # @states → @defaultActions

      @analyzed = true
      @timing "🔍 Analysis"

  # ============================================================================
  # PHASE 1: SYMBOL AND RULE ANALYSIS
  # ============================================================================

  # Create fundamental LALR(1) symbols
  createSpecialSymbols: ->
    @getSymbol '$accept'
    @getSymbol '$end' , true
    @getSymbol 'error', true; @tokens.add('error')

  # Extract symbols from rules and identify terminals
  buildSymbols: ->

    # Add all symbols from rules
    for rule in @rules
      @getSymbol(rule.lhs, false)  # Nonterminal
      @getSymbol(symbol, true) for symbol in rule.rhs  # Assume terminal initially

    # Mark as terminal if never appears on LHS
    lhsSymbols = new Set(rule.lhs for rule in @rules)
    for [name, symbol] from @symbols
      unless lhsSymbols.has(name)
        symbol.isTerminal = true
        @tokens.add(name)

  # Create rule lookup by symbol
  buildSymbolRules: ->
    for rule in @rules
      lhs = rule.lhs
      @symbolRules.set(lhs, []) unless @symbolRules.has(lhs)
      @symbolRules.get(lhs).push(rule)

  # Process operator precedence and associativity
  buildPrecedence: ->
    level = 1
    for group in @operators
      [assoc, ...symbols] = group
      for symbol in symbols
        @precedence[symbol] = {level, assoc}
      level++

  # Add augmented start rule: $accept → start $end
  augmentStartRule: ->
    @rules.push(new Rule('$accept', [@start, '$end']))
    @stats.augmentedRules = 1

  # Get or create a symbol
  getSymbol: (name, isTerminal) ->
    return sym if sym = @symbols.get(name)
    isTerminal = if isTerminal? then !!isTerminal else @tokens.has(name)
    symbol = new Symbol(name, isTerminal, @symbols.size)
    @symbols.set name, symbol
    symbol

  # Check if a symbol name is valid
  isValidSymbolName: (name) ->
    return false unless name? and typeof name is 'string'
    return false if name.length == 0
    # Allow alphanumeric, underscore, hyphen, and some special characters for terminals
    /^[a-zA-Z_][a-zA-Z0-9_?-]*$|^[+\-*/(){}[\];,.'":=<>!&|?~^%$#@\\]+$/.test(name)

  # ============================================================================
  # HELPER FUNCTIONS
  # ============================================================================

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
