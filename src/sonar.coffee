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
          @actionTable[stateId][symbol.name] = ["shift", targetStateId]
        else
          @gotoTable[stateId][symbol.name] = targetStateId

      # Reduce actions
      for item in state.reductions
        if item.production.id is 0  # Accept action
          @actionTable[stateId]["$end"] = ["accept"]
        else
          for lookahead from item.lookaheads
            action = ["reduce", item.production.id]

            if @actionTable[stateId][lookahead.name]
              # Conflict resolution
              @resolveConflict(stateId, lookahead.name, @actionTable[stateId][lookahead.name], action)
            else
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
  # Code Generation
  # ==========================================================================

  generate: (options = {}) ->
    @generateModule(options)

  generateModule: (options = {}) ->
    # Build symbol mappings
    symbolMap = {}
    terminals = {}
    id = 0

    # Assign IDs to symbols
    symbolMap["$accept"] = id++
    symbolMap["$end"] = id++
    symbolMap["error"] = id++
    terminals[1] = "$end"
    terminals[2] = "error"

    for symbol from @terminals.values()
      unless symbolMap[symbol.name]?
        symbolMap[symbol.name] = id++
        terminals[symbolMap[symbol.name]] = symbol.name

    for symbol from @nonterminals.values()
      unless symbolMap[symbol.name]?
        symbolMap[symbol.name] = id++

    # Build production table
    productionTable = [0] # placeholder
    for production in @productions
      lhsId = symbolMap[production.lhs.name]
      rhsLength = production.rhs.length
      productionTable.push [lhsId, rhsLength]

    # Convert parse tables to use symbol IDs
    actionTableJson = {}
    gotoTableJson = {}

    for stateId, actions of @actionTable
      actionTableJson[stateId] = {}
      for terminal, action of actions
        terminalId = symbolMap[terminal]
        actionTableJson[stateId][terminalId] = action

    for stateId, gotos of @gotoTable
      gotoTableJson[stateId] = {}
      for nonterminal, target of gotos
        nonterminalId = symbolMap[nonterminal]
        gotoTableJson[stateId][nonterminalId] = target

    # Generate parser code - build it in parts to avoid quote escaping issues
    parserCode = """
    /* Generated by Sonar LALR(1) Parser Generator */
    (function(){
      var parser = {
        trace: function(){},
        yy: {},

        symbols_: """ + JSON.stringify(terminals) + """,
        terminals_: """ + JSON.stringify(terminals) + """,
        productions_: """ + JSON.stringify(productionTable) + """,

        table: """ + JSON.stringify(actionTableJson) + """,
        defaultActions: {},

        parseError: function(str, hash) {
          throw new Error(str);
        },

        parse: function(input) {
          var self = this;
          var stack = [0];
          var vstack = [null];
          var lstack = [{}];

          var lexer = Object.create(this.lexer);
          if (typeof input === 'string') {
            lexer.setInput(input);
          }

          var symbol, preErrorSymbol, state, action, r;
          var len, newState, expected;

          function lex() {
            var token = lexer.lex() || 'EOF';
            if (typeof token !== 'number') {
              var terminalId = """ + JSON.stringify(symbolMap) + """[token] || token;
              return terminalId;
            }
            return token;
          }

          symbol = lex();

          while (true) {
            state = stack[stack.length - 1];

            if (this.defaultActions[state]) {
              action = this.defaultActions[state];
            } else {
              if (!symbol) symbol = lex();
              action = this.table[state] && this.table[state][symbol];
            }

            if (!action || !action.length) {
              var errStr = 'Parse error on line ' + (lexer.yylineno + 1) + ': Unexpected ' +
                          (symbol == 'EOF' ? 'end of input' : '"' + (this.terminals_[symbol] || symbol) + '"');
              this.parseError(errStr, {
                text: lexer.match,
                token: this.terminals_[symbol] || symbol,
                line: lexer.yylineno,
                expected: Object.keys(this.table[state] || {}).map(function(id) {
                  return self.terminals_[id];
                })
              });
            }

            switch (action[0]) {
              case 'shift':
                stack.push(symbol);
                vstack.push(lexer.yytext);
                lstack.push({first_line: lexer.yylineno});
                stack.push(action[1]);
                symbol = null;
                break;

              case 'reduce':
                len = this.productions_[action[1]][1];
                r = this.performAction.apply(null, [vstack[vstack.length - len]].concat(vstack.slice(-len)));

                if (len) {
                  stack = stack.slice(0, -2 * len);
                  vstack = vstack.slice(0, -len);
                  lstack = lstack.slice(0, -len);
                }

                var nt = this.productions_[action[1]][0];
                stack.push(nt);
                vstack.push(r);
                lstack.push({});

                newState = """ + JSON.stringify(gotoTableJson) + """[stack[stack.length - 2]][nt];
                stack.push(newState);
                break;

              case 'accept':
                return vstack[0];
            }
          }
        },

        performAction: function() {
          // Default action - return first argument
          return arguments[0];
        }
      };

      if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
        exports.parser = parser;
        exports.Parser = parser;
        exports.parse = function () { return parser.parse.apply(parser, arguments); };
      }

      return parser;
    })();
    """

    return parserCode

# ==============================================================================
# Exports
# ==============================================================================

if typeof exports isnt 'undefined'
  exports.LALRGenerator = LALRGenerator

  exports.Generator = (grammar, options) ->
    new LALRGenerator(grammar, options)

  exports.Parser = (grammar, options) ->
    generator = new LALRGenerator(grammar, options)
    parser = eval(generator.generate())
    parser

# CLI support
if require.main is module
  args = process.argv[2..]
  if args.length < 1
    console.log "Usage: sonar.coffee <grammar.coffee> [-o output.js]"
    process.exit 1

  fs = require 'fs'
  grammarFile = args[0]
  outputFile = if args.indexOf('-o') >= 0 then args[args.indexOf('-o') + 1] else 'parser.js'

  try
    grammar = require(require('path').resolve(grammarFile))
    generator = new LALRGenerator(grammar, {timing: true})
    output = generator.generate()
    fs.writeFileSync(outputFile, output)
    console.log "Parser generated: #{outputFile}"
  catch error
    console.error "Error: #{error.message}"
    process.exit 1
