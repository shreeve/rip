#!/usr/bin/env coffee

# ==============================================================================
# parser - SLR(1) Parser Generator for Rip
#
# Clean implementation influenced by Jison, but rewritten for Rip with modern
#
# Author: Steve Shreeve <steve.shreeve@gmail.com>
#   Date: September 8, 2025
# ==============================================================================

{version} = require '../package.json'

# Terminal symbols (tokens, cannot be expanded)
class Terminal
  constructor: (name, id) ->
    @id   = id
    @name = name

# Nonterminal symbols (can be expanded by productions)
class Nonterminal
  constructor: (name, id) ->
    @id          = id
    @name        = name
    @productions = []      # productions where this symbol is the LHS
    @nullable    = false   # true if symbol can derive empty string
    @first       = new Set # terminals that can appear first
    @follows     = new Set # terminals that can follow this symbol

# Production rule (Expression → Expression + Term)
class Production
  constructor: (lhs, rhs, id) ->
    @lhs        = lhs     # left-hand side (nonterminal)
    @rhs        = rhs     # right-hand side (array of symbols)
    @id         = id      # unique production number
    @nullable   = false   # true if RHS can derive empty string
    @first      = new Set # terminals that can appear first in RHS
    @precedence = 0       # operator precedence for conflict resolution

# LR item (Expression → Expression • + Term)
class Item
  constructor: (production, lookaheads, dot = 0) ->
    @production = production                  # the production rule
    @dot        = dot                         # position of parse progress
    @lookaheads = new Set(lookaheads or [])   # defensive copy, handle null/undefined
    @nextSymbol = @production.rhs[@dot]       # symbol after dot (if any)
    @id         = @production.id * 100 + @dot # compact unique ID

# LR state (set of items with transitions)
class LRState
  constructor: (items...) ->
    @id           = null           # state number (assigned later)
    @items        = new Set(items) # kernel and closure items
    @transitions  = new Map        # symbol → next state
    @reductions   = new Set        # reduction items
    @hasShifts    = false          # has shift actions
    @hasConflicts = false          # has shift/reduce or reduce/reduce conflicts

# ==============================================================================
# SLR(1) Parser Generator
# ==============================================================================

class Generator
  constructor: (grammar, options = {}) ->

    # Configuration
    @options = { ...grammar.options, ...options }
    @parseParams = grammar.parseParams
    @yy = {}

    # Grammar structures
    @operators   = {}
    @productions = []
    @conflicts   = 0

    # Initialize symbol table with special symbols
    @symbolTable = new Map
    @symbolTable.set "$accept", new Nonterminal "$accept", 0
    @symbolTable.set "$end"   , new Terminal    "$end"   , 1
    @symbolTable.set "error"  , new Terminal    "error"  , 2

    # Code generation setup
    @moduleInclude = grammar.moduleInclude or ''
    @actionInclude = grammar.actionInclude and
      if typeof grammar.actionInclude is 'function'
        String(grammar.actionInclude).replace(/^\s*function \(\) \{|\}\s*$/g, '')
      else
        grammar.actionInclude

    # Build parser
    @timing '💥 Total time', =>
      @timing 'processGrammar'   , => @processGrammar grammar # Process grammar rules
      @timing 'buildLRAutomaton' , => @buildLRAutomaton()     # Build LR(0) automaton
      @timing 'processLookaheads', => @processLookaheads()    # Compute FIRST/FOLLOW and assign lookaheads
      @timing 'buildParseTable'  , => @buildParseTable()      # Build parse table with default actions

  # ============================================================================
  # Helper Functions
  # ============================================================================

  timing: (label, fn) ->
    console.time(label)
    result = fn() if fn
    console.timeEnd(label)
    result

  # ============================================================================
  # Grammar Processing
  # ============================================================================

  processGrammar: (grammar) ->
    @nonterminals = {}
    @operators = @_processOperators grammar.operators

    @_buildProductions grammar.bnf, @productions, @nonterminals, @operators
    @_augmentGrammar grammar

  _processOperators: (ops) ->
    return {} unless ops

    operators = {}
    for precedence, i in ops
      for k in [1...precedence.length]
        operators[precedence[k]] = {precedence: i + 1, assoc: precedence[0]}
    operators

  _expandNode: (lhs, node, rhs) ->
    t = typeof node

    return node if t is 'string' and node[0] is '$' # x() pass-through
    return node if t in ['boolean','number'] or node is null # literals
    return { $array: node } if Array.isArray node # array literals

    if t is 'object'
      return node if node.$concat? or node.$array? or node.$passthrough?
      return node if node.type? or node.$noType?
      return { type: lhs, ...node }  # auto-add type for o() if missing

    '$1'  # default x() pass-through

  _buildProductions: (bnf, productions, nonterminals, operators) ->
    actionGroups = {}
    productionTable = [0]
    @symbolIds = {"$accept": 0, "$end": 1, "error": 2}  # Add reserved symbols
    symbolId = 3 # Next available symbol ID (after special symbols)

    # Add symbol to symbol table if not already present
    addSymbol = (name) =>
      return if not name or @symbolIds[name]

      # Use existing symbol or create a new one
      unless symbol = @symbolTable.get(name)
        id = symbolId++
        symbol = if bnf[name] then new Nonterminal(name, id) else new Terminal(name, id)
        @symbolTable.set name, symbol
      @symbolIds[name] = symbol.id

    processProduction = (lhs, pattern, node, precedence) =>
      for singlePattern in pattern.split('|').map (p) -> p.trim()
        rhs = singlePattern.split(/\s+/g).filter(Boolean)
        rhs = [''] if rhs.length is 0

        addSymbol token for token in rhs when token

        if node?
          action = @_expandNode lhs, node, rhs
          if action?
            actionStr = if typeof action is 'string' then action else "this.$ = #{JSON.stringify action}"
            key = @_processSemanticAction actionStr, rhs
            (actionGroups[key] ?= []).push "case #{productions.length + 1}:"

        production = new Production lhs, rhs, productions.length + 1
        @_assignPrecedence production, precedence, operators, nonterminals
        productions.push production
        productionTable.push [@symbolIds[lhs], if rhs[0] is '' then 0 else rhs.length]
        nonterminals[lhs].productions.push production

    # Process all grammar rules
    for own lhs, rules of bnf
      addSymbol lhs
      nonterminals[lhs] = @symbolTable.get lhs

      # Handle both array format and single production format
      if Array.isArray rules
        for handle in rules
          [pattern, node, precedence] = handle
          processProduction lhs, pattern, node, precedence
      else if typeof rules is 'object' and rules.pattern
        # Single production from inline syntax (e.g., Line: x 'Expression')
        # Expecting rules = { pattern: 'Expression', type: 'x', spec: ... }
        processProduction lhs, rules.pattern, rules.spec, rules.precedence
      else
        # Legacy string format (fallback)
        patterns = rules.split /\s*\|\s*/g
        for pattern in patterns
          processProduction lhs, pattern, null, null

    # Generate parser components
    actionsCode = @_generateActionCode actionGroups
    @productionData = productionTable
    @_buildTerminalMappings nonterminals

    parameters = "yytext, yyleng, yylineno, yy, yystate, $$, _$"
    parameters += ', ' + @parseParams.join(', ') if @parseParams

    @performAction = "function anonymous(#{parameters}) {\n#{actionsCode}\n}"

  _parseHandle: (handle) ->
    if Array.isArray handle
      rhs = if typeof handle[0] is 'string' then handle[0].trim().split(' ') else [...handle[0]]
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
          rhs_i = rhs_i[0].slice(1, -1)
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

  _assignPrecedence: (production, precedence, operators, nonterminals) ->
    if precedence?.prec and operators[precedence.prec]
      production.precedence = operators[precedence.prec].precedence
    else if production.precedence is 0
      # Use rightmost terminal's precedence
      for token in production.rhs by -1
        if operators[token] and not nonterminals[token]
          production.precedence = operators[token].precedence
          break

  _generateActionCode: (actionGroups) ->
    actions = [
      '/* this == yyval */'
      @actionInclude or ''
      'var $0 = $$.length - 1;'
      'const hasProp = {}.hasOwnProperty;'
      'switch (yystate) {'
    ]
    actions.push labels.join(' '), action, 'break;' for action, labels of actionGroups
    actions.push '}'

    actions.join('\n')
      .replace(/YYABORT/g, 'return false')
      .replace(/YYACCEPT/g, 'return true')

  _buildTerminalMappings: (nonterminals) ->
    @terminalNames = {}

    for own name, id of @symbolIds when id >= 2
      unless nonterminals[name]
        @terminalNames[id] = name

  _augmentGrammar: (grammar) ->
    throw new Error "Grammar error: must have at least one production rule." if @productions.length is 0

    @start = grammar.start or @productions[0].lhs
    unless @nonterminals[@start]
      throw new Error "Grammar error: start symbol '#{@start}' must be a nonterminal defined in the grammar."

    acceptProduction = new Production "$accept", [@start, "$end"], 0
    @productions.push acceptProduction
    @acceptProductionIndex = @productions.length - 1

    @nonterminals.$accept = @symbolTable.get "$accept"
    @nonterminals.$accept.productions.push acceptProduction
    @nonterminals[@start].follows.add "$end"

  # ============================================================================
  # LR Automaton Construction
  # ============================================================================

  buildLRAutomaton: ->
    acceptItem = new Item @productions[@acceptProductionIndex]
    firstState = @_closure new LRState(acceptItem)
    firstState.id = 0
    firstState.signature = @_computeStateSignature(firstState)

    states = [firstState]
    stateMap = new Map # stateSignature -> state index
    stateMap.set firstState.signature, 0

    # Build automaton by exploring all transitions
    marked = 0
    while marked < states.length
      itemSet = states[marked++]
      symbols = new Set
      for item from itemSet.items when sym = item.nextSymbol
        if sym isnt '$end'
          symbols.add sym
      for symbol from symbols
        @_insertLRState symbol, itemSet, states, stateMap

    @states = states

  # Calculate unique identifier for a state based on its items
  _computeStateSignature: (state) ->
    ids = []
    ids.push item.id for item from state.items
    ids.sort((a, b) -> a - b).join('|')

  # Compute closure of an LR item set (lookaheads assigned later using FOLLOW sets)
  _closure: (itemSet) ->
    closureSet = new LRState
    workingSet = new Set itemSet.items
    itemCores  = new Map # item.id -> item

    # Process all items
    while workingSet.size > 0
      newItems = new Set

      # Only process item cores we haven't yet seen
      for item from workingSet when !itemCores.has(item.id)

        # Add item to closure
        closureSet.items.add(item)
        itemCores.set(item.id, item)

        # Check item type
        {nextSymbol} = item

        if not nextSymbol
          # Reduction item
          closureSet.reductions.add(item)
          closureSet.hasConflicts = closureSet.reductions.size > 1 or closureSet.hasShifts
        else if not @nonterminals[nextSymbol]
          # Shift item (terminal)
          closureSet.hasShifts = true
          closureSet.hasConflicts = closureSet.reductions.size > 0
        else
          # Nonterminal - add items for all its productions
          nonterminal = @nonterminals[nextSymbol]
          for production in nonterminal.productions
            # Create [B → •γ] with empty lookaheads (will be filled by FOLLOW sets later)
            newItem = new Item production
            newItems.add(newItem) unless itemCores.has(newItem.id)

      workingSet = newItems

    closureSet

  # Compute GOTO(state, symbol) - transitions from one state to another
  _goto: (itemSet, symbol) ->
    gotoSet = new LRState

    for item from itemSet.items when item.nextSymbol is symbol
      # Create advanced item (lookaheads will be set from FOLLOW sets later)
      newItem = new Item item.production, null, item.dot + 1
      gotoSet.items.add newItem

    if gotoSet.items.size is 0 then gotoSet else @_closure gotoSet

  # Insert new state into automaton
  _insertLRState: (symbol, itemSet, states, stateMap) ->
    # Build kernel signature (advanced items) before computing closure
    kernel = []
    for item from itemSet.items when item.nextSymbol is symbol
      kernel.push [item.production.id, item.dot + 1]
    return unless kernel.length

    kernel.sort (a, b) -> (a[0] - b[0]) or (a[1] - b[1])
    kernelSig = (pid + '.' + pos for [pid, pos] in kernel).join '|'

    existing = stateMap.get kernelSig
    if existing?
      itemSet.transitions.set symbol, existing
      return

    # Kernel is new; compute closure now
    gotoSet = @_goto itemSet, symbol
    return unless gotoSet.items.size > 0

    gotoSet.signature = kernelSig
    gotoSet.id = states.length
    stateMap.set kernelSig, gotoSet.id
    itemSet.transitions.set symbol, gotoSet.id
    states.push gotoSet

  # ============================================================================
  # Lookahead Computation - SLR(1) Algorithm
  # ============================================================================

  processLookaheads: ->
    @processLookaheads = ->  # Computes once; no-op on subsequent calls
    @_computeNullableSets()  # ε-derivable symbols
    @_computeFirstSets()     # First terminals
    @_computeFollowSets()    # Following terminals
    @_assignItemLookaheads() # FOLLOW(A) → item lookaheads

  # Determine nullable symbols (can derive ε)
  _computeNullableSets: ->
    changed = true
    while changed
      changed = false

      # Mark productions nullable if all handle symbols are nullable
      for production in @productions when not production.nullable
        if production.rhs.every (symbol) => @_isNullable symbol
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
        firsts = @_computeFirst production.rhs
        oldSize = production.first.size
        production.first.clear()
        firsts.forEach (item) => production.first.add item
        changed = true if production.first.size > oldSize

      for symbol, nonterminal of @nonterminals
        oldSize = nonterminal.first.size
        nonterminal.first.clear()
        for production in nonterminal.productions
          production.first.forEach (s) => nonterminal.first.add s
        changed = true if nonterminal.first.size > oldSize

  _computeFirst: (symbols) ->
    return new Set if symbols is ''
    return @_computeFirstOfSequence symbols if Array.isArray symbols
    return new Set([symbols]) unless @nonterminals[symbols]
    @nonterminals[symbols].first

  _computeFirstOfSequence: (symbols) ->
    firsts = new Set
    for symbol in symbols
      if @nonterminals[symbol]
        @nonterminals[symbol].first.forEach (s) => firsts.add s
      else
        firsts.add symbol
      break unless @_isNullable symbol
    firsts

  # Compute FOLLOW sets (terminals that can follow nonterminals)
  _computeFollowSets: ->
    changed = true
    while changed
      changed = false

      for production in @productions
        for symbol, i in production.rhs when @nonterminals[symbol]
          oldSize = @nonterminals[symbol].follows.size

          if i is production.rhs.length - 1
            # Symbol at end: add FOLLOW(LHS)
            @nonterminals[production.lhs].follows.forEach (item) =>
              @nonterminals[symbol].follows.add item
          else
            # Add FIRST(β) where β follows symbol
            beta = production.rhs[i + 1..]
            firstSet = @_computeFirst beta

            firstSet.forEach (item) => @nonterminals[symbol].follows.add item

            # If β is nullable, also add FOLLOW(LHS)
            if @_isNullable beta
              @nonterminals[production.lhs].follows.forEach (item) =>
                @nonterminals[symbol].follows.add item

          changed = true if @nonterminals[symbol].follows.size > oldSize

  # Assign FOLLOW sets to reduction items
  _assignItemLookaheads: ->
    for state in @states
      for item from state.reductions
        follows = @nonterminals[item.production.lhs]?.follows
        if follows
          item.lookaheads.clear()
          item.lookaheads.add terminal for terminal from follows

  # ============================================================================
  # Parse Table Generation
  # ============================================================================

  buildParseTable: (itemSets = @states) ->
    states = []
    {nonterminals, operators} = this
    [NONASSOC, SHIFT, REDUCE, ACCEPT] = [0, 1, 2, 3]

    for itemSet, k in itemSets
      state = states[k] = {}

      # Shift and goto actions
      for [stackSymbol, gotoState] from itemSet.transitions when @symbolIds[stackSymbol]?
        for item from itemSet.items when item.nextSymbol is stackSymbol
          if nonterminals[stackSymbol]
            state[@symbolIds[stackSymbol]] = gotoState
          else
            state[@symbolIds[stackSymbol]] = [SHIFT, gotoState]

      # Accept action
      for item from itemSet.items when item.nextSymbol is "$end" and @symbolIds["$end"]?
        state[@symbolIds["$end"]] = [ACCEPT]

      # Reduce actions
      for item from itemSet.reductions
        for stackSymbol from item.lookaheads when @symbolIds[stackSymbol]?
          action = state[@symbolIds[stackSymbol]]
          op = operators[stackSymbol]

          if action
            # Resolve conflict
            which = if action[0] instanceof Array then action[0] else action
            solution = @_resolveConflict item.production, op, [REDUCE, item.production.id], which

            if solution.bydefault
              @conflicts++
            else
              action = solution.action
          else
            action = [REDUCE, item.production.id]

          if action?.length
            state[@symbolIds[stackSymbol]] = action
          else if action is NONASSOC
            state[@symbolIds[stackSymbol]] = undefined

    @_computeDefaultActions @parseTable = states

  # Resolve conflicts using precedence and associativity
  _resolveConflict: (production, op, reduce, shift) ->
    solution = {production, operator: op, r: reduce, s: shift}
    [NONASSOC, SHIFT, REDUCE] = [0, 1, 2]

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
  _computeDefaultActions: (states) ->
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
    @options = { ...@options, ...options }
    parserCode = @generateModule @options

    if @options.compress
      @_compressParser parserCode
    else
      parserCode

  generateModule: (options = {}) ->
    moduleName = options.moduleName or "parser"
    out = "/* parser generated by Rip #{version} */\n"
    out += if moduleName.match /\./ then moduleName else "export const #{moduleName}"
    out += " = #{@generateModuleExpr()}"

  generateModuleExpr: ->
    module = @_generateModuleCore()
    """
    (function(){
      const hasProp = {}.hasOwnProperty;
      #{module.commonCode}
      const parser = #{module.moduleCode};
      #{@moduleInclude}
      function Parser () { this.yy = {}; }
      Parser.prototype = parser;
      parser.Parser = Parser;
      return new Parser;
    })();
    """

  _generateModuleCore: ->
    tableCode = @_generateTableCode @parseTable

    moduleCode = """{
      trace: function trace() {},
      yy: {},
      symbolIds: #{JSON.stringify @symbolIds},
      terminalNames: #{JSON.stringify(@terminalNames).replace /"([0-9]+)":/g, "$1:"},
      productionData: #{JSON.stringify @productionData},
      parseTable: #{tableCode.moduleCode},
      defaultActions: #{JSON.stringify(@defaultActions).replace /"([0-9]+)":/g, "$1:"},
      performAction: #{@performAction},
      parseError: function #{@parseError},
      parse: function #{@parse}
    }"""

    {commonCode: tableCode.commonCode, moduleCode}

  _generateTableCode: (stateTable) ->
    moduleCode = JSON.stringify(stateTable, null, 0).replace /"([0-9]+)"(?=:)/g, "$1"
    {commonCode: '', moduleCode}

  _compressParser: (parserCode) ->
    # Compress the entire parser with Brotli
    compressedData = @_brotliCompress parserCode

    """
    /* Brotli-compressed parser generated by Rip #{version} */
    (function() {
      // Brotli decompression (requires Node.js with Brotli support)
      function loadBrotliDecoder() {
        if (typeof require !== 'undefined') {
          try {
            // Try built-in Node.js zlib brotli first (Node 12+)
            const zlib = require('zlib');
            if (zlib.brotliDecompressSync) {
              return function(buffer) {
                return zlib.brotliDecompressSync(buffer);
              };
            }
          } catch (e) {}

          try {
            // Fallback to brotli package
            const brotli = require('brotli');
            return function(buffer) {
              return Buffer.from(brotli.decompress(new Uint8Array(buffer)));
            };
          } catch (e) {
            throw new Error('Brotli decompression not available. This parser requires Brotli support. Please install the brotli package or use Node.js 12+.');
          }
        }
        throw new Error('This compressed parser requires Node.js environment with Brotli support.');
      }

      // Decompress and evaluate the parser
      const brotliDecode = loadBrotliDecoder();
      const compressedBuffer = Buffer.from('#{compressedData}', 'base64');
      const decompressedBuffer = brotliDecode(compressedBuffer);
      const parserCode = decompressedBuffer.toString('utf8');

      // Evaluate the decompressed parser code
      return eval(parserCode);
    })();
    """

  _brotliCompress: (data) ->
    try
      if typeof require isnt 'undefined'
        # Try Node.js built-in zlib brotli first
        zlib = require 'zlib'
        if zlib.brotliCompressSync
          compressed = zlib.brotliCompressSync Buffer.from(data)
          return compressed.toString 'base64'

        # Fallback to brotli package
        brotli = require 'brotli'
        compressed = brotli.compress Buffer.from(data)
        return Buffer.from(compressed).toString 'base64'
      else
        throw new Error 'Brotli compression requires Node.js environment'
    catch error
      throw new Error "Brotli compression failed: #{error.message}. Please ensure Brotli is available (Node.js 12+ or install 'brotli' package)."

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
    [parseTable, yytext, yylineno, yyleng, recovering] = [@parseTable, '', 0, 0, 0]
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
      token = @symbolIds[token] or token unless typeof token is 'number'
      token

    [symbol, preErrorSymbol, state, action, r, yyval, p, len, newState, expected] =
      [null, null, null, null, null, {}, null, null, null, null]

    loop
      state = stk[stk.length - 1]
      action = @defaultActions[state] or (
        symbol = lex() if not symbol?
        parseTable[state]?[symbol]
      )

      unless action?.length and action[0]
        errStr = ''
        unless recovering
          expected = ("'#{@terminalNames[p]}'" for own p of parseTable[state] when @terminalNames[p] and p > TERROR)
        errStr = if lexer.showPosition
          "Parse error on line #{yylineno + 1}:\n#{lexer.showPosition()}\nExpecting #{expected.join(', ')}, got '#{@terminalNames[symbol] or symbol}'"
        else
          "Parse error on line #{yylineno + 1}: Unexpected #{if symbol is EOF then "end of input" else "'#{@terminalNames[symbol] or symbol}'"}"

          @parseError errStr, {
            text: lexer.match
            token: @terminalNames[symbol] or symbol
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
          len = @productionData[action[1]][1]
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

          stk.push @productionData[action[1]][0]
          val.push yyval.$
          loc.push yyval._$
          newState = parseTable[stk[stk.length - 2]][stk[stk.length - 1]]
          stk.push newState

        when 3 # accept
          return true

  trace: (msg) -> # Debug output (no-op by default)
    console.log msg if @options?.debug

  createParser: ->
    parser = eval @generateModuleExpr()
    parser.productions = @productions

    bindMethod = (method) => => @lexer = parser.lexer; @[method].apply this, arguments

    parser.lexer = @lexer
    parser.generate = bindMethod 'generate'
    parser.generateModule = bindMethod 'generateModule'

    parser

# ==============================================================================
# Exports
# ==============================================================================

createParser = (grammar, options = {}) ->
  new Generator(grammar, options).createParser()

# Export the Generator class and createParser function
module.exports = { Generator, createParser }

# ==============================================================================
# CLI Interface
# ==============================================================================

if require.main is module
  fs = require 'fs'
  path = require 'path'

  showHelp = ->
    console.log """
    Solar - SLR(1) Parser Generator
    ===============================

    Usage: coffee solar.coffee [options] [grammar-file]

    Options:
      -h, --help              Show this help
      -s, --stats             Show grammar statistics
      -g, --generate          Generate parser (default)
      -o, --output <file>     Output file (default: parser.js)
      -c, --compress          Compress parser with Brotli (requires Brotli support)
      -v, --verbose           Verbose output

    Examples:
      coffee solar.coffee grammar.coffee
      coffee solar.coffee --stats grammar.coffee
      coffee solar.coffee -c -o parser.js grammar.coffee
      coffee solar.coffee --compress --output parser.js grammar.coffee
    """

  showStats = (generator) ->
    terminals = Object.keys(generator.terminalNames or {}).length
    nonterminals = Object.keys(generator.nonterminals or {}).length
    productions = generator.productions?.length or 0
    states = generator.states?.length or 0
    conflicts = generator.conflicts or 0

    console.log """

    ⏱️ Statistics:
    • Terminals: #{terminals}
    • Nonterminals: #{nonterminals}
    • Productions: #{productions}
    • States: #{states}
    • Conflicts: #{conflicts}
    """

  # Parse command line
  options = {help: false, stats: false, generate: false, output: 'parser.js', verbose: false, compress: false}
  grammarFile = null

  i = 0
  while i < process.argv.length - 2
    arg = process.argv[i + 2]
    switch arg
      when '-h', '--help'     then options.help     = true
      when '-s', '--stats'    then options.stats    = true
      when '-g', '--generate' then options.generate = true
      when '-o', '--output'   then options.output   = process.argv[++i + 2]
      when '-v', '--verbose'  then options.verbose  = true
      when '-c', '--compress' then options.compress = true
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
    generator = new Generator grammar, options

    if options.stats
      showStats generator

    if options.generate or not options.stats
      parserCode = generator.generate()
      fs.writeFileSync options.output, parserCode
      console.log "\nParser generated: #{options.output}"

  catch error
    console.error "Error:", error.message
    console.error error.stack if options.verbose
    process.exit 1
