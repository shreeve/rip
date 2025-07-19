#!/usr/bin/env coffee

# Sonar - LALR(1) Parser Generator
# Elegant CoffeeScript implementation of standard LALR(1) parsing

# ==============================================================================
# Core Data Structures
# ==============================================================================

# Unified Symbol class for both terminals and nonterminals
class Symbol
  constructor: (name, isTerminal = false, id) ->
    @id         = id         # unique symbol id
    @name       = name       # symbol name (e.g. "Expression", "IF", "$end")
    @isTerminal = isTerminal # true if terminal, false if nonterminal
    @nullable   = false      # LALR(1) nullable computation (nonterminals only)
    @first      = new Set()  # LALR(1) FIRST sets (nonterminals only)
    @follows    = new Set()  # LALR(1) FOLLOW sets (nonterminals only)
    @productions = []        # Productions for this nonterminal (nonterminals only)

# Production rule: A → α
class Production
  constructor: (symbol, handle, id) ->
    @symbol     = symbol
    @handle     = handle
    @id         = id
    @nullable   = false
    @first      = new Set
    @precedence = 0

# LR(0) item: [A → α•β] with LALR(1) lookahead
class Item
  constructor: (production, dot = 0, follows = []) ->
    @production = production
    @dot        = dot
    @follows    = follows
    @nextSymbol = @production.handle[@dot]
    @id         = parseInt("#{@production.id}a#{@dot}", 36)

# LR parser state (set of items)
class LRState
  constructor: (items...) ->
    @items        = new Set(items)
    @reductions   = new Set()
    @transitions  = {}
    @hasShifts    = false
    @hasConflicts = false
    @id           = null

# ==============================================================================
# LALR(1) Parser Generator
# ==============================================================================

class LALRGenerator
  constructor: (grammar, options = {}) ->

    # Configuration
    @options = Object.assign {}, grammar.options, options
    @parseParams = grammar.parseParams
    @yy = {}

    # Grammar structures
    @terminals   = {}
    @operators   = {}
    @productions = []
    @conflicts   = 0

    # Initialize unified symbol system
    @symbols = new Map()      # name -> Symbol object

    # Pre-create special symbols with exact same IDs as original system
    # This is critical for LALR(1) compatibility
    @_createSpecialSymbol "$accept", false, 0 # ID = 0 (nonterminal)
    @_createSpecialSymbol "$end"   , true , 1 # ID = 1 (terminal)
    @_createSpecialSymbol "error"  , true , 2 # ID = 2 (terminal)

    # Code generation setup
    @_setupCodeGeneration grammar
    @_buildParser grammar

  # ==============================================================================
  # Unified Symbol Management
  # ==============================================================================

  # Create special symbols with guaranteed ID assignment
  _createSpecialSymbol: (name, isTerminal, id) ->
    symbol = new Symbol name, isTerminal, id
    @symbols.set name, symbol
    symbol

  _setupCodeGeneration: (grammar) ->
    if grammar.actionInclude
      @actionInclude = if typeof grammar.actionInclude is 'function'
        String(grammar.actionInclude)
          .replace(/^\s*function \(\) \{/, '')
          .replace(/\}\s*$/, '')
      else
        grammar.actionInclude

    @moduleInclude = grammar.moduleInclude or ''

  _buildParser: (grammar) ->
    timing = (label, fn) =>
      console.time(label)
      result = fn() if fn
      console.timeEnd(label)
      result

    timing 'sonar', =>
      timing 'processGrammar'       , => @processGrammar grammar
      timing 'buildLRAutomaton'     , => @buildLRAutomaton()
      timing 'computeLookaheads'    , => @computeLookaheads()
      timing 'assignItemLookaheads' , => @assignItemLookaheads()
      timing 'buildParseTable'      , => @buildParseTable @states
      timing 'computeDefaultActions', => @computeDefaultActions @stateTable

  # ============================================================================
  # Grammar Processing
  # ============================================================================

  processGrammar: (grammar) ->
    @nonterminals = {}
    # Special symbols already created by unified symbol system
    # Just need to maintain legacy array structure for compatibility
    @symbolsArray = ["$accept", "$end", "error"]  # Legacy array compatibility
    @operators = @_processOperators grammar.operators

    tokens = grammar.tokens
    tokens = if typeof tokens is 'string' then tokens.trim().split(' ') else tokens?[..]

    @_buildProductions grammar.bnf ? grammar.grammar, @productions, @nonterminals, @symbolsArray, @operators

    if tokens and @terminals.length isnt tokens.length
      @trace "Warning: declared tokens differ from tokens found in rules."

    @_augmentGrammar grammar

  _processOperators: (ops) ->
    return {} unless ops

    operators = {}
    for precedence, i in ops
      for k in [1...precedence.length]
        operators[precedence[k]] = {precedence: i + 1, assoc: precedence[0]}
    operators

  _augmentGrammar: (grammar) ->
    throw new Error "Grammar error: must have at least one rule." if @productions.length is 0

    @startSymbol = grammar.start or grammar.startSymbol or @productions[0].symbol
    unless @nonterminals[@startSymbol]
      throw new Error "Grammar error: startSymbol must be a non-terminal found in your grammar."

    acceptProduction = new Production "$accept", [@startSymbol, "$end"], 0
    @productions.push acceptProduction
    @acceptProductionIndex = @productions.length - 1

    # Use unified Symbol for $accept (already created in initialization)
    @nonterminals.$accept = @symbols.get "$accept"
    @nonterminals.$accept.productions.push acceptProduction
    @nonterminals[@startSymbol].follows.add "$end"

  _buildProductions: (bnf, productions, nonterminals, symbols, operators) ->
    actions = [
      '/* this == yyval */'
      @actionInclude or ''
      'var $0 = $$.length - 1;'
      'hasProp = {}.hasOwnProperty;'
      'switch (yystate) {'
    ]

    actionGroups = {}
    productionTable = [0]
    # symbolId starts at 3 because special symbols are already assigned IDs 0, 1, 2
    symbolId = 3
    symbolMap = {"$accept": 0, "$end": 1, "error": 2}  # Pre-map all reserved symbols

    # Use unified symbol system but maintain exact same ID assignment
    addSymbol = (s) =>
      if s and not symbolMap[s]
        # Check if symbol already exists in unified system from special symbol initialization
        existingSymbol = @symbols.get s
        if existingSymbol
          # Use existing ID (for special symbols)
          symbolMap[s] = existingSymbol.id
        else
          # Create new symbol with exact same ID as original system would assign
          isTerminal = !bnf[s]  # If not in BNF rules, it's a terminal
          id = symbolId++  # Use original system's ID assignment
          symbol = new Symbol s, isTerminal, id
          @symbols.set s, symbol
          symbolMap[s] = id
        symbols.push s

    # Process nonterminals and their productions
    for own symbol, rules of bnf
      addSymbol symbol
      # Use unified Symbol instead of separate Nonterminal
      unifiedSymbol = @symbols.get symbol
      nonterminals[symbol] = unifiedSymbol

      prods = if typeof rules is 'string' then rules.split(/\s*\|\s*/g) else rules[..]

      for handle in prods
        [rhs, action, precedence] = @_parseHandle handle

        # Add symbols to grammar
        addSymbol token for token in rhs

        # Process semantic actions
        if action
          action = @_processSemanticAction action, rhs
          label = 'case ' + (productions.length + 1) + ':'
          actionGroups[action]?.push(label) or actionGroups[action] = [label]

        # Create production
        production = new Production symbol, rhs, productions.length + 1

        # Set precedence
        if precedence and operators[precedence.prec]
          production.precedence = operators[precedence.prec].precedence
        else if production.precedence is 0
          # Use rightmost terminal's precedence
          for i in [(rhs.length - 1)..0] by -1
            tok = rhs[i]
            if operators[tok] and not nonterminals[tok]
              production.precedence = operators[tok].precedence
              break

        productions.push production
        productionTable.push [symbolMap[symbol], if rhs[0] is '' then 0 else rhs.length]
        nonterminals[symbol].productions.push production

    # Generate action code
    for action, labels of actionGroups
      actions.push labels.join(' '), action, 'break;'

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

  _parseHandle: (handle) ->
    if Array.isArray handle
      rhs = if typeof handle[0] is 'string' then handle[0].trim().split(' ') else handle[0][..]
      rhs = rhs.map (e) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '')

      action = if typeof handle[1] is 'string' or handle.length is 3 then handle[1] else null
      precedence = if handle[2] then handle[2] else if handle[1] and typeof handle[1] isnt 'string' then handle[1] else null

      [rhs, action, precedence]
    else
      handle = handle.replace /\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, ''
      rhs = handle.trim().split ' '
      [rhs, null, null]

  _processSemanticAction: (action, rhs) ->
    # Process named semantic values
    if action.match(/[$@][a-zA-Z][a-zA-Z0-9_]*/)
      count = {}
      names = {}

      for token, i in rhs
        rhs_i = token.match(/\[[a-zA-Z][a-zA-Z0-9_-]*\]/) # Like [var]
        if rhs_i
          rhs_i = rhs_i[0].substr(1, rhs_i[0].length - 2)
        else
          rhs_i = token

        if names[rhs_i]
          names[rhs_i + (++count[rhs_i])] = i + 1
        else
          names[rhs_i] = i + 1
          names[rhs_i + "1"] = i + 1
          count[rhs_i] = 1

      action = action
        .replace /\$([a-zA-Z][a-zA-Z0-9_]*)/g, (str, pl) -> if names[pl] then '$' + names[pl] else str # Like $var
        .replace  /@([a-zA-Z][a-zA-Z0-9_]*)/g, (str, pl) -> if names[pl] then '@' + names[pl] else str # Like @var

    # Transform $$ and positional references
    action
      .replace(/([^'"])\$\$|^\$\$/g, '$1this.$') # Like $$var
      .replace(/@[0$]/g, "this._$") # Like @var
      .replace(/\$(-?\d+)/g, (_, n) -> "$$[$0" + (parseInt(n, 10) - rhs.length || '') + "]") # Like $1
      .replace( /@(-?\d+)/g, (_, n) -> "_$[$0" +               (n - rhs.length || '') + "]") # Like @1

  _buildTerminalMappings: (symbolMap, nonterminals) ->
    terminals = ["$end", "error"]  # Pre-include special terminals to avoid unshift
    terminalsMap = {}

    for own name, id of symbolMap
      unless nonterminals[name]
        terminals.push name if name isnt "$end" and name isnt "error"
        terminalsMap[id] = name

    @terminals  = terminals
    @terminals_ = terminalsMap

  # ============================================================================
  # Lookahead Computation - LALR(1) algorithm
  # ============================================================================

  computeLookaheads: ->
    @computeLookaheads = -> # Prevent re-computation
    @_computeNullableSets()
    @_computeFirstSets()
    @_computeFollowSets()

  # Determine nullable symbols (can derive ε)
  _computeNullableSets: ->
    changed = true
    while changed
      changed = false

      # Mark productions nullable if all handle symbols are nullable
      for production in @productions when not production.nullable
        if production.handle.every (symbol) => @_isNullable symbol
          production.nullable = changed = true

      # Propagate to nonterminals
      for symbol, nonterminal of @nonterminals when not @_isNullable symbol
        if nonterminal.productions.some (p) -> p.nullable
          nonterminal.nullable = changed = true

  _isNullable: (symbol) ->
    return true if symbol is ''
    return symbol.every((s) => @_isNullable s) if Array.isArray symbol
    @nonterminals[symbol]?.nullable or false

  # Compute FIRST sets (terminals that can begin derivations)
  _computeFirstSets: ->
    changed = true
    while changed
      changed = false

      for production in @productions
        firsts = @_first production.handle
        oldSize = production.first.size
        production.first.clear()
        production.first.add item for item in firsts
        changed = true if production.first.size > oldSize

      for symbol, nonterminal of @nonterminals
        oldSize = nonterminal.first.size
        nonterminal.first.clear()
        for production in nonterminal.productions
          production.first.forEach (s) => nonterminal.first.add s
        changed = true if nonterminal.first.size > oldSize

  _first: (symbols) ->
    return [] if symbols is ''
    return @_firstOfSequence symbols if Array.isArray symbols
    return [symbols] unless @nonterminals[symbols]
    Array.from @nonterminals[symbols].first

  _firstOfSequence: (symbols) ->
    firsts = new Set()
    for symbol in symbols
      if @nonterminals[symbol]
        @nonterminals[symbol].first.forEach (s) => firsts.add s
      else
        firsts.add symbol
      break unless @_isNullable symbol
    Array.from firsts

  # Compute FOLLOW sets (terminals that can follow nonterminals)
  _computeFollowSets: ->
    changed = true
    while changed
      changed = false

      for production in @productions
        for symbol, i in production.handle when @nonterminals[symbol]
          oldSize = @nonterminals[symbol].follows.size

          if i is production.handle.length - 1
            # Symbol at end: add FOLLOW(LHS)
            @nonterminals[production.symbol].follows.forEach (item) =>
              @nonterminals[symbol].follows.add item
          else
            # Add FIRST(β) where β follows symbol
            beta = production.handle[i + 1..]
            firstSet = @_first beta

            @nonterminals[symbol].follows.add item for item in firstSet

            # If β is nullable, also add FOLLOW(LHS)
            if @_isNullable beta
              @nonterminals[production.symbol].follows.forEach (item) =>
                @nonterminals[symbol].follows.add item

          changed = true if @nonterminals[symbol].follows.size > oldSize

  # Assign FOLLOW sets to reduction items for LALR(1)
  assignItemLookaheads: ->
    for state in @states
      for item from state.reductions
        follows = @nonterminals[item.production.symbol]?.follows
        if follows
          item.follows.length = 0
          item.follows.push terminal for terminal from follows

# ==============================================================================
# LR Automaton Construction
# ==============================================================================

  buildLRAutomaton: ->
    item1 = new Item @productions[@acceptProductionIndex], 0, ["$end"]
    firstState = @_closure new LRState item1
    states = [firstState]
    marked = 0

    states.has = {}
    states.has[firstState] = 0

    while marked isnt states.length
      itemSet = states[marked++]
      for item from itemSet.items when item.nextSymbol and item.nextSymbol isnt "$end"
        @_insertLRState item.nextSymbol, itemSet, states, marked - 1

    @states = states

  # Compute closure of item set
  _closure: (itemSet) ->
    closureSet = new LRState()
    workingSet = new Set(itemSet.items)
    processed = {}

    while workingSet.size > 0
      newItems = new Set()
      closureSet.items.add item for item from workingSet

      for item from workingSet
        {nextSymbol} = item

        if nextSymbol and @nonterminals[nextSymbol] and not processed[nextSymbol]
          for production in @nonterminals[nextSymbol].productions
            unless closureSet.items.has production.id
              newItems.add new Item production, 0
          processed[nextSymbol] = true
        else unless nextSymbol
          closureSet.reductions.add item
          closureSet.hasConflicts = closureSet.reductions.size > 1 or closureSet.hasShifts
        else
          closureSet.hasShifts = true
          closureSet.hasConflicts = closureSet.reductions.size > 0

      workingSet = newItems

    closureSet

  # Compute GOTO(state, symbol)
  _goto: (itemSet, symbol) ->
    gotoSet = new LRState()

    for item from itemSet.items when item.nextSymbol is symbol
      newItem = new Item item.production, item.dot + 1, item.follows
      gotoSet.items.add newItem

    if gotoSet.items.size is 0 then gotoSet else @_closure gotoSet

  # Insert new state into automaton
  _insertLRState: (symbol, itemSet, states, stateNum) ->
    gotoSet = @_goto itemSet, symbol

    if gotoSet.items.size > 0
      gotoValue = gotoSet.id ?= (e.id for e from gotoSet.items).sort().join('|')
      existingIndex = states.has[gotoValue]

      if not existingIndex?
        states.has[gotoValue] = states.length
        itemSet.transitions[symbol] = states.length
        states.push gotoSet
      else
        itemSet.transitions[symbol] = existingIndex

  # Navigate through states following symbol sequence
  gotoState: (startState, symbolSequence) ->
    currentState = parseInt startState, 10
    for symbol in symbolSequence
      currentState = @states[currentState].transitions[symbol] or currentState
    currentState

  getLookaheadSet: (state, item) -> item.follows

  # ============================================================================
  # Parse Table Generation
  # ============================================================================

  buildParseTable: (itemSets) ->
    states = []
    {nonterminals, operators} = this
    conflictedStates = {}
    [SHIFT, REDUCE, ACCEPT, NONASSOC] = [1, 2, 3, 0]

    for itemSet, k in itemSets
      state = states[k] = {}

      # Shift and goto actions
      for stackSymbol, gotoState of itemSet.transitions when @symbolMap[stackSymbol]?
        for item from itemSet.items when item.nextSymbol is stackSymbol
          if nonterminals[stackSymbol]
            state[@symbolMap[stackSymbol]] = gotoState
          else
            state[@symbolMap[stackSymbol]] = [SHIFT, gotoState]

      # Accept action
      for item from itemSet.items when item.nextSymbol is "$end" and @symbolMap["$end"]?
        state[@symbolMap["$end"]] = [ACCEPT]

      # Reduce actions
      for item from itemSet.reductions
        terminals = @getLookaheadSet? itemSet, item
        terminals or= @terminals

        for stackSymbol in terminals when @symbolMap[stackSymbol]?
          action = state[@symbolMap[stackSymbol]]
          op = operators[stackSymbol]

          if action
            # Resolve conflict
            which = if action[0] instanceof Array then action[0] else action
            solution = @_resolveConflict item.production, op, [REDUCE, item.production.id], which

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

    @stateTable = states

  # Resolve conflicts using precedence and associativity
  _resolveConflict: (production, op, reduce, shift) ->
    solution = {production, operator: op, r: reduce, s: shift}
    [SHIFT, REDUCE, NONASSOC] = [1, 2, 0]

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

  # Compute default actions for single-action states
  computeDefaultActions: (states) ->
    defaults = {}
    for state, k in states
      actionCount = 0
      lastAction = null

      for own action of state
        actionCount++
        lastAction = state[action]

      defaults[k] = lastAction if actionCount is 1 and lastAction[0] is 2

    @defaultActions = defaults

  # ============================================================================
  # Code Generation
  # ============================================================================

  generate: (options = {}) ->
    @generateCommonJSModule Object.assign {}, @options, options

  generateCommonJSModule: (options = {}) ->
    moduleName = options.moduleName or "parser"
    moduleName = "parser" unless moduleName.match /^[A-Za-z_$][A-Za-z0-9_$]*$/

    @generateModule(options) + """
      \n\n
      if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
        exports.parser = #{moduleName};
        exports.Parser = #{moduleName}.Parser;
        exports.parse = function () { return #{moduleName}.parse.apply(#{moduleName}, arguments); };
        exports.main = function() {};
        if (typeof module !== 'undefined' && require.main === module) { exports.main(process.argv.slice(1)); }
      }
      """

  generateModule: (options = {}) ->
    moduleName = options.moduleName or "parser"
    version = '0.5.2'
    out = "/* parser generated by sonar #{version} */\n"
    out += if moduleName.match /\./ then moduleName else "var #{moduleName}"
    out += " = #{@generateModuleExpr()}"

  generateModuleExpr: ->
    module = @_generateModuleCore()
    """
    (function(){
    var hasProp = {}.hasOwnProperty;
    #{module.commonCode}
    var parser = #{module.moduleCode};
    #{@moduleInclude}
    function Parser () { this.yy = {}; }
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
    moduleCode = JSON.stringify(stateTable, null, 0).replace /"([0-9]+)"(?=:)/g, "$1"
    {commonCode: '', moduleCode}

  # ============================================================================
  # Runtime Parser
  # ============================================================================

  parseError: (str, hash) ->
    if hash.recoverable
      @trace str
    else
      error = new Error str
      error.hash = hash
      throw error

  parse: (input) ->
    [stk, val, loc] = [[0], [null], []]
    [stateTable, yytext, yylineno, yyleng, recovering] = [@stateTable, '', 0, 0, 0]
    [TERROR, EOF] = [2, 1]

    lexer = Object.create @lexer
    sharedState = {yy: {}}
    sharedState.yy[k] = v for own k, v of @yy

    lexer.setInput input, sharedState.yy
    [sharedState.yy.lexer, sharedState.yy.parser] = [lexer, this]

    lexer.yylloc = {} unless lexer.yylloc?
    yyloc = lexer.yylloc
    loc.push yyloc

    ranges = lexer.options?.ranges

    @parseError = if typeof sharedState.yy.parseError is 'function'
      sharedState.yy.parseError
    else
      Object.getPrototypeOf(this).parseError

    lex = =>
      token = lexer.lex() or EOF
      token = @symbolMap[token] or token unless typeof token is 'number'
      token

    [symbol, preErrorSymbol, state, action, r, yyval, p, len, newState, expected] =
      [null, null, null, null, null, {}, null, null, null, null]

    loop
      state = stk[stk.length - 1]
      action = @defaultActions[state] or (
        symbol = lex() if not symbol?
        stateTable[state]?[symbol]
      )

      unless action?.length and action[0]
        errStr = ''
        unless recovering
          expected = ("'#{@terminals_[p]}'" for own p of stateTable[state] when @terminals_[p] and p > TERROR)
          errStr = if lexer.showPosition
            "Parse error on line #{yylineno + 1}:\n#{lexer.showPosition()}\nExpecting #{expected.join(', ')}, got '#{@terminals_[symbol] or symbol}'"
          else
            "Parse error on line #{yylineno + 1}: Unexpected #{if symbol is EOF then "end of input" else "'#{@terminals_[symbol] or symbol}'"}"

          @parseError errStr, {
            text: lexer.match
            token: @terminals_[symbol] or symbol
            line: lexer.yylineno
            loc: yyloc
            expected
          }
        throw new Error errStr

      throw new Error "Parse Error: multiple actions possible at state: #{state}, token: #{symbol}" if action[0] instanceof Array and action.length > 1

      switch action[0]
        when 1 # shift
          stk.push symbol, action[1]
          val.push lexer.yytext
          loc.push lexer.yylloc
          symbol = null
          unless preErrorSymbol
            [yyleng, yytext, yylineno, yyloc] = [lexer.yyleng, lexer.yytext, lexer.yylineno, lexer.yylloc]
            recovering-- if recovering > 0
          else
            [symbol, preErrorSymbol] = [preErrorSymbol, null]

        when 2 # reduce
          len = @productionTable[action[1]][1]
          yyval.$ = val[val.length - len]
          [locFirst, locLast] = [loc[loc.length - (len or 1)], loc[loc.length - 1]]
          yyval._$ = {
            first_line: locFirst.first_line, last_line: locLast.last_line
            first_column: locFirst.first_column, last_column: locLast.last_column
          }
          yyval._$.range = [locFirst.range[0], locLast.range[1]] if ranges

          r = @performAction.apply yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], val, loc]
          return r if r?

          if len
            stk.length -= len * 2
            val.length -= len
            loc.length -= len

          stk.push @productionTable[action[1]][0]
          val.push yyval.$
          loc.push yyval._$
          newState = stateTable[stk[stk.length - 2]][stk[stk.length - 1]]
          stk.push newState

        when 3 # accept
          return true

  trace: -> # Debug output (no-op)

  createParser: ->
    parser = eval @generateModuleExpr()
    parser.productions = @productions

    bindMethod = (method) => => @lexer = parser.lexer; @[method].apply this, arguments

    parser.lexer = @lexer
    parser.generate = bindMethod 'generate'
    parser.generateModule = bindMethod 'generateModule'
    parser.generateCommonJSModule = bindMethod 'generateCommonJSModule'

    parser

# ==============================================================================
# Exports
# ==============================================================================

Sonar = exports.Sonar = exports

Sonar.Parser = (grammar, options) ->
  generator = new LALRGenerator grammar, options
  generator.createParser()

exports.LALRGenerator = LALRGenerator

Sonar.Generator = (g, options) ->
  new LALRGenerator g, Object.assign({}, g.options, options)

exports.Parser = (grammar, options) ->
  generator = Sonar.Generator grammar, options
  generator.createParser()

# ==============================================================================
# CLI Interface
# ==============================================================================

if require.main is module
  fs = require 'fs'
  path = require 'path'

  showHelp = ->
    console.log """
    Sonar - LALR(1) Parser Generator
    ================================

    Usage: coffee sonar.coffee [options] [grammar-file]

    Options:
      -h, --help              Show this help
      -s, --stats             Show grammar statistics
      -g, --generate          Generate parser (default)
      -o, --output <file>     Output file (default: parser.js)
      -v, --verbose           Verbose output

    Examples:
      coffee sonar.coffee grammar.coffee
      coffee sonar.coffee --stats grammar.coffee
      coffee sonar.coffee -o parser.js grammar.coffee
    """

  showStats = (generator) ->
    terminals = Object.keys(generator.terminals_ or {}).length
    nonterminals = Object.keys(generator.nonterminals or {}).length
    productions = generator.productions?.length or 0
    states = generator.states?.length or 0
    conflicts = generator.conflictStates?.length or 0

    console.log """
    Grammar Statistics:
    • Terminals: #{terminals}
    • Nonterminals: #{nonterminals}
    • Productions: #{productions}
    • States: #{states}
    • Conflicts: #{conflicts}
    """

  # Parse command line
  options = {help: false, stats: false, generate: true, output: 'parser.js', verbose: false}
  grammarFile = null

  i = 0
  while i < process.argv.length - 2
    arg = process.argv[i + 2]
    switch arg
      when '-h', '--help' then options.help = true
      when '-s', '--stats' then options.stats = true
      when '-g', '--generate' then options.generate = true
      when '-o', '--output' then options.output = process.argv[++i + 2]
      when '-v', '--verbose' then options.verbose = true
      else grammarFile = arg unless arg.startsWith('-')
    i++

  if options.help or not grammarFile
    showHelp()
    process.exit 0

  try
    unless fs.existsSync grammarFile
      console.error "Grammar file not found: #{grammarFile}"
      process.exit 1

    # Load grammar
    grammar = if grammarFile.endsWith('.coffee')
      require(path.resolve(grammarFile))
    else if grammarFile.endsWith('.json')
      JSON.parse fs.readFileSync(grammarFile, 'utf8')
    else
      throw new Error "Unsupported format. Use .coffee or .json"

    unless grammar
      throw new Error "Failed to load grammar"

    # Generate parser
    generator = new LALRGenerator grammar

    if options.stats
      showStats generator

    if options.generate
      parserCode = generator.generate()
      fs.writeFileSync options.output, parserCode
      console.log "Parser generated: #{options.output}"

  catch error
    console.error "Error:", error.message
    console.error error.stack if options.verbose
    process.exit 1
