# Dew - CoffeeScript-based Jison Parser Generator
# This is a CoffeeScript port of the jison.js parser generator

# Grammar nonterminals with productions, first/follow sets
class Nonterminal
  constructor: (symbol) ->
    @symbol = symbol
    @productions = []
    @first = []
    @follows = []
    @nullable = false

  toString: ->
    str = "#{@symbol}\n"
    str += if @nullable then 'nullable' else 'not nullable'
    str += "\nFirsts: #{@first.join(', ')}"
    str += "\nFollows: #{@first.join(', ')}"
    str += "\nProductions:\n  #{@productions.join('\n  ')}"
    return str

# Grammar productions with handles and precedence
class Production
  constructor: (symbol, handle, id) ->
    @symbol = symbol
    @handle = handle
    @nullable = false
    @id = id
    @first = []
    @precedence = 0

  toString: ->
    return "#{@symbol} -> #{@handle.join(' ')}"

# Represents LR items (productions with dot positions)
class Item
  constructor: (production, dot, f, predecessor) ->
    @production = production
    @dotPosition = dot or 0
    @follows = f or []
    @predecessor = predecessor
    @id = parseInt("#{production.id}a#{@dotPosition}", 36)
    @markedSymbol = @production.handle[@dotPosition]

  remainingHandle: ->
    return @production.handle.slice(@dotPosition + 1)

  eq: (e) ->
    return e.id is @id

  handleToString: ->
    handle = @production.handle.slice(0)
    handle[@dotPosition] = ".#{handle[@dotPosition] or ''}"
    return handle.join(' ')

  toString: ->
    temp = @production.handle.slice(0)
    temp[@dotPosition] = ".#{temp[@dotPosition] or ''}"
    return "#{@production.symbol} -> #{temp.join(' ')}#{if @follows.length is 0 then '' else " #lookaheads= #{@follows.join(' ')}"}"

# Manages set of LR items with deduplication
class ItemSet
  constructor: ->
    @map = new Map() # id -> item
    @reductions = []
    @goes = {}
    @edges = {}
    @shifts = false
    @inadequate = false

  push: (item) ->
    unless @map.has(item.id)
      @map.set(item.id, item)
    return @map.size

  concat: (set) ->
    # Handle both ItemSet and array inputs
    items = if set.items then set.items() else set
    for item in items
      @push(item)
    return @

  contains: (item) ->
    return @map.has(item.id)

  valueOf: ->
    # Memoized string representation for state deduplication
    v = Array.from(@map.keys()).sort().join('|')
    @valueOf = -> v
    return v

  forEach: (fn) ->
    for item in @map.values()
      fn(item)

  isEmpty: ->
    return @map.size is 0

  items: ->
    return Array.from(@map.values())

  toString: ->
    return @items().toString()

# Base class for building parse tables and generating parsers
class BaseGenerator
  constructor: (grammar, opt) ->
    options = Object.assign({}, grammar.options, opt)
    @terms = {}
    @operators = {}
    @productions = []
    @conflicts = 0
    @resolutions = []
    @options = options
    @parseParams = grammar.parseParams
    @yy = {} # accessed as yy free variable in the parser/lexer actions

    # source included in semantic action execution scope
    if grammar.actionInclude
      if typeof grammar.actionInclude is 'function'
        grammar.actionInclude = String(grammar.actionInclude)
          .replace(/^function \(\) \{/, '')
          .replace(/\}\s*$/, '')
      @actionInclude = grammar.actionInclude
    @moduleInclude = grammar.moduleInclude or ''

    @processGrammar(grammar)

  # ==[ Initialization ]=======================================================

  processGrammar: (grammar) ->
    bnf = grammar.bnf
    tokens = grammar.tokens
    nonterminals = @nonterminals = {}
    productions = @productions

    if tokens
      if typeof tokens is 'string'
        tokens = tokens.trim().split(' ')
      else
        tokens = tokens.slice(0)

    symbols = @symbols = []

    # calculate precedence of operators
    operators = @operators = processOperators(grammar.operators)

    # build productions from cfg
    @buildProductions(bnf, productions, nonterminals, symbols, operators)

    # augment the grammar
    @augmentGrammar(grammar)

  augmentGrammar: (grammar) ->
    if @productions.length is 0
      throw new Error("Grammar error: must have at least one rule.")
    # use specified start symbol, or default to first user defined production
    @startSymbol = grammar.start or grammar.startSymbol or @productions[0].symbol
    unless @nonterminals[@startSymbol]
      throw new Error("Grammar error: startSymbol must be a non-terminal found in your grammar.")
    @EOF = "$end"

    # augment the grammar
    acceptProduction = new Production('$accept', [@startSymbol, '$end'], 0)
    @productions.unshift(acceptProduction)

    # prepend parser tokens
    @symbols.unshift("$accept", @EOF)
    @symbols_[@EOF] = 1
    @terminals.unshift(@EOF)

    @nonterminals.$accept = new Nonterminal("$accept")
    @nonterminals.$accept.productions.push(acceptProduction)

    # add follow $ to start symbol
    @nonterminals[@startSymbol].follows.push(@EOF)

  # ==[ Grammar building ]=====================================================

  buildProductions: (bnf, productions, nonterminals, symbols, operators) ->
    actions = [
      '/* this == yyval */'
      @actionInclude or ''
      'var $0 = $$.length - 1;'
      'switch (yystate) {'
    ]
    actionGroups = {}
    prods, symbol
    productions_ = [0]
    symbolId = 1
    symbols_ = {}

    her = false # has error recovery

    addSymbol = (s) ->
      if s and not symbols_[s]
        symbols_[s] = ++symbolId
        symbols.push(s)

    # add error symbol; will be third symbol, or "2" ($accept, $end, error)
    addSymbol("error")

    for symbol of bnf
      continue unless bnf.hasOwnProperty(symbol)

      addSymbol(symbol)
      nonterminals[symbol] = new Nonterminal(symbol)

      if typeof bnf[symbol] is 'string'
        prods = bnf[symbol].split(/\s*\|\s*/g)
      else
        prods = bnf[symbol].slice(0)

      prods.forEach(buildProduction)

    for action of actionGroups
      actions.push(actionGroups[action].join(' '), action, 'break;')

    sym, terms = [], terms_ = {}
    each(symbols_, (id, sym) ->
      unless nonterminals[sym]
        terms.push(sym)
        terms_[id] = sym
    )

    @hasErrorRecovery = her

    @terminals = terms
    @terminals_ = terms_
    @symbols_ = symbols_

    @productions_ = productions_
    actions.push('}')

    actions = actions.join("\n")
      .replace(/YYABORT/g, 'return false')
      .replace(/YYACCEPT/g, 'return true')

    parameters = "yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */"
    if @parseParams
      parameters += ', ' + @parseParams.join(', ')

    @performAction = "function anonymous(#{parameters}) {\n#{actions}\n}"

    buildProduction = (handle) ->
      r, rhs, i
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
          label = "case #{productions.length + 1}:"
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
            .replace(/\$(-?\d+)/g, (_, n) ->
              return "$$[$0#{parseInt(n, 10) - rhs.length or ''}]"
            )
            # same as above for location references (@n)
            .replace(/@(-?\d+)/g, (_, n) ->
              return "_$[$0#{n - rhs.length or ''}]"
            )

          if action of actionGroups
            actionGroups[action].push(label)
          else
            actionGroups[action] = [label]

          # done with aliases; strip them.
          rhs = rhs.map((e, i) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, ''))
          r = new Production(symbol, rhs, productions.length + 1)
          # precedence specified also
          if handle[2] and operators[handle[2].prec]
            r.precedence = operators[handle[2].prec].precedence
        else
          # no action -> don't care about aliases; strip them.
          rhs = rhs.map((e, i) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, ''))
          # only precedence specified
          r = new Production(symbol, rhs, productions.length + 1)
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
        r = new Production(symbol, rhs, productions.length + 1)

      if r.precedence is 0
        # set precedence
        for i in [r.handle.length - 1..0]
          if not (r.handle[i] of nonterminals) and r.handle[i] of operators
            r.precedence = operators[r.handle[i]].precedence

      productions.push(r)
      productions_.push([symbols_[r.symbol], if r.handle[0] is '' then 0 else r.handle.length])
      nonterminals[symbol].productions.push(r)

  buildTable: ->
    @states = @canonicalCollection()
    @table = @parseTable(@states)
    @defaultActions = findDefaults(@table)

  canonicalCollection: ->
    item1 = new Item(@productions[0], 0, [@EOF])
    firstSet = new ItemSet()
    firstSet.push(item1)
    firstState = @closureOperation(firstSet)
    states = [firstState]
    marked = 0
    itemSet

    states.has = {}
    states.has[firstState.valueOf()] = 0

    while marked isnt states.length
      itemSet = states[marked]
      marked++
      itemSet.forEach((item) ->
        if item.markedSymbol and item.markedSymbol isnt @EOF
          @canonicalCollectionInsert(item.markedSymbol, itemSet, states, marked - 1)
      )

    return states

  canonicalCollectionInsert: (symbol, itemSet, states, stateNum) ->
    g = @gotoOperation(itemSet, symbol)
    unless g.predecessors
      g.predecessors = {}
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

  gotoOperation: (itemSet, symbol) ->
    gotoSet = new ItemSet()

    itemSet.forEach((item) ->
      if item.markedSymbol is symbol
        gotoSet.push(new Item(item.production, item.dotPosition + 1, item.follows, item.predecessor))
    )

    return if gotoSet.isEmpty() then gotoSet else @closureOperation(gotoSet)

  closureOperation: (itemSet) ->
    closureSet = new ItemSet()
    set = itemSet
    itemQueue, syms = {}

    loop
      itemQueue = new ItemSet()
      closureSet.concat(set)
      set.forEach((item) ->
        symbol = item.markedSymbol

        # if token is a non-terminal, recursively add closures
        if symbol and @nonterminals[symbol]
          unless syms[symbol]
            @nonterminals[symbol].productions.forEach((production) ->
              newItem = new Item(production, 0)
              unless closureSet.contains(newItem)
                itemQueue.push(newItem)
            )
            syms[symbol] = true
        else unless symbol
          # reduction
          closureSet.reductions.push(item)
          closureSet.inadequate = closureSet.reductions.length > 1 or closureSet.shifts
        else
          # shift
          closureSet.shifts = true
          closureSet.inadequate = closureSet.reductions.length > 0

      )

      set = itemQueue
      break if itemQueue.isEmpty()

    return closureSet

  parseTable: (itemSets) ->
    states = []
    nonterminals = @nonterminals
    operators = @operators
    conflictedStates = {} # array of [state, token] tuples
    s = 1
    r = 2
    a = 3 # shift, reduce, accept

    # for each item set
    itemSets.forEach((itemSet, k) ->
      state = states[k] = {}
      action, stackSymbol

      # set shift and goto actions
      for stackSymbol of itemSet.edges
        itemSet.forEach((item, j) ->
          # find shift and goto actions
          if item.markedSymbol is stackSymbol
            gotoState = itemSet.edges[stackSymbol]
            if nonterminals[stackSymbol]
              # store state to go to after a reduce
              state[@symbols_[stackSymbol]] = gotoState
            else
              state[@symbols_[stackSymbol]] = [s, gotoState]
        )

      # set accept action
      itemSet.forEach((item, j) ->
        if item.markedSymbol is @EOF
          # accept
          state[@symbols_[@EOF]] = [a]
      )

      allterms = if @lookAheads then false else @terminals

      # set reductions and resolve potential conflicts
      itemSet.reductions.forEach((item, j) ->
        # if parser uses lookahead, only enumerate those terminals
        terminals = allterms or @lookAheads(itemSet, item)

        terminals.forEach((stackSymbol) ->
          action = state[@symbols_[stackSymbol]]
          op = operators[stackSymbol]

          # Reading a terminal and current position is at the end of a production, try to reduce
          if action or (action and action.length)
            sol = resolveConflict(item.production, op, [r, item.production.id], if action[0] instanceof Array then action[0] else action)
            @resolutions.push([k, stackSymbol, sol])
            if sol.bydefault
              @conflicts++
              throw new Error("Grammar ambiguous when lookahead is #{stackSymbol} in state #{k}")
            else
              action = sol.action
          else
            action = [r, item.production.id]

          if action and action.length
            state[@symbols_[stackSymbol]] = action
          else if action is NONASSOC
            state[@symbols_[stackSymbol]] = undefined
        )
      )
    )

    if @conflicts > 0
      conflictDetails = "\nStates with conflicts:"
      each(conflictedStates, (val, state) ->
        conflictDetails += "\nState #{state}"
        conflictDetails += "\n  #{itemSets[state].join("\n  ")}"
      )
      throw new Error("Grammar conflicts: #{@conflicts} #{conflictDetails}")

    return states

  # ==[ Lookahead / Parsing algorithms ]=====================================

  computeLookaheads: ->
    @nullableSets()
    @firstSets()
    @followSets()

  nullableSets: ->
    @firsts = {}
    nonterminals = @nonterminals
    cont = true

    # loop until no further changes have been made
    while cont
      cont = false

      # check if each production is nullable
      @productions.forEach((production, k) ->
        unless production.nullable
          n = 0
          i = 0
          t
          for i in [0...production.handle.length]
            t = production.handle[i]
            if @nullable(t)
              n++
          if n is i # production is nullable if all tokens are nullable
            production.nullable = cont = true
      )

      # check if each symbol is nullable
      for symbol of nonterminals
        unless @nullable(symbol)
          for i in [0...nonterminals[symbol].productions.length]
            production = nonterminals[symbol].productions[i]
            if production.nullable
              nonterminals[symbol].nullable = cont = true

  nullable: (symbol) ->
    # epsilon
    if symbol is ''
      return true
    # RHS
    else if Array.isArray(symbol)
      for i in [0...symbol.length]
        t = symbol[i]
        unless @nullable(t)
          return false
      return true
    # terminal
    else unless @nonterminals[symbol]
      return false
    # nonterminal
    else
      return @nonterminals[symbol].nullable

  firstSets: ->
    productions = @productions
    nonterminals = @nonterminals
    cont = true

    # loop until no further changes have been made
    while cont
      cont = false
      productions.forEach((production, k) ->
        firsts = @first(production.handle)
        oldcount = nonterminals[production.symbol].first.length
        unionArrays(nonterminals[production.symbol].first, firsts)
        if oldcount isnt nonterminals[production.symbol].first.length
          cont = true
      )

  first: (symbol) ->
    # epsilon
    if symbol is ''
      return []
    # RHS
    else if symbol instanceof Array
      firsts = []
      for i in [0...symbol.length]
        t = symbol[i]
        unless @nonterminals[t]
          if firsts.indexOf(t) is -1
            firsts.push(t)
        else
          unionArrays(firsts, @nonterminals[t].first)
        unless @nullable(t)
          break
      return firsts
    # terminal
    else unless @nonterminals[symbol]
      return [symbol]
    # nonterminal
    else
      return @nonterminals[symbol].first

  followSets: ->
    productions = @productions
    nonterminals = @nonterminals
    cont = true

    # loop until no further changes have been made
    while cont
      cont = false

      productions.forEach((production, k) ->
        # q is used in Simple LALR algorithm to determine follows in context
        q
        ctx = !!@go_

        set = []
        oldcount
        for i in [0...production.handle.length]
          t = production.handle[i]
          unless nonterminals[t]
            continue

          # For Simple LALR algorithm, this.go_ checks if
          if ctx
            q = @go_(production.symbol, production.handle.slice(0, i))
            bool = not ctx or q is parseInt(@nterms_[t], 10)

            if i is production.handle.length + 1 and bool
              set = nonterminals[production.symbol].follows
            else
              part = production.handle.slice(i + 1)
              set = @first(part)
              if @nullable(part) and bool
                set.push.apply(set, nonterminals[production.symbol].follows)
          else
            part = production.handle.slice(i + 1)
            set = @first(part)
            if @nullable(part)
              set.push.apply(set, nonterminals[production.symbol].follows)

          oldcount = nonterminals[t].follows.length
          unionArrays(nonterminals[t].follows, set)
          if oldcount isnt nonterminals[t].follows.length
            cont = true
      )

  # ==[ Output/Generation ]==================================================

  generate: (opt) ->
    opt = Object.assign({}, @options, opt)

    # check for illegal identifier
    unless opt.moduleName or opt.moduleName.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
      opt.moduleName = "parser"

    switch opt.moduleType
      when "js"
        return @generateModule(opt)
      else
        return @generateCommonJSModule(opt)

  generateCommonJSModule: (opt) ->
    opt = Object.assign({}, @options, opt)
    moduleName = opt.moduleName or "parser"

    return "#{@generateModule(opt)}


if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = #{moduleName};
exports.Parser = #{moduleName}.Parser;
exports.parse = function () { return #{moduleName}.parse.apply(#{moduleName}, arguments); };
exports.main = function() {};
}"

  generateModule: (opt) ->
    opt = Object.assign({}, @options, opt)
    moduleName = opt.moduleName or "parser"

    out = "/* parser generated by dew-parser */\n"
    out += if moduleName.match(/\./) then moduleName else "var #{moduleName}"
    out += " = "
    out += @generateModuleExpr()

    return out

  generateModuleExpr: ->
    out = "(function(){\n"
    out += "\nvar parser = {"
    out += [
      "trace: function trace () { }"
      "yy: {}"
      "symbols_: #{JSON.stringify(@symbols_)}"
      "terminals_: #{JSON.stringify(@terminals_).replace(/\"(\d+)\":/g, '$1:')}"
      "productions_: #{JSON.stringify(@productions_)}"
      "performAction: #{String(@performAction)}"
      "table: #{JSON.stringify(@table).replaceAll('"', '')}"
      "defaultActions: #{JSON.stringify(@defaultActions).replaceAll('"', '')}"
      "parseError: #{String(parser.parseError)}"
      "parse: #{String(parser.parse)}"
    ].join(",\n")
    out += "};\n"
    out += @moduleInclude
    if @lexer and @lexer.generateModule
      out += @lexer.generateModule()
      out += "\nparser.lexer = lexer;"
    out += "\nfunction Parser () {\n  this.yy = {};\n}\n"
    out += "Parser.prototype = parser;"
    out += "parser.Parser = Parser;"
    out += "\nreturn new Parser;\n})();"

    return out

  createParser: ->
    p = eval(@generateModuleExpr())

    # for debugging
    p.productions = @productions

    bind = (method) ->
      return ->
        @lexer = p.lexer
        return @[method].apply(@, arguments)

    # backwards compatability
    p.lexer = @lexer
    p.generate = bind('generate')
    p.generateCommonJSModule = bind('generateCommonJSModule')
    p.generateModule = bind('generateModule')

    return p

  # ==[ Error handling / logging ]===========================================

  trace: ->

  warn: ->
    args = Array.prototype.slice.call(arguments, 0)
    throw new Error("Warning: #{args.join('')}")

  error: (msg) ->
    throw new Error(msg)

# LALRGenerator extends BaseGenerator for LALR(1) parsing
class LALRGenerator extends BaseGenerator
  constructor: (grammar, options) ->
    super(grammar, options)

    @type = "LALR(1)"

    options = options or {}
    @states = @canonicalCollection()
    @terms_ = {}

    newg = @newg = Object.assign(Object.create(BaseGenerator.prototype), {
      oldg: @
      trace: @trace
      nterms_: {}
      go_: (r, B) ->
        r = r.split(":")[0] # grab state #
        B = B.map((b) -> b.slice(b.indexOf(":") + 1))
        return @oldg.go(r, B)
    })
    newg.nonterminals = {}
    newg.productions = []

    @inadequateStates = []

    # if true, only lookaheads in inadequate states are computed (faster, larger table)
    # if false, lookaheads for all reductions will be computed (slower, smaller table)
    @onDemandLookahead = options.onDemandLookahead or false

    @buildNewGrammar()
    newg.computeLookaheads()
    @unionLookaheads()

    @table = @parseTable(@states)
    @defaultActions = findDefaults(@table)

  lookAheads: (state, item) ->
    return if !!@onDemandLookahead and not state.inadequate then @terminals else item.follows

  go: (p, w) ->
    q = parseInt(p, 10)
    for i in [0...w.length]
      q = @states[q].edges[w[i]] or q
    return q

  goPath: (p, w) ->
    q = parseInt(p, 10)
    t
    path = []
    for i in [0...w.length]
      t = if w[i] then "#{q}:#{w[i]}" else ''
      if t
        @newg.nterms_[t] = q
      path.push(t)
      q = @states[q].edges[w[i]] or q
      @terms_[t] = w[i]
    return { path: path, endState: q }

  # Every disjoint reduction of a nonterminal becomes a produciton in G'
  buildNewGrammar: ->
    newg = @newg

    @states.forEach((state, i) ->
      state.forEach((item) ->
        if item.dotPosition is 0
          # new symbols are a combination of state and transition symbol
          symbol = "#{i}:#{item.production.symbol}"
          @terms_[symbol] = item.production.symbol
          newg.nterms_[symbol] = i
          unless newg.nonterminals[symbol]
            newg.nonterminals[symbol] = new Nonterminal(symbol)
          pathInfo = @goPath(i, item.production.handle)
          p = new Production(symbol, pathInfo.path, newg.productions.length)
          newg.productions.push(p)
          newg.nonterminals[symbol].productions.push(p)

          # store the transition that get's 'backed up to' after reduction on path
          handle = item.production.handle.join(' ')
          goes = @states[pathInfo.endState].goes
          unless goes[handle]
            goes[handle] = []
          goes[handle].push(symbol)
      )
      if state.inadequate
        @inadequateStates.push(i)
    )

  unionLookaheads: ->
    newg = @newg
    states = if !!@onDemandLookahead then @inadequateStates else @states

    states.forEach((i) ->
      state = if typeof i is 'number' then @states[i] else i
      if state.reductions.length
        state.reductions.forEach((item) ->
          follows = {}
          for k in [0...item.follows.length]
            follows[item.follows[k]] = true
          state.goes[item.production.handle.join(' ')].forEach((symbol) ->
            newg.nonterminals[symbol].follows.forEach((symbol) ->
              terminal = @terms_[symbol]
              unless follows[terminal]
                follows[terminal] = true
                item.follows.push(terminal)
            )
          )
        )
    )

# ==[ Helper Functions ]=======================================================

# Iterate over objects
each = (obj, func) ->
  if obj.forEach
    obj.forEach(func)
  else
    p
    for p of obj
      if obj.hasOwnProperty(p)
        func.call(obj, obj[p], p, obj)

# Find default actions
findDefaults = (states) ->
  defaults = {}
  states.forEach((state, k) ->
    i = 0
    for act of state
      if {}.hasOwnProperty.call(state, act)
        i++

    if i is 1 and state[act][0] is 2
      # only one action in state and it's a reduction
      defaults[k] = state[act]
  )

  return defaults

# Merge arrays without duplicates
unionArrays = (a, b) ->
  ar = {}
  for k in [a.length - 1..0]
    ar[a[k]] = true
  for i in [b.length - 1..0]
    unless ar[b[i]]
      a.push(b[i])
  return a

# Set precedence and associativity of operators
processOperators = (ops) ->
  unless ops
    return {}
  operators = {}
  for i in [0...ops.length]
    prec = ops[i]
    for k in [1...prec.length]
      operators[prec[k]] = { precedence: i + 1, assoc: prec[0] }
  return operators

# Resolve conflicts of alternatives
resolveConflict = (production, op, reduce, shift) ->
  sln = { production: production, operator: op, r: reduce, s: shift }
  s = 1 # shift
  r = 2 # reduce
  a = 3 # accept

  if shift[0] is r
    sln.msg = "Resolve R/R conflict (use first production declared in grammar.)"
    sln.action = if shift[1] < reduce[1] then shift else reduce
    if shift[1] isnt reduce[1]
      sln.bydefault = true
    return sln

  if production.precedence is 0 or not op
    sln.msg = "Resolve S/R conflict (shift by default.)"
    sln.bydefault = true
    sln.action = shift
  else if production.precedence < op.precedence
    sln.msg = "Resolve S/R conflict (shift for higher precedent operator.)"
    sln.action = shift
  else if production.precedence is op.precedence
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
    sln.msg = "Resolve conflict (reduce for higher precedent production.)"
    sln.action = reduce

  return sln

# TODO: Replace this with a proper Parser class
parser = {}

parser.init = (dict) ->
  @table = dict.table
  @defaultActions = dict.defaultActions
  @performAction = dict.performAction
  @productions_ = dict.productions_
  @symbols_ = dict.symbols_
  @terminals_ = dict.terminals_

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
  stack = [0]
  tstack = [] # token stack
  vstack = [null] # semantic value stack
  lstack = [] # location stack
  table = @table
  yytext = ''
  yylineno = 0
  yyleng = 0
  recovering = 0
  TERROR = 2
  EOF = 1

  args = lstack.slice.call(arguments, 1)
  lexer = Object.create(@lexer)
  sharedState = { yy: {} }

  # copy state
  for k of @yy
    if Object.prototype.hasOwnProperty.call(@yy, k)
      sharedState.yy[k] = @yy[k]

  lexer.setInput(input, sharedState.yy)
  sharedState.yy.lexer = lexer
  sharedState.yy.parser = @
  if typeof lexer.yylloc is 'undefined'
    lexer.yylloc = {}
  yyloc = lexer.yylloc
  lstack.push(yyloc)

  ranges = lexer.options and lexer.options.ranges

  if typeof sharedState.yy.parseError is 'function'
    @parseError = sharedState.yy.parseError
  else
    @parseError = Object.getPrototypeOf(@).parseError

  popStack = (n) ->
    stack.length = stack.length - 2 * n
    vstack.length = vstack.length - n
    lstack.length = lstack.length - n

  lex = ->
    token
    token = lexer.lex() or EOF
    # if token isn't its numeric value, convert
    if typeof token isnt 'number'
      token = @symbols_[token] or token
    return token

  symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected
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
          if (TERROR.toString()) of table[state]
            return depth
          if state is 0 or stack_probe < 2
            return false # No suitable error recovery rule available.
          stack_probe -= 2 # popStack(1): [symbol, action]
          state = stack[stack_probe]
          ++depth

      unless recovering
        # first see if there's any chance at hitting an error recovery rule:
        error_rule_depth = locateNearestErrorRecoveryRule(state)

        # Report error
        expected = []
        for p of table[state]
          if @terminals_[p] and p > TERROR
            expected.push("'#{@terminals_[p]}'")
        if lexer.showPosition
          errStr = "Parse error on line #{yylineno + 1}:\n#{lexer.showPosition()}\nExpecting #{expected.join(', ')}, got '#{@terminals_[symbol] or symbol}'"
        else
          errStr = "Parse error on line #{yylineno + 1}: Unexpected #{if symbol is EOF then "end of input" else "'#{@terminals_[symbol] or symbol}'"}"
        @parseError(errStr, {
          text: lexer.match
          token: @terminals_[symbol] or symbol
          line: lexer.yylineno
          loc: yyloc
          expected: expected
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
      symbol = TERROR         # insert generic error symbol as new lookahead
      state = stack[stack.length - 1]
      action = table[state] and table[state][TERROR]
      recovering = 3 # allow 3 real symbols to be shifted before reporting a new error

    # this shouldn't happen, unless resolve defaults are off
    if action[0] instanceof Array and action.length > 1
      throw new Error("Parse Error: multiple actions possible at state: #{state}, token: #{symbol}")

    switch action[0]
      when 1 # shift
        #this.shiftCount++;

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

      when 2
        # reduce
        #this.reductionCount++;

        len = @productions_[action[1]][1]

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

        if typeof r isnt 'undefined'
          return r

        # pop off stack
        if len
          stack = stack.slice(0, -1 * len * 2)
          vstack = vstack.slice(0, -1 * len)
          lstack = lstack.slice(0, -1 * len)

        stack.push(@productions_[action[1]][0])    # push nonterminal (reduce)
        vstack.push(yyval.$)
        lstack.push(yyval._$)
        # goto new state = table[STATE][NONTERMINAL]
        newState = table[stack[stack.length - 2]][stack[stack.length - 1]]
        stack.push(newState)
        break

      when 3
        # accept
        return true

  return true

# Export the main parser generator
exports.Parser = LALRGenerator