#!/usr/bin/env coffee

# ==============================================================================
# rip-jison - CoffeeScript based LALR(1) parser generator based on Jison
# ==============================================================================

# Grammar rules with handles and precedence
class Rule
  constructor: (nonterminal, handle, id) ->
    @nonterminal      = nonterminal
    @handle     = handle
    @nullable   = false
    @id         = id
    @first      = []
    @precedence = 0

  toString: ->
    "#{@nonterminal} -> #{@handle.join(' ')}"

# Grammar nonterminals with rules, first/follow sets
class Nonterminal
  constructor: (nonterminal) ->
    @nonterminal    = nonterminal
    @rules    = []
    @first    = []
    @follows  = []
    @nullable = false

  toString: -> """
    #{@nonterminal}
    #{if @nullable then 'nullable' else 'not nullable'}
    Firsts:  #{@first  .join(', ')}
    Follows: #{@follows.join(', ')}
    Rules:
        #{@rules.join('\n  ')}
    """

# Represents LR items (rules with dot positions)
class Item
  constructor: (rule, dot, f, predecessor) ->
    @rule        = rule
    @dotPosition = dot or 0
    @follows     = f or []
    @predecessor = predecessor
    @id          = parseInt("#{rule.id}a#{@dotPosition}", 36)
    @markedSymbol = @rule.handle[@dotPosition]

  remainingHandle: -> @rule.handle.slice(@dotPosition + 1)

  eq: (e) -> e.id is @id

  handleToString: ->
    handle = @rule.handle.slice(0)
    handle[@dotPosition] = ".#{handle[@dotPosition] or ''}"
    handle.join(' ')

  toString: ->
    temp = @rule.handle.slice(0)
    temp[@dotPosition] = ".#{temp[@dotPosition] or ''}"
    look = " #lookaheads= #{@follows.join(' ')}" if @follows.length
    "#{@rule.nonterminal} -> #{temp.join(' ')}#{look}"

# Manages set of LR items with deduplication
class ItemSet
  constructor: ->
    @map        = new Map() # id -> item
    @reductions = []
    @handles    = {}
    @edges      = {}
    @shifts     = false
    @inadequate = false

  contains: (item) -> @map.has(item.id)
  forEach: (fn) -> @map.forEach (item, key) => fn(item)
  isEmpty: -> @map.size is 0
  items: -> Array.from @map.values()
  toString: -> @items().toString()

  concat: (set) ->
    # Handle both ItemSet and array inputs
    items = if set.items then set.items() else set
    @push(item) for item in items
    @

  push: (item) ->
    @map.set(item.id, item) unless @map.has(item.id)
    @map.size

  valueOf: ->
    # Memoized string representation for state deduplication
    v = Array.from(@map.keys()).sort().join('|')
    @valueOf = -> v
    v

# ==[ Utility Functions ]=======================================================

# Merge arrays without duplicates
mergeArrays = (a, b) ->
  seen = {}
  seen[item] = true for item in a
  a.push(item) for item in b when not seen[item]
  a

# ==[ Grammar Helpers ]=========================================================

# Defensive getter for nonterminals
getNonterminal = (nonterminals, s) ->
  nonterminals[s] ?= new Nonterminal(s)

# Set precedence and associativity of operators
processOperators = (ops) ->
  return {} unless ops
  operators = {}
  for group, i in ops
    assoc = group[0]
    for op in group[1..]
      operators[op] = { precedence: i + 1, assoc }
  operators

# ==[ Parser Helpers ]==========================================================

# Find default actions
findDefaults = (states) ->
  defaults = {}
  states.forEach (state, k) ->
    i = 0
    for act of state
      if {}.hasOwnProperty.call(state, act) then i++
    if i is 1 and state[act][0] is 2
      # only one action in state and it's a reduction
      defaults[k] = state[act]
  defaults

# Resolve conflicts of alternatives
resolveConflict = (rule, op, reduce, shift) ->
  sln = { rule: rule, operator: op, r: reduce, s: shift }
  s = 1 # shift
  r = 2 # reduce
  a = 3 # accept

  if shift[0] is r
    sln.msg = "Resolve R/R conflict (use first rule declared in grammar.)"
    sln.action = if shift[1] < reduce[1] then shift else reduce
    if shift[1] isnt reduce[1] then sln.bydefault = true
    return sln

  # Special handling for empty rules (epsilon rules)
  if rule.handle.length is 0 or (rule.handle.length is 1 and rule.handle[0] is '')
    sln.msg = "Resolve S/R conflict for empty rule (reduce by default.)"
    sln.bydefault = true
    sln.action = reduce
    return sln

  if rule.precedence is 0 or not op
    sln.msg = "Resolve S/R conflict (shift by default.)"
    sln.bydefault = true
    sln.action = shift
  else if rule.precedence < op.precedence
    sln.msg = "Resolve S/R conflict (shift for higher precedent operator.)"
    sln.action = shift
  else if rule.precedence is op.precedence
    if op.assoc is "right"
      sln.msg = "Resolve S/R conflict (shift for right associative operator.)"
      sln.action = shift
    else if op.assoc is "left"
      sln.msg = "Resolve S/R conflict (reduce for left associative operator.)"
      sln.action = reduce
    else if op.assoc is "nonassoc"
      sln.msg = "Resolve S/R conflict (no action for non-associative operator.)"
      sln.action = 0 # NONASSOC
  else
    sln.msg = "Resolve conflict (reduce for higher precedent rule.)"
    sln.action = reduce

  sln

# ==[ Main LALR(1) Parser Generator Class  ]====================================

class Generator

  constructor: (grammar, opt) ->
    @conflicts   = 0
    @operators   = {}
    @options     = Object.assign {}, grammar.options, opt
    @parseParams = grammar.parseParams
    @rules       = []
    @resolutions = []
    @tokens      = {}
    @yy          = {} # accessed as yy free variable in the parser/lexer actions

    # source included in semantic action execution scope
    if grammar.actionInclude
      if typeof grammar.actionInclude is 'function'
        grammar.actionInclude = String(grammar.actionInclude)
          .replace(/^function \(\) \{/, '')
          .replace(/\}\s*$/, '')
      @actionInclude = grammar.actionInclude
    @moduleInclude = grammar.moduleInclude or ''

    @processGrammar(grammar)

    @type    = "LALR(1)"
    options  = opt or {}

    @states  = @buildLRStates()

    @tokens_ = {}
    @derived = {}
    @nonterminals  = {}
    @inadequateStates = []
    @onDemandLookahead = options.onDemandLookahead or false

    @buildGrammar()
    @computeLookaheads()
    @mergeLookaheads()

    @table = @buildParseTable(@states)
    @defaultActions = findDefaults(@table)

  processGrammar: (grammar) ->
    bnf    = grammar.bnf
    tokens = grammar.tokens
    nonterminals = @nonterminals = {}
    rules  = @rules

    if tokens
      if typeof tokens is 'string'
        tokens = tokens.trim().split(' ')
      else
        tokens = tokens.slice(0)

    symbols = @symbols = []

    # calculate precedence of operators
    operators = @operators = processOperators(grammar.operators)

    # build rules from cfg
    @buildRules(bnf, rules, nonterminals, symbols, operators)

    # augment the grammar
    @addAcceptRule(grammar)

  addAcceptRule: (grammar) ->
    if @rules.length is 0
      @error "Grammar error: must have at least one rule."

    # starting nonterminal, defaults to first nonterminal defined
    @startNonterminal = grammar.start or @rules[0].nonterminal
    unless @nonterminals[@startNonterminal]
      @error "Grammar error: starting nonterminal not found."
    @EOF = "$end"

    # augment the grammar
    acceptRule = new Rule('$accept', [@startNonterminal, '$end'], 0)
    @rules.unshift(acceptRule)

    # prepend parser tokens
    @symbols.unshift("$accept", @EOF)
    @symbols_[@EOF] = 1
    @tokens.unshift(@EOF)

    @nonterminals.$accept = new Nonterminal("$accept")
    @nonterminals.$accept.rules.push(acceptRule)

    # add follow $ to start nonterminal
    getNonterminal(@nonterminals, @startNonterminal).follows.push(@EOF)

  # ==[ Grammar Processing ]====================================================

  buildRules: (bnf, rules, nonterminals, symbols, operators) ->
    actions = [
      '/* this == yyval */'
      @actionInclude or ''
      'var $0 = $$.length - 1;'
      'switch (yystate) {'
    ]
    actionGroups = {}
    rules_       = [0, 0] # Flat array: [nonterminal_id, handle_length, ...]
    symbols_     = {}
    symbolId     = 1

    addSymbol = (s) ->
      if s and not symbols_[s]
        symbols_[s] = ++symbolId
        symbols.push(s)

    # Strip alias annotations from symbols (e.g., id[alias] -> id)
    stripAliases = (str) ->
      str.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '')

    # add error symbol; will be third symbol, or "2" ($accept, $end, error)
    addSymbol("error")

    buildRule = (handle) ->
      if handle.constructor is Array
        rhs = if typeof handle[0] is 'string'
          handle[0].trim().split(' ')
        else
          handle[0].slice(0)

        for i in [0...rhs.length]
          unless symbols_[rhs[i]]
            addSymbol(rhs[i])

        if typeof handle[1] is 'string' or handle.length is 3

          # semantic action specified
          label = "case #{rules.length + 1}:"
          action = handle[1]

          # replace named semantic values ($nonterminal)
          if action.match(/[$@][a-zA-Z][a-zA-Z0-9_]*/)
            count = {}
            names = {}
            for i in [0...rhs.length]
              # check for aliased names, e.g., id[alias]
              rhs_i = rhs[i].match(/\[[a-zA-Z][a-zA-Z0-9_-]*\]/)
              if rhs_i
                rhs_i = rhs_i[0].substr(1, rhs_i[0].length - 2)
                rhs[i] = rhs[i].substr(0, rhs[i].indexOf('['))
              else
                rhs_i = rhs[i]

              if names[rhs_i]
                names[rhs_i + (++count[rhs_i])] = i + 1
              else
                names[rhs_i] = i + 1
                names[rhs_i + "1"] = i + 1
                count[rhs_i] = 1

            action = action
              .replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, (s, n) -> if names[n]? then "$#{names[n]}" else s)
              .replace( /@([a-zA-Z][a-zA-Z0-9_]*)/g, (s, n) -> if names[n]? then "@#{names[n]}" else s)

          action = action

            # replace references to $$ with this.$, and @$ with this._$
            .replace(/([^'"])\$\$|^\$\$/g, '$1this.$').replace(/@[0$]/g, "this._$")

            # replace semantic value references ($n) with stack value (stack[n])
            .replace(/\$(-?\d+)/g, (_, n) -> "$$[$0#{parseInt(n, 10) - rhs.length or ''}]")

            # same as above for location references (@n)
            .replace(/@(-?\d+)/g, (_, n) -> "_$[$0#{n - rhs.length or ''}]")

          if action of actionGroups
            actionGroups[action].push(label)
          else
            actionGroups[action] = [label]

          # done with aliases; strip them.
          rhs = rhs.map((e) -> stripAliases(e))
          r = new Rule(nonterminal, rhs, rules.length + 1)
          # precedence specified also
          r.precedence = p.precedence if (p = handle[2]?.prec) and (p = operators[p])
        else
          # no action -> don't care about aliases; strip them.
          rhs = rhs.map((e) -> stripAliases(e))
          # only precedence specified
          r = new Rule(nonterminal, rhs, rules.length + 1)
          r.precedence = p.precedence if (p = handle[1]?.prec) and (p = operators[p])
      else
        # no action -> don't care about aliases; strip them.
        handle = stripAliases(handle)
        rhs = handle.trim().split(' ')
        for i in [0...rhs.length]
          unless symbols_[rhs[i]]
            addSymbol(rhs[i])
        r = new Rule(nonterminal, rhs, rules.length + 1)

      if r.precedence is 0
        # set precedence
        for i in [r.handle.length - 1..0]
          if not (r.handle[i] of nonterminals) and r.handle[i] of operators
            r.precedence = operators[r.handle[i]].precedence

      rules.push(r)
      # Push as flat array: nonterminal_id, handle_length
      rules_.push(symbols_[r.nonterminal], if r.handle[0] is '' then 0 else r.handle.length)
      nonterminals[nonterminal].rules.push(r)

    for nonterminal of bnf
      continue unless bnf.hasOwnProperty(nonterminal)

      addSymbol(nonterminal)
      nonterminals[nonterminal] = new Nonterminal(nonterminal)

      # Get the rules for this nonterminal as an array
      prods = if typeof bnf[nonterminal] is 'string' \
        then bnf[nonterminal].split(/\s*\|\s*/g) \
        else bnf[nonterminal].slice(0)

      prods.forEach(buildRule)

    for action of actionGroups
      # Compress action onto a single line by removing extra whitespace
      compressedAction = action
        .replace(/\/\/[^\n]*$/gm, '')  # Remove single-line comments
        .replace(/\s*\n\s*/g, ' ')     # Replace newlines and surrounding whitespace with single space
        .replace(/\s+/g, ' ')          # Collapse multiple spaces
        .replace(/\s*{\s*/g, '{ ')     # Clean up braces
        .replace(/\s*}\s*/g, ' }')
        .replace(/\s*,\s*/g, ', ')     # Clean up commas
        .trim()

      # Join case labels, action, and break on one line
      actions.push("#{actionGroups[action].join(' ')} #{compressedAction} break;")

    tokens  = []
    tokens_ = {}
    terminalTokens_ = {} # Clean mapping for generated parser

    for sym, id of symbols_
      unless nonterminals[sym]
        tokens.push(sym)
        tokens_[id] = sym
        terminalTokens_[id] = sym # Only actual terminals

    @tokens   = tokens
    @tokens_  = tokens_ # Internal use - will be polluted with state:symbol pairs
    @terminalTokens_ = terminalTokens_ # Clean - only terminals for error messages
    @symbols_ = symbols_
    @rules_   = rules_

    actions.push('}')

    # Join with newlines but keep case statements compressed
    actions = actions.join("\n")
      .replace(/YYABORT/g, 'return false')
      .replace(/YYACCEPT/g, 'return true')

    baseParams = ["yytext", "yyleng", "yylineno", "yy", "yystate /* action[1] */", "$$ /* vstack */", "_$ /* lstack */"]
    allParams = if @parseParams?.length > 0 then baseParams.concat(@parseParams) else baseParams

    @performAction = "function anonymous(#{allParams.join(', ')}) {\n#{actions}\n}"

  # ==[ LR State Construction ]=================================================

  buildLRStates: ->
    console.log "\n=== Building LR states ==="
    item1      = new Item(@rules[0], 0, [@EOF])
    firstSet   = new ItemSet(); firstSet.push(item1)
    firstState = @computeClosureSet(firstSet)
    states     = [firstState]
    marked     = 0

    states.has = {}
    states.has[firstState.valueOf()] = 0

    # Track stats
    @duplicateStates = 0
    @totalTransitions = 0

    while marked isnt states.length
      itemSet = states[marked++]
      itemSet.forEach (item) =>
        if item.markedSymbol and item.markedSymbol isnt @EOF
          @addLRState(item.markedSymbol, itemSet, states, marked - 1)

    console.log "LR states built: #{states.length}"
    console.log "Total transitions attempted: #{@totalTransitions}"
    console.log "Duplicate states avoided: #{@duplicateStates}"
    states

  addLRState: (nonterminal, itemSet, states, stateNum) ->
    g = @computeGotoSet(itemSet, nonterminal)
    g.predecessors = {} unless g.predecessors

    # add g to queue if not empty or duplicate
    unless g.isEmpty()
      @totalTransitions++
      gv = g.valueOf()
      i = states.has[gv]
      if i is -1 or typeof i is 'undefined'
        # New state
        states.has[gv] = states.length
        itemSet.edges[nonterminal] = states.length # store goto transition for table
        states.push(g)
        g.predecessors[nonterminal] = [stateNum]
      else
        # Existing state
        @duplicateStates++
        itemSet.edges[nonterminal] = i # store goto transition for table
        states[i].predecessors[nonterminal].push(stateNum)
        if @debugDuplicates and states.length < 50
          console.log "  REUSE state #{i}: #{nonterminal} from state #{stateNum} (duplicate)"

  computeGotoSet: (itemSet, nonterminal) ->
    gotoSet = new ItemSet()

    itemSet.forEach (item) =>
      if item.markedSymbol is nonterminal
        gotoSet.push(new Item(item.rule, item.dotPosition + 1, item.follows, item.predecessor))

    if gotoSet.isEmpty() then gotoSet else @computeClosureSet(gotoSet)

  computeClosureSet: (itemSet) ->
    closureSet = new ItemSet()
    set        = itemSet
    syms       = {}

    loop
      itemQueue = new ItemSet()
      closureSet.concat(set)
      set.forEach (item) =>
        symbol = item.markedSymbol

        # if symbol is a nonterminal, recursively add closures
        if symbol and @nonterminals[symbol]
          unless syms[symbol]
            @nonterminals[symbol].rules.forEach (rule) =>
              newItem = new Item(rule, 0)
              unless closureSet.contains(newItem)
                itemQueue.push(newItem)
            syms[symbol] = true
        else unless symbol
          # reduction
          closureSet.reductions.push(item)
          closureSet.inadequate = closureSet.reductions.length > 1 or closureSet.shifts
        else
          # shift
          closureSet.shifts = true
          closureSet.inadequate = closureSet.reductions.length > 0

      set = itemQueue
      break if itemQueue.isEmpty()

    closureSet

  # ==[ Lookahead Computation ]=================================================

  computeLookaheads: ->
    @computeNullableSet()
    @computeFirstSets()
    @computeFollowSets()

  computeNullableSet: ->
    @firsts = {}
    nonterminals  = @nonterminals
    more    = true

    # loop until no further changes have been made
    while more
      more = false

      # rule is nullable if all of its elements are nullable
      for rule in @rules when not rule.nullable
        rule.nullable = more = true if rule.handle.every(@nullable.bind(@))

      # check if each nonterminal is nullable
      for nonterminal of nonterminals when not @nullable(nonterminal)
        if nonterminals[nonterminal].rules.some((rule) -> rule.nullable)
          nonterminals[nonterminal].nullable = more = true

  nullable: (nonterminal) ->
    return true if nonterminal is '' # epsilon
    return nonterminal.every(@nullable.bind(@)) if Array.isArray(nonterminal) # RHS
    return false unless @nonterminals[nonterminal] # token
    return getNonterminal(@nonterminals, nonterminal).nullable # nonterminal

  computeFirstSets: ->
    rules  = @rules
    nonterminals = @nonterminals
    cont   = true

    # loop until no further changes have been made
    while cont
      cont = false
      rules.forEach (rule, k) =>
        firsts = @computeFirstSet(rule.handle)
        before = getNonterminal(@nonterminals, rule.nonterminal).first.length
        mergeArrays(getNonterminal(@nonterminals, rule.nonterminal).first, firsts)
        cont = true if before isnt getNonterminal(@nonterminals, rule.nonterminal).first.length

  computeFirstSet: (nonterminal) ->
    switch
      when nonterminal is '' then [] # epsilon
      when nonterminal instanceof Array # RHS
        firsts = []
        for s in nonterminal
          break unless s
          if e = @nonterminals[s] then mergeArrays firsts, getNonterminal(@nonterminals, s).first
          else firsts.push s unless s in firsts
          break unless @nullable s
        firsts
      when e = @nonterminals[nonterminal] then getNonterminal(@nonterminals, nonterminal).first # nonterminal
      else [nonterminal] # token

  computeFollowSets: ->
    rules  = @rules
    nonterminals = @nonterminals
    cont   = true

    # loop until no further changes have been made
    while cont
      cont = false

      rules.forEach (rule, k) =>
        set = []
        oldcount
        for i in [0...rule.handle.length]
          t = rule.handle[i]
          continue unless @nonterminals[t]

          part = rule.handle.slice(i + 1)
          set = @computeFirstSet(part)
          if @nullable(part)
            set.push.apply(set, getNonterminal(@nonterminals, rule.nonterminal).follows)

          oldcount = getNonterminal(@nonterminals, t).follows.length
          mergeArrays(getNonterminal(@nonterminals, t).follows, set)
          if oldcount isnt getNonterminal(@nonterminals, t).follows.length
            cont = true

  # ==[ LALR Table Building ]===================================================

  buildParseTable: (itemSets) ->
    states    = []
    nonterminals    = @nonterminals
    operators = @operators

    conflictedStates = {} # array of [state, token] tuples

    s = 1 # shift
    r = 2 # reduce
    a = 3 # accept

    itemSets.forEach (itemSet, k) =>
      state = states[k] = {}

      # set shift and goto actions
      for stackSymbol of itemSet.edges
        itemSet.forEach (item, j) =>
          # find shift and goto actions
          if item.markedSymbol is stackSymbol
            nextState = itemSet.edges[stackSymbol]
            if nonterminals[stackSymbol]
              # store state to go to after a reduce
              state[@symbols_[stackSymbol]] = nextState
            else
              state[@symbols_[stackSymbol]] = [s, nextState]

      # set accept action
      itemSet.forEach (item, j) =>
        if item.markedSymbol is @EOF
          # accept
          state[@symbols_[@EOF]] = [a]

      # set reductions and resolve potential conflicts
      itemSet.reductions.forEach (item, j) =>
        # if parser uses lookahead, only enumerate those tokens
        tokens = @getLookaheads?(itemSet, item) || @tokens

        tokens.forEach (stackSymbol) =>
          action = state[@symbols_[stackSymbol]]
          op = operators[stackSymbol]
          # at a token and the current position is at the end of a rule, try to reduce
          if action or (action and action.length)
            sln = resolveConflict(item.rule, op, [r, item.rule.id], if action[0] instanceof Array then action[0] else action)
            @resolutions.push([k, stackSymbol, sln])
            if sln.bydefault
              @conflicts++
              # NOTE: Don't throw error for default resolutions - just log them
              console.log "Resolved #{@conflicts} conflict by default: #{sln.msg}"
            action = sln.action
          else
            action = [r, item.rule.id]

          if action and action.length
            state[@symbols_[stackSymbol]] = action
          else if action is 0 # NONASSOC
            state[@symbols_[stackSymbol]] = undefined

    if @conflicts > 0
      conflictDetails = "\nStates with conflicts:"
      for state, val of conflictedStates
        conflictDetails += "\nState #{state}"
        conflictDetails += "\n  #{itemSets[state].join("\n  ")}"
      # NOTE: Don't throw error for default resolutions - just log them
      # console.log "Warning: Grammar conflicts: #{@conflicts} #{conflictDetails}"

    return states

  # Every disjoint reduction of a nonterminal becomes a rule in G'
  buildGrammar: ->
    console.log "\n=== buildGrammar: Creating derived grammar G' ==="
    console.log "Original rules count: #{@rules.length}"
    derivedRuleCount = 0

    @states.forEach (state, i) =>
      state.forEach (item) =>
        if item.dotPosition is 0
          symbol = "#{i}:#{item.rule.nonterminal}"
          @tokens_[symbol] = item.rule.nonterminal
          @derived[symbol] = i
          nt = getNonterminal(@nonterminals, symbol)
          pathInfo = @followHandle(i, item.rule.handle)
          p = new Rule(symbol, pathInfo.path, @rules.length)
          @rules.push(p)
          nt.rules.push(p)
          derivedRuleCount++

          # Debug output for first few derived rules
          if derivedRuleCount <= 5
            console.log "  Derived rule ##{derivedRuleCount}: #{p.toString()}"
            console.log "    - From state #{i}, original rule: #{item.rule.toString()}"
            console.log "    - Path through states: #{pathInfo.path.join(' → ')}"

          handle = item.rule.handle.join(' ')
          handles = @states[pathInfo.endState].handles
          handles[handle] = [] unless handles[handle]
          handles[handle].push(symbol)
      if state.inadequate then @inadequateStates.push(i)

    console.log "Total derived rules created: #{derivedRuleCount}"
    console.log "Total rules after buildGrammar: #{@rules.length}"
    console.log "Inadequate states: #{@inadequateStates.length}"

  mergeLookaheads: ->
    states = if !!@onDemandLookahead then @inadequateStates else @states
    console.log "\n=== mergeLookaheads ==="
    console.log "On-demand lookahead: #{@onDemandLookahead}"
    console.log "Processing #{if @onDemandLookahead then @inadequateStates.length + ' inadequate' else @states.length + ' total'} states"

    mergeCount = 0
    states.forEach (i) =>
      state = if typeof i is 'number' then @states[i] else i
      if state.reductions.length
        state.reductions.forEach (item) =>
          follows = {}
          for k in [0...item.follows.length]
            follows[item.follows[k]] = true
          if state.handles[item.rule.handle.join(' ')]
            state.handles[item.rule.handle.join(' ')].forEach (symbol) =>
              nt = getNonterminal(@nonterminals, symbol)
              nt.follows.forEach (symbol) =>
                token = @tokens_[symbol]
                unless follows[token]
                  follows[token] = true
                  item.follows.push(token)
                  mergeCount++

    console.log "Merged #{mergeCount} additional lookaheads"

  # ==[ LALR Helpers ]==========================================================

  getLookaheads: (state, item) ->
    if !!@onDemandLookahead and not state.inadequate then @tokens else item.follows

  followHandle: (q, w) ->
    path = []
    startState = q
    for i in [0...w.length]
      t = if w[i] then "#{q}:#{w[i]}" else ''
      if t then @derived[t] = q
      path.push(t)
      nextState = @states[q].edges[w[i]] or q
      # Debug first few followHandle calls
      @followHandleCallCount ?= 0
      if @followHandleCallCount++ < 10
        console.log "    followHandle: state #{q} --[#{w[i]}]--> state #{nextState}"
      q = nextState
      @tokens_[t] = w[i]
    {
      path: path
      endState: q
    }

  # ==[ Code Generation ]=======================================================

  # Convert numeric string keys to numeric keys in JSON ("1": -> 1:)
  jsonStringifyWithNumericKeys: (obj) ->
    JSON.stringify(obj).replace(/"(\d+)":/g, '$1:')

  # Extract common patterns from semantic actions
  extractActionPatterns: ->
    patterns =
      passThrough: []
      arrayCreate: []
      newNode: []
      objectProps: []

    # Analyze rules to identify patterns
    @rules.forEach (rule, idx) =>
      action = @actionInclude?[idx]
      if action?.match(/^\s*\$\$\s*$/) # Simple pass-through
        patterns.passThrough.push(idx)

    patterns

    # Generate switch cases for performAction
  generatePerformActionCases: ->
    # This would generate the actual switch cases from @performAction
    # For now, we'll use the existing performAction function body
    fnString = String(@performAction)
    # Extract the switch statement content
    match = fnString.match(/switch\s*\(.*?\)\s*\{([\s\S]*)\}[\s\S]*$/)
    if match then match[1] else ''

  # Generate pattern-based performAction (experimental optimization)
  generatePatternBasedPerformAction: ->
    patterns = @extractActionPatterns()

    """
    performAction: function(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
      var $0 = $$.length - 1;

      // Fast path for pass-through cases
      const passThroughCases = #{JSON.stringify(patterns.passThrough)};
      if (passThroughCases.includes(yystate)) {
        this.$ = $$[$0];
        return;
      }

      // Fall back to switch for other cases
      switch (yystate) {
    #{@generatePerformActionCases()}
      }
    }
    """

  # Generate traditional performAction
  generateTraditionalPerformAction: ->
    "performAction: " + String(@performAction)

  generate: (opt) ->
    opt = Object.assign {}, @options, opt

    # check for illegal identifier
    unless opt.moduleName and opt.moduleName.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
      opt.moduleName = "parser"

    # Use pattern optimization if enabled
    if opt.patternOptimization
      @performActionCode = @generatePatternBasedPerformAction()
    else
      @performActionCode = @generateTraditionalPerformAction()

    if opt.moduleType is "js"
      @generateESModule(opt)
    else
      @generateCommonJS(opt)

  # Supply an array of lexed tokens
  arrayLexer: -> '''{

      // Tokenizing
      setInput(tokens) { this.tokens = tokens; this.pos = 0; },
      lex() { return this.tokens?.[this.pos++] ?? 1; }, // 1 = EOF

      // Required
      match: '',
      options: {},
      yyleng: 0,
      yylineno: 0,
      yylloc: {},
      yytext: '',

      // Compatibility
      _currentRules: () => {},
      begin: () => {},
      less: () => {},
      more: () => {},
      next: () => {},
      pastInput: () => '',
      popState: () => {},
      pushState: () => {},
      showPosition: () => '',
      test_match: () => {},
      topState: () => {},
      unput: () => {},
      upcomingInput: () => ''
    }'''

  generateESModule: (opt) ->
    opt = Object.assign {}, @options, opt
    moduleName = opt.moduleName or "parser"

    # Generate lexer code differently based on whether we have a real lexer
    if @lexer and @lexer.generateESModule
      lexerSetup = @lexer.generateESModule() + "\n\n  "
      lexerCode = "lexer: lexer,"
    else
      lexerSetup = ""
      arrayLexer = @arrayLexer().split('\n').map((line, i) ->
        if i == 0 then line else '    ' + line
      ).join('\n')
      lexerCode = "// Minimal lexer for token arrays\n    lexer: #{arrayLexer},"

    """
/* Generated by rip-parser-jison 1.0.0 */
/* NOT THE ORIGINAL JISON - This is our clean-room implementation! */
/* Generated at: #{new Date().toISOString()} */

const #{moduleName} = (() => {#{if lexerSetup then '\n  ' + lexerSetup.trim() else ''}
  const parser = {
    trace: () => {},
    yy: {},
    symbols_: #{JSON.stringify(@symbols_)},
    tokens_: #{@jsonStringifyWithNumericKeys(@terminalTokens_)},
    rules_: #{JSON.stringify(@rules_)},
    #{lexerCode}
    #{@performActionCode or "performAction: " + String(@performAction)},
    table: #{@jsonStringifyWithNumericKeys(@table)},
    defaultActions: #{@jsonStringifyWithNumericKeys(@defaultActions)},

    parseError(str, hash) {
      if (!hash.recoverable) {
        const err = new Error(str);
        err.hash = hash;
        throw err;
      }
      this.trace(str);
    },

    parse(input) {
      const self = this;
      const stack = [0];
      const vstack = [null];
      const lstack = [];
      const { table, rules_, symbols_, defaultActions } = this;
      const EOF = 1;
      const TERROR = 2;

      // Setup lexer
      const lexer = Object.create(parser.lexer);
      const sharedState = { yy: Object.assign({}, this.yy) };
      lexer.setInput(input, sharedState.yy);
      sharedState.yy.lexer = lexer;
      sharedState.yy.parser = this;
      lexer.yylloc = lexer.yylloc || {};
      lstack.push(lexer.yylloc);

      // Parser configuration
      const ranges = lexer.options?.ranges;
      const args = [].slice.call(arguments, 1);
      this.parseError = sharedState.yy.parseError || this.parseError;

      let yytext = '';
      let yylineno = 0;
      let yyleng = 0;
      let recovering = 0;
      let symbol = null;
      let preErrorSymbol = null;

      const lex = () => {
        const token = lexer.lex() || EOF;
        return typeof token === 'number' ? token : symbols_[token] || token;
      };

      const popStack = (n) => {
        stack.length -= 2 * n;
        vstack.length -= n;
        lstack.length -= n;
      };

      // Error handling
      const handleError = () => {
        const st = stack[stack.length - 1];

        // Quick error recovery check
        let probe = stack.length - 1;
        let depth = 0;
        let curr = st;
        while (curr !== 0 && probe >= 2) {
          if (table[curr]?.[TERROR]) break;
          probe -= 2;
          curr = stack[probe];
          depth++;
        }

        const hasRecovery = curr !== 0 && table[curr]?.[TERROR];

        if (!recovering) {

          // Build error info
          const expected = [];
          const stateTable = table[st];
          if (stateTable) {
            for (const tok in stateTable) {
              if (this.tokens_[tok] && tok > TERROR) {
                expected.push(`'${this.tokens_[tok]}'`);
              }
            }
          }

          this.parseError(
            lexer.showPosition
              ? `Parse error on line ${yylineno + 1}:\\n${lexer.showPosition()}\\nExpecting ${expected.join(', ')}, got '${this.tokens_[symbol] || symbol}'`
              : `Parse error on line ${yylineno + 1}: Unexpected ${symbol === EOF ? 'end of input' : `'${this.tokens_[symbol] || symbol}'`}`,
            {
              text: lexer.match,
              token: this.tokens_[symbol] || symbol,
              line: lexer.yylineno,
              loc: lexer.yylloc,
              expected,
              recoverable: hasRecovery
            }
          );
        }

        if (recovering === 3) {
          if (symbol === EOF || preErrorSymbol === EOF) {
            throw new Error('Parsing halted while recovering from error.');
          }
          yyleng = lexer.yyleng;
          yytext = lexer.yytext;
          yylineno = lexer.yylineno;
          symbol = lex();
        }

        if (!hasRecovery) {
          throw new Error('Parsing halted. No error recovery rule available.');
        }

        popStack(depth);
        preErrorSymbol = symbol === TERROR ? null : symbol;
        symbol = TERROR;
        recovering = 3;

        return table[stack[stack.length - 1]]?.[TERROR];
      };

      // Main parse loop
      while (true) {
        const state = stack[stack.length - 1];

        // Get action - check defaults first (common case for large grammars)
        let action = defaultActions[state];
        if (!action) {
          symbol ??= lex();
          action = table[state]?.[symbol];
        }

        // Handle missing action (error)
        if (!action?.length || !action[0]) {
          action = handleError();
          if (!action) continue;
        }

        // Execute action
        switch (action[0]) {

          case 1: // Shift
            stack.push(symbol, action[1]);
            vstack.push(lexer.yytext);
            lstack.push(lexer.yylloc);
            symbol = null;

            if (!preErrorSymbol) {
              yyleng = lexer.yyleng;
              yytext = lexer.yytext;
              yylineno = lexer.yylineno;
              if (recovering > 0) recovering--;
            } else {
              symbol = preErrorSymbol;
              preErrorSymbol = null;
            }
            break;

          case 2: // Reduce
            const ruleIdx = action[1] * 2; // Index into flat rules_ array
            const len = rules_[ruleIdx + 1]; // Handle length
            const lenOrOne = len || 1;

            // Prepare reduction values
            const yyval = { $: vstack[vstack.length - len] };
            const topLoc = lstack[lstack.length - 1];
            const baseLoc = lstack[lstack.length - lenOrOne];

            // Set location
            yyval._$ = {
              first_line: baseLoc.first_line,
              last_line: topLoc.last_line,
              first_column: baseLoc.first_column,
              last_column: topLoc.last_column
            };

            if (ranges) {
              yyval._$.range = [baseLoc.range[0], topLoc.range[1]];
            }

            // Execute semantic action
            const r = this.performAction.apply(yyval, [
              yytext, yyleng, yylineno, sharedState.yy, action[1], vstack, lstack, ...args
            ]);

            if (r !== undefined) return r;

            // Pop stack and push result
            if (len) {
              stack.length -= 2 * len;
              vstack.length -= len;
              lstack.length -= len;
            }

            const nonterminal = rules_[ruleIdx];
            stack.push(nonterminal);
            vstack.push(yyval.$);
            lstack.push(yyval._$);

            // Goto new state
            const newState = table[stack[stack.length - 2]][nonterminal];
            stack.push(newState);
            break;

          case 3: // Accept
            return true;
        }
      }
    }
  };
#{if @moduleInclude then '\n  ' + @moduleInclude.trim() + '\n' else ''}
  parser.Parser = class Parser {
    constructor() {
      Object.assign(this, parser);
      this.yy = {};
      this.lexer = parser.lexer;
    }
  };

  return parser;
})();"""

  generateCommonJS: (opt) ->
    opt = Object.assign {}, @options, opt
    moduleName = opt.moduleName or "parser"

    # Generate ES module then append CommonJS exports
    esModule = @generateESModule(opt)
    commonJSExports =
      """
      // CommonJS export
      if (typeof module === 'object' && module.exports) {
        exports = module.exports = #{moduleName};
        exports.parser = #{moduleName};
        exports.Parser = #{moduleName}.Parser;
        exports.parse = #{moduleName}.parse.bind(#{moduleName});
      }
      """

    # Add our signature comment at the very end
    signature = "\n// RIP-PARSER-JISON WAS HERE! Generated at: #{new Date().toISOString()}\n"

    esModule + "\n" + commonJSExports + signature

  trace: ->
  error: (msg) -> throw new Error(msg)

# ==[ Module Exports ]==========================================================

module.exports = Generator

# ==[ Command Line ]============================================================

unless module.parent
  fs   = require 'fs'
  path = require 'path'

  # Grammar file
  [file, ...rest] = process.argv.slice(2)

  # Help function
  showHelp = ->
    console.log """
    rip-parser-jison - A modern LALR(1) parser generator

    Usage: coffee rip-parser-jison.coffee <grammar-file> [options]

    Arguments:
      grammar-file    Path to the grammar file (JavaScript/JSON)

    Options:
      -o, --output <file>    Output file path (default: <grammar-file>-parser.js)
      -h, --help             Show this help message

    Examples:
      coffee rip-parser-jison.coffee grammar.js
      coffee rip-parser-jison.coffee grammar.js -o my-parser.js
      coffee rip-parser-jison.coffee grammar.js --output custom-parser.js

    Grammar file format:
      The grammar file should export an object with:
      - grammar: BNF grammar rules
      - tokens: Space-separated token list
      - operators: Operator precedence rules
      - start: Starting nonterminal (default: 'Root')
    """
    process.exit(0)

  # Check for help flags
  if file in ['-h', '--help'] or rest.includes('-h') or rest.includes('--help')
    showHelp()

  unless file
    console.log "Usage: coffee rip-parser-jison.coffee <grammar-file> [-o <output-file>]"
    console.log "Use -h or --help for more information"
    process.exit(1)

  idx = rest.indexOf('-o')
  out = if ~idx and rest[idx+1]?
    rest[idx+1]
  else
    path.basename(file, path.extname(file)) + '-parser.js'

  try
    lang = require file
    unless lang.grammar
      throw new Error("Grammar file must export { grammar, tokens, operators, start }")

    grammar =
      bnf           : lang.grammar
      tokens        : lang.tokens
      operators     : lang.operators or []
      start         : lang.start or 'Root'
      parseParams   : lang.parseParams or []
      moduleInclude : lang.moduleInclude or ''
      actionInclude : lang.actionInclude or ''

    parser_code = (new Generator(grammar)).generate(moduleMain: ->)

    fs.writeFileSync out, parser_code
    console.log "Generated parser: #{out}"
  catch error
    console.error "Error: #{error.message}"
    process.exit(1)
