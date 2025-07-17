#!/usr/bin/env coffee

# Sonar - LALR(1) Parser Generator
# An elegant CoffeeScript implementation of the DeRemer-Pennello algorithm
#
# Based on canonical literature:
# - "Compilers: Principles, Techniques, and Tools" (Dragon Book)
# - "Efficient Computation of LALR(1) Look-Ahead Sets" (DeRemer & Pennello, 1982)
# - "LR Parsing: Theory and Practice" (Knuth, 1965)

# =============================================================================
# Core Data Structures
# =============================================================================

# Utility: merge arrays without duplicates
union = (target, source) ->
  seen = Object.create null
  seen[item] = true for item in target

  for item in source when not seen[item]
    target.push item
    seen[item] = true

  target

# Grammar symbol (nonterminal)
class Nonterminal
  constructor: (@symbol) ->
    @productions = []
    @first = []
    @follows = []
    @nullable = false

# Production rule: A → α
class Production
  constructor: (@symbol, @handle, @id) ->
    @nullable = false
    @first = []
    @precedence = 0

# LR(0) item: [A → α•β] with LALR(1) lookahead
class Item
  constructor: (@production, @dot = 0, @follows = [], @predecessor = null) ->
    @nextSymbol = @production.handle[@dot]
    @id = parseInt("#{@production.id}a#{@dot}", 36)

# Set of LR items (parser state)
class LRState
  constructor: (items...) ->
    @list = items
    @length = @list.length
    @reductions = []
    @handleToSymbols = {}
    @transitions = {}
    @hasShifts = false
    @hasConflicts = false
    @keys = {}

    @keys[item.id] = true for item in @list

  concat: (set) ->
    items = set.list ? set
    @keys[item.id] = true for item in items
    @list.push items...
    @length = @list.length
    this

  push: (item) ->
    @keys[item.id] = true
    @list.push item
    @length = @list.length

  contains: (item) ->
    @keys[item.id]?

  valueOf: ->
    return @_value if @_value?
    @_value = @list.map((item) -> item.id).sort().join('|')

# =============================================================================
# LALR(1) Parser Generator
# =============================================================================

class LALRGenerator
  constructor: (grammar, options = {}) ->
    @options = Object.assign {}, grammar.options, options
    @terminals = {}
    @operators = {}
    @productions = []
    @conflicts = 0
    @resolutions = []
    @parseParams = grammar.parseParams
    @yy = {}

    # Process action includes
    if grammar.actionInclude
      if typeof grammar.actionInclude is 'function'
        @actionInclude = String(grammar.actionInclude)
          .replace(/^\s*function \(\) \{/, '')
          .replace(/\}\s*$/, '')
      else
        @actionInclude = grammar.actionInclude

    @moduleInclude = grammar.moduleInclude or ''

    # Build parser in phases with timing
    @_buildParser grammar

  _buildParser: (grammar) ->
    console.time 'processGrammar'
    @processGrammar grammar
    console.timeEnd 'processGrammar'

    console.time 'buildLRAutomaton'
    @states = @buildLRAutomaton()
    console.timeEnd 'buildLRAutomaton'

    @terminalMap = {}

    # Initialize lookahead state (replaces newg creation)
    @lookahead = {
      nonterminalMap: {},
      nonterminals: {},
      productions: []
    }

    @conflictStates = []
    @onDemandLookahead = @options.onDemandLookahead or false

    console.time 'buildAugmentedGrammar'
    @buildAugmentedGrammar()
    console.timeEnd 'buildAugmentedGrammar'

    # Compute lookaheads in lookahead context (replaces newg.computeLookaheads())
    savedNonterminals = @nonterminals
    savedProductions = @productions

    @nonterminals = @lookahead.nonterminals
    @productions = @lookahead.productions

    console.time 'computeLookaheads'
    @computeLookaheads()
    console.timeEnd 'computeLookaheads'

    @nonterminals = savedNonterminals
    @productions = savedProductions

    console.time 'unionLookaheads'
    @unionLookaheads()
    console.timeEnd 'unionLookaheads'

    console.time 'buildParseTable'
    @stateTable = @buildParseTable @states
    console.timeEnd 'buildParseTable'

    console.time 'computeDefaultActions'
    @defaultActions = @computeDefaultActions @stateTable
    console.timeEnd 'computeDefaultActions'

  # Specialized GOTO method for lookahead computation (DeRemer-Pennello algorithm)
  gotoEncoded: (stateId, symbolSequence) ->
    stateId = stateId.split(":")[0]
    symbolSequence = symbolSequence.map (s) -> s.slice(s.indexOf(":") + 1)
    @gotoState stateId, symbolSequence

  # Navigate through parser states following a symbol sequence
  gotoState: (startState, symbolSequence) ->
    currentState = parseInt startState, 10
    for symbol in symbolSequence
      currentState = @states[currentState].transitions[symbol] or currentState
    currentState

  # Get lookahead symbols for an item in a state
  getLookaheadSet: (state, item) ->
    if @onDemandLookahead and not state.hasConflicts
      @terminals
    else
      item.follows

  # ---------------------------------------------------------------------------
  # Grammar Processing
  # ---------------------------------------------------------------------------

  processGrammar: (grammar) ->
    @nonterminals = {}
    @symbols = []
    @operators = @_processOperators grammar.operators

    tokens = grammar.tokens
    if tokens
      tokens = if typeof tokens is 'string' then tokens.trim().split(' ') else tokens[..]

    @_buildProductions grammar.bnf, @productions, @nonterminals, @symbols, @operators

    if tokens and @terminals.length isnt tokens.length
      @trace "Warning: declared tokens differ from tokens found in rules."

    @_augmentGrammar grammar

  _processOperators: (ops) ->
    return {} unless ops

    operators = {}
    for precedence, i in ops
      for k in [1...precedence.length]
        operators[precedence[k]] =
          precedence: i + 1
          assoc: precedence[0]

    operators

  _augmentGrammar: (grammar) ->
    throw new Error "Grammar error: must have at least one rule." if @productions.length is 0

    @startSymbol = grammar.start or grammar.startSymbol or @productions[0].symbol
    unless @nonterminals[@startSymbol]
      throw new Error "Grammar error: startSymbol must be a non-terminal found in your grammar."

    @EOF = "$end"
    acceptProduction = new Production '$accept', [@startSymbol, '$end'], 0
    @productions.unshift acceptProduction
    @symbols.unshift "$accept", @EOF
    @symbolMap.$accept = 0
    @symbolMap[@EOF] = 1
    @terminals.unshift @EOF

    @nonterminals.$accept = new Nonterminal "$accept"
    @nonterminals.$accept.productions.push acceptProduction
    @nonterminals[@startSymbol].follows.push @EOF

  _buildProductions: (bnf, productions, nonterminals, symbols, operators) ->
    actions = [
      '/* this == yyval */'
      @actionInclude or ''
      'var $0 = $$.length - 1;'
      'switch (yystate) {'
    ]

    actionGroups = {}
    productionTable = [0]
    symbolId = 1
    symbolMap = {}

    addSymbol = (s) ->
      if s and not symbolMap[s]
        symbolMap[s] = ++symbolId
        symbols.push s

    addSymbol "error"

    # Process each nonterminal
    for symbol, rules of bnf when bnf.hasOwnProperty symbol
      addSymbol symbol
      nonterminals[symbol] = new Nonterminal symbol

      prods = if typeof rules is 'string' then rules.split(/\s*\|\s*/g) else rules[..]

      for handle in prods
        @_processProduction handle, symbol, productions, nonterminals,
                            addSymbol, actionGroups, operators, symbolMap, productionTable

    # Build action code
    for action, labels of actionGroups
      actions.push labels.join(' '), action, 'break;'

    # Build terminal mappings
    @_buildTerminalMappings symbolMap, nonterminals

    @symbolMap = symbolMap
    @productionTable = productionTable

    actions.push '}'
    actionsCode = actions.join('\n')
      .replace(/YYABORT/g, 'return false')
      .replace(/YYACCEPT/g, 'return true')

    parameters = "yytext, yyleng, yylineno, yy, yystate, $$, _$"
    parameters += ', ' + @parseParams.join(', ') if @parseParams

    @performAction = "function anonymous(#{parameters}) {\n#{actionsCode}\n}"

  _processProduction: (handle, symbol, productions, nonterminals, addSymbol, actionGroups, operators, symbolMap, productionTable) ->
    r = null
    rhs = null
    i = 0

    if Array.isArray handle
      rhs = if typeof handle[0] is 'string' then handle[0].trim().split(' ') else handle[0][..]

      for token in rhs
        addSymbol token

      if typeof handle[1] is 'string' or handle.length is 3
        label = 'case ' + (productions.length + 1) + ':'
        action = handle[1]

        # Process named semantic values
        if action.match(/[$@][a-zA-Z][a-zA-Z0-9_]*/)
          count = {}
          names = {}

          for token, i in rhs
            rhs_i = token.match(/\[[a-zA-Z][a-zA-Z0-9_-]*\]/)
            if rhs_i
              rhs_i = rhs_i[0].substr(1, rhs_i[0].length - 2)
              rhs[i] = token.substr(0, token.indexOf('['))
            else
              rhs_i = token

            if names[rhs_i]
              names[rhs_i + (++count[rhs_i])] = i + 1
            else
              names[rhs_i] = i + 1
              names[rhs_i + "1"] = i + 1
              count[rhs_i] = 1

          action = action.replace /\$([a-zA-Z][a-zA-Z0-9_]*)/g, (str, pl) ->
            if names[pl] then '$' + names[pl] else str
          action = action.replace /@([a-zA-Z][a-zA-Z0-9_]*)/g, (str, pl) ->
            if names[pl] then '@' + names[pl] else str

        action = action
          .replace(/([^'"])\$\$|^\$\$/g, '$1this.$')
          .replace(/@[0$]/g, "this._$")
          .replace(/\$(-?\d+)/g, (_, n) ->
            "$$[$0" + (parseInt(n, 10) - rhs.length || '') + "]")
          .replace(/@(-?\d+)/g, (_, n) ->
            "_$[$0" + (n - rhs.length || '') + "]")

        if actionGroups[action]
          actionGroups[action].push label
        else
          actionGroups[action] = [label]

        rhs = rhs.map (e) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '')

        r = new Production symbol, rhs, productions.length + 1
        if handle[2] and operators[handle[2].prec]
          r.precedence = operators[handle[2].prec].precedence
      else
        rhs = rhs.map (e) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '')
        r = new Production symbol, rhs, productions.length + 1
        if operators[handle[1].prec]
          r.precedence = operators[handle[1].prec].precedence
    else
      handle = handle.replace /\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, ''
      rhs = handle.trim().split ' '
      for token in rhs
        addSymbol token
      r = new Production symbol, rhs, productions.length + 1

    if r.precedence is 0
      for i in [(r.handle.length - 1)..0] by -1
        tok = r.handle[i]
        if tok of operators and tok not of nonterminals
          r.precedence = operators[tok].precedence
          break

    productions.push r
    productionTable.push [symbolMap[r.symbol], if r.handle[0] is '' then 0 else r.handle.length]
    nonterminals[symbol].productions.push r

  _buildTerminalMappings: (symbolMap, nonterminals) ->
    terminals = []
    terminalsMap = {}

    for name, id of symbolMap when symbolMap.hasOwnProperty(name)
      unless nonterminals[name]
        terminals.push name
        terminalsMap[id] = name

    @terminals = terminals
    @terminals_ = terminalsMap

  # ---------------------------------------------------------------------------
  # Lookahead Computation (DeRemer-Pennello Algorithm)
  # ---------------------------------------------------------------------------

  computeLookaheads: ->
    @computeLookaheads = -> # Prevent re-computation
    @_computeNullableSets()
    @_computeFirstSets()
    @_computeFollowSets()

  _computeNullableSets: ->
    changed = true
    while changed
      changed = false

      for production in @productions when not production.nullable
        nullableCount = 0
        for symbol in production.handle
          nullableCount++ if @_isNullable symbol

        if nullableCount is production.handle.length
          production.nullable = changed = true

      for symbol, nonterminal of @nonterminals when not @_isNullable symbol
        for production in nonterminal.productions when production.nullable
          nonterminal.nullable = changed = true
          break

  _isNullable: (symbol) ->
    return true if symbol is ''
    return symbol.every((s) => @_isNullable s) if Array.isArray symbol
    return false unless @nonterminals[symbol]
    @nonterminals[symbol].nullable

  _computeFirstSets: ->
    changed = true
    while changed
      changed = false

      for production in @productions
        firsts = @_first production.handle
        if firsts.length isnt production.first.length
          production.first = firsts
          changed = true

      for symbol, nonterminal of @nonterminals
        firsts = []
        union(firsts, production.first) for production in nonterminal.productions

        if firsts.length isnt nonterminal.first.length
          nonterminal.first = firsts
          changed = true

  _first: (symbols) ->
    return [] if symbols is ''
    return @_firstOfSequence symbols if Array.isArray symbols
    return [symbols] unless @nonterminals[symbols]
    @nonterminals[symbols].first

  _firstOfSequence: (symbols) ->
    firsts = []
    for symbol in symbols
      unless @nonterminals[symbol]
        firsts.push symbol unless symbol in firsts
      else
        union firsts, @nonterminals[symbol].first

      break unless @_isNullable symbol

    firsts

  _computeFollowSets: ->
    changed = true
    while changed
      changed = false

      for production in @productions
        q = !!@go_
        ctx = q

        for symbol, i in production.handle when @nonterminals[symbol]
          if ctx
            q = @gotoEncoded production.symbol, production.handle[0...i]
          bool = not ctx or q is parseInt(@lookahead.nonterminalMap[symbol], 10)

          followSet = if i is production.handle.length - 1 and bool
            @nonterminals[production.symbol].follows
          else
            part = production.handle[i + 1..]
            firstSet = @_first part
            if @_isNullable(part) and bool
              firstSet.concat @nonterminals[production.symbol].follows
            else
              firstSet

          oldLength = @nonterminals[symbol].follows.length
          union @nonterminals[symbol].follows, followSet
          changed = true if @nonterminals[symbol].follows.length isnt oldLength

  # ---------------------------------------------------------------------------
  # LR Automaton Construction
  # ---------------------------------------------------------------------------

  buildLRAutomaton: ->
    item1 = new Item @productions[0], 0, [@EOF]
    firstState = @_closure new LRState item1
    states = [firstState]
    marked = 0

    states.has = {}
    states.has[firstState] = 0

    while marked isnt states.length
      itemSet = states[marked++]

      for item in itemSet.list when item.nextSymbol and item.nextSymbol isnt @EOF
        @_insertLRState item.nextSymbol, itemSet, states, marked - 1

    states

  _closure: (itemSet) ->
    closureSet = new LRState()
    queue = itemSet.list or itemSet
    processed = {}

    while queue.length > 0
      newItems = []
      closureSet.concat queue

      for item in queue
        {nextSymbol} = item

        if nextSymbol and @nonterminals[nextSymbol] and not processed[nextSymbol]
          for production in @nonterminals[nextSymbol].productions
            newItem = new Item production, 0
            newItems.push newItem unless closureSet.contains newItem
          processed[nextSymbol] = true
        else unless nextSymbol
          closureSet.reductions.push item
          closureSet.hasConflicts = closureSet.reductions.length > 1 or closureSet.hasShifts
        else
          closureSet.hasShifts = true
          closureSet.hasConflicts = closureSet.reductions.length > 0

      queue = newItems

    closureSet

  _goto: (itemSet, symbol) ->
    gotoSet = new LRState()

    for item, n in itemSet.list when item.nextSymbol is symbol
      gotoSet.push new Item item.production, item.dot + 1, item.follows, n

    if gotoSet.length is 0 then gotoSet else @_closure gotoSet

  _insertLRState: (symbol, itemSet, states, stateNum) ->
    gotoSet = @_goto itemSet, symbol
    gotoSet.predecessors ?= {}

    if gotoSet.length > 0
      gotoValue = gotoSet.valueOf()
      existingIndex = states.has[gotoValue]

      if existingIndex is -1 or not existingIndex?
        states.has[gotoValue] = states.length
        itemSet.transitions[symbol] = states.length
        states.push gotoSet
        gotoSet.predecessors[symbol] = [stateNum]
      else
        itemSet.transitions[symbol] = existingIndex
        states[existingIndex].predecessors[symbol].push stateNum

  # ---------------------------------------------------------------------------
  # Parse Table Generation
  # ---------------------------------------------------------------------------

  buildParseTable: (itemSets) ->
    states = []
    {nonterminals, operators} = this
    conflictedStates = {}
    [SHIFT, REDUCE, ACCEPT] = [1, 2, 3]
    NONASSOC = 0

    for itemSet, k in itemSets
      state = states[k] = {}

      # Set shift and goto actions
      for stackSymbol, gotoState of itemSet.transitions
        for item in itemSet.list when item.nextSymbol is stackSymbol
          # Skip symbols that aren't in the symbolMap (prevents undefined keys)
          continue unless @symbolMap[stackSymbol]?

          if nonterminals[stackSymbol]
            state[@symbolMap[stackSymbol]] = gotoState
          else
            state[@symbolMap[stackSymbol]] = [SHIFT, gotoState]

      # Set accept action
      for item in itemSet.list when item.nextSymbol is @EOF
        # Skip if EOF symbol not in symbolMap (prevents undefined keys)
        continue unless @symbolMap[@EOF]?

        state[@symbolMap[@EOF]] = [ACCEPT]

      # Set reductions
      for item in itemSet.reductions
        terminals = if @getLookaheadSet then @getLookaheadSet(itemSet, item) else @terminals

        for stackSymbol in terminals
          # Skip symbols that aren't in the symbolMap (prevents undefined keys)
          continue unless @symbolMap[stackSymbol]?

          action = state[@symbolMap[stackSymbol]]
          op = operators[stackSymbol]

          if action
            solution = @_resolveConflict item.production, op, [REDUCE, item.production.id],
                                         if action[0] instanceof Array then action[0] else action
            @resolutions.push [k, stackSymbol, solution]

            if solution.bydefault
              @conflicts++
              conflictedStates[k] = true
              if @options.noDefaultResolve
                action = [action] unless action[0] instanceof Array
                action.push solution.r
            else
              action = solution.action
          else
            action = [REDUCE, item.production.id]

          if action?.length
            state[@symbolMap[stackSymbol]] = action
          else if action is NONASSOC
            state[@symbolMap[stackSymbol]] = undefined

    states

  _resolveConflict: (production, op, reduce, shift) ->
    solution = {production, operator: op, r: reduce, s: shift}
    [SHIFT, REDUCE] = [1, 2]
    NONASSOC = 0

    if shift[0] is REDUCE
      solution.action = if shift[1] < reduce[1] then shift else reduce
      solution.bydefault = true if shift[1] isnt reduce[1]
      return solution

    if production.precedence is 0 or not op
      solution.bydefault = true
      solution.action = shift
    else if production.precedence < op.precedence
      solution.action = shift
    else if production.precedence is op.precedence
      solution.action = switch op.assoc
        when "right" then shift
        when "left" then reduce
        when "nonassoc" then NONASSOC
        else shift
    else
      solution.action = reduce

    solution

  computeDefaultActions: (states) ->
    defaults = {}
    for state, k in states
      actionCount = 0
      lastAction = null

      for action of state when state.hasOwnProperty action
        actionCount++
        lastAction = state[action]

      defaults[k] = lastAction if actionCount is 1 and lastAction[0] is 2

    defaults

  # ---------------------------------------------------------------------------
  # Augmented Grammar for Lookahead Computation
  # ---------------------------------------------------------------------------

  buildAugmentedGrammar: ->
    @lookahead = {nonterminalMap: {}, nonterminals: {}, productions: []}
    @conflictStates = []
    @terminalMap = {}

    for state, i in @states
      for item in state.list when item.dot is 0
        symbol = "#{i}:#{item.production.symbol}"
        @terminalMap[symbol] = item.production.symbol
        @lookahead.nonterminalMap[symbol] = i
        @lookahead.nonterminals[symbol] ?= new Nonterminal symbol

        pathInfo = @_gotoStateWithPath i, item.production.handle
        production = new Production symbol, pathInfo.path, @lookahead.productions.length
        @lookahead.productions.push production
        @lookahead.nonterminals[symbol].productions.push production

        handle = item.production.handle.join ' '
        handleToSymbols = @states[pathInfo.endState].handleToSymbols
        (handleToSymbols[handle] ?= []).push symbol

      @conflictStates.push i if state.hasConflicts

  _gotoStateWithPath: (startState, symbolSequence) ->
    currentState = parseInt startState, 10
    path = []

    for symbol in symbolSequence
      transition = if symbol then "#{currentState}:#{symbol}" else ''
      if transition
        @lookahead.nonterminalMap[transition] = currentState
      path.push transition
      currentState = @states[currentState].transitions[symbol] or currentState
      @terminalMap[transition] = symbol

    {path, endState: currentState}

  unionLookaheads: ->
    statesToProcess = if @onDemandLookahead then @conflictStates else @states

    for i in statesToProcess
      state = if typeof i is 'number' then @states[i] else i

      if state.reductions.length
        for item in state.reductions
          follows = {}
          follows[follow] = true for follow in item.follows

          for symbol in state.handleToSymbols[item.production.handle.join ' ']
            for followSymbol in @lookahead.nonterminals[symbol].follows
              terminal = @terminalMap[followSymbol]
              unless follows[terminal]
                follows[terminal] = true
                item.follows.push terminal

  # ---------------------------------------------------------------------------
  # Code Generation
  # ---------------------------------------------------------------------------

  generate: (options = {}) ->
    @generateCommonJSModule Object.assign {}, @options, options

  generateCommonJSModule: (options = {}) ->
    moduleName = options.moduleName or "parser"
    moduleName = "parser" unless moduleName.match /^[A-Za-z_$][A-Za-z0-9_$]*$/

    out = @generateModule(options) + """
      \n\n
      if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
        exports.parser = #{moduleName};
        exports.Parser = #{moduleName}.Parser;
        exports.parse = function () { return #{moduleName}.parse.apply(#{moduleName}, arguments); };
        exports.main = function() {};
        if (typeof module !== 'undefined' && require.main === module) {
          exports.main(process.argv.slice(1));
        }
      }
      """

  generateModule: (options = {}) ->
    moduleName = options.moduleName or "parser"
    version = '0.5.0'; # require('./package.json').version

    out = "/* parser generated by sonar #{version} */\n"
    out += if moduleName.match /\./ then moduleName else "var #{moduleName}"
    out += " = #{@generateModuleExpr()}"

  generateModuleExpr: ->
    module = @_generateModuleCore()
    """
    (function(){
    #{module.commonCode}
    var parser = #{module.moduleCode};
    #{@moduleInclude}
    function Parser () {
      this.yy = {};
    }
    Parser.prototype = parser;
    parser.Parser = Parser;
    return new Parser;
    })();
    """

  _generateModuleCore: ->
    tableCode = @_generateTableCode @stateTable

    moduleCode = """{
      trace: function trace() {},
      yy: {},
      symbolMap: #{JSON.stringify @symbolMap},
      terminals_: #{JSON.stringify(@terminals_).replace /"([0-9]+)":/g, "$1:"},
      productionTable: #{JSON.stringify @productionTable},
      stateTable: #{tableCode.moduleCode},
      defaultActions: #{JSON.stringify(@defaultActions).replace /"([0-9]+)":/g, "$1:"},
      performAction: #{@performAction},
      parseError: function #{@parseError},
      parse: function #{@parse}
    }"""

    {commonCode: tableCode.commonCode, moduleCode}

  _generateTableCode: (stateTable) ->
    moduleCode = JSON.stringify(stateTable, null, 0)
      .replace /"([0-9]+)"(?=:)/g, "$1"

    {commonCode: '', moduleCode}

  # ---------------------------------------------------------------------------
  # Runtime Parser Methods
  # ---------------------------------------------------------------------------

  parseError: (str, hash) ->
    if hash.recoverable
      @trace str
    else
      error = new Error str
      error.hash = hash
      throw error

  parse: (input) ->
    stk = [0]
    val = [null]
    loc = []
    stateTable = @stateTable
    yytext = ''
    yylineno = 0
    yyleng = 0
    recovering = 0
    TERROR = 2
    EOF = 1

    lexer = Object.create @lexer
    sharedState = { yy: {} }

    for k of @yy when Object.prototype.hasOwnProperty.call(@yy, k)
      sharedState.yy[k] = @yy[k]

    lexer.setInput input, sharedState.yy
    sharedState.yy.lexer = lexer
    sharedState.yy.parser = this

    unless typeof lexer.yylloc isnt 'undefined'
      lexer.yylloc = {}
    yyloc = lexer.yylloc
    loc.push yyloc

    ranges = lexer.options and lexer.options.ranges

    if typeof sharedState.yy.parseError is 'function'
      @parseError = sharedState.yy.parseError
    else
      @parseError = Object.getPrototypeOf(this).parseError

    lex = =>
      token = lexer.lex() or EOF
      if typeof token isnt 'number'
        token = @symbolMap[token] or token
      token

    symbol = null
    preErrorSymbol = null
    state = null
    action = null
    r = null
    yyval = {}
    p = null
    len = null
    newState = null
    expected = null

    while true
      stkLen = stk.length
      state = stk[stkLen - 1]

      if @defaultActions[state]
        action = @defaultActions[state]
      else
        if symbol is null or typeof symbol is 'undefined'
          symbol = lex()
        action = stateTable[state] and stateTable[state][symbol]

      if typeof action is 'undefined' or not action.length or not action[0]
        errStr = ''

        unless recovering
          expected = []
          for p of stateTable[state]
            if @terminals_[p] and p > TERROR
              expected.push "'" + @terminals_[p] + "'"
          if lexer.showPosition
            errStr = 'Parse error on line ' + (yylineno + 1) + ":\n" +
              lexer.showPosition() + "\nExpecting " + expected.join(', ') +
              ", got '" + (@terminals_[symbol] or symbol) + "'"
          else
            errStr = 'Parse error on line ' + (yylineno + 1) + ": Unexpected " +
              (if symbol is EOF then "end of input" else "'" + (@terminals_[symbol] or symbol) + "'")
          @parseError errStr, {
            text: lexer.match
            token: @terminals_[symbol] or symbol
            line: lexer.yylineno
            loc: yyloc
            expected: expected
          }

        throw new Error errStr

      if action[0] instanceof Array and action.length > 1
        throw new Error 'Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol

      switch action[0]
        when 1 # shift
          stk.push symbol
          val.push lexer.yytext
          loc.push lexer.yylloc
          stk.push action[1]
          symbol = null
          unless preErrorSymbol
            yyleng = lexer.yyleng
            yytext = lexer.yytext
            yylineno = lexer.yylineno
            yyloc = lexer.yylloc
            if recovering > 0
              recovering--
          else
            symbol = preErrorSymbol
            preErrorSymbol = null

        when 2 # reduce
          len = @productionTable[action[1]][1]
          valLen = val.length
          locLen = loc.length
          yyval.$ = val[valLen - len]
          locFirst = loc[locLen - (len or 1)]
          locLast = loc[locLen - 1]
          yyval._$ = {
            first_line: locFirst.first_line
            last_line: locLast.last_line
            first_column: locFirst.first_column
            last_column: locLast.last_column
          }
          if ranges
            yyval._$.range = [locFirst.range[0], locLast.range[1]]
          r = @performAction.apply yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], val, loc]

          if typeof r isnt 'undefined'
            return r

          if len
            stk.length = stk.length - (len * 2)
            val.length = val.length - len
            loc.length = loc.length - len

          stk.push @productionTable[action[1]][0]
          val.push yyval.$
          loc.push yyval._$
          stkLen = stk.length
          newState = stateTable[stk[stkLen - 2]][stk[stkLen - 1]]
          stk.push newState

        when 3 # accept
          return true

  trace: ->
    # Debug tracing - no-op by default

  createParser: ->
    parser = eval @generateModuleExpr()
    parser.productions = @productions

    bindMethod = (method) =>
      =>
        @lexer = parser.lexer
        @[method].apply this, arguments

    parser.lexer = @lexer
    parser.generate = bindMethod 'generate'
    parser.generateModule = bindMethod 'generateModule'
    parser.generateCommonJSModule = bindMethod 'generateCommonJSModule'

    parser

# =============================================================================
# Exports
# =============================================================================

Sonar = exports.Sonar = exports

Sonar.Parser = (grammar, options) ->
  generator = new LALRGenerator grammar, options
  generator.createParser()

exports.LALRGenerator = LALRGenerator

Sonar.Generator = (g, options) ->
  opt = Object.assign {}, g.options, options
  new LALRGenerator g, opt

exports.Parser = (grammar, options) ->
  generator = Sonar.Generator grammar, options
  generator.createParser()

# =============================================================================
# CLI Interface
# =============================================================================

if require.main is module
  fs = require 'fs'
  path = require 'path'

  # Parse command line arguments
  args = process.argv[2..]

  showHelp = ->
    console.log """
    Sonar - LALR(1) Parser Generator
    ================================

    Usage: coffee sonar.coffee [options] [grammar-file]

    Options:
      -h, --help              Show this help message
      -s, --stats             Show grammar statistics and analysis
      -g, --generate          Generate parser code (default)
      -o, --output <file>     Output file (default: parser.js)
      -l, --language <lang>   Language pack output (js, coffee, json)
      -v, --verbose           Verbose output with timing
      -t, --table             Show parse table information
      -c, --conflicts         Show shift/reduce conflicts
      --format <format>       Output format (commonjs, module, standalone)
      --optimize              Enable parser optimizations
      --debug                 Include debug information

    Examples:
      coffee sonar.coffee grammar.coffee
      coffee sonar.coffee --stats --verbose grammar.coffee
      coffee sonar.coffee --generate --output parser.js grammar.coffee
      coffee sonar.coffee --language json --output grammar.json grammar.coffee

    Grammar Statistics:
      Use --stats to see detailed information about:
      • Symbol counts (terminals, nonterminals)
      • Production rule analysis
      • Parser state information
      • Conflict detection and resolution

    Language Packs:
      Use --language to export grammar in different formats:
      • js: JavaScript module
      • coffee: CoffeeScript module
      • json: JSON data structure
    """

  showStats = (generator, options = {}) ->
    # Get raw grammar symbols (user-defined)
    capturedGrammar = generator.originalGrammar || {}

    # Calculate user-defined symbols
    userSymbols = new Set()
    if capturedGrammar.bnf
      for rule of capturedGrammar.bnf
        userSymbols.add(rule)
    if capturedGrammar.tokens
      for token in capturedGrammar.tokens.split(' ') when token.trim()
        userSymbols.add(token.trim())
    if capturedGrammar.startSymbol
      userSymbols.add(capturedGrammar.startSymbol)

    userSymbolCount = userSymbols.size

    # Calculate parser statistics
    totalSymbols = Object.keys(generator.symbolMap || {}).length
    terminals = Object.keys(generator.terminals_ || {}).length
    nonterminals = Object.keys(generator.nonterminals || {}).length
    productions = generator.productions?.length || 0
    states = generator.states?.length || 0
    conflicts = generator.conflictStates?.length || 0

    # System symbols (added by parser generator)
    systemSymbols = ['error', '$accept', '$end']
    systemSymbolCount = systemSymbols.filter((s) -> s in Object.keys(generator.symbolMap || {})).length

    # Calculate average production length
    avgProdLength = if productions > 0
      totalLength = generator.productions.reduce(((sum, p) -> sum + p.handle.length), 0)
      (totalLength / productions).toFixed(1)
    else
      0

    # Calculate parse table statistics
    stateTableSize = Object.keys(generator.stateTable || {}).length
    defaultActionsSize = Object.keys(generator.defaultActions || {}).length

    # Calculate action types in parse table
    actionStats = {shift: 0, reduce: 0, accept: 0, error: 0}
    if generator.stateTable
      for stateId, state of generator.stateTable
        for symbol, action of state
          if Array.isArray(action)
            switch action[0]
              when 1 then actionStats.shift++
              when 2 then actionStats.reduce++
              when 3 then actionStats.accept++
          else
            actionStats.error++

    # Default mode: Show only user-defined symbols
    if not options.debug and not options.verbose
      console.log """
      📊 Grammar Statistics
      ====================

      Symbols:
      • Terminals: #{terminals}
      • Nonterminals: #{nonterminals}
      • Total Symbols: #{userSymbolCount}

      Productions:
      • Total Productions: #{productions}
      • Average Production Length: #{avgProdLength}

      Parser States:
      • Total States: #{states}
      • States with Conflicts: #{conflicts}
      • Conflict Rate: #{if states > 0 then (conflicts / states * 100).toFixed(1) else 0}%

      Parse Table:
      • Total Actions: #{stateTableSize}
      • Shift Actions: #{actionStats.shift}
      • Reduce Actions: #{actionStats.reduce}
      • Accept Actions: #{actionStats.accept}
      """

    # Debug/verbose mode: Show detailed breakdown
    else
      console.log """
      📊 Grammar Statistics (Debug Mode)
      ==================================

      Symbols:
      • User-defined symbols: #{userSymbolCount}
      • Parser-generated symbols: #{systemSymbolCount} (#{systemSymbols.join(', ')})
      • Total symbols in parser: #{totalSymbols}

      Symbol Classification:
      • Terminals: #{terminals}
      • Nonterminals: #{nonterminals}
      • System symbols: #{systemSymbolCount}

      Productions:
      • Total Productions: #{productions}
      • Average Production Length: #{avgProdLength}
      • Shortest Production: #{if productions > 0 then Math.min(...generator.productions.map((p) -> p.handle.length)) else 0}
      • Longest Production: #{if productions > 0 then Math.max(...generator.productions.map((p) -> p.handle.length)) else 0}

      Parser States:
      • Total States: #{states}
      • States with Conflicts: #{conflicts}
      • Conflict Rate: #{if states > 0 then (conflicts / states * 100).toFixed(1) else 0}%

      Parse Table:
      • Total Actions: #{stateTableSize}
      • Shift Actions: #{actionStats.shift}
      • Reduce Actions: #{actionStats.reduce}
      • Accept Actions: #{actionStats.accept}
      • Default Actions: #{defaultActionsSize}
      """

    if generator.conflictStates?.length > 0
      console.log """

      ⚠️  Conflicts Detected:
      • States with conflicts: #{generator.conflictStates.join(', ')}
      • Use --conflicts for detailed conflict analysis
      """

  showConflicts = (generator) ->
    if not generator.conflictStates?.length
      console.log "✅ No conflicts detected in grammar"
      return

    console.log """
    ⚠️  Shift/Reduce Conflicts
    =========================

    """

    for stateId in generator.conflictStates
      state = generator.states[stateId]
      console.log "State #{stateId}:"
      console.log "  Items: #{state.list?.length || 0}"
      console.log "  Reductions: #{state.reductions?.length || 0}"
      console.log "  Shifts: #{Object.keys(state.transitions || {}).length}"
      console.log ""

  generateLanguagePack = (generator, language, outputFile) ->
    switch language.toLowerCase()
      when 'js', 'javascript'
        content = """
        // Generated by Sonar LALR(1) Parser Generator
        module.exports = {
          symbols: #{JSON.stringify(generator.symbols_ || {}, null, 2)},
          terminals: #{JSON.stringify(generator.terminals_ || {}, null, 2)},
          productions: #{JSON.stringify(generator.productions || [], null, 2)},
          states: #{generator.states?.length || 0},
          conflicts: #{generator.conflictStates?.length || 0}
        };
        """

      when 'coffee', 'coffeescript'
        content = """
        # Generated by Sonar LALR(1) Parser Generator
        module.exports =
          symbols: #{JSON.stringify(generator.symbols_ || {})}
          terminals: #{JSON.stringify(generator.terminals_ || {})}
          productions: #{JSON.stringify(generator.productions || [])}
          states: #{generator.states?.length || 0}
          conflicts: #{generator.conflictStates?.length || 0}
        """

      when 'json'
        content = JSON.stringify({
          symbols: generator.symbols_ || {}
          terminals: generator.terminals_ || {}
          productions: generator.productions || []
          states: generator.states?.length || 0
          conflicts: generator.conflictStates?.length || 0
          metadata:
            generator: "Sonar LALR(1)"
            generated: new Date().toISOString()
        }, null, 2)

      else
        throw new Error "Unsupported language: #{language}"

    fs.writeFileSync outputFile, content
    console.log "✅ Language pack written to #{outputFile}"

  # Parse options
  options = {
    help: false
    stats: false
    generate: true
    output: 'parser.js'
    language: null
    verbose: false
    table: false
    conflicts: false
    format: 'commonjs'
    optimize: false
    debug: false
  }

  grammarFile = null
  i = 0

  while i < args.length
    arg = args[i]

    switch arg
      when '-h', '--help'
        options.help = true
      when '-s', '--stats'
        options.stats = true
      when '-g', '--generate'
        options.generate = true
      when '-o', '--output'
        options.output = args[++i]
      when '-l', '--language'
        options.language = args[++i]
      when '-v', '--verbose'
        options.verbose = true
      when '-t', '--table'
        options.table = true
      when '-c', '--conflicts'
        options.conflicts = true
      when '--format'
        options.format = args[++i]
      when '--optimize'
        options.optimize = true
      when '--debug'
        options.debug = true
      else
        if not grammarFile and not arg.startsWith('-')
          grammarFile = arg
        else
          console.error "Unknown option: #{arg}"
          process.exit 1

    i++

  # Show help if requested or no arguments
  if options.help or (not grammarFile and not options.stats)
    showHelp()
    process.exit 0

  # Main execution
  try
    if grammarFile
      unless fs.existsSync grammarFile
        console.error "❌ Grammar file not found: #{grammarFile}"
        process.exit 1

      # Read and parse grammar
      grammarContent = fs.readFileSync grammarFile, 'utf8'

      # Parse grammar based on file type
      if grammarFile.endsWith('.coffee')
        # Try to require the grammar file directly first
        try
          grammarModule = require(path.resolve(grammarFile))

          # Check if it's a direct export of grammar specification
          if grammarModule.grammar and grammarModule.operators and grammarModule.tokens
            # Transform the grammar format to match LALRGenerator expectations
            grammar = {
              bnf: grammarModule.grammar           # LALRGenerator expects 'bnf' not 'grammar'
              operators: grammarModule.operators
              tokens: grammarModule.tokens
              start: grammarModule.start
              startSymbol: grammarModule.start     # Some code paths check for 'startSymbol'
            }
          else
            # Fall back to the jison mocking approach for other CoffeeScript grammar files
            capturedGrammar = null
            MockParser = (spec) ->
              capturedGrammar = spec
              return {
                generate: -> ''
                generateModule: -> ''
                generateCommonJSModule: -> ''
              }

            # Temporarily replace the jison module
            originalJison = require.cache[require.resolve('jison')]
            mockJison = { Parser: MockParser }
            require.cache[require.resolve('jison')] = { exports: mockJison }

            # Delete the cached module and require again
            delete require.cache[path.resolve(grammarFile)]
            grammarModule = require(path.resolve(grammarFile))

            # Restore original jison module
            if originalJison
              require.cache[require.resolve('jison')] = originalJison
            else
              delete require.cache[require.resolve('jison')]

            grammar = capturedGrammar

        catch error
          console.error "❌ Failed to load grammar from #{grammarFile}: #{error.message}"
          process.exit 1

        unless grammar
          console.error "❌ Failed to capture grammar from #{grammarFile}"
          process.exit 1

      else if grammarFile.endsWith('.json')
        grammar = JSON.parse(grammarContent)

      else
        console.error "❌ Unsupported grammar format. Use .coffee or .json"
        process.exit 1

      if options.verbose
        console.log "🔧 Processing grammar: #{grammarFile}"

            # Create generator
      generator = new LALRGenerator grammar, {
        optimize: options.optimize
        debug: options.debug
      }

      # Store original grammar for user-defined symbol counting
      generator.originalGrammar = grammar

      # Show statistics
      if options.stats
        showStats generator, options

      # Show conflicts
      if options.conflicts
        showConflicts generator

      # Generate language pack
      if options.language
        generateLanguagePack generator, options.language, options.output

      # Generate parser
      else if options.generate
        if options.verbose
          console.log "🚀 Generating parser..."

        parserCode = generator.generate({
          format: options.format
          debug: options.debug
        })

        fs.writeFileSync options.output, parserCode

        stats = fs.statSync options.output
        console.log "✅ Parser generated successfully!"
        console.log "   Output: #{options.output}"
        console.log "   Size: #{stats.size} bytes"

        if options.verbose
          console.log "   States: #{generator.states?.length || 0}"
          console.log "   Productions: #{generator.productions?.length || 0}"
          console.log "   Conflicts: #{generator.conflictStates?.length || 0}"

    else
      console.error "❌ No grammar file specified"
      process.exit 1

  catch error
    console.error "❌ Error:", error.message
    if options.verbose
      console.error error.stack
    process.exit 1