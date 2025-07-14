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
  constructor: ->
    @id          = null      # unique state id
    @items       = []        # collection of items
    @coreMap     = new Map() # core-based deduplication (core key -> item)
    @transitions = new Map() # state transitions (symbol -> state)
    @inadequate  = false     # has shift/reduce conflicts?
    @_core       = null      # cached core string

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
      @_core = null # Invalidate cached core
      @coreMap.set(coreKey, item)
      @items.push(item)
      true

  # FIXME: Confirm these are optimal

  # Lazy core computation with caching
  core: -> @_core ?= (item.coreKey() for item in @items).sort().join('|')

  # Get core item by rule and dot
  getCoreItem: (ruleId, dot) -> @coreMap.get(Item.makeCoreKey(ruleId, dot))

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
      minimizeStates:   opts.minimizeStates   ? true
      safeMinimization: opts.safeMinimization ? true

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
      @minimizeStates() if @optimizationConfig.minimizeStates # State minimization
      @optimizeTable()           # Smart table optimization
      @buildDefaultActions()     # @states → @defaultActions

      @analyzed = true
      @timing "🔍 Analysis"

  # ============================================================================
  # PHASE 0: LANGUAGE PREPARATION
  # ============================================================================

  loadLanguage: ->
    @info      = {...(@language.info      or {})}
    @operators = [...(@language.operators or [])]
    @start     =      @language.start

    # Load grammar rules
    for lhs, rules of (@language.grammar ? @language.rules)
      for rule, i in rules
        try
          [pattern, action, options] = rule

          rhs = @parseRulePattern(pattern, lhs, i)
          @validateActionCode(action, rhs.length, lhs, i) if action?
          @rules.push(new Rule(lhs, rhs, @rules.length, action, options?.prec))

          @stats.sourceRules++
        catch error
          throw new Error("Error processing rule #{i + 1} for '#{lhs}': #{error.message}")

  # Parse and validate rule pattern (such as 'Body TERMINATOR Line')
  parseRulePattern: (pattern, lhs, i) ->
    return [] unless pattern? # Empty rule (epsilon)
    throw new Error("Pattern must be a string") unless typeof pattern is 'string'

    # Make sure each pattern is a valid symbol name
    symbols = pattern.trim().split(/\s+/)
    for symbol in symbols
      throw new Error("Invalid symbol '#{symbol}'") unless @isValidSymbolName symbol

    symbols

  # Validate action code for common issues
  validateActionCode: (action, size, lhs, ruleIndex) ->
    return unless action?

    # Check for parameter references beyond RHS length
    string = if typeof action is 'function' then action.toString() else action
    params = string.match(/\$(\d+)/g) || []
    for match in params
      param = parseInt(match.substring(1), 10)
      if param > size and not (size == 0 and param == 1) and not (lhs == '$accept' and param == 0)
        throw new Error("Invalid parameter index #{match} in action for '#{lhs}' rule #{ruleIndex + 1}")

  # Create fundamental LALR(1) symbols
  createSpecialSymbols: ->
    @getSymbol '$accept'
    @getSymbol '$end' , true
    @getSymbol 'error', true; @tokens.add('error') # 'error' is also a terminal

  # Add augmented start rule: $accept → start $end
  augmentStartRule: ->
    rule = @addRule '$accept', [@start, '$end']
    @stats.augmentedRules = 1
    @startRule = rule

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

    # Handle start symbol detection
    if @start?
      throw new Error("No start symbol '#{@start}'") unless @symbols.has @start
    else
      for [name, symbol] from @symbols when not symbol.isTerminal
        @start = name
        break
      throw new Error("No start symbol found") unless @start

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


  # ============================================================================
  # PHASE 2: LALR(1) SET COMPUTATIONS
  # ============================================================================

  # Compute nullable symbols
  computeNullable: ->
    @timing "🔍 Compute Nullable"

    # Pre-compute rules by LHS for efficiency
    rulesByLhs = new Map()
    for rule in @rules
      rulesByLhs.get(rule.lhs)?.push(rule) or rulesByLhs.set(rule.lhs, [rule])

    changed = true
    while changed
      changed = false

      # Check each nonterminal
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
          if rule.rhs.every (sym) -> @getSymbol(sym).nullable
            symbol.nullable = true
            changed = true
            break

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

  # Build LR(0) state machine
  buildStates: ->

    # Create initial state with augmented start rule
    startState = new State
    startState.addItem(new Item(@rules[@startRule], 0, new Set(['$end'])))
    @closure(startState)
    @addState(startState)

    # Build all states
    workList = [startState]
    while workList.length > 0
      state = workList.shift()

      # Group items by next symbol
      transitions = new Map()
      for item in state.items when not item.isComplete()
        nextSym = item.nextSymbol()
        transitions.get(nextSym)?.push(item) or transitions.set(nextSym, [item])

      # Create new states for each transition
      for [symbol, items] from transitions
        newState = new State
        newState.addItem(item.advance()) for item in items
        @closure(newState)

        # Add or merge state
        existingState = @getState(newState)
        state.transitions.set(symbol, existingState)
        workList.push(newState) if existingState is newState

  # Compute closure of a state (LR(0) - no lookaheads yet)
  closure: (state) ->
    @stats.closureCalls++

    # Check closure cache first
    coreKey = state.core()
    if @cache.has(coreKey)
      @stats.cacheHits++
      return

    # Compute closure using standard algorithm
    workList = [...state.items]
    while workList.length > 0
      item = workList.shift()

      # Skip if item is complete
      continue if item.isComplete()

      # Get next symbol after dot
      nextSym = item.nextSymbol()
      nextSymbol = @getSymbol(nextSym)

      # Skip if next symbol is terminal
      continue if nextSymbol.isTerminal

      # Find all rules for this nonterminal
      rules = @symbolRules.get(nextSym) or []
      for rule in rules
        # Create new item: [A → • α, lookahead]
        newItem = new Item(rule, 0, new Set())

        # Add to state if not already present
        if state.addItem(newItem)
          workList.push(newItem)

    # Cache the closure result
    @cache.set(coreKey, true)

  # Get existing state or add new one (similar to getSymbol)
  getState: (state) ->
    coreKey = state.core()

    if @stateMap.has(coreKey)
      existingState = @stateMap.get(coreKey)
      # Merge lookaheads from new state into existing state
      for item in state.items
        existingItem = existingState.getCoreItem(item.rule.id, item.dot)
        if existingItem
          existingItem.lookahead.add(la) for la from item.lookahead
      existingState
    else
      @addState(state)
      state

  # Add state to state list
  addState: (state) ->
    state.id = @states.length
    @states.push(state)
    @stateMap.set(state.core(), state)
    @stats.stateCreations++
    state

  # Compute LALR(1) lookahead sets
  computeLookaheads: ->
    @timing "📋 Compute Lookaheads"

    # First pass: compute spontaneous lookaheads
    for state in @states
      for item in state.items
        continue if item.isComplete()

        # Cache suffix computation to avoid computing twice
        suffix = item.rule.rhs.slice(item.dot + 1)
        lookahead = @firstOfString(suffix)

        # Check if suffix is nullable (includes original lookahead)
        if suffix.some (sym) => @getSymbol(sym).nullable
          lookahead.add(la) for la from item.lookahead

        # Add spontaneous lookaheads
        item.lookahead.add(la) for la from lookahead

    # Second pass: propagate lookaheads
    @propagateLookaheads()

    @timing "📋 Compute Lookaheads"

  # Propagate lookaheads until convergence
  propagateLookaheads: ->
    changed = true
    maxIterations = 1000
    iterationCount = 0

    while changed and iterationCount++ < maxIterations
      changed = false

      for state in @states
        for item in state.items
          continue if item.isComplete()

          nextSym = item.nextSymbol()
          nextState = state.transitions.get(nextSym)
          continue unless nextState

          # Find corresponding item in next state
          nextItem = nextState.getCoreItem(item.rule.id, item.dot + 1)
          continue unless nextItem

          # Propagate lookaheads
          oldSize = nextItem.lookahead.size
          nextItem.lookahead.add(la) for la from item.lookahead
          changed = true if nextItem.lookahead.size > oldSize

    if iterationCount >= maxIterations
      # FIXME: This could indicate a bug in the grammar or state construction
      console.warn("Lookahead propagation exceeded maximum iterations (#{maxIterations})")
      console.warn("Consider checking for left recursion or other grammar issues")

  # ============================================================================
  # PHASE 6: PARSE TABLE AND OPTIMIZATION
  # ============================================================================

  # Build parse table from states
  buildTable: ->
    @timing "📋 Build Table"

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
      for item in state.items when item.isComplete()

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
                  explanation: "State #{state.id}: Shift/reduce conflict on '#{la}' resolved to REDUCE (precedence)"
                })
              else if resolved == 'shift'
                @conflicts.push({
                  type: 'shift/reduce'
                  state: state.id
                  lookahead: la
                  resolved: true
                  resolution: 'shift'
                  explanation: "State #{state.id}: Shift/reduce conflict on '#{la}' resolved to SHIFT (precedence)"
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
                  explanation: "State #{state.id}: Unresolved shift/reduce conflict on '#{la}' - using default SHIFT"
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
                explanation: "State #{state.id}: Reduce/reduce conflict on '#{la}' resolved to rule #{Math.min(item.rule.id, existingRuleId)} (first declared)"
              })
              conflicts.rr++
          else
            table[state.id][la] = { type: 'reduce', rule: item.rule.id }

    if conflicts.sr or conflicts.rr
      console.warn("Grammar has conflicts: #{conflicts.sr} shift/reduce, #{conflicts.rr} reduce/reduce")

    @table = table
    @timing "📋 Build Table"

  # Remove unreachable (dead) states from the state machine
  removeUnreachableStates: ->
    @timing "🧹 Remove Unreachable States"

    # Find all reachable states starting from state 0 (initial state)
    reachable = new Set()
    workList = [@states[0]] # Start with initial state
    reachable.add(@states[0])

    # Breadth-first search to find all reachable states
    while workList.length > 0
      state = workList.shift()

      # Follow all transitions from this state
      for [symbol, nextState] from state.transitions
        unless reachable.has(nextState)
          reachable.add(nextState)
          workList.push(nextState)

    # Remove unreachable states
    originalCount = @states.length
    @states = @states.filter (state) -> reachable.has(state)
    removedCount = originalCount - @states.length

    # Rebuild state map with new state IDs
    @stateMap.clear()
    for state, i in @states
      state.id = i
      @stateMap.set(state.core(), state)

    # Update transitions to point to new state IDs
    for state in @states
      for [symbol, nextState] from state.transitions
        # Update transition to point to the new state ID
        state.transitions.set(symbol, nextState)

    if removedCount > 0
      console.log("Removed #{removedCount} unreachable states (from #{originalCount} to #{@states.length})")

    @timing "🧹 Remove Unreachable States"

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

  # Resolve conflicts and mark inadequate states
  resolveConflicts: ->
    @timing "📋 Resolve Conflicts"

    # Conflicts are already resolved during table building
    # This method is for any additional conflict resolution logic

    @timing "📋 Resolve Conflicts"

  # Minimize states for optimization
  minimizeStates: ->
    @timing "🔧 Minimize States"

    originalCount = @states.length
    mergedCount = 0

    # Phase 1: Find equivalent states using core-based comparison
    stateGroups = new Map()
    for state in @states
      core = state.core()
      stateGroups.get(core)?.push(state) or stateGroups.set(core, [state])

    # Phase 2: Merge states with identical cores and compatible lookaheads
    for [core, states] from stateGroups
      continue if states.length <= 1 # No merging needed

      # Sort states by ID for consistent merging
      states.sort((a, b) -> a.id - b.id)
      targetState = states[0]

      # Merge all other states into the first one
      for i in [1...states.length]
        sourceState = states[i]
        @mergeStates(targetState, sourceState)
        @states[sourceState.id] = null # Mark as merged
        mergedCount++

    # Phase 3: Clean up merged states
    @states = @states.filter (state) -> state?
    for state, i in @states
      state.id = i

    # Phase 4: Rebuild state map and update transitions
    @stateMap.clear()
    for state in @states
      @stateMap.set(state.core(), state)

    # Update all transitions to point to new state IDs
    for state in @states
      for [symbol, nextState] from state.transitions
        # Find the new state by core
        newState = @stateMap.get(nextState.core()) or throw new Error("State minimization error: cannot find state with core '#{nextState.core()}'")
        state.transitions.set(symbol, newState)

    if mergedCount > 0
      console.log("Merged #{mergedCount} equivalent states (from #{originalCount} to #{@states.length})")

    @timing "🔧 Minimize States"

  # Compute state signature for fast equivalence checking
  computeStateSignature: (state) ->
    transitions = []
    for [symbol, nextState] from state.transitions
      transitions.push("#{symbol}:#{nextState.core()}") # core-based not by id!
    transitions.sort()

    reduceActions = []
    for item in state.items when item.isComplete()
      for lookahead from item.lookahead
        reduceActions.push("#{lookahead}:#{item.rule.id}")
    reduceActions.sort()

    # Combine transitions and reduce actions for unique signature
    "#{transitions.join('|')}##{reduceActions.join('|')}"

  # Get reduce actions for a state
  getReduceActions: (state) ->
    actions = new Map()
    for item in state.items
      continue unless item.isComplete()
      for lookahead from item.lookahead
        actions.set(lookahead, item.rule.id)
    actions

  # Compute state key for minimization
  computeStateKey: (state) ->
    # Create a key based on state's core items
    cores = []
    for item in state.items
      cores.push(item.coreKey())
    cores.sort().join('|')

  # Merge two states
  mergeStates: (target, source) ->
    # Validate that states have identical cores
    if target.core() isnt source.core()
      throw new Error("Cannot merge states with different cores")

    # Merge lookaheads from source into target
    for item in source.items
      targetItem = target.getCoreItem(item.rule.id, item.dot)
      if targetItem
        targetItem.lookahead.add(la) for la from item.lookahead
      else
        # This indicates a bug in core computation or state management
        throw new Error("Missing target item for rule #{item.rule.id} dot #{item.dot} - core computation error")

  # Optimize parse table
  optimizeTable: ->
    @timing "🔧 Optimize Table"

    # Smart table optimization - only when beneficial
    if @optimizationConfig.enabled and @states.length >= @optimizationConfig.minStatesForAuto
      # Apply optimizations based on configuration
      for algorithm in @optimizationConfig.algorithms
        switch algorithm
          when 'auto'
            @autoOptimizeTable()
          when 'minimal'
            @minimalOptimizeTable()

    @timing "🔧 Optimize Table"

  # Auto-optimize table based on heuristics
  autoOptimizeTable: ->
    # Remove redundant actions
    for state in @states
      if @table[state.id]?
        actions = @table[state.id]
        # Remove duplicate actions
        seen = new Set()
        for symbol, action of actions
          actionKey = "#{action.type}-#{action.state or action.rule}"
          if seen.has(actionKey)
            delete actions[symbol]
          else
            seen.add(actionKey)

  # Minimal table optimization
  minimalOptimizeTable: ->
    # Basic optimization: remove obvious redundancies
    for state in @states
      if @table[state.id]?
        actions = @table[state.id]
        # Remove empty actions
        for symbol, action of actions
          if not action or (action.type is 'reduce' and not action.rule?)
            delete actions[symbol]

  # Compute default actions for performance optimization
  buildDefaultActions: ->
    @timing "📋 Build Default Actions"

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

    @timing "📋 Build Default Actions"

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

# ==============================================================================
# CLI SUPPORT
# ==============================================================================

# Only run CLI if this script is executed directly
if process.argv[1]?.includes('rip.coffee') or process.argv[1]?.includes('rip.js')

  # Parse command line arguments
  args = process.argv.slice(2)
  options = {}
  outputFile = null

  # Help text
  helpText = """
  rip: The multilanguage universal runtime powering the Rip ecosystem.

  Usage: coffee rip.coffee [options] <language-file>

  Options:
    -h, --help              Show this help message
    -v, --version           Show version information
    -V, --verbose           Enable verbose output (same as --debug-level 2)
    -d, --debug             Enable debug mode (same as --debug-level 3)
    -q, --quiet             Suppress all output except errors (same as --debug-level 0)
    --debug-level LEVEL     Set debug level: 0=silent, 1=normal, 2=verbose, 3=debug
    -o, --output FILE       Output file (default: stdout)

  Examples:
    coffee rip.coffee grammar.json
    coffee rip.coffee -V grammar.json
    coffee rip.coffee --debug-level 2 -o parser.js grammar.json
  """

  # Parse arguments
  i = 0
  while i < args.length
    arg = args[i]

    switch arg
      when '-h', '--help'
        console.log helpText
        process.exit 0
      when '-v', '--version'
        console.log "rip version 0.5.0"
        process.exit 0
      when '-V', '--verbose'
        options.debug = VERBOSE
      when '-d', '--debug'
        options.debug = DEBUG
      when '-q', '--quiet'
        options.debug = SILENT
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
      when '-o', '--output'
        if i + 1 >= args.length
          console.error "Error: --output requires a filename"
          process.exit 1
        outputFile = args[i + 1]
        i++ # Skip the next argument since we consumed it
      else
        # Assume this is the input file
        if options.inputFile?
          console.error "Error: Multiple input files specified"
          process.exit 1
        options.inputFile = arg
    i++

  # Validate input file
  unless options.inputFile?
    console.log helpText
    process.exit 1

  # Check if input file exists
  fs = require 'fs'
  unless fs.existsSync options.inputFile
    console.error "Error: Input file '#{options.inputFile}' not found"
    process.exit 11

  # Read and parse input file
  try
    # { grammar: language, operators: language.operators, start: language.start } = require(options.inputFile)
    language = require(options.inputFile)

  catch error
    console.error "Error: Failed to parse input file: #{error.message}"
    process.exit 1

  # Create language instance
  try
    lang = new Language language, options
    lang.analyze()

    # Generate output
    output = {
      symbols: Array.from(lang.symbols.entries())
      rules: lang.rules
      states: lang.states.length
      conflicts: lang.conflicts.length
      table: lang.table
      defaultActions: lang.defaultActions
    }

    # Output to file or stdout
    if outputFile?
      try
        fs.writeFileSync outputFile, JSON.stringify(output, null, 2)
        console.log "Output written to #{outputFile}" unless options.debug is SILENT
      catch error
        console.error "Error: Failed to write output file: #{error.message}"
        process.exit 1
    else
      console.log JSON.stringify(output, null, 2)

  catch error
    console.error "Error: #{error.message}"
    process.exit 1
