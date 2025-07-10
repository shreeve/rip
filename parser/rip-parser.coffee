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
    unreachable = @findUnreachableSymbols()
    return if unreachable.length == 0

    console.warn "\n⚠️  Found unreachable non-terminals: #{unreachable.join(', ')}"

    # Remove rules with unreachable LHS
    @rules = @rules.filter (rule) ->
      if rule.lhs in unreachable
        console.warn "  Removing rule: #{rule.lhs} → #{rule.rhs.join(' ')}"
        false
      else
        true

    # Remove unreachable symbols
    for symbol in unreachable
      @symbols.delete(symbol)

    # Reset rule IDs
    Rule.idno = 0
    for rule in @rules
      rule.id = Rule.idno++

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
    unproductive = @findUnproductiveSymbols()
    return if unproductive.length == 0

    console.warn "\n⚠️  Found unproductive non-terminals: #{unproductive.join(', ')}"

    # Remove rules containing unproductive symbols
    @rules = @rules.filter (rule) ->
      # Remove if LHS is unproductive
      if rule.lhs in unproductive
        console.warn "  Removing unproductive rule: #{rule.lhs} → #{rule.rhs.join(' ')}"
        return false

      # Remove if any RHS symbol is unproductive
      for symbol in rule.rhs
        if symbol in unproductive
          console.warn "  Removing rule with unproductive RHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
          return false

      true

    # Remove unproductive symbols
    for symbol in unproductive
      @symbols.delete(symbol)

    # Reset rule IDs
    Rule.idno = 0
    for rule in @rules
      rule.id = Rule.idno++

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
    # Check all RHS symbols are defined
    for rule in @rules
      for symbol in rule.rhs
        unless @symbols.has(symbol)
          throw new Error("Undefined symbol '#{symbol}' in rule: #{rule.lhs} → #{rule.rhs.join(' ')}")

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

        for rhsName in rule.rhs
          rhsSymbol = @getSymbol(rhsName)

          # Add First(rhsSymbol) to First(lhs)
          for item from rhsSymbol.first
            unless lhsSymbol.first.has(item)
              lhsSymbol.first.add(item)
              changed = true

          # If rhsSymbol is not nullable, stop
          break unless rhsSymbol.nullable

  # Compute FOLLOW sets
  computeFollow: ->
    # Follow(start) includes EOF
    @getSymbol(@start).follow.add('$end')

    changed = true
    while changed
      changed = false
      for rule in @rules
        follow = new Set(@getSymbol(rule.lhs).follow)

        # Process RHS from right to left
        for i in [rule.rhs.length - 1..0] by -1
          rhsName = rule.rhs[i]
          rhsSymbol = @getSymbol(rhsName)

          # Add follow to Follow(rhsSymbol)
          for item from follow
            unless rhsSymbol.follow.has(item)
              rhsSymbol.follow.add(item)
              changed = true

          # Update follow for next iteration
          if rhsSymbol.nullable
            # Add First(rhsSymbol) to follow
            for item from rhsSymbol.first
              follow.add(item)
          else
            # Replace follow with First(rhsSymbol)
            follow = new Set(rhsSymbol.first)

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

    for state in @states
      # If all actions in a state are reduces by the same rule
      reductions = []
      for item in state.items
        if item.isComplete()
          reductions.push(item.rule.id)

      if reductions.length > 0 and new Set(reductions).size == 1
        # Can use default reduction
        @defaultActions[state.id] = [2, reductions[0]]

  # ============================================================================
  # Code Generation
  # ============================================================================

  # Generate parser code
  generate: (options = {}) ->
    @processGrammar(options)
    @eliminateUnreachable()
    @eliminateUnproductive()
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
