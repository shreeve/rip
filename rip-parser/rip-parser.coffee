#!/usr/bin/env coffee

# ==============================================================================
# rip-parser - A rip-lang based LALR(1) parser generator, derived from Jison
# Author: Steve Shreeve <steve.shreeve@gmail.com>
#         Cursor AI <cursor@cursor.com>
#         Jison team | https://www.npmjs.com/package/jison
#  Legal: MIT License
#   Date: July 4, 2025
# ==============================================================================

# Grammar rules with handles and precedence
class Rule
  constructor: (symbol, handle, id) ->
    @symbol     = symbol
    @handle     = handle
    @nullable   = false
    @id         = id
    @first      = []
    @precedence = 0

  toString: ->
    "#{@symbol} -> #{@handle.join(' ')}"

# Grammar nonterminals with rules, first/follow sets
class Nonterminal
  constructor: (symbol) ->
    @symbol      = symbol
    @rules       = []
    @first       = []
    @follows     = []
    @nullable    = false

    toString: -> """
      #{@symbol}
      #{if @nullable then 'nullable' else 'not nullable'}
      Firsts:  #{@first  .join(', ')}
      Follows: #{@follows.join(', ')}
      Rules:
          #{@rules.join('\n  ')}
      """

# Represents LR items (rules with dot positions)
class Item
  constructor: (rule, dot, f, predecessor) ->
    @rule         = rule
    @dotPosition  = dot or 0
    @follows      = f or []
    @predecessor  = predecessor
    @id           = parseInt("#{rule.id}a#{@dotPosition}", 36)
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
    "#{@rule.symbol} -> #{temp.join(' ')}#{look}"

# Manages set of LR items with deduplication
class ItemSet
  constructor: ->
    @map        = new Map() # id -> item
    @reductions = []
    @reductions = {}
    @edges      = {}
    @shifts     = false
    @inadequate = false

  contains: (item) -> @map.has(item.id)
  forEach: (fn) ->
    @map.forEach (item, key) =>
      fn(item)
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

# Iterate over objects
forEach = (obj, func) ->
  if obj.forEach
    obj.forEach func
  else
    for p of obj
      if obj.hasOwnProperty(p)
        func.call(obj, obj[p], p, obj)

# Merge arrays without duplicates
mergeArrays = (a, b) ->
  ar = {}
  for k in [a.length - 1..0]
    ar[a[k]] = true
  for i in [b.length - 1..0]
    a.push(b[i]) unless ar[b[i]]
  a

# ==[ Grammar Helpers ]=========================================================

# Defensive getter for nonterminals
getNonterminal = (nonterminals, s) ->
  unless nonterminals[s]
    nonterminals[s] = new Nonterminal(s)
  nonterminals[s]

# Set precedence and associativity of operators
processOperators = (ops) ->
  return {} unless ops
  operators = {}
  for i in [0...ops.length]
    prec = ops[i]
    for k in [1...prec.length]
      operators[prec[k]] = { precedence: i + 1, assoc: prec[0] }
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
    @nonterminals = {}
    @inadequateStates = []
    @onDemandLookahead = options.onDemandLookahead or false

    @buildGrammar()
    @computeLookaheads()
    @mergeLookaheads()
    @table = @buildParseTable(@states)
    @defaultActions = findDefaults(@table)

  processGrammar: (grammar) ->
    bnf          = grammar.bnf
    tokens       = grammar.tokens
    nonterminals = @nonterminals = {}
    rules        = @rules

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
    @addAcceptProduction(grammar)

  addAcceptProduction: (grammar) ->
    if @rules.length is 0
      throw new Error("Grammar error: must have at least one rule.")

    # use specified start symbol, or default to first user defined rule
    @startSymbol = grammar.start or grammar.startSymbol or @rules[0].symbol
    unless @nonterminals[@startSymbol]
      throw new Error("Grammar error: startSymbol must be a nonterminal found in your grammar.")
    @EOF = "$end"

    # augment the grammar
    acceptRule = new Rule('$accept', [@startSymbol, '$end'], 0)
    @rules.unshift(acceptRule)

    # prepend parser tokens
    @symbols.unshift("$accept", @EOF)
    @symbols_[@EOF] = 1
    @tokens.unshift(@EOF)

    @nonterminals.$accept = new Nonterminal("$accept")
    @nonterminals.$accept.rules.push(acceptRule)

    # add follow $ to start symbol
    getNonterminal(@nonterminals, @startSymbol).follows.push(@EOF)

  # ==[ Grammar Processing ]====================================================

  buildRules: (bnf, rules, nonterminals, symbols, operators) ->
    actions = [
      '/* this == yyval */'
      @actionInclude or ''
      'var $0 = $$.length - 1;'
      'switch (yystate) {'
    ]
    actionGroups = {}
    her          = false # has error recovery
    rules_       = [0]
    symbols_     = {}
    symbolId     = 1
    prods        = null # TODO: Is this needed?
    symbol       = null # TODO: Is this needed?

    addSymbol = (s) ->
      if s and not symbols_[s]
        symbols_[s] = ++symbolId
        symbols.push(s)

    # add error symbol; will be third symbol, or "2" ($accept, $end, error)
    addSymbol("error")

    buildRule = (handle) ->
      # r, rhs, i # TODO: Do these need to be defined?
      if handle.constructor is Array
        rhs = if typeof handle[0] is 'string'
          handle[0].trim().split(' ')
        else
          handle[0].slice(0)

        for i in [0...rhs.length]
          if rhs[i] is 'error'
            her = true
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

            action = action.replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, (str, pl) ->
              return if names[pl] then "$#{names[pl]}" else str
            ).replace(/@([a-zA-Z][a-zA-Z0-9_]*)/g, (str, pl) ->
              return if names[pl] then "@#{names[pl]}" else str
            )

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
          rhs = rhs.map((e, i) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, ''))
          r = new Rule(symbol, rhs, rules.length + 1)
          # precedence specified also
          if handle[2] and operators[handle[2].prec]
            r.precedence = operators[handle[2].prec].precedence
        else
          # no action -> don't care about aliases; strip them.
          rhs = rhs.map((e, i) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, ''))
          # only precedence specified
          r = new Rule(symbol, rhs, rules.length + 1)
          if operators[handle[1].prec]
            r.precedence = operators[handle[1].prec].precedence
      else
        # no action -> don't care about aliases; strip them.
        handle = handle.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '')
        rhs = handle.trim().split(' ')
        for i in [0...rhs.length]
          if rhs[i] is 'error'
            her = true
          unless symbols_[rhs[i]]
            addSymbol(rhs[i])
        r = new Rule(symbol, rhs, rules.length + 1)

      if r.precedence is 0
        # set precedence
        for i in [r.handle.length - 1..0]
          if not (r.handle[i] of nonterminals) and r.handle[i] of operators
            r.precedence = operators[r.handle[i]].precedence

      rules.push(r)
      rules_.push([symbols_[r.symbol], if r.handle[0] is '' then 0 else r.handle.length])
      nonterminals[symbol].rules.push(r)

    for symbol of bnf
      continue unless bnf.hasOwnProperty(symbol)

      addSymbol(symbol)
      nonterminals[symbol] = new Nonterminal(symbol)

      if typeof bnf[symbol] is 'string'
        prods = bnf[symbol].split(/\s*\|\s*/g)
      else
        prods = bnf[symbol].slice(0)

      prods.forEach(buildRule)

    for action of actionGroups
      actions.push(actionGroups[action].join(' '), action, 'break;')

    tokens  = []
    tokens_ = {}

    forEach(symbols_, (id, sym) ->
      unless nonterminals[sym]
        tokens.push(sym)
        tokens_[id] = sym
    )

    @tokens   = tokens
    @tokens_  = tokens_
    @symbols_ = symbols_
    @rules_   = rules_

    actions.push('}')

    actions = actions.join("\n")
      .replace(/YYABORT/g, 'return false')
      .replace(/YYACCEPT/g, 'return true')

    parameters = "yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */"
    parameters += ', ' + @parseParams.join(', ') if @parseParams?.length > 0

    @performAction = "function anonymous(#{parameters}) {\n#{actions}\n}"

  # ==[ LR State Construction ]=================================================

  buildLRStates: ->
    item1      = new Item(@rules[0], 0, [@EOF])
    firstSet   = new ItemSet(); firstSet.push(item1)
    firstState = @computeClosureSet(firstSet)
    states     = [firstState]
    marked     = 0

    states.has = {}
    states.has[firstState.valueOf()] = 0

    while marked isnt states.length
      itemSet = states[marked++]
      itemSet.forEach (item) =>
        if item.markedSymbol and item.markedSymbol isnt @EOF
          @addLRState(item.markedSymbol, itemSet, states, marked - 1)

    states

  addLRState: (symbol, itemSet, states, stateNum) ->
    g = @computeGotoSet(itemSet, symbol)
    g.predecessors = {} unless g.predecessors

    # add g to queue if not empty or duplicate
    unless g.isEmpty()
      gv = g.valueOf()
      i = states.has[gv]
      if i is -1 or typeof i is 'undefined'
        states.has[gv] = states.length
        itemSet.edges[symbol] = states.length # store goto transition for table
        states.push(g)
        g.predecessors[symbol] = [stateNum]
      else
        itemSet.edges[symbol] = i # store goto transition for table
        states[i].predecessors[symbol].push(stateNum)

  computeGotoSet: (itemSet, symbol) ->
    gotoSet = new ItemSet()

    itemSet.forEach (item) =>
      if item.markedSymbol is symbol
        gotoSet.push(new Item(item.rule, item.dotPosition + 1, item.follows, item.predecessor))

    if gotoSet.isEmpty() then gotoSet else @computeClosureSet(gotoSet)

  computeClosureSet: (itemSet) ->
    closureSet = new ItemSet()
    set        = itemSet
    syms       = {}
    itemQueue  = null # TODO: Is this needed?

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
    nonterminals = @nonterminals
    cont = true

    # loop until no further changes have been made
    while cont
      cont = false

      # check if each rule is nullable
      @rules.forEach (rule, k) =>
        unless rule.nullable
          n = 0
          i = 0
          t = null # TODO: Is this needed?
          for i in [0...rule.handle.length]
            t = rule.handle[i]
            if @nullable(t) then n++
          if n is i # rule is nullable if all of its elements (tokens or nonterminals) are nullable
            rule.nullable = cont = true

      # check if each symbol is nullable
      for symbol of nonterminals
        unless @nullable(symbol)
          for i in [0...nonterminals[symbol].rules.length]
            rule = nonterminals[symbol].rules[i]
            if rule.nullable
              nonterminals[symbol].nullable = cont = true

  nullable: (symbol) ->
    # epsilon
    if symbol is ''
      return true
    # RHS
    else if Array.isArray(symbol)
      for i in [0...symbol.length]
        t = symbol[i]
        return false unless @nullable(t)
      return true
    # token
    else unless @nonterminals[symbol]
      return false
    # nonterminal
    else
      return getNonterminal(@nonterminals, symbol).nullable

  computeFirstSets: ->
    rules        = @rules
    nonterminals = @nonterminals
    cont         = true

    # loop until no further changes have been made
    while cont
      cont = false
      rules.forEach (rule, k) =>
        firsts = @computeFirstSet(rule.handle)
        oldcount = getNonterminal(@nonterminals, rule.symbol).first.length
        mergeArrays(getNonterminal(@nonterminals, rule.symbol).first, firsts)
        cont = true if oldcount isnt getNonterminal(@nonterminals, rule.symbol).first.length

  computeFirstSet: (symbol) ->
    switch
      when symbol is '' then [] # epsilon
      when symbol instanceof Array # RHS
        firsts = []
        for s in symbol
          break unless s
          if e = @nonterminals[s] then mergeArrays firsts, getNonterminal(@nonterminals, s).first
          else firsts.push s unless s in firsts
          break unless @nullable s
        firsts
      when e = @nonterminals[symbol] then getNonterminal(@nonterminals, symbol).first # nonterminal
      else [symbol] # token

  computeFollowSets: ->
    rules  = @rules
    nonterminals = @nonterminals
    cont         = true

    # loop until no further changes have been made
    while cont
      cont = false

      rules.forEach (rule, k) =>
        # q is used in Simple LALR algorithm to determine follows in context
        q = null # TODO: Is this needed?
        ctx = !!@go_

        set = []
        oldcount
        for i in [0...rule.handle.length]
          t = rule.handle[i]
          continue unless @nonterminals[t]

          # For Simple LALR algorithm, @go_ checks if
          if ctx
            q = @go_(rule.symbol, rule.handle.slice(0, i))
            bool = not ctx or q is parseInt(@derived[t], 10)

            if i is rule.handle.length + 1 and bool
              set = getNonterminal(@nonterminals, rule.symbol).follows
            else
              part = rule.handle.slice(i + 1)
              set = @computeFirstSet(part)
              if @nullable(part) and bool
                set.push.apply(set, getNonterminal(@nonterminals, rule.symbol).follows)
          else
            part = rule.handle.slice(i + 1)
            set = @computeFirstSet(part)
            if @nullable(part)
              set.push.apply(set, getNonterminal(@nonterminals, rule.symbol).follows)

          oldcount = getNonterminal(@nonterminals, t).follows.length
          mergeArrays(getNonterminal(@nonterminals, t).follows, set)
          if oldcount isnt getNonterminal(@nonterminals, t).follows.length
            cont = true

  # ==[ LALR Table Building ]===================================================

  buildParseTable: (itemSets) ->
    states           = []
    nonterminals     = @nonterminals
    operators        = @operators
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
            gotoState = itemSet.edges[stackSymbol]
            if nonterminals[stackSymbol]
              # store state to go to after a reduce
              state[@symbols_[stackSymbol]] = gotoState
            else
              state[@symbols_[stackSymbol]] = [s, gotoState]

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
              # console.log "Resolved conflict by default: #{sln.msg}"
            action = sln.action
          else
            action = [r, item.rule.id]

          if action and action.length
            state[@symbols_[stackSymbol]] = action
          else if action is NONASSOC
            state[@symbols_[stackSymbol]] = undefined

    if @conflicts > 0
      conflictDetails = "\nStates with conflicts:"
      forEach conflictedStates, (val, state) ->
        conflictDetails += "\nState #{state}"
        conflictDetails += "\n  #{itemSets[state].join("\n  ")}"
      # NOTE: Don't throw error for default resolutions - just log them
      # console.log "Warning: Grammar conflicts: #{@conflicts} #{conflictDetails}"

    states

  # Every disjoint reduction of a nonterminal becomes a rule in G'
  buildGrammar: ->
    @states.forEach (state, i) =>
      state.forEach (item) =>
        if item.dotPosition is 0
          symbol = "#{i}:#{item.rule.symbol}"
          @tokens_[symbol] = item.rule.symbol
          @derived[symbol] = i
          nt = getNonterminal(@nonterminals, symbol)
          pathInfo = @goPath(i, item.rule.handle)
          p = new Rule(symbol, pathInfo.path, @rules.length)
          @rules.push(p)
          nt.rules.push(p)
          handle = item.rule.handle.join(' ')
          reductions = @states[pathInfo.endState].reductions
          reductions[handle] = [] unless reductions[handle]
          reductions[handle].push(symbol)
      if state.inadequate then @inadequateStates.push(i)

  mergeLookaheads: ->
    states = if !!@onDemandLookahead then @inadequateStates else @states
    states.forEach (i) =>
      state = if typeof i is 'number' then @states[i] else i
      if state.reductions.length
        state.reductions.forEach (item) =>
          follows = {}
          for k in [0...item.follows.length]
            follows[item.follows[k]] = true
          state.reductions[item.rule.handle.join(' ')].forEach (symbol) =>
            nt = getNonterminal(@nonterminals, symbol)
            nt.follows.forEach (symbol) =>
              token = @tokens_[symbol]
              unless follows[token]
                follows[token] = true
                item.follows.push(token)

  # ==[ LALR Helpers ]==========================================================

  getLookaheads: (state, item) ->
    if !!@onDemandLookahead and not state.inadequate then @tokens else item.follows

  goPath: (q, w) ->
    t = null # TODO: Is this needed?
    path = []
    for i in [0...w.length]
      t = if w[i] then "#{q}:#{w[i]}" else ''
      if t then @derived[t] = q
      path.push(t)
      q = @states[q].edges[w[i]] or q
      @tokens_[t] = w[i]
    {
      path: path
      endState: q
    }

  # ==[ Code Generation ]=======================================================

  generate: (opt) ->
    opt = Object.assign {}, @options, opt

    # check for illegal identifier
    unless opt.moduleName and opt.moduleName.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
      opt.moduleName = "parser"

    switch opt.moduleType
      when "js" then @generateESModule(opt)
      else   @generateCommonJS(opt)

  generateESModule: (opt) ->
    opt = Object.assign {}, @options, opt
    moduleName = opt.moduleName or "parser"

    # Always create a fake lexer and assign it to parser.lexer
    lexerCode = if @lexer and @lexer.generateESModule then @lexer.generateESModule() + '\n  parser.lexer = lexer;' else '''
  // Minimal fake lexer for token arrays
  const fakeLexer = {
    setInput(tokens) { this.tokens = tokens; this.pos = 0; },
    lex() { return this.tokens && this.pos < this.tokens.length ? this.tokens[this.pos++] : 1; }, // 1 = EOF
    // Stubs for compatibility
    yylloc: {},
    yylineno: 0,
    yytext: '',
    yyleng: 0,
    options: {},
    setInput: function(tokens) { this.tokens = tokens; this.pos = 0; },
    showPosition: function() { return ''; },
    match: '',
    more: function() {},
    unput: function() {},
    less: function() {},
    pastInput: function() { return ''; },
    upcomingInput: function() { return ''; },
    test_match: function() {},
    next: function() {},
    begin: function() {},
    popState: function() {},
    _currentRules: function() {},
    topState: function() {},
    pushState: function() {},
  };
  parser.lexer = fakeLexer;'''

    out = """/* parser generated by our modernized rip-parser */
const #{moduleName} = (() => {
  const parser = {
    trace: () => {},
    yy: {},
    symbols_: #{JSON.stringify(@symbols_)},
    tokens_: #{JSON.stringify(@tokens_).replace(/"(\d+)":/g, '$1:')},
    rules_: #{JSON.stringify(@rules_)},
    performAction: #{String(@performAction)},
    table: #{JSON.stringify(@table).replace(/"(\d+)":/g, '$1:')},
    defaultActions: #{JSON.stringify(@defaultActions).replace(/"(\d+)":/g, '$1:')},
    parseError: (str, hash) => {
      if (hash.recoverable) {
        this.trace(str);
      } else {
        const error = new Error(str);
        error.hash = hash;
        throw error;
      }
    },
    parse(input) {
      let stack = [0];
      const tstack = [];
      let vstack = [null];
      let lstack = [];
      const table = this.table;
      let yytext = '';
      let yylineno = 0;
      let yyleng = 0;
      let recovering = 0;
      const TERROR = 2;
      const EOF = 1;

      const args = lstack.slice.call(arguments, 1);
      // Use parser.lexer instead of this.lexer to avoid context issues
      const lexer = Object.create(parser.lexer);
      const sharedState = { yy: {} };

      for (const k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
          sharedState.yy[k] = this.yy[k];
        }
      }

      lexer.setInput(input, sharedState.yy);
      sharedState.yy.lexer = lexer;
      sharedState.yy.parser = this;
      if (typeof lexer.yylloc === 'undefined') lexer.yylloc = {};
      let yyloc = lexer.yylloc;
      lstack.push(yyloc);

      const ranges = lexer.options && lexer.options.ranges;

      if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
      } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
      }

      const popStack = (n) => {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
      };

      const lex = () => {
        let token = lexer.lex() || EOF;
        if (typeof token !== 'number') {
          token = this.symbols_[token] || token;
        }
        return token;
      };

      let symbol, preErrorSymbol, state, action, r, yyval = {}, p, len, newState, expected;
      while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
          action = this.defaultActions[state];
        } else {
          if (symbol === null || typeof symbol === 'undefined') {
            symbol = lex();
          }
          action = table[state] && table[state][symbol];
        }
        if (typeof action === 'undefined' || !action.length || !action[0]) {
          let error_rule_depth;
          let errStr = '';
          const locateNearestErrorRecoveryRule = (state) => {
            let stack_probe = stack.length - 1;
            let depth = 0;
            while (true) {
              if ((TERROR.toString()) in table[state]) return depth;
              if (state === 0 || stack_probe < 2) return false;
              stack_probe -= 2;
              state = stack[stack_probe];
              ++depth;
            }
          };
          if (!recovering) {
            error_rule_depth = locateNearestErrorRecoveryRule(state);
            expected = [];
            for (p in table[state]) {
              if (this.tokens_[p] && p > TERROR) {
                expected.push(`'${this.tokens_[p]}'`);
              }
            }
            if (lexer.showPosition) {
              errStr = `Parse error on line ${yylineno + 1}:\\n${lexer.showPosition()}\\nExpecting ${expected.join(', ')}, got '${this.tokens_[symbol] || symbol}'`;
            } else {
              errStr = `Parse error on line ${yylineno + 1}: Unexpected ${symbol === EOF ? 'end of input' : `'${this.tokens_[symbol] || symbol}'`}`;
            }
            this.parseError(errStr, {
              text: lexer.match,
              token: this.tokens_[symbol] || symbol,
              line: lexer.yylineno,
              loc: yyloc,
              expected: expected,
              recoverable: error_rule_depth !== false
            });
          } else if (preErrorSymbol !== EOF) {
            error_rule_depth = locateNearestErrorRecoveryRule(state);
          }
          if (recovering === 3) {
            if (symbol === EOF || preErrorSymbol === EOF) {
              throw new Error(errStr || 'Parsing halted while starting to recover from another error.');
            }
            yyleng = lexer.yyleng;
            yytext = lexer.yytext;
            yylineno = lexer.yylineno;
            yyloc = lexer.yylloc;
            symbol = lex();
          }
          if (error_rule_depth === false) {
            throw new Error(errStr || 'Parsing halted. No suitable error recovery rule available.');
          }
          popStack(error_rule_depth);
          preErrorSymbol = symbol === TERROR ? null : symbol;
          symbol = TERROR;
          state = stack[stack.length - 1];
          action = table[state] && table[state][TERROR];
          recovering = 3;
        }
        if (action[0] instanceof Array && action.length > 1) {
          throw new Error(`Parse Error: multiple actions possible at state: ${state}, token: ${symbol}`);
        }
        switch (action[0]) {
          case 1:
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
              if (recovering > 0) recovering--;
            } else {
              symbol = preErrorSymbol;
              preErrorSymbol = null;
            }
            break;
          case 2:
            len = this.rules_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
              first_line: lstack[lstack.length - (len || 1)].first_line,
              last_line: lstack[lstack.length - 1].last_line,
              first_column: lstack[lstack.length - (len || 1)].first_column,
              last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
              yyval._$.range = [lstack[lstack.length - (len || 1)].range[0], lstack[lstack.length - 1].range[1]];
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
            stack.push(this.rules_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
          case 3:
            return true;
        }
      }
      return true;
    }
  };

  #{@moduleInclude}

  #{lexerCode}

  class Parser {
    constructor() {
      this.yy = {};
      // Ensure this.lexer is always set to the parser's lexer
      this.lexer = parser.lexer;
    }
  }

  Parser.prototype = parser;
  parser.Parser = Parser;

  return parser;
})();"""

    return out

  generateCommonJS: (opt) ->
    opt = Object.assign {}, @options, opt
    moduleName = opt.moduleName or "parser"

    out = @generateESModule(opt)
    out += """

if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
  exports.parser = #{moduleName};
  exports.Parser = #{moduleName}.Parser;
  exports.parse = function () { return #{moduleName}.parse.apply(#{moduleName}, arguments); };
  exports.main = function() {};
}"""

    return out

  # ==[ Error Handling ]========================================================

  trace: ->
  warn: ->
    args = Array.prototype.slice.call(arguments, 0)
    throw new Error("Warning: #{args.join('')}")
  error: (msg) -> throw new Error(msg)

# ==[ Parser Object ]===========================================================

parser = {}

parser.init = (dict) ->
  @table          = dict.table
  @defaultActions = dict.defaultActions
  @performAction  = dict.performAction
  @rules_         = dict.rules_
  @symbols_       = dict.symbols_
  @tokens_        = dict.tokens_

# parser.trace = generator.trace;
# parser.warn = generator.warn;
# parser.error = generator.error;

parser.parseError = parseError = (str, hash) ->
  if hash.recoverable
    @trace(str)
  else
    error = new Error(str)
    error.hash = hash
    throw error

parser.parse = (input) ->
  stack       = [0]
  tstack      = [] # token stack
  vstack      = [null] # semantic value stack
  lstack      = [] # location stack
  table       = @table
  yytext      = ''
  yylineno    = 0
  yyleng      = 0
  recovering  = 0
  TERROR      = 2
  EOF         = 1

  args        = lstack.slice.call(arguments, 1)
  lexer       = Object.create(@lexer)
  sharedState = { yy: {} }

  # copy state
  for k of @yy
    if Object.prototype.hasOwnProperty.call(@yy, k)
      sharedState.yy[k] = @yy[k]

  lexer.setInput(input, sharedState.yy)
  sharedState.yy.lexer = lexer
  sharedState.yy.parser = @
  if typeof lexer.yylloc is 'undefined' then lexer.yylloc = {}
  yyloc = lexer.yylloc
  lstack.push(yyloc)

  ranges = lexer.options and lexer.options.ranges

  if typeof sharedState.yy.parseError is 'function'
    @parseError = sharedState.yy.parseError
  else
    @parseError = Object.getPrototypeOf(@).parseError

  popStack = (n) ->
    stack.length  = stack.length  - 2 * n
    vstack.length = vstack.length - n
    lstack.length = lstack.length - n

  lex = ->
    token = lexer.lex() or EOF
    # if token isn't its numeric value, convert
    if typeof token isnt 'number'
      token = @symbols_[token] or token
    token

  yyval = {}

  while true
    # retreive state number from top of stack
    state = stack[stack.length - 1]

    # use default actions if available
    if @defaultActions[state]
      action = @defaultActions[state]
    else
      if symbol is null or typeof symbol is 'undefined'
        symbol = lex()
      # read action for current state and first input
      action = table[state] and table[state][symbol]

    # handle parse error
    if typeof action is 'undefined' or not action.length or not action[0]
      error_rule_depth
      errStr = ''

      # Return the rule stack depth where the nearest error recovery rule was found.
      # Return FALSE when no error recovery rule was found.
      locateNearestErrorRecoveryRule = (state) ->
        stack_probe = stack.length - 1
        depth = 0

        # try to recover from error
        loop
          # check for error recovery rule in this state
          return depth if (TERROR.toString()) of table[state]
          return false if state is 0 or stack_probe < 2 # No error recovery rule
          stack_probe -= 2 # popStack(1): [symbol, action]
          state = stack[stack_probe]
          ++depth

      unless recovering
        # first see if there's any chance at hitting an error recovery rule:
        error_rule_depth = locateNearestErrorRecoveryRule(state)

        # Report error
        expected = []
        for p of table[state]
          if @tokens_[p] and p > TERROR then expected.push("'#{@tokens_[p]}'")
        if lexer.showPosition
          errStr = "Parse error on line #{yylineno + 1}:\n#{lexer.showPosition()}\nExpecting #{expected.join(', ')}, got '#{@tokens_[symbol] or symbol}'"
        else
          errStr = "Parse error on line #{yylineno + 1}: Unexpected #{if symbol is EOF then "end of input" else "'#{@tokens_[symbol] or symbol}'"}"
        @parseError(errStr, {
          text:        lexer.match
          token:       @tokens_[symbol] or symbol
          line:        lexer.yylineno
          loc:         yyloc
          expected:    expected
          recoverable: (error_rule_depth isnt false)
        })
      else if preErrorSymbol isnt EOF
        error_rule_depth = locateNearestErrorRecoveryRule(state)

      # just recovered from another error
      if recovering is 3
        if symbol is EOF or preErrorSymbol is EOF
          throw new Error(errStr or 'Parsing halted while starting to recover from another error.')

        # discard current lookahead and grab another
        yyleng = lexer.yyleng
        yytext = lexer.yytext
        yylineno = lexer.yylineno
        yyloc = lexer.yylloc
        symbol = lex()

      # try to recover from error
      if error_rule_depth is false
        throw new Error(errStr or 'Parsing halted. No suitable error recovery rule available.')
      popStack(error_rule_depth)

      preErrorSymbol = if symbol is TERROR then null else symbol # save the lookahead token
      symbol         = TERROR # insert generic error symbol as new lookahead
      state          = stack[stack.length - 1]
      action         = table[state] and table[state][TERROR]
      recovering     = 3 # allow 3 real symbols to be shifted before reporting a new error

    # this shouldn't happen, unless resolve defaults are off
    if action[0] instanceof Array and action.length > 1
      throw new Error("Parse Error: multiple actions possible at state: #{state}, token: #{symbol}")

    switch action[0]
      when 1 # shift
        # @shiftCount++;
        stack.push(symbol)
        vstack.push(lexer.yytext)
        lstack.push(lexer.yylloc)
        stack.push(action[1]) # push state
        symbol = null
        unless preErrorSymbol # normal execution/no error
          yyleng = lexer.yyleng
          yytext = lexer.yytext
          yylineno = lexer.yylineno
          yyloc = lexer.yylloc
          if recovering > 0
            recovering--
        else
          # error just occurred, resume old lookahead f/ before error
          symbol = preErrorSymbol
          preErrorSymbol = null
        break

      when 2 # reduce
        # @reductionCount++;
        len = @rules_[action[1]][1]
        # perform semantic action
        yyval.$ = vstack[vstack.length - len] # default to $$ = $1
        # default location, uses first token for firsts, last for lasts
        yyval._$ = {
          first_line: lstack[lstack.length - (len or 1)].first_line
          last_line: lstack[lstack.length - 1].last_line
          first_column: lstack[lstack.length - (len or 1)].first_column
          last_column: lstack[lstack.length - 1].last_column
        }
        if ranges
          yyval._$.range = [lstack[lstack.length - (len or 1)].range[0], lstack[lstack.length - 1].range[1]]
        r = @performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], vstack, lstack].concat(args))
        if typeof r isnt 'undefined' then return r

        # pop off stack
        if len
          stack  = stack.slice(0, -1 * len * 2)
          vstack = vstack.slice(0, -1 * len)
          lstack = lstack.slice(0, -1 * len)

        stack.push(@rules_[action[1]][0])    # push nonterminal (reduce)
        vstack.push(yyval.$)
        lstack.push(yyval._$)
        # goto new state = table[STATE][NONTERMINAL]
        newState = table[stack[stack.length - 2]][stack[stack.length - 1]]
        stack.push(newState)
        break

      when 3 # accept
        return true

  true

# Export the main parser generator
exports.Parser = Generator

# ==[ Command Line ]============================================================

if !module.parent
  fs = require 'fs'
  path = require 'path'

  # Parse command line arguments
  args = process.argv.slice(2)

  if args.length < 1
    console.log "Usage: coffee rip-parser.coffee <grammar-file> [-o <output-file>]"
    console.log "Example: coffee rip-parser.coffee grammar.coffee -o parser.js"
    process.exit(1)

  grammar_file = args[0]
  output_file = null

  # Parse -o flag for output file
  for i in [1...args.length]
    if args[i] is '-o' and i + 1 < args.length
      output_file = args[i + 1]
      break

  # Default output filename if not specified
  if not output_file
    grammar_name = path.basename(grammar_file, path.extname(grammar_file))
    output_file = "#{grammar_name}-parser.js"

  try
    # Load the grammar file - supports both old parser format and new grammar format
    grammar_module = require grammar_file

    # Check if it's a new grammar format (exports grammar data) or old format (exports parser)
    if grammar_module.grammar
      # New format: grammar file exports { grammar, tokens, operators, startSymbol }
      grammar_data = grammar_module
      startSymbol = grammar_data.startSymbol or 'Root'

      # Create a grammar object that rip-parser can understand
      grammar = {
        bnf: grammar_data.grammar
        tokens: grammar_data.tokens
        operators: grammar_data.operators
        start: startSymbol
        parseParams: grammar_data.parseParams or []
        moduleInclude: grammar_data.moduleInclude or ''
        actionInclude: grammar_data.actionInclude or ''
      }

      # Generate the parser from the grammar data
      parser_generator = new Generator(grammar)
      parser_code = parser_generator.generate(moduleMain: ->)

    else if grammar_module.parser
      # Old format: grammar file exports { parser }
      parser_code = grammar_module.parser.generate(moduleMain: ->)

    else
      throw new Error("Grammar file must export either { grammar, tokens, operators, startSymbol } or { parser }")

    # Write the generated parser to a file
    fs.writeFileSync output_file, parser_code
    console.log "Generated parser: #{output_file}"

  catch error
    console.error "Error: #{error.message}"
    process.exit(1)
