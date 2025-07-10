#!/usr/bin/env coffee

# ==============================================================================
# rip-parser: A modern, LALR(1) parser generator for the rip ecosystem
#
# Author: Steve Shreeve <steve.shreeve@gmail.com> and Claude 4 Opus
#  Stats: July 9, 2025 (version 0.2.0) MIT License
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
    @onDemandLookahead = opts.onDemandLookahead ? true

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

  # Work starts here
  processGrammar: ({ grammar, operators, start, tokens }) ->
    throw new Error('Invalid language format') unless grammar

    # Convert tokens to a set
    @tokens = new Set(tokens.trim().split(/\s+/))

    # Create special symbols (starts with id = 0, 1, 2)
    @getSymbol '$accept'
    @getSymbol '$end' , true
    @getSymbol 'error', true; @tokens.add('error')

    # Process all rules
    for nonterminal, productions of grammar
      for production in productions
        [pattern, action, options] = production

        # Parse the pattern into RHS symbols
        rhs = if pattern then pattern.split(/\s+/) else []

        # Create the rule
        rule = new Rule(nonterminal, rhs, action)
        rule.precedence = options?.prec

        @rules.push(rule)

        # Track nonterminal
        @getSymbol(nonterminal, false)

        # Track terminals in RHS
        for symbol in rhs
          @getSymbol(symbol)

    # Set start symbol
    @start = switch
      when grammar[start ] then start
      when grammar['Root'] then 'Root'
      else Object.keys(grammar)[0]
    throw new Error('Start symbol not found') unless @start

    # Add augmented start rule: $accept → start $end
    @rules.push(new Rule('$accept', [@start, '$end']))

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
    # Create initial state with augmented start rule
    startState = new State()
    startItem = new Item(@rules[@rules.length - 1], 0, new Set(['$end']))
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

  # Compute closure of a state (LR(0) - no lookaheads yet)
  closure: (state) ->
    changed = true

    while changed
      changed = false

      # Process all current items (use slice to avoid modification during iteration)
      for item in state.items.slice()
        continue if item.isComplete()

        nextSym = item.nextSymbol()
        continue if @getSymbol(nextSym).isTerminal

        # Add items for all productions of nextSym
        for rule in @rules
          continue unless rule.lhs is nextSym

          # For LR(0) construction, use empty lookahead
          newItem = new Item(rule, 0, new Set())
          # addItem now handles merging automatically
          if state.addItem(newItem)
            changed = true

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
    # Use the core keys from the coreMap for consistent hashing
    coreKeys = Array.from(state.coreMap.keys()).sort()
    coreKeys.join('|')

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

  # Closure with lookahead computation
  closureWithLookahead: (state) ->
    changed = true

    while changed
      changed = false

      for item in state.items.slice()
        continue if item.isComplete()

        nextSym = item.nextSymbol()
        continue if @getSymbol(nextSym).isTerminal

        # Compute lookahead for new items
        # For A → α • B β, la
        # Add B → • γ with FIRST(β la)
        beta = item.rule.rhs.slice(item.dot + 1)

        for rule in @rules
          continue unless rule.lhs is nextSym

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
            changed = true

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
              else if resolved == 'shift'
                # keep existing shift (default)
              else
                # unresolved conflict
                conflicts.sr++
                state.inadequate = true
                @inadequateStates.push(state) unless @inadequateStates.includes(state)

                # NOTE: This is easy to add
                # ----
                # # Add conflict details
                # conflict = {
                #   type: 'shift/reduce',
                #   state: state.id,
                #   lookahead: la,
                #   shiftTo: existing.state,
                #   reduceBy: item.rule,
                #   explanation: @explainConflict(item, existing, la)
                # }
                # @conflicts.push(conflict)
                #
                # NOTE: It could be paired with this
                # ----
                # explainConflict: (reduceItem, shiftAction, lookahead) ->
                #   """
                #   Shift/Reduce conflict in state #{state.id}:
                #
                #   When seeing '#{lookahead}', the parser could either:
                #   1. Shift to state #{shiftAction.state}
                #   2. Reduce using: #{reduceItem.rule.lhs} → #{reduceItem.rule.rhs.join(' ')}
                #
                #   Example input that causes this: ...
                #   """
                #
                # NOTE: Example output
                # ----
                # Warning: Shift/Reduce conflict in state 15:
                #
                # When parsing: "if (x) if (y) foo() else bar()"
                # The 'else' could belong to either 'if'
                #
                # Conflict resolution: Shifting (else binds to nearest if)
                # To fix: Use explicit braces or precedence declarations
                #
                # NOTE: Another example
                # ----
                # reportDetailedConflicts: ->
                #   console.log "\n=== DETAILED CONFLICT ANALYSIS ==="
                #
                #   for conflict in @conflicts
                #     console.log conflict.explanation
                #
                #     # Show the grammar rules involved
                #     console.log "\nProductions that cause this conflict:"
                #     for rule in @findConflictingRules(conflict)
                #       console.log "  #{rule.lhs} → #{rule.rhs.join(' ')}"
                #
                #     # Suggest fixes
                #     console.log "\nPossible solutions:"
                #     console.log "  - Add precedence declarations"
                #     console.log "  - Rewrite grammar to be unambiguous"
                #     console.log "  - Accept the default resolution"

            else
              # Reduce/reduce conflict - use first rule (earliest in grammar)
              if existing.type is 'reduce'
                existingRuleId = existing.rule
              else
                # Unexpected: existing action is not shift or reduce
                console.warn "Warning: Unexpected existing action type in reduce/reduce conflict: #{existing.type || 'undefined'}"
                existingRuleId = existing.rule || existing

              # Compare rule IDs and keep the earlier rule (lower ID)
              if item.rule.id < existingRuleId
                table[state.id][la] = { type: 'reduce', rule: item.rule.id }
              # else keep the existing action (it has a lower rule ID)

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

  # ============================================================================
  # Code Generation
  # ============================================================================

  # Generate parser code
  generate: (options = {}) ->
    @processGrammar(options)

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
    @computeDefaultActions()

    # Now generate the parser code
    @generateCommonJS(options)

  # Build performAction from grammar
  buildPerformAction: ->
    actions = []

    # Process each rule and its action
    # Parameter mapping for rule A → B C D (length=3):
    # $1 → B → $$[$0-2], $2 → C → $$[$0-1], $3 → D → $$[$0]
    # @1 → B → _$[_$.length-1-2], @2 → C → _$[_$.length-1-1], @3 → D → _$[_$.length-1]
    for rule, i in @rules
      action = rule.action || 'this.$ = $$[$0];'

      # If action is a function, convert to string
      if typeof action is 'function'
        action = action.toString()
        # Extract the function body (everything after the arrow)
        match = action.match(/^(?:function\s*\([^)]*\)|[^=]+=>)\s*\{?\s*([\s\S]*?)\s*\}?\s*$/)
        if match
          action = match[1]
        else
          # For simple arrow functions like -> $1 + $3
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
      action = action.replace /\$0/g, '$0'

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

      # Add case
      actions.push "      case #{i}:"
      actions.push "        var $0 = $$.length - 1;"
      actions.push "        #{action}"
      actions.push "        break;"

    """performAction: function(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
      switch (yystate) {
#{actions.join('\n')}
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
    # Prepare data structures
    table   = @prepareTable()
    rules   = @prepareRules()
    symbols = @prepareSymbols()
    tokens  = @prepareTokens()

    # Get semantic actions from grammar
    performAction = options.performAction || @buildPerformAction()

    """
/* Generated by rison 1.0.0 */

const parser = (() => {
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
  # Debugging
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
    return unless @inadequateStates.length > 0

    console.log "\n=== GRAMMAR CONFLICTS ==="
    for state in @inadequateStates
      console.log "\nState #{state.id} has conflicts:"

      # Show the conflicting items
      for item in state.items
        console.log "  #{item.toString()}"

      # Show the conflict details
      # (would need to track these during table building)

# ==[ Export ]===============================================================

module.exports = { Generator }

if !module.parent
  console.log "Add CLI here..."
