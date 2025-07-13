#!/usr/bin/env coffee

# ==============================================================================
# rip: A modern, LALR(1) parser generator for the Rip ecosystem
#
# Author: Steve Shreeve <steve.shreeve@gmail.com> and Claude 4 Opus/Sonnet
#  Stats: July 11, 2025 (version 0.4.0) MIT License
# ==============================================================================

# Debug level constants (defined at top for use throughout)
SILENT = 0   # Errors only
NORMAL = 1   # Basic summary (default)
VERBOSE = 2  # Detailed analysis
DEBUG = 3    # Everything + internals

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
    # Validate inputs
    unless rule?
      throw new Error("Item constructor requires a rule")
    unless typeof dot is 'number' or dot < 0
      throw new Error("Item dot position must be a non-negative number")
    unless dot <= rule.rhs.length
      throw new Error("Item dot position (#{dot}) cannot exceed rule RHS length (#{rule.rhs.length})")

    @rule      = rule        # associated production rule
    @dot       = dot         # dot position (• marker)
    @lookahead = lookahead   # LALR(1) lookahead set

  isComplete: -> @dot >= @rule.rhs.length                        # reduction check (is dot at end?)
  nextSymbol: -> @rule.rhs[@dot]                                 # next symbol after dot
  advance:    -> new Item(@rule, @dot + 1, new Set(@lookahead))  # new item with dot advanced
  core:       -> new Item(@rule, @dot, new Set())                # LR(0) core (item without lookahead)
  coreKey:    -> @_coreKey ?= Item.makeCoreKey(@rule.id, @dot)   # core key, supports deduplication

  # String for debugging
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
  constructor: (grammarData = null, opts = {}) ->
    @timing "🏗️ CONSTRUCTOR"
    @timing "  📋 Data structure initialization"

    # Initialize all data structures
    @grammar           = null      # store grammar
    @start             = null      # start symbol
    @tokens            = null      # store tokens for terminal identification
    @symbols           = new Map() # name -> Symbol
    @rules             = []        # array of Rules
    @precedence        = {}        # symbol -> {level, assoc}
    @states            = []        # array of States
    @stateMap          = new Map() # core hash -> State
    @propagateLinks    = new Map() # stateId-itemKey -> Set of stateId-itemKey
    @inadequateStates  = []        # states with conflicts
    @conflicts         = []        # conflict information
    @analyzed          = false     # track if analysis is complete
    @rulesByLHS        = new Map() # LHS -> [Rules] for O(1) rule lookup
    @stats             =
      closureCalls:          0     # closure calls
      cacheHits:             0     # cache hits
      stateCreations:        0     # state creations
      lookaheadComputations: 0     # lookahead computations
      optimizationTime:      0     # optimization time
      sourceRules:           0     # direct from grammar file
      expandedRules:         0     # expanded/flattened
      errorRecoveryRules:    0     # error recovery rules
      augmentedRules:        0     # augmented start rule

    # Table optimization configuration
    @optimizationConfig =
      enabled:          opts.optimize         ? false
      auto:             opts.autoOptimize     ? true
      minStatesForAuto: opts.minStatesForAuto ? 20
      algorithms:       opts.algorithms       ? ['auto']
      skipIfSmall:      opts.skipIfSmall      ? true

    # Debug levels will use module-level constants

    # Parse debug level from options (handle 0 as valid value)
    debugInput = if opts.debugLevel? then opts.debugLevel else (opts.verbose || opts.debug || 'normal')
    @debugLevel = @parseDebugLevel(debugInput)

    # Legacy debug configuration (for backward compatibility)
    @debugConfig =
      enabled: @debugLevel >= DEBUG

    # Configure options
    @options = opts
    @options.grammarData = grammarData  # Store for lazy loading

    @timing "  📋 Data structure initialization"

    # If grammar data provided, process it immediately (unless lazy loading requested)
    if grammarData and not opts.lazy
      try
        @timing "  📁 Grammar processing", =>
          if grammarData.grammar
            # Grammar data is in the expected format { grammar, operators, start, tokens }
            @processGrammar(grammarData)
          else
            # Legacy format - assume grammarData is the grammar object itself
            @processGrammar({
              grammar: grammarData.grammar or grammarData
              operators: grammarData.operators
              start: grammarData.start
              tokens: grammarData.tokens
            })

        @timing "  🔍 Analysis", => @analyze()

      catch error
        console.error("❌ Constructor failed to process grammar:", error.message)
        throw error

    @timing "🏗️ CONSTRUCTOR"

  # ============================================================================
  # DEBUG LEVEL PARSING - Convert various debug options to numeric levels
  # ============================================================================

  parseDebugLevel: (level) ->
    switch level
      when 0, 'silent'  then 0  # SILENT
      when 1, 'normal'  then 1  # NORMAL
      when 2, 'verbose' then 2  # VERBOSE
      when 3, 'debug'   then 3  # DEBUG
      when true         then 2  # VERBOSE - --verbose flag
      when false        then 1  # NORMAL - default when verbose=false
      else 1  # fallback to normal

  # ============================================================================
  # TIMING UTILITY - Flexible timing for both function wrapping and manual timing
  # ============================================================================

  # Usage:
  #   @timing "📋 Phase description", => @fn()  # Function wrapper
  #   @timing "📋 Phase description"            # Start timer
  #   @timing "📋 Phase description"            # End timer and show duration
  timing: (description, fn) ->
    # Initialize timers map if not exists
    @_timers ?= new Map()

    if fn?
      # Function wrapper mode - only time if verbose or higher
      if @debugLevel >= VERBOSE
        startTime = Date.now()
        result = fn.call(this)
        endTime = Date.now()
        duration = endTime - startTime
        console.log("#{description}: #{duration}ms")
        result
      else
        fn.call(this)
    else
      # Manual timing mode - only time if verbose or higher
      if @debugLevel >= VERBOSE
        if @_timers.has(description)
          # End timer
          startTime = @_timers.get(description)
          endTime = Date.now()
          duration = endTime - startTime
          console.log("#{description}: #{duration}ms")
          @_timers.delete(description)
        else
          # Start timer
          @_timers.set(description, Date.now())
      # Return nothing for manual timing mode

  # ============================================================================
  # 1. MAIN ANALYSIS METHOD - Performs complete LALR(1) analysis
  # ============================================================================

  analyze: ->
    return if @analyzed

    unless @grammar
      throw new Error("No grammar loaded. Use new Generator(grammarData) or call processGrammar() first.")

    # Validate that we have the essential components
    unless @start
      throw new Error("No start symbol defined in grammar")

    unless @rules.length > 0
      throw new Error("No production rules found in grammar")

    try
      @timing "📊 TOTAL ANALYSIS TIME"

      @timing "  ⚡ Phase 1: Nullable computation", => @computeNullable()
      @timing "  ⚡ Phase 2: FIRST sets computation", => @computeFirst()
      @timing "  ⚡ Phase 3: FOLLOW sets computation", => @computeFollow()
      @timing "  ⚡ Phase 4: Grammar cleanup", =>
        # Grammar cleanup - iterate until no more changes
        loop
          initialRuleCount = @rules.length
          initialSymbolCount = @symbols.size

          # Order matters: unproductive first, then unreachable
          @eliminateUnproductive()
          @eliminateUnreachable()

          # Stop if no changes were made
          break if @rules.length == initialRuleCount and @symbols.size == initialSymbolCount

      @timing "  ⚡ Phase 5: Error recovery rules", => @addErrorRecoveryRules()
      @timing "  ⚡ Phase 6: State construction", => @buildStates()
      @timing "  ⚡ Phase 7: LALR(1) lookahead computation", =>
        @computeLookaheads()
        @propagateLookaheads()
      @timing "  ⚡ Phase 8: Parse table construction", => @table = @buildTable()
      @timing "  ⚡ Phase 9: State optimization", =>
        @minimizeStates() # State minimization and optimization
        @smartOptimizeTable() # Smart table optimization (Bug #20 Fix) - only when beneficial
        @computeDefaultActions()

      @timing "📊 TOTAL ANALYSIS TIME"

      @analyzed = true

    catch error
      console.error("❌ Analysis failed:", error.message)
      throw error

  # ============================================================================
  # 2. MAIN COMPILATION METHOD - Generates parser code
  # ============================================================================

  compile: (options = {}) ->
    @timing "🔧 COMPILE METHOD"

    # If grammar wasn't processed yet (lazy loading), process it now
    unless @grammar
      @timing "  📁 Processing grammar (lazy loading)", =>
        if @options.grammarData
          # Process the stored grammar data
          grammarData = @options.grammarData
          if grammarData.grammar
            @processGrammar(grammarData)
          else
            @processGrammar({ grammar, operators = grammarData, start, tokens } = grammarData)
        else
          throw new Error("No grammar data available for lazy loading")

    @timing "  🔍 Analysis (if needed)" , => @analyze() unless @analyzed
    @timing "  📋 Conflict reporting"   , => @reportConflicts() if @conflicts.length > 0
    @timing "  📊 Statistics display"   , => @displayStats()

    # Generate the parser code using unified format
    result = @timing "  🏗️ Code generation", => @generateCommonJS(options)

    @timing "🔧 COMPILE METHOD"

    result

  # ============================================================================
  # 3. ANALYSIS INSPECTION METHODS
  # ============================================================================

  getStatistics: ->
    @analyze() unless @analyzed
    stats =
      states:                @states.length
      rules:                 @rules.length
      terminals:             [...@symbols.values()].filter((s) -> s.isTerminal).length
      nonterminals:          [...@symbols.values()].filter((s) -> !s.isTerminal).length
      conflicts:             @conflicts.length
      symbols:               @symbols.size
      inadequateStates:      @inadequateStates.length

      # Rule details
      sourceRules:           @stats.sourceRules
      expandedRules:         @rules.length - (@stats.sourceRules + @stats.errorRecoveryRules + @stats.augmentedRules)
      errorRecoveryRules:    @stats.errorRecoveryRules
      augmentedRules:        @stats.augmentedRules

      # Performance metrics
      closureCalls:          @stats.closureCalls
      cacheHits:             @stats.cacheHits
      stateCreations:        @stats.stateCreations
      lookaheadComputations: @stats.lookaheadComputations
      optimizationTime:      @stats.optimizationTime
    stats

  hasConflicts: ->
    @analyze() unless @analyzed
    @conflicts.length > 0

  isAnalyzed: -> @analyzed

  # ============================================================================
  # 4. LEGACY SUPPORT - Maintain backward compatibility
  # ============================================================================

  # Legacy method for backward compatibility
  generate: (options = {}) ->
    # If no grammar loaded, try to process from options
    unless @grammar
      if options.grammar
        @processGrammar(options)
        @analyze()
      else
        throw new Error("No grammar data provided. Use new Generator(grammarData) or provide grammar in options.")

    # Delegate to compile method
    @compile(options)

  # ============================================================================
  # 5. GRAMMAR PROCESSING PHASE
  # ============================================================================

  # Work starts here
  processGrammar: ({ grammar, operators, start, tokens }) ->
    # Comprehensive input validation
    @validateGrammarInput({ grammar, operators, start, tokens })

    # Store the grammar for later reference
    @grammar = grammar

    # Auto-detect tokens if not provided, otherwise use provided tokens
    @tokens = if tokens
      new Set(tokens.trim().split(/\s+/))
    else
      @autoDetectTerminals(grammar)

    # Create special symbols (starts with id = 0, 1, 2)
    @getSymbol '$accept'
    @getSymbol '$end' , true
    @getSymbol 'error', true; @tokens.add('error')

    # Rule stats
    @stats.sourceRules        = 0
    @stats.expandedRules      = 0
    @stats.errorRecoveryRules = 0
    @stats.augmentedRules     = 0

    # Process all rules with enhanced validation
    ruleCountBefore = @rules.length
    for nonterminal, rules of grammar
      for rule, i in rules
        try
          [pattern, action, options] = rule

          # Validate and parse the pattern
          rhs = @parseRulePattern(pattern, nonterminal, i)

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

          @stats.sourceRules++
        catch error
          throw new Error("Error processing rule #{i} for '#{nonterminal}': #{error.message}")

    # Smart start symbol detection with fallbacks
    @start = start || (if grammar['Root'] then 'Root' else Object.keys(grammar)[0])
    throw new Error('Start symbol not found') unless @start

    # Add augmented start rule: $accept → start $end
    @rules.push(new Rule('$accept', [@start, '$end']))
    @stats.augmentedRules = 1

    # Build performance optimization caches
    @buildRuleLookupCache()

    # Process operators (precedence and associativity)
    @processOperators(operators) if operators

    # Add error recovery rules
    @addErrorRecoveryRules()

  # Comprehensive grammar input validation
  validateGrammarInput: ({ grammar, operators, start, tokens }) ->
    errors = []

    # 1. Basic structure validation
    unless grammar?
      errors.push("Grammar object is required")

    unless typeof grammar is 'object'
      errors.push("Grammar must be an object, got #{typeof grammar}")

    # Tokens are now optional (auto-detected if not provided)
    if tokens? and typeof tokens isnt 'string'
      errors.push("Tokens must be a string, got #{typeof tokens}")

    # Early exit if basic structure is invalid
    if errors.length > 0
      throw new Error("Grammar validation failed:\n  #{errors.join('\n  ')}")

    # 2. Grammar structure validation
    if Object.keys(grammar).length == 0
      errors.push("Grammar cannot be empty")

    # 3. Validate each non-terminal and its rules
    for nonterminal, rules of grammar
      # Validate non-terminal name
      unless @isValidSymbolName(nonterminal)
        errors.push("Invalid non-terminal name '#{nonterminal}': must be alphanumeric with underscores")

      # Validate rules array
      unless Array.isArray(rules)
        errors.push("Rules for '#{nonterminal}' must be an array, got #{typeof rules}")
        continue

      if rules.length == 0
        errors.push("Non-terminal '#{nonterminal}' has no rules")
        continue

      # Validate each rule
      for rule, i in rules
        unless Array.isArray(rule)
          errors.push("Rule #{i} for '#{nonterminal}' must be an array, got #{typeof rule}")
          continue

        if rule.length == 0
          errors.push("Rule #{i} for '#{nonterminal}' cannot be empty")
          continue

        [pattern, action, options] = rule

        # Validate pattern
        if pattern? and typeof pattern isnt 'string'
          errors.push("Pattern in rule #{i} for '#{nonterminal}' must be a string, got #{typeof pattern}")

        # Validate action if present
        if action? and typeof action isnt 'string' and typeof action isnt 'function'
          errors.push("Action in rule #{i} for '#{nonterminal}' must be a string or function, got #{typeof action}")

        # Validate options if present
        if options? and typeof options isnt 'object'
          errors.push("Options in rule #{i} for '#{nonterminal}' must be an object, got #{typeof options}")

        # Validate symbols in pattern
        if pattern?
          symbols = pattern.trim().split(/\s+/)
          for symbol in symbols when symbol
            unless @isValidSymbolName(symbol)
              errors.push("Invalid symbol '#{symbol}' in rule #{i} for '#{nonterminal}'")

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

    # 6. Validate tokens (only if provided)
    if tokens?
      tokenList = tokens.trim().split(/\s+/)
      for token in tokenList when token
        unless @isValidSymbolName(token)
          errors.push("Invalid token name '#{token}'")

    # Throw error if any validation failed
    if errors.length > 0
      throw new Error("Grammar validation failed:\n  #{errors.join('\n  ')}")

  # Parse and validate rule pattern
  parseRulePattern: (pattern, nonterminal, ruleIndex) ->
    unless pattern?
      return [] # Empty rule (epsilon)

    unless typeof pattern is 'string'
      throw new Error("Pattern must be a string")

    # Split into symbols and validate each
    symbols = pattern.trim().split(/\s+/).filter((s) -> s.length > 0)

    for symbol in symbols
      unless @isValidSymbolName(symbol)
        throw new Error("Invalid symbol '#{symbol}' in pattern")

    symbols

  # Validate action code for common issues
  validateActionCode: (action, rhsLength, nonterminal, ruleIndex) ->
    return unless action?

    actionStr = if typeof action is 'function' then action.toString() else action

    # Check for parameter references beyond RHS length
    paramMatches = actionStr.match(/\$(\d+)/g) || []
    for match in paramMatches
      paramNum = parseInt(match.substring(1), 10)
      if paramNum > rhsLength and not (rhsLength == 0 and paramNum == 1) and not (nonterminal == '$accept' and paramNum == 0)
        console.warn("Warning: Parameter #{match} in action for '#{nonterminal}' rule #{ruleIndex} exceeds RHS length (#{rhsLength})")

  # Operator precedence and associativity
  processOperators: (operators) ->
    @precedence = {}
    precedenceLevel = 1

    for group in operators
      [assoc, symbols...] = group
      for symbol in symbols
        @precedence[symbol] = { level: precedenceLevel, assoc }
      precedenceLevel++

  # Add error recovery rules to the grammar
  addErrorRecoveryRules: ->
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

    # Add error rules for promising candidates
    for ntName in candidateNonTerminals.slice(0, 3) # Limit to avoid too many
      # Add: NonTerminal → error
      errorRule = new Rule(ntName, ['error'], '/* error recovery */')
      @rules.push(errorRule)
      @stats.errorRecoveryRules++

      # Only show in debug mode (internal implementation details)
      if @debugLevel >= DEBUG
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

  # Auto-detect terminal symbols from grammar rules
  # A symbol is a terminal if it never appears as the left-hand side of any rule
  autoDetectTerminals: (grammar) ->
    allSymbols = new Set()
    nonTerminals = new Set()

    # Collect all non-terminals (LHS symbols)
    for lhs, rules of grammar
      nonTerminals.add(lhs)

    # Collect all symbols from RHS of rules
    for lhs, rules of grammar
      for rule in rules
        [pattern] = rule
        if pattern and typeof pattern is 'string'
          symbols = pattern.trim().split(/\s+/).filter((s) -> s.length > 0)
          for symbol in symbols
            allSymbols.add(symbol)

    # Terminals are symbols that appear in RHS but not as LHS
    terminals = new Set()
    for symbol from allSymbols
      unless nonTerminals.has(symbol)
        terminals.add(symbol)

    terminals

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
  # 6. GRAMMAR CLEANUP PHASE
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
  # 7. LALR(1) ANALYSIS PHASE
  # ============================================================================

  # Compute nullable symbols
  computeNullable: ->
    changed = true
    while changed
      changed = false
      for rule in @rules
        continue if @getSymbol(rule.lhs).nullable

        # A nonterminal is nullable if it has an empty rule
        # or if all symbols in one of its rules are nullable
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
  # 8. STATE MACHINE CONSTRUCTION
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
    @stats.closureCalls++

    # Check closure cache first
    coreKey = @computeCore(state)
    if @closureCache.has(coreKey)
      @stats.cacheHits++
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
  # 9. LOOKAHEAD COMPUTATION
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
  # 10. PARSING TABLE CONSTRUCTION
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
  # 11. OPTIMIZATION PHASE
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

    # Report minimization results - always show in normal mode and above
    if @debugLevel >= NORMAL
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
      if @debugLevel >= VERBOSE
        console.log "\n🔧 Smart Table Optimization:"
        console.log "============================="
        console.log "Grammar size: #{@states.length} states, #{@symbols.size} symbols"
        console.log "Optimization triggered: #{@getOptimizationReason()}"

      @optimizeTableConditional()
    else
      if @debugLevel >= VERBOSE
        console.log "\n⚡ Skipping table optimization (small grammar, better performance without)"

      # For small grammars, use fast path
      @optimizedTable = null

    @stats.optimizationTime = Date.now() - startTime

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

    if @debugLevel >= VERBOSE
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
        optimizationTime: @stats.optimizationTime
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
  # 12. DEFAULT ACTIONS PHASE
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
  # 13. DEBUGGING & ANALYSIS FUNCTIONS
  # ============================================================================

  # Check if a symbol is left-recursive
  isLeftRecursive: (symbol, visited = new Set()) ->
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

  # Check if a symbol is right-recursive
  isRightRecursive: (symbol, visited = new Set()) ->
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
      stateCount: @states.length
      totalEntries: Object.keys(@table).length
      density: @calculateTableDensity()
      conflicts: @conflicts.length
      optimizations: @getOptimizationInfo()
    }
    tableInfo

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

  calculateTableDensity: ->
    totalPossibleEntries = @states.length * @symbols.size
    actualEntries = 0
    for stateId, actions of @table
      actualEntries += Object.keys(actions).length
    Math.round((actualEntries / totalPossibleEntries) * 100)

  getOptimizationInfo: ->
    info = {
      stateMinimization: @states.length
      tableOptimization: @optimizedTable?.format || 'none'
      defaultActions: if @defaultActions then Object.keys(@defaultActions).length else 0
    }
    info

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

  # ============================================================================
  # 14. SOURCE MAP SUPPORT INFRASTRUCTURE
  # ============================================================================

  # Source map tracker for debugging support
  class SourceMapTracker
    constructor: (@options = {}) ->
      @mappings = []
      @sources = []
      @sourcesContent = []
      @names = []
      @version = 3
      @file = @options.file || 'generated.js'
      @sourceRoot = @options.sourceRoot || ''

    # Add a mapping between generated and source positions
    addMapping: (generated, source) ->
      @mappings.push {
        generated: generated
        source: source
        original: source.original
        name: source.name
      }

    # Generate VLQ encoded mappings string
    generateMappings: ->
      # Implementation of VLQ encoding for source maps
      # This is a simplified version - full implementation would be more complex
      mappingsStr = ''

      for mapping in @mappings
        # VLQ encode the mapping data
        vlqData = @encodeVLQValue(mapping.generated.column)
        vlqData += @encodeVLQValue(mapping.source.index)
        vlqData += @encodeVLQValue(mapping.original.line)
        vlqData += @encodeVLQValue(mapping.original.column)

        if mapping.name
          vlqData += @encodeVLQValue(mapping.name.index)

        mappingsStr += vlqData + ','

      mappingsStr.slice(0, -1) # Remove trailing comma

    # VLQ encoding implementation
    encodeVLQValue: (value) ->
      base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      vlq = if value < 0 then ((-value) << 1) | 1 else value << 1
      result = ''

      while vlq > 31
        result += base64Chars[32 | (vlq & 31)]
        vlq >>>= 5

      result += base64Chars[vlq]
      result

    # Generate complete source map object
    generateSourceMap: ->
      {
        version: @version
        file: @file
        sourceRoot: @sourceRoot
        sources: @sources
        sourcesContent: @sourcesContent
        names: @names
        mappings: @generateMappings()
      }

  # Initialize source map tracking
  initSourceMapTracking: (options = {}) ->
    @sourceMapTracker = new SourceMapTracker(options)

  # Add source map entry
  addSourceMapEntry: (generated, source) ->
    @sourceMapTracker?.addMapping(generated, source)

  # Generate source map for parser
  generateSourceMapForParser: (options = {}) ->
    return null unless @sourceMapTracker
    @sourceMapTracker.generateSourceMap()

  # ============================================================================
  # 15. VISUALIZATION FUNCTIONS
  # ============================================================================

  # Generate DOT format visualization of the state machine
  generateDotVisualization: ->
    lines = []
    lines.push 'digraph parser_states {'
    lines.push '  rankdir=LR;'
    lines.push '  node [shape=circle];'

    # Add states
    for state in @states
      label = "State #{state.id}"
      if state.inadequate
        lines.push "  #{state.id} [label=\"#{label}\", color=red];"
      else
        lines.push "  #{state.id} [label=\"#{label}\"];"

    # Add transitions
    for state in @states
      for [symbol, nextState] from state.transitions
        lines.push "  #{state.id} -> #{nextState.id} [label=\"#{symbol}\"];"

    lines.push '}'
    lines.join('\n')

  # Generate Mermaid diagram of the state machine
  generateMermaidVisualization: ->
    lines = []
    lines.push 'stateDiagram-v2'

    # Add states
    for state in @states
      if state.inadequate
        lines.push "  #{state.id} --> #{state.id} : conflict"

      # Add transitions
      for [symbol, nextState] from state.transitions
        lines.push "  #{state.id} --> #{nextState.id} : #{symbol}"

    lines.join('\n')

  # Generate comprehensive state analysis visualization
  generateStateAnalysisVisualization: ->
    analysis = {
      totalStates: @states.length
      inadequateStates: @inadequateStates.length
      conflictStates: @conflicts.length
      stateTransitions: 0
      averageItemsPerState: 0
      maxItemsInState: 0
      stateDistribution: {}
    }

    totalItems = 0
    for state in @states
      totalItems += state.items.length
      analysis.maxItemsInState = Math.max(analysis.maxItemsInState, state.items.length)
      analysis.stateTransitions += state.transitions.size

      # Categorize states by item count
      itemCount = state.items.length
      range = switch
        when itemCount <= 5 then '1-5'
        when itemCount <= 10 then '6-10'
        when itemCount <= 15 then '11-15'
        else '16+'

      analysis.stateDistribution[range] = (analysis.stateDistribution[range] or 0) + 1

    analysis.averageItemsPerState = Math.round(totalItems / @states.length)
    analysis

  # Generate grammar flow visualization
  generateGrammarFlowVisualization: ->
    lines = []
    lines.push 'graph TD'

    # Add rules as nodes
    for rule in @rules
      ruleStr = "#{rule.lhs} → #{rule.rhs.join(' ')}"
      lines.push "  R#{rule.id}[\"#{ruleStr}\"]"

    # Add symbol dependencies
    for rule in @rules
      for symbol in rule.rhs
        unless @getSymbol(symbol).isTerminal
          # Find rules that define this symbol
          definingRules = @getRulesDefiningSymbol(symbol)
          for definingRuleId in definingRules
            lines.push "  R#{definingRuleId} --> R#{rule.id}"

    lines.join('\n')

  # Generate conflict analysis visualization
  generateConflictVisualization: ->
    return "No conflicts found" if @conflicts.length == 0

    lines = []
    lines.push 'graph TB'

    # Group conflicts by state
    conflictsByState = {}
    for conflict in @conflicts
      conflictsByState[conflict.state] = conflictsByState[conflict.state] || []
      conflictsByState[conflict.state].push(conflict)

    # Add conflict nodes
    for stateId, conflicts of conflictsByState
      lines.push "  S#{stateId}[\"State #{stateId}\"]"
      for conflict, i in conflicts
        conflictId = "C#{stateId}_#{i}"
        conflictType = conflict.type.replace('/', '_')
        lines.push "  #{conflictId}[\"#{conflict.type}\"]"
        lines.push "  S#{stateId} --> #{conflictId}"

        if conflict.resolved
          lines.push "  #{conflictId} --> R#{stateId}_#{i}[\"Resolved\"]"
        else
          lines.push "  #{conflictId} --> U#{stateId}_#{i}[\"Unresolved\"]"

    lines.join('\n')

  # Add isLeftRecursive and isRightRecursive to the end of Visualization Functions
  # (Already added above in the debugging section, but moving them here as requested)

  # ============================================================================
  # 16. CODE GENERATION PHASE
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
/* Generated by Rip 1.0.0 - Unified Format */

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
            throw new Error(errStr + (if expected.length > 0 then `, expected: ${expected.join(', ')}` else ''));
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
            const rule = getRule(target);
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
/* High-Performance Parser - Generated by Rip */

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

  // Rule metadata for reductions
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
            const rule = productions[target];
            if (!rule) {
              throw new Error(`Invalid rule ${target}`);
            }

            const [lhs, length] = rule;
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
      throw new Error(errStr + (if expected.length > 0 then `, expected: ${expected.join(', ')}` else ''));
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
    # Handle the special case where CoffeeScript grammar uses @1 and $1 in empty rules
    # These need to be replaced with default values FIRST, before any other processing
    if rule.rhs.length == 0
      # For empty rules, @1 and $1 should use default values
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

    # Ensure the action has a proper return statement or expression
    # If the action doesn't already have a return statement and isn't a simple assignment,
    # treat it as an expression that should be returned
    action = action.trim()
    unless action.match(/^(return\s|this\.\$\s*=|var\s|let\s|const\s|\$\$\s*=)/) or action == '' or action.includes(';')
      # If it's not already a statement, make it a return statement
      action = "return #{action}"

    action

  # Transform action code with source map information
  transformActionWithSourceMap: (action, rule, originalLocation) ->
    # Handle the special case where CoffeeScript grammar uses @1 and $1 in empty rules
    # These need to be replaced with default values FIRST, before any other processing
    if rule.rhs.length == 0
      # For empty rules, @1 and $1 should use default values
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
    rules = @prepareCompactProductions()

    # Generate unified states array with symbol 0 optimization
    states = @prepareUnifiedStates()

    {
      symbols: symbols
      terminals: terminals
      rules: rules  # Renamed from productions to rules
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

function getRule(ruleId) {
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

  # Determine terminals from symbols and rules (for language packs without explicit terminals)
  # This delegates to the shared utility in the universal parser
  determineTerminalsFromGrammar: (symbols, rules) ->
    UniversalParser = require('./parser.coffee')
    UniversalParser.determineTerminals(symbols, rules)

  # Generate compact rules map (rules__ = Map {3=>[0,1], 4=>[1,3,2],...})
  prepareCompactProductions: ->
    rules = []
    for rule, id in @rules
      lhsSymbol = @symbols.get(rule.lhs)
      continue unless lhsSymbol
      lhsId = lhsSymbol.id
      rhsLength = rule.rhs.length
      rules[id] = [lhsId, rhsLength]
    rules

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
      return if row then row[symbol] else undefined;
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
  # 15. FINAL STEPS
  # ============================================================================

  reportConflicts: ->
    return unless @conflicts.length > 0

    # Group conflicts by type
    srConflicts = @conflicts.filter (c) -> c.type == 'shift/reduce'
    rrConflicts = @conflicts.filter (c) -> c.type == 'reduce/reduce'

    resolvedSR = srConflicts.filter (c) -> c.resolved
    unresolvedSR = srConflicts.filter (c) -> not c.resolved

    # Show detailed analysis only in verbose mode or higher
    if @debugLevel >= VERBOSE
      console.log "\n=== DETAILED CONFLICT ANALYSIS ==="
      console.log "Total conflicts: #{@conflicts.length}"
      console.log "  Shift/Reduce: #{srConflicts.length} (#{resolvedSR.length} resolved, #{unresolvedSR.length} unresolved)"
      console.log "  Reduce/Reduce: #{rrConflicts.length} (all resolved by default)"
      console.log ""

      # Report unresolved conflicts first (most important)
      if unresolvedSR.length > 0
        console.log ""
        console.log "🚨 UNRESOLVED CONFLICTS (require attention):"
        console.log "=================================================="
        for conflict in unresolvedSR
          console.log conflict.explanation

      # Report resolved conflicts
      if resolvedSR.length > 0
        console.log ""
        console.log "✅ RESOLVED SHIFT/REDUCE CONFLICTS:"
        console.log "========================================"
        for conflict in resolvedSR
          console.log conflict.explanation

      # Report reduce/reduce conflicts
      if rrConflicts.length > 0
        console.log ""
        console.log "⚠️  REDUCE/REDUCE CONFLICTS:"
        console.log "=============================="
        for conflict in rrConflicts
          console.log conflict.explanation

    # Always show summary and recommendations (essential info)
    @reportConflictSummary(unresolvedSR.length, resolvedSR.length, rrConflicts.length)

  reportConflictSummary: (unresolved, resolved, reduceReduce) ->
    return unless @debugLevel >= NORMAL

    console.log ""
    console.log "📊 CONFLICT SUMMARY:"
    console.log "===================="
    console.log ""

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
    return unless @debugLevel >= NORMAL

    hitRateText = if @stats.closureCalls > 0
      hitRate = Math.round((@stats.cacheHits / @stats.closureCalls) * 100)
      "Cache hit rate: #{hitRate}%"
    else
      ""

    optimizationText = if @stats.optimizationTime > 0
      if @optimizedTable
        """Table optimization: #{@stats.optimizationTime}ms
        Optimization method: #{@optimizedTable.format}"""
      else
        """Table optimization: #{@stats.optimizationTime}ms
        Optimization: skipped (small grammar)"""
    else
      ""

    cacheSize = @coreCache.size + @closureCache.size

    console.log """

    📊 Performance Statistics:
    =========================
    Terminals: #{@tokens.size}
    Symbols: #{@symbols.size}
    Rules processed: #{@rules.length}
    States created: #{@states.length}
    Closure computations: #{@stats.closureCalls}
    Cache hits: #{@stats.cacheHits}
    #{hitRateText}
    #{optimizationText}
    Cache entries: #{cacheSize}
    """

  # ============================================================================
  # 19. UTILITY FUNCTIONS
  # ============================================================================

  # Interactive debugging functions (called by CLI)
  exploreState: (stateId) ->
    return "Invalid state ID" unless stateId >= 0 and stateId < @states.length

    state = @states[stateId]
    console.log "\n🔍 EXPLORING STATE #{stateId}"
    console.log "=============================="
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
    console.log "=============================="
    console.log "Rule: #{rule.lhs} → #{rule.rhs.join(' ')}"
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
    console.log "==================================="
    console.log conflict.explanation

    # Show the state causing the conflict
    console.log "\nState #{conflict.state} details:"
    @exploreState(conflict.state)

  # Statistics and utility functions (called by CLI)
  getStatistics: ->
    stats = {
      rules: @rules.length
      states: @states.length
      transitions: 0
      terminals: [...@symbols.values()].filter((s) -> s.isTerminal).length
      nonterminals: [...@symbols.values()].filter((s) -> !s.isTerminal).length
      conflicts: @conflicts.length
      startSymbol: @start
      tableSize: 0
      density: 0
      compression: @optimizedTable?.format || 'none'
    }

    # Count transitions
    for state in @states
      stats.transitions += state.transitions.size

    # Calculate table statistics
    totalCells = 0
    filledCells = 0
    for state in @states
      if @table[state.id]
        for symbol, action of @table[state.id]
          totalCells++
          if action?
            filledCells++
            stats.tableSize++
      totalCells += @symbols.size

    stats.density = Math.round((filledCells / totalCells) * 100) if totalCells > 0
    stats

  # Unified statistics display function
  displayStats: ->
    return unless @debugLevel >= NORMAL

    # ANSI color codes
    RESET = '\x1b[0m'
    BOLD = '\x1b[1m'
    CYAN = '\x1b[36m'
    YELLOW = '\x1b[33m'
    GREEN = '\x1b[32m'
    RED = '\x1b[31m'
    GRAY = '\x1b[90m'

    # Box drawing
    topBox    = '╔' + '═'.repeat(46) + '╗'
    midBox    = '╟' + '─'.repeat(46) + '╢'
    botBox    = '╚' + '═'.repeat(46) + '╝'
    sectionTop= '┌' + '─'.repeat(44) + '┐'
    sectionBot= '└' + '─'.repeat(44) + '┘'

    # Get comprehensive statistics
    stats = @getStatistics()

    # Calculate additional metrics
    hitRate = if @stats.closureCalls > 0
      Math.round((@stats.cacheHits / @stats.closureCalls) * 100)
    else
      0

    cacheSize = @coreCache?.size + @closureCache?.size || 0
    compressionRatio = if @optimizedTable?.compressionRatio
      Math.round(@optimizedTable.compressionRatio * 100)
    else
      null

    # Conflict breakdown
    shiftReduce = @conflicts.filter((c) -> c.type == 'shift/reduce').length
    reduceReduce = @conflicts.filter((c) -> c.type == 'reduce/reduce').length
    warning = (msg) -> RED + BOLD + msg + RESET
    number = (n) -> YELLOW + BOLD + n + RESET
    label  = (s) -> CYAN + BOLD + s + RESET

    console.log """
#{topBox}
║          #{label('📊  COMPREHENSIVE STATISTICS')}          ║
#{botBox}

#{sectionTop}
│ #{label('GRAMMAR ANALYSIS').padEnd(42)} │
#{midBox}
│ Non-terminals:   #{number(stats.nonterminals).padEnd(28)}│
│ Terminals:       #{number(stats.terminals).padEnd(28)}│
│ Total symbols:   #{number(stats.symbols).padEnd(28)}│
│ Start symbol:    #{GREEN + stats.startSymbol + RESET}".padEnd(44) + '│'
│ Source rules:    #{number(@stats.sourceRules).padEnd(28)}│
│ Expanded rules:  #{number(@stats.expandedRules).padEnd(28)}│
│ Error recovery:  #{number(@stats.errorRecoveryRules).padEnd(28)}│
│ Augmented start: #{number(@stats.augmentedRules).padEnd(28)}│
│ Total rules:     #{number(stats.rules).padEnd(28)}│
#{sectionBot}

#{sectionTop}
│ #{label('STATE MACHINE').padEnd(42)} │
#{midBox}
│ States:            #{number(stats.states).padEnd(24)}│
│ Transitions:       #{number(stats.transitions).padEnd(24)}│
│ Inadequate states: #{number(@inadequateStates.length).padEnd(24)}│
│ Conflicts:         #{number(stats.conflicts).padEnd(24)}│
│  • Shift/Reduce:   #{number(shiftReduce).padEnd(20)}│
│  • Reduce/Reduce:  #{number(reduceReduce).padEnd(20)}│
#{sectionBot}

#{sectionTop}
│ #{label('TABLE & OUTPUT').padEnd(42)} │
#{midBox}
│ Table entries:     #{number(stats.tableSize).padEnd(24)}│
│ Table density:     #{number(stats.density) + '%'.padEnd(23)}│
│ Compression:       #{GREEN + stats.compression + RESET}".padEnd(44) + '│'
#{if compressionRatio? then "│ Compression ratio: #{number(compressionRatio) + '%'.padEnd(23)}│" else ''}
#{sectionBot}

#{sectionTop}
│ #{label('PERFORMANCE').padEnd(42)} │
#{midBox}
│ Closure calls:     #{number(@stats.closureCalls).padEnd(24)}│
│ Cache hits:        #{number(@stats.cacheHits).padEnd(24)}│
│ Cache hit rate:    #{number(hitRate) + '%'.padEnd(23)}│
│ Cache entries:     #{number(cacheSize).padEnd(24)}│
#{if @stats.optimizationTime > 0 then "│ Optimization time: #{number(@stats.optimizationTime) + 'ms'.padEnd(21)}│" else ''}
#{sectionBot}
"""

  optimizeTables: ->
    console.log "\n🔧 Running table optimization..."

    # Run the smart optimization
    @smartOptimizeTable()

    console.log "✅ Table optimization complete!"

    # Report results
    if @optimizedTable
      console.log "  Format: #{@optimizedTable.format}"
      if @optimizedTable.compressionRatio
        console.log "  Compression ratio: #{Math.round(@optimizedTable.compressionRatio * 100)}%"
    else
      console.log "  Optimization skipped (table too small or no benefit)"

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

# ============================================================================
# EXPORT GENERATOR CLASS AND DEBUG CONSTANTS
# ============================================================================


# CommonJS exports for maximum compatibility
module.exports = { Generator, SILENT, NORMAL, VERBOSE, DEBUG }

# ============================================================================
# COMPREHENSIVE CLI INTERFACE
# ============================================================================

if (typeof module != 'undefined' and not module.parent) or (typeof process != 'undefined' and process.argv?[1]?.includes('rip.coffee'))
  # CLI Implementation
  fs = require 'fs'
  path = require 'path'

  # CLI Configuration and Options
  class CLIOptions
    constructor: ->
      @inputFile = null
      @outputFile = null
      @debugLevel = 1  # Default to NORMAL
      @showStats = false
      @showStates = false
      @showConflicts = false
      @showGrammar = false
      @generateReport = false
      @reportFile = null
      @optimize = 'auto'  # auto, on, off
      @compression = 'auto'  # auto, coo, csr, dictionary, off
      @minimization = true
      @sourceMap = false
      @sourceMapFile = null
      @format = 'commonjs'  # commonjs, es6, umd
      @namespace = 'parser'
      @performance = false
      @interactive = false
      @help = false
      @version = false
      @production = false  # Generate production-ready parser (no console output)
      @silentParser = false  # Completely silent parser (all console functions as no-ops)
      @logLevel = 'normal'  # normal, minimal, silent

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
          options.debugLevel = VERBOSE
        when '-d', '--debug'
          options.debugLevel = DEBUG
        when '-q', '--quiet'
          options.debugLevel = SILENT
        when '--debug-level'
          if args[i + 1] and not args[i + 1].startsWith('-')
            level = parseInt(args[++i], 10)
            if level >= 0 and level <= 3
              options.debugLevel = level
            else
              console.error "Error: Invalid debug level '#{level}'. Use 0-3."
              process.exit(1)
          else
            console.error "Error: --debug-level requires a value (0-3)"
            process.exit(1)
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
    Rip - Advanced LALR(1) Parser Generator

    USAGE:
      rip [OPTIONS] GRAMMAR_FILE

    OPTIONS:
      -h, --help              Show this help message
      -v, --version           Show version information
      -V, --verbose           Enable verbose output (same as --debug-level 2)
      -d, --debug             Enable debug mode (same as --debug-level 3)
      -q, --quiet             Suppress all output except errors (same as --debug-level 0)
      --debug-level LEVEL     Set debug level: 0=silent, 1=normal, 2=verbose, 3=debug
      -o, --output FILE       Output file (default: stdout)

    ANALYSIS:
      --stats                 Show detailed statistics
      --states                Show state machine information
      --conflicts             Show shift/reduce conflicts analysis
      --grammar               Show processed grammar information
      --report [FILE]         Generate comprehensive analysis report
      --performance           Show performance metrics and timing

    OPTIMIZATION:
      --optimize [auto|on|off]    Control table optimization (default: auto)
      --compression [METHOD]      Compression method: auto, coo, csr, dictionary, off
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
      rip grammar.coffee -o parser.js

      # Verbose generation with optimization
      rip grammar.coffee --verbose --optimize on --stats

      # Generate comprehensive report
      rip grammar.coffee --report analysis.md --conflicts --states

      # Performance analysis
      rip grammar.coffee --performance --compression csr

      # Interactive exploration
      rip grammar.coffee --interactive

      # Debug mode with source maps
      rip grammar.coffee --debug --source-map parser.js.map

      # Production-ready parser (no console output)
      rip grammar.coffee --production -o parser.js

      # Completely silent parser
      rip grammar.coffee --silent-parser -o parser.js

      # Minimal console output
      rip grammar.coffee --log-level minimal -o parser.js
    """

  # Show version information
  showVersion = ->
    console.log """
    Rip 1.0.0
    Advanced LALR(1) Parser Generator with Comprehensive Optimizations

    Features:
    • Correct LALR(1) algorithm implementation
    • State minimization and table optimization
    • Multiple compression algorithms (COO, CSR, Dictionary)
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
      if options.debugLevel == SILENT
        console.log = -> # Suppress normal output
      else if options.debugLevel >= VERBOSE
        console.log "🚀 Rip - Advanced LALR(1) Parser Generator"
        console.log "📁 Input: #{options.inputFile}"

      # Read and parse grammar file
      grammarSource = fs.readFileSync(options.inputFile, 'utf8')
      grammar = parseGrammarFile(grammarSource, options)

      # Create generator with grammar data and configuration
      generator = new Generator(grammar, {debugLevel: options.debugLevel})
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
      if options.debugLevel >= DEBUG
        console.error error.stack
      process.exit(1)

  # Parse grammar file based on format
  parseGrammarFile = (source, options) ->
    try
      # Try to require the grammar file directly (works with coffee executable)
      if options.inputFile.endsWith('.coffee') or options.inputFile.endsWith('.js')
        # CoffeeScript/JavaScript grammar file - require directly
        path = require('path')
        absolutePath = path.resolve(options.inputFile)
        grammar = require(absolutePath)
      else
        # Try JSON format
        grammar = JSON.parse(source)

      if options.debugLevel >= VERBOSE
        console.log """
        ✅ Grammar file parsed successfully
        📊 Productions: #{Object.keys(grammar.grammar || {}).length}
        🎯 Start symbol: #{grammar.start || 'unknown'}
        """

      grammar

    catch error
      throw new Error("Failed to parse grammar file: #{error.message}")

  # Configure generator with CLI options
  configureGenerator = (generator, options) ->
    # Set optimization configuration
    generator.optimizationConfig =
      enabled:          options.optimize         == 'on'
      auto:             options.optimize         == 'auto'
      skipIfSmall:      options.optimize         == 'auto'
      minStatesForAuto: 20
      compression:      options.compression
      minimization:     options.minimization
      performance:      options.performance

    generator.debugConfig =
      enabled:        options.debugLevel        >= DEBUG
      showStates:     options.showStates
      showConflicts:  options.showConflicts
      showGrammar:    options.showGrammar
      interactive:    options.interactive

    generator.consoleConfig =
      production:    options.production
      silentParser:  options.silentParser
      logLevel:      options.logLevel

    if options.debugLevel >= VERBOSE
      console.log """
      ⚙️  Configuration:
         Optimization: #{options.optimize}
         Compression: #{options.compression}
         Minimization: #{options.minimization}
         Source Maps: #{options.sourceMap}
      """

  # Generate parser with configured options
  generateParser = (generator, grammar, options) ->
    if options.debugLevel >= VERBOSE
      console.log "\n🔧 Generating parser..."

    # Use the new compile method for code generation
    parser = generator.compile({
      format: options.format
      namespace: options.namespace
      sourceMap: options.sourceMap
      sourceMapFile: options.sourceMapFile
      performance: options.performance
      production: options.production
      silentParser: options.silentParser
      logLevel: options.logLevel
      compact: options.compact
    })

    if options.debugLevel >= VERBOSE
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
      if options.debugLevel >= VERBOSE
        console.log """
        📝 Parser written to: #{options.outputFile}
        📏 Size: #{content.length} characters
        ⏱️  Generation time: #{generationTime}ms
        """
    else
      # No output file specified - skip JS output for analysis mode
      if options.debugLevel >= VERBOSE
        console.log """
        ✨ Parser generated (#{content.length} characters) - use -o filename to save
        ⏱️  Generation time: #{generationTime}ms
        """

    # Write source map if generated
    if sourceMap and options.sourceMapFile
      fs.writeFileSync(options.sourceMapFile, JSON.stringify(sourceMap, null, 2), 'utf8')
      if options.debugLevel >= VERBOSE
        console.log "🗺️  Source map written to: #{options.sourceMapFile}"

  # Generate comprehensive reports
  generateReports = (generator, options) ->
    reports = []

    if options.showStats
      # Use the new unified stats display
      generator.displayStats()

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
    - Non-terminals: #{stats.nonterminals}
    - Terminals: #{stats.terminals}
    - Rules: #{stats.rules}
    - Start symbol: #{stats.startSymbol}

    **State Machine:**
    - States: #{stats.states}
    - Transitions: #{stats.transitions}
    - Conflicts: #{stats.conflicts}

    **Table Properties:**
    - Density: #{stats.density}%
    - Size: #{stats.tableSize} entries
    - Compression: #{stats.compression}
    """

  # Generate states report
  generateStatesReport = (generator) ->
    """
    ## State Machine Analysis

    **State Details:**
    #{generator.states.map((state, i) -> "State #{i}: #{state.items.length} items").join('\n')}

    **Transitions:**
    #{generator.states.map((state, i) ->
      transitions = [...state.transitions.entries()].map(([sym, target]) -> "#{sym} -> #{target.id}")
      "State #{i}: #{transitions.join(', ')}"
    ).join('\n')}
    """

  # Generate conflicts report
  generateConflictsReport = (generator) ->
    if generator.conflicts.length == 0
      return "## Conflicts\n\n✅ No conflicts found!"

    """
    ## Conflict Analysis

    **Summary:**
    - Total conflicts: #{generator.conflicts.length}
    - Shift/Reduce: #{generator.conflicts.filter(c -> c.type == 'shift/reduce').length}
    - Reduce/Reduce: #{generator.conflicts.filter(c -> c.type == 'reduce/reduce').length}

    **Detailed Analysis:**
    #{generator.conflicts.map((conflict, i) ->
      "#{i+1}. #{conflict.type} conflict in state #{conflict.state}\n   #{conflict.explanation}"
    ).join('\n')}
    """

  # Generate grammar report
  generateGrammarReport = (generator) ->
    """
    ## Grammar Analysis

    **Production Rules:**
    #{generator.rules.map((rule, i) ->
      "#{i}: #{rule.lhs} → #{rule.rhs.join(' ')}"
    ).join('\n')}

    **Symbol Information:**
    #{[...generator.symbols.entries()].map(([name, symbol]) ->
      type = if symbol.isTerminal then 'T' else 'NT'
      "#{name} (#{type}): nullable=#{symbol.nullable}, first={#{[...symbol.first].join(',')}}"
    ).join('\n')}
    """

  # Generate performance report
  generatePerformanceReport = (generator) ->
    perf = generator.stats

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
      prompt: 'rip> '
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
        generator.displayStats()

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

    # Run the CLI only if this is the main module (CommonJS) or if we're in Node.js
  if (typeof module != 'undefined' and not module.parent) or (typeof process != 'undefined' and process.argv?[1]?.includes('rip.coffee'))
    main()
