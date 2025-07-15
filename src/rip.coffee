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
  constructor: (@language = {}, opts = {}) ->
    @timing "🔤 Language constructor"

    # Set debugging level and perform language validation
    @debug = @parseDebug opts.debug ? NORMAL
    # @validateLanguage()

    # Input (foundational data)
    @info             = {}        # Language metadata
    @rules            = []        # Language rules
    @operators        = []        # Precedence/associativity
    @start            = null      # Start symbol

    # Output (derived during analysis)
    @analyzed         = false     # Analysis done?
    @symbols          = new Map() # Symbol table
    @tokens           = new Set() # Terminal symbols
    @precedence       = {}        # Symbol precedence table
    @symbolRules      = new Map() # Lookup rules by symbol
    @startRule        = null      # Cached augmented start rule
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

      # Grammar rules
      lhsCount:              0    # LHS count (97)
      sourceRules:           0    # Direct from grammar file (405)
      expandedRules:         0    # Expanded/flattened (0)
      errorRecoveryRules:    0    # Error recovery rules (4)
      augmentedRules:        0    # Augmented start rule (1)

      # 206 symbols

      # Operator statistics
      precedenceLevels:      0    # Number of precedence levels (23)
      totalOperators:        0    # Total number of operators (100)
      leftAssocGroups:       0    # Number of left-associative groups (10)
      rightAssocGroups:      0    # Number of right-associative groups (10)
      nonAssocGroups:        0    # Number of non-associative groups (3)

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
      minimizeStates:   opts.minimizeStates   ? true
      safeMinimization: opts.safeMinimization ? true

    @timing "🔤 Language constructor"

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
