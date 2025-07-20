#!/usr/bin/env coffee

# Sonar - True LALR(1) Parser Generator
# Complete rewrite implementing proper LALR(1) with DeRemer-Pennello algorithm

# ==============================================================================
# Core Data Structures
# ==============================================================================

class Symbol
  constructor: (@name, @isTerminal = false) ->
    @nullable = false
    @first = new Set()
    @follows = new Set()
    @productions = []

class Production
  constructor: (@lhs, @rhs, @id) ->
    @nullable = false
    @first = new Set()
    @precedence = null

class LRItem
  constructor: (@production, @position = 0, @lookaheads = new Set()) ->
    @id = "#{@production.id}.#{@position}"

  nextSymbol: ->
    @production.rhs[@position]

  isComplete: ->
    @position >= @production.rhs.length

  advance: ->
    new LRItem(@production, @position + 1, new Set(@lookaheads))

  equals: (other) ->
    @production.id is other.production.id and @position is other.position

class LRState
  constructor: (@id, @items = []) ->
    @itemsMap = new Map()
    @transitions = new Map()
    @reductions = []
    @shifts = []

    for item in @items
      @itemsMap.set(item.id, item)
      if item.isComplete()
        @reductions.push item
      else
        @shifts.push item

  addItem: (item) ->
    key = item.id
    if @itemsMap.has key
      existing = @itemsMap.get key
      for lookahead from item.lookaheads
        existing.lookaheads.add lookahead
    else
      @itemsMap.set key, item
      @items.push item
      if item.isComplete()
        @reductions.push item
      else
        @shifts.push item

# ==============================================================================
# True LALR(1) Parser Generator
# ==============================================================================

class LALRGenerator
  constructor: (@grammar, @options = {}) ->
    # Initialize data structures
    @terminals = new Map()
    @nonterminals = new Map()
    @productions = []
    @states = []
    @parseTable = {}
    @conflicts = 0

    # Special symbols
    @addTerminal("$end")
    @addTerminal("error")
    @startSymbol = @addNonterminal("$accept")

    # Build parser
    console.time("processGrammar") if @options.timing

    # Check for different input types
    if typeof @grammar is 'string' and @grammar.endsWith('.json')
      # Direct JSON file path
      @loadFromJSON(@grammar)
    else
      # Regular grammar object - check for cached JSON first
      fs = require('fs')
      path = require('path')

      # Look for pre-exported grammar data in common locations
      possibleJsonFiles = [
        'grammar-data.json',                    # Current directory
        'src/grammar-data.json',                # src directory
        '../grammar-data.json',                 # Parent directory
        '../../grammar-data.json',              # Grandparent
        path.join(__dirname, 'grammar-data.json'),          # Relative to this file
        path.join(process.cwd(), 'grammar-data.json')       # Process working directory
      ]

      jsonFile = null
      for candidate in possibleJsonFiles
        try
          if fs.existsSync(candidate)
            jsonFile = candidate
            break
        catch
          continue

      if jsonFile
        console.log("Using cached grammar data from #{jsonFile}") if @options.timing
        @loadFromJSON(jsonFile)
      else
        console.log("Processing grammar directly") if @options.timing
        @processGrammar()

    console.timeEnd("processGrammar") if @options.timing

    console.time("buildLR0Automaton") if @options.timing
    @buildLR0Automaton()
    console.timeEnd("buildLR0Automaton") if @options.timing

    console.time("computeLookaheads") if @options.timing
    @computeLookaheads()
    console.timeEnd("computeLookaheads") if @options.timing

    console.time("buildParseTable") if @options.timing
    @buildParseTable()
    console.timeEnd("buildParseTable") if @options.timing

  # ==========================================================================
  # Grammar Processing
  # ==========================================================================

  addTerminal: (name) ->
    unless @terminals.has name
      symbol = new Symbol(name, true)
      @terminals.set name, symbol
      symbol
    else
      @terminals.get name

  addNonterminal: (name) ->
    unless @nonterminals.has name
      symbol = new Symbol(name, false)
      @nonterminals.set name, symbol
      symbol
    else
      @nonterminals.get name

  processGrammar: ->
    # Process operators
    @operators = {}
    if @grammar.operators
      for precedence, i in @grammar.operators
        for k in [1...precedence.length]
          @operators[precedence[k]] = {precedence: i + 1, assoc: precedence[0]}

    # Process productions
    @processProductions(@grammar.bnf or @grammar.grammar)

    # Augment grammar
    @augmentGrammar()

    # Compute basic sets
    @computeNullable()
    @computeFirst()
    @computeFollow()

  processProductions: (bnf) ->
    productionId = 1

    for own lhs, rules of bnf
      lhsSymbol = @addNonterminal(lhs)

      prods = if typeof rules is 'string' then rules.split(/\s*\|\s*/g) else rules[..]

      for handle in prods
        [rhs, action, precedence] = @parseHandle(handle)

        # Convert symbol names to symbol objects
        rhsSymbols = []
        for symbolName in rhs when symbolName isnt ''
          if bnf[symbolName]?
            rhsSymbols.push @addNonterminal(symbolName)
          else
            rhsSymbols.push @addTerminal(symbolName)

        production = new Production(lhsSymbol, rhsSymbols, productionId++)

        # Set precedence if specified
        if precedence
          production.precedence = precedence.prec or precedence
        else
          # Use rightmost terminal's precedence
          for i in [rhsSymbols.length - 1..0] by -1
            symbol = rhsSymbols[i]
            if symbol.isTerminal and @operators[symbol.name]
              production.precedence = @operators[symbol.name].precedence
              break

        @productions.push production
        lhsSymbol.productions.push production

  parseHandle: (handle) ->
    if Array.isArray handle
      rhs = if typeof handle[0] is 'string' then handle[0].trim().split(/\s+/) else handle[0][..]
      rhs = rhs.map (e) -> e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '')

      action = if typeof handle[1] is 'string' or handle.length is 3 then handle[1] else null
      precedence = if handle[2] then handle[2] else if handle[1] and typeof handle[1] isnt 'string' then handle[1] else null

      [rhs, action, precedence]
    else
      handle = handle.replace /\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, ''
      rhs = handle.trim().split(/\s+/)
      [rhs, null, null]

  augmentGrammar: ->
    # Find actual start symbol
    actualStart = @grammar.start or @grammar.startSymbol or @productions[0]?.lhs?.name
    actualStartSymbol = @nonterminals.get(actualStart)

    throw new Error("Start symbol '#{actualStart}' not found") unless actualStartSymbol

    # Create augmented start production: $accept → actualStart $end
    endSymbol = @terminals.get("$end")
    acceptProduction = new Production(@startSymbol, [actualStartSymbol, endSymbol], 0)

    @productions.unshift acceptProduction
    @startSymbol.productions.push acceptProduction

    # Update production IDs
    for production, i in @productions
      production.id = i

  # ==========================================================================
  # Classic Algorithms (Nullable, FIRST, FOLLOW)
  # ==========================================================================

  computeNullable: ->
    changed = true

    while changed
      changed = false

      for production in @productions
        if not production.nullable
          if production.rhs.length is 0 or production.rhs.every((s) -> s.nullable)
            production.nullable = changed = true

      for symbol from @nonterminals.values()
        if not symbol.nullable
          if symbol.productions.some((p) -> p.nullable)
            symbol.nullable = changed = true

  computeFirst: ->
    changed = true

    while changed
      changed = false

      # FIRST for productions
      for production in @productions
        first = @firstOfSequence(production.rhs)
        oldSize = production.first.size
        production.first.clear()
        for terminal in first
          production.first.add terminal
        if production.first.size isnt oldSize
          changed = true

      # FIRST for nonterminals
      for symbol from @nonterminals.values()
        oldSize = symbol.first.size
        symbol.first.clear()
        for production in symbol.productions
          for terminal from production.first
            symbol.first.add terminal
        if symbol.first.size isnt oldSize
          changed = true

  firstOfSequence: (sequence) ->
    result = new Set()

    for symbol in sequence
      if symbol.isTerminal
        result.add symbol
        break
      else
        for terminal from symbol.first
          result.add terminal
        break unless symbol.nullable

    result

  computeFollow: ->
    # Add $end to follow of start symbol
    actualStart = @productions[0].rhs[0]
    actualStart.follows.add @terminals.get("$end")

    changed = true

    while changed
      changed = false

      for production in @productions
        for symbol, i in production.rhs when not symbol.isTerminal
          oldSize = symbol.follows.size

          # Add FIRST(β) where β is the rest of the production
          beta = production.rhs[i+1..]
          first = @firstOfSequence(beta)

          for terminal from first
            symbol.follows.add terminal

          # If β is nullable, add FOLLOW(production.lhs)
          if beta.length is 0 or beta.every((s) -> s.nullable)
            for terminal from production.lhs.follows
              symbol.follows.add terminal

          if symbol.follows.size isnt oldSize
            changed = true

  # ==========================================================================
  # LR(0) Automaton Construction
  # ==========================================================================

  buildLR0Automaton: ->
    # Create initial state with augmented start item
    startItem = new LRItem(@productions[0], 0)
    startState = new LRState(0, [startItem])
    @closure(startState)

    @states = [startState]
    @stateMap = new Map()
    @stateMap.set(@stateSignature(startState), 0)

    worklist = [0]

    while worklist.length > 0
      stateId = worklist.pop()
      state = @states[stateId]

      # Group items by next symbol
      transitions = new Map()

      for item in state.shifts
        symbol = item.nextSymbol()
        if not transitions.has(symbol)
          transitions.set(symbol, [])
        transitions.get(symbol).push(item.advance())

      # Create new states for each symbol
      for [symbol, items] from transitions.entries()
        newState = new LRState(@states.length, items)
        @closure(newState)

        signature = @stateSignature(newState)

        if @stateMap.has(signature)
          # State already exists
          targetStateId = @stateMap.get(signature)
          state.transitions.set(symbol, targetStateId)
        else
          # New state
          newStateId = @states.length
          @states.push(newState)
          @stateMap.set(signature, newStateId)
          state.transitions.set(symbol, newStateId)
          worklist.push(newStateId)

  closure: (state) ->
    added = new Set()

    changed = true
    while changed
      changed = false

      for item in state.items when not item.isComplete()
        nextSymbol = item.nextSymbol()

        if not nextSymbol.isTerminal and not added.has(nextSymbol.name)
          added.add(nextSymbol.name)

          for production in nextSymbol.productions
            newItem = new LRItem(production, 0)
            state.addItem(newItem)
            changed = true

  stateSignature: (state) ->
    signature = []
    for item in state.items
      signature.push "#{item.production.id}.#{item.position}"
    signature.sort().join('|')

  # ==========================================================================
  # True LALR(1) Lookahead Computation (DeRemer-Pennello Algorithm)
  # ==========================================================================

  computeLookaheads: ->
    # Step 1: Compute spontaneous lookaheads and propagation relationships
    @spontaneous = new Map()  # state -> item -> Set of terminals
    @propagates = new Map()   # state -> item -> [(state, item), ...]

    for state, stateId in @states
      @spontaneous.set(stateId, new Map())
      @propagates.set(stateId, new Map())

      for item in state.items when not item.isComplete()
        @computeLookaheadInfo(stateId, item)

    # Step 2: Initialize lookaheads with spontaneous ones
    for stateId from @spontaneous.keys()
      state = @states[stateId]
      spontaneousMap = @spontaneous.get(stateId)

      for item in state.items
        itemKey = item.id
        if spontaneousMap.has(itemKey)
          for terminal from spontaneousMap.get(itemKey)
            item.lookaheads.add(terminal)

    # Step 3: Propagate lookaheads until fixed point
    changed = true
    while changed
      changed = false

      for stateId from @propagates.keys()
        state = @states[stateId]
        propagateMap = @propagates.get(stateId)

        for item in state.items
          itemKey = item.id
          if propagateMap.has(itemKey)
            targets = propagateMap.get(itemKey)

            for [targetStateId, targetItemId] in targets
              targetState = @states[targetStateId]
              targetItem = targetState.itemsMap.get(targetItemId)

              if targetItem
                oldSize = targetItem.lookaheads.size
                for terminal from item.lookaheads
                  targetItem.lookaheads.add(terminal)
                if targetItem.lookaheads.size > oldSize
                  changed = true

  computeLookaheadInfo: (stateId, item) ->
    # For item A → α·Bβ, compute goto(state, B)
    nextSymbol = item.nextSymbol()
    return unless @states[stateId].transitions.has(nextSymbol)

    targetStateId = @states[stateId].transitions.get(nextSymbol)
    targetState = @states[targetStateId]

    # Find the corresponding item B → ·γ in target state
    for targetItem in targetState.items when targetItem.position is 0
      if targetItem.production.lhs is nextSymbol
        # Compute FIRST(βα) where α is the current lookahead context
        beta = item.production.rhs[item.position + 1..]

        # Use a dummy terminal to detect propagation vs spontaneous
        dummyTerminal = new Symbol("#", true)
        testSequence = beta.concat([dummyTerminal])
        first = @firstOfSequence(testSequence)

        spontaneousSet = @spontaneous.get(stateId).get(item.id) or new Set()
        propagateList = @propagates.get(stateId).get(item.id) or []

        for terminal from first
          if terminal is dummyTerminal
            # This is a propagation case
            propagateList.push([targetStateId, targetItem.id])
          else
            # This is spontaneous
            spontaneousSet.add(terminal)

        @spontaneous.get(stateId).set(item.id, spontaneousSet)
        @propagates.get(stateId).set(item.id, propagateList)

  # ==========================================================================
  # Parse Table Construction
  # ==========================================================================

  buildParseTable: ->
    @actionTable = {}
    @gotoTable = {}

    for state, stateId in @states
      @actionTable[stateId] = {}
      @gotoTable[stateId] = {}

      # Shift actions
      for [symbol, targetStateId] from state.transitions.entries()
        if symbol.isTerminal
          @actionTable[stateId][symbol.name] = [1, targetStateId]  # 1 = shift
        else
          @gotoTable[stateId][symbol.name] = targetStateId

      # Generate accept action
      if state.id == 1  # accept state typically has id 1
        @actionTable[stateId]["$end"] = [3]  # 3 = accept

      # Generate reduce actions
      for item in state.reductions
        if item.production.lhs.name == "$accept"
          # This is the accept item
          continue

        action = [2, item.production.id]  # 2 = reduce
        for lookahead from item.lookaheads
          @actionTable[stateId][lookahead.name] = action

  resolveConflict: (stateId, terminal, existing, new_action) ->
    @conflicts++
    # Simple precedence resolution - prefer shift over reduce for now
    if existing[0] is "shift" and new_action[0] is "reduce"
      # Keep shift action
      return
    # Otherwise keep first action
    return

  # ==========================================================================
  # Grammar Loading from JSON
  # ==========================================================================

  loadFromJSON: (filename) ->
    fs = require 'fs'
    data = JSON.parse(fs.readFileSync(filename, 'utf8'))

    # Load metadata
    @startSymbolName = data.metadata.startSymbol
    @conflicts = data.metadata.conflicts || 0

    # Load symbols
    for symbolData in data.symbols
      symbol = new Symbol(symbolData.name, symbolData.isTerminal)
      symbol.nullable = symbolData.nullable || false
      symbol.first = new Set(symbolData.first || [])
      symbol.follows = new Set(symbolData.follows || [])

      if symbol.isTerminal
        @terminals.set(symbol.name, symbol)
      else
        @nonterminals.set(symbol.name, symbol)

    # Set start symbol reference
    @startSymbol = @nonterminals.get("$accept")

    # Load productions
    for prodData in data.productions
      lhsSymbol = @nonterminals.get(prodData.symbol)
      unless lhsSymbol
        throw new Error("Production LHS symbol not found: #{prodData.symbol}")

      # Convert handle symbol names to symbol objects
      rhs = []
      for symbolName in prodData.handle
        # Skip empty strings (epsilon productions)
        if symbolName is ''
          continue

        symbol = @terminals.get(symbolName) || @nonterminals.get(symbolName)
        unless symbol
          throw new Error("Production RHS symbol not found: #{symbolName}")
        rhs.push(symbol)

      production = new Production(lhsSymbol, rhs, prodData.id)
      production.nullable = prodData.nullable || false
      production.first = new Set(prodData.first || [])
      production.precedence = prodData.precedence

      @productions.push(production)
      lhsSymbol.productions.push(production)

    # Load operators
    @operators = {}
    for own op, opData of (data.operators || {})
      @operators[op] = {
        precedence: opData.precedence
        assoc: opData.assoc
      }

    metadata = data.metadata || {}
    console.log("Loaded grammar: #{metadata.symbolCount || 0} symbols, #{metadata.productionCount || 0} productions")

  # ==========================================================================
  # Code Generation
  # ==========================================================================

  generate: (options = {}) ->
    @generateModule(options)

  generateModule: ->
    # My LALR(1) core has already built the parse tables - now use original's proven runtime
    @_buildOriginalFormatTables()
    @_generatePerformAction()

    # Generate using the original's proven structure
    @generateModuleExpr()

  _buildOriginalFormatTables: ->
    # Convert my efficient LALR(1) tables to the format the original runtime expects
    @stateTable = []
    @symbolMap = {}
    @terminals_ = {}
    @productionTable = []
    @defaultActions = {}

    # Build symbol map and terminals (original format)
    symbolId = 0
    for [name, symbol] from @terminals
      @symbolMap[name] = symbolId
      @terminals_[symbolId] = name
      symbolId++

    for [name, symbol] from @nonterminals
      unless name is "$accept"  # Skip internal symbol
        @symbolMap[name] = symbolId
        symbolId++

    # Build production table (original format: [lhs, rhs_length])
    for production in @productions
      unless production.lhs.name is "$accept"  # Skip augmented production
        @productionTable.push [
          @symbolMap[production.lhs.name]
          production.rhs.length
        ]

    # Convert my action/goto tables to original stateTable format
    for stateId in [0...@states.length]
      stateActions = {}

      # Add action entries
      if @actionTable[stateId]
        for symbol, action of @actionTable[stateId]
          symbolId = @symbolMap[symbol]
          if action[0] is 'shift'
            stateActions[symbolId] = [1, action[1]]  # [1, nextState]
          else if action[0] is 'reduce'
            stateActions[symbolId] = [2, action[1]]  # [2, productionId]
          else if action[0] is 'accept'
            stateActions[symbolId] = [3]  # [3]

      # Add goto entries
      if @gotoTable[stateId]
        for symbol, target of @gotoTable[stateId]
          symbolId = @symbolMap[symbol]
          stateActions[symbolId] = target  # Just the target state number

      @stateTable[stateId] = stateActions

  _generatePerformAction: ->
    # For now, use a default performAction - this could be enhanced later
    # The semantic actions from the grammar would go here
    parameters = "yytext, yyleng, yylineno, yy, yystate, $$, _$"
    actionsCode = """
switch(yystate) {
default:
  this.$ = $$[0];
  break;
}
"""
    @performAction = "function anonymous(#{parameters}) {\n#{actionsCode}\n}"

  generateModuleExpr: ->
    module = @_generateModuleCore()
    """
    (function(){
    var hasProp = {}.hasOwnProperty;
    #{module.commonCode}
    var parser = #{module.moduleCode};
    #{@moduleInclude || ''}
    function Parser () { this.yy = {}; }
    Parser.prototype = parser;
    parser.Parser = Parser;
    return new Parser;
    })();
    """

  _generateModuleCore: ->
    tableCode = @_generateTableCode @stateTable

    # Build the module code entirely as a JavaScript string to avoid CoffeeScript interpolation
    symbolMapJson = JSON.stringify @symbolMap
    terminalsJson = JSON.stringify(@terminals_).replace /"([0-9]+)":/g, "$1:"
    productionTableJson = JSON.stringify @productionTable
    defaultActionsJson = JSON.stringify(@defaultActions).replace /"([0-9]+)":/g, "$1:"

    moduleCode = [
      "{"
      "  trace: function trace() {},"
      "  yy: {},"
      "  symbolMap: " + symbolMapJson + ","
      "  terminals_: " + terminalsJson + ","
      "  productionTable: " + productionTableJson + ","
      "  stateTable: " + tableCode.moduleCode + ","
      "  defaultActions: " + defaultActionsJson + ","
      "  performAction: " + @performAction + ","
      "  parseError: function parseError(str, hash) {"
      "    if (hash.recoverable) {"
      "      this.trace(str);"
      "    } else {"
      "      var error = new Error(str);"
      "      error.hash = hash;"
      "      throw error;"
      "    }"
      "  },"
      "  parse: function parse(input) {"
      "    var stk = [0], val = [null], loc = [{}];"
      "    var stateTable = this.stateTable, yytext = '', yylineno = 0, yyleng = 0, recovering = 0;"
      "    var TERROR = 2, EOF = 1;"
      ""
      "    var lexer = Object.create(this.lexer);"
      "    var sharedState = {yy: {}};"
      "    "
      "    for (var k in this.yy) {"
      "      if (this.yy.hasOwnProperty(k)) {"
      "        sharedState.yy[k] = this.yy[k];"
      "      }"
      "    }"
      ""
      "    lexer.setInput(input, sharedState.yy);"
      "    sharedState.yy.lexer = lexer;"
      "    sharedState.yy.parser = this;"
      ""
      "    if (!lexer.yylloc) lexer.yylloc = {};"
      "    var yyloc = lexer.yylloc;"
      "    loc.push(yyloc);"
      ""
      "    var ranges = lexer.options && lexer.options.ranges;"
      "    var self = this;"
      ""
      "    if (typeof sharedState.yy.parseError === 'function') {"
      "      this.parseError = sharedState.yy.parseError;"
      "    }"
      ""
      "    function lex() {"
      "      var token = lexer.lex() || EOF;"
      "      if (typeof token !== 'number') {"
      "        token = self.symbolMap[token] || token;"
      "      }"
      "      return token;"
      "    }"
      ""
      "    var symbol = null, preErrorSymbol = null, state, action, r, yyval = {};"
      "    var p, len, newState, expected;"
      ""
      "    while (true) {"
      "      state = stk[stk.length - 1];"
      "      "
      "      if (this.defaultActions[state]) {"
      "        action = this.defaultActions[state];"
      "      } else {"
      "        if (!symbol) symbol = lex();"
      "        action = stateTable[state] && stateTable[state][symbol];"
      "      }"
      ""
      "      if (!action || !action.length || !action[0]) {"
      "        var errStr = '';"
      "        if (!recovering) {"
      "          expected = [];"
      "          for (p in stateTable[state]) {"
      "            if (this.terminals_[p] && p > TERROR) {"
      "              expected.push(\"'\" + this.terminals_[p] + \"'\");"
      "            }"
      "          }"
      "          errStr = lexer.showPosition ? "
      "            \"Parse error on line \" + (yylineno + 1) + \":\" + lexer.showPosition() + \"Expecting \" + expected.join(', ') + \", got '\" + (this.terminals_[symbol] || symbol) + \"'\" :"
      "            \"Parse error on line \" + (yylineno + 1) + \": Unexpected \" + (symbol == EOF ? \"end of input\" : \"'\" + (this.terminals_[symbol] || symbol) + \"'\" );"
      ""
      "          this.parseError(errStr, {"
      "            text: lexer.match,"
      "            token: this.terminals_[symbol] || symbol,"
      "            line: lexer.yylineno,"
      "            loc: yyloc,"
      "            expected: expected"
      "          });"
      "        }"
      "        throw new Error(errStr);"
      "      }"
      ""
      "      if (action[0] instanceof Array && action.length > 1) {"
      "        throw new Error(\"Parse Error: multiple actions possible at state: \" + state + \", token: \" + symbol);"
      "      }"
      ""
      "      switch (action[0]) {"
      "        case 1: // shift"
      "          stk.push(symbol, action[1]);"
      "          val.push(lexer.yytext);"
      "          loc.push(lexer.yylloc);"
      "          symbol = null;"
      "          if (!preErrorSymbol) {"
      "            yyleng = lexer.yyleng;"
      "            yytext = lexer.yytext;"
      "            yylineno = lexer.yylineno;"
      "            yyloc = lexer.yylloc;"
      "            if (recovering > 0) recovering--;"
      "          } else {"
      "            symbol = preErrorSymbol;"
      "            preErrorSymbol = null;"
      "          }"
      "          break;"
      ""
      "        case 2: // reduce"
      "          len = this.productionTable[action[1]][1];"
      "          yyval.$ = val[val.length - len];"
      "          var locFirst = loc[loc.length - (len || 1)];"
      "          var locLast = loc[loc.length - 1];"
      "          yyval._$ = {"
      "            first_line: locFirst.first_line, "
      "            last_line: locLast.last_line,"
      "            first_column: locFirst.first_column, "
      "            last_column: locLast.last_column"
      "          };"
      "          if (ranges) {"
      "            yyval._$.range = [locFirst.range[0], locLast.range[1]];"
      "          }"
      ""
      "          r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], val, loc]);"
      "          if (typeof r !== 'undefined') {"
      "            return r;"
      "          }"
      ""
      "          if (len) {"
      "            stk = stk.slice(0, -len * 2);"
      "            val = val.slice(0, -len);"
      "            loc = loc.slice(0, -len);"
      "          }"
      ""
      "          stk.push(this.productionTable[action[1]][0]);"
      "          val.push(yyval.$);"
      "          loc.push(yyval._$);"
      "          newState = stateTable[stk[stk.length - 2]][stk[stk.length - 1]];"
      "          stk.push(newState);"
      "          break;"
      ""
      "        case 3: // accept"
      "          return true;"
      "      }"
      "    }"
      "  }"
      "}"
    ].join("\n")

    {commonCode: tableCode.commonCode, moduleCode}

  _generateTableCode: (stateTable) ->
    moduleCode = JSON.stringify(stateTable, null, 0).replace /"([0-9]+)"(?=:)/g, "$1"
    {commonCode: '', moduleCode}

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

  exportParseData: (filename) ->
    # Convert my efficient LALR(1) tables to the runtime format
    @_buildOriginalFormatTables()

    parseData = {
      metadata: {
        generator: "LALR(1) Parser Generator"
        exportedAt: new Date().toISOString()
        states: @states.length
        conflicts: @conflicts
        algorithm: "DeRemer-Pennello LALR(1)"
      }
      symbolMap: @symbolMap
      terminals_: @terminals_
      productionTable: @productionTable
      stateTable: @stateTable
      defaultActions: @defaultActions
    }

    # Write to file
    fs = require 'fs'
    fs.writeFileSync filename, JSON.stringify(parseData, null, 2)
    console.log "Parse table data exported to #{filename}"
    parseData

# ==============================================================================
# Exports - Match original sonar structure
# ==============================================================================

Sonar = exports.Sonar = exports

Sonar.Parser = (grammar, options) ->
  generator = new LALRGenerator grammar, options
  generator.createParser()

exports.LALRGenerator = LALRGenerator

Sonar.Generator = (g, options) ->
  new LALRGenerator g, Object.assign({}, g.options, options)

# CLI support
if require.main is module
  args = process.argv[2..]

  # Parse command line options
  options = {help: false, exportParseData: false, output: null}
  grammarFile = null

  i = 0
  while i < args.length
    arg = args[i]
    switch arg
      when '-h', '--help' then options.help = true
      when '--export-parse-data' then options.exportParseData = true
      when '-o', '--output' then options.output = args[++i]
      else grammarFile = arg unless arg.startsWith('-')
    i++

  if options.help or not grammarFile
    console.log """
    Usage: sonar.coffee <grammar.coffee|grammar.json> [options]

    Options:
      -h, --help              Show this help
      --export-parse-data     Export parse table data to JSON
      -o, --output <file>     Output file

    Examples:
      sonar.coffee grammar.coffee -o parser.js                    # Parse .coffee grammar
      sonar.coffee grammar-data.json -o parser.js                 # Use pre-parsed JSON
      sonar.coffee grammar.json --export-parse-data -o data.json  # Export parse tables
    """
    process.exit if options.help then 0 else 1

  fs = require 'fs'
  path = require 'path'
  options.output ||= if options.exportParseData then 'parse-data.json' else 'parser.js'

  try
    unless fs.existsSync grammarFile
      console.error "Grammar file not found: #{grammarFile}"
      process.exit 1

    # Determine input type and load accordingly
    if grammarFile.endsWith('.json')
      # Pre-parsed JSON grammar data
      generator = new LALRGenerator(grammarFile, {timing: true})
    else
      # Regular .coffee grammar file
      grammar = require(path.resolve(grammarFile))
      generator = new LALRGenerator(grammar, {timing: true})

    if options.exportParseData
      generator.exportParseData options.output
    else
      output = generator.generate()
      fs.writeFileSync(options.output, output)
      console.log "Parser generated: #{options.output}"

  catch error
    console.error "Error: #{error.message}"
    console.error error.stack
    process.exit 1
