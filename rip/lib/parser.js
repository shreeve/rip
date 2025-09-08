// ==============================================================================
// parser - SLR(1) Parser Generator for Rip
//
// Clean implementation influenced by Jison, but rewritten for Rip with modern
// ES6/ESM patterns for readability, efficiency, and maintainability.
//
// Author: Steve Shreeve <steve.shreeve@gmail.com>
//   Date: September 7, 2025
// ==============================================================================

import packageData from '../package.json' with { type: 'json' };
const version = packageData.version;

// Terminal symbols (tokens, cannot be expanded)
class Terminal {
  constructor(name, id) {
    this.id = id;
    this.name = name;
  }
}

// Nonterminal symbols (can be expanded by productions)
class Nonterminal {
  constructor(name, id) {
    this.id = id;
    this.name = name;
    this.productions = []; // productions where this symbol is the LHS
    this.nullable = false; // true if symbol can derive empty string
    this.first = new Set(); // terminals that can appear first
    this.follows = new Set(); // terminals that can follow this symbol
  }
}

// Production rule (Expression → Expression + Term)
class Production {
  constructor(lhs, rhs, id) {
    this.lhs = lhs; // left-hand side (nonterminal)
    this.rhs = rhs; // right-hand side (array of symbols)
    this.id = id; // unique production number
    this.nullable = false; // true if RHS can derive empty string
    this.first = new Set(); // terminals that can appear first in RHS
    this.precedence = 0; // operator precedence for conflict resolution
  }
}

// LR item (Expression → Expression • + Term)
class Item {
  constructor(production, lookaheads, dot = 0) {
    this.production = production; // the production rule
    this.dot = dot; // position of parse progress
    this.lookaheads = new Set(lookaheads || []);
    this.nextSymbol = this.production.rhs[this.dot];
    this.id = this.production.id * 100 + this.dot; // compact unique ID
  }
}

// LR state (set of items with transitions)
class LRState {
  constructor(...items) {
    this.id = null; // state number (assigned later)
    this.items = new Set(items); // kernel and closure items
    this.transitions = new Map(); // symbol → next state
    this.reductions = new Set(); // reduction items
    this.hasShifts = false; // has shift actions
    this.hasConflicts = false; // has shift/reduce or reduce/reduce conflicts
  }
}

// ==============================================================================
// SLR(1) Parser Generator
// ==============================================================================
export class Generator {
  constructor(grammar, options = {}) {
    // Configuration
    this.options = {...grammar.options, ...options};
    this.parseParams = grammar.parseParams;
    this.yy = {};

    // Grammar structures
    this.operators = {};
    this.productions = [];
    this.conflicts = 0;

    // Initialize symbol table with special symbols
    this.symbolTable = new Map();
    this.symbolTable.set("$accept", new Nonterminal("$accept", 0));
    this.symbolTable.set("$end", new Terminal("$end", 1));
    this.symbolTable.set("error", new Terminal("error", 2));

    // Code generation setup
    this.moduleInclude = grammar.moduleInclude || '';
    this.actionInclude = grammar.actionInclude && (
      typeof grammar.actionInclude === 'function'
        ? String(grammar.actionInclude).replace(/^\s*function \(\) \{|\}\s*$/g, '')
        : grammar.actionInclude
    );

    // Build parser
    this.timing('💥 Total time', () => {
      this.timing('processGrammar', () => this.processGrammar(grammar)); // Process grammar rules
      this.timing('buildLRAutomaton', () => this.buildLRAutomaton()); // Build LR(0) automaton
      this.timing('processLookaheads', () => this.processLookaheads()); // Compute FIRST/FOLLOW and assign lookaheads
      this.timing('buildParseTable', () => this.buildParseTable()); // Build parse table with default actions
    });
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================
  timing(label, fn) {
    console.time(label);
    const result = fn ? fn() : undefined;
    console.timeEnd(label);
    return result;
  }

  // ============================================================================
  // Grammar Processing
  // ============================================================================
  processGrammar(grammar) {
    this.nonterminals = {};
    this.operators = this._processOperators(grammar.operators);
    this._buildProductions(grammar.bnf, this.productions, this.nonterminals, this.operators);
    return this._augmentGrammar(grammar);
  }

  _processOperators(ops) {
    if (!ops) {
      return {};
    }
    const operators = {};
    for (let i = 0; i < ops.length; i++) {
      const precedence = ops[i];
      for (let k = 1; k < precedence.length; k++) {
        operators[precedence[k]] = {
          precedence: i + 1,
          assoc: precedence[0]
        };
      }
    }
    return operators;
  }

  _buildProductions(bnf, productions, nonterminals, operators) {
    const actionGroups = {};
    const productionTable = [0];
    this.symbolIds = {
      "$accept": 0,
      "$end": 1,
      "error": 2 // Add reserved symbols
    };
    let symbolId = 3; // Next available symbol ID (after special symbols)

    // Add symbol to symbol table if not already present
    const addSymbol = (name) => {
      if (!name || this.symbolIds[name]) {
        return;
      }
      // Use existing symbol or create a new one
      let symbol = this.symbolTable.get(name);
      if (!symbol) {
        const id = symbolId++;
        symbol = bnf[name] ? new Nonterminal(name, id) : new Terminal(name, id);
        this.symbolTable.set(name, symbol);
      }
      return this.symbolIds[name] = symbol.id;
    };

    // Process a single production (from o() or x())
    const processProduction = (lhs, pattern, nodeSpec, precedence) => {
      // Handle pipe syntax in pattern - split into multiple productions
      const patterns = pattern.includes('|')
        ? pattern.split('|').map(p => p.trim())
        : [pattern];

      for (const singlePattern of patterns) {
        // Split pattern into rhs array
        const rhs = singlePattern.trim().split(/\s+/g).filter(Boolean);
        if (rhs.length === 0) rhs.push(''); // Handle empty pattern

        // Add symbols for each element in rhs
        for (const token of rhs) {
          if (token) addSymbol(token);
        }

        // Process the node/action specification
        let action = null;
        if (nodeSpec !== undefined) {
          action = this._expandNodeSpec(lhs, nodeSpec, rhs);
        }

        // Generate action code
        if (action) {
          const processedAction = this._processSemanticAction(action, rhs);
          const label = 'case ' + (productions.length + 1) + ':';
          if (actionGroups[processedAction]) {
            actionGroups[processedAction].push(label);
          } else {
            actionGroups[processedAction] = [label];
          }
        }

        // Create production
        const production = new Production(lhs, rhs, productions.length + 1);

        // Set precedence
        this._assignPrecedence(production, precedence, operators, nonterminals);

        productions.push(production);
        productionTable.push([this.symbolIds[lhs], rhs[0] === '' ? 0 : rhs.length]);
        nonterminals[lhs].productions.push(production);
      }
    };

    // Process all grammar rules
    for (const lhs in bnf) {
      if (!Object.prototype.hasOwnProperty.call(bnf, lhs)) continue;

      const rules = bnf[lhs];
      addSymbol(lhs);
      nonterminals[lhs] = this.symbolTable.get(lhs);

      // Handle both array format and single production format
      if (Array.isArray(rules)) {
        // Multiple productions in array
        for (const handle of rules) {
          const [pattern, nodeSpec, precedence] = handle;
          processProduction(lhs, pattern, nodeSpec, precedence);
        }
      } else if (typeof rules === 'object' && rules.pattern) {
        // Single production from inline syntax (e.g., Line: x 'Expression')
        // Expecting rules = { pattern: 'Expression', type: 'x', spec: ... }
        processProduction(lhs, rules.pattern, rules.spec, rules.precedence);
      } else {
        // Legacy string format (fallback)
        const patterns = rules.split(/\s*\|\s*/g);
        for (const pattern of patterns) {
          processProduction(lhs, pattern, null, null);
        }
      }
    }

    // Generate parser components
    const actionsCode = this._generateActionCode(actionGroups);
    this.productionData = productionTable;
    this._buildTerminalMappings(nonterminals);

    let parameters = "yytext, yyleng, yylineno, yy, yystate, $$, _$";
    if (this.parseParams) {
      parameters += ', ' + this.parseParams.join(', ');
    }

    this.performAction = `function anonymous(${parameters}) {\n${actionsCode}\n}`;
  }

  // New helper method to expand node specifications based on o/x semantics
  _expandNodeSpec(lhs, nodeSpec, rhs) {
    // If nodeSpec is from x() function (pass-through)
    if (typeof nodeSpec === 'string' && nodeSpec.startsWith('$')) {
      return nodeSpec; // Pass through position
    }

    // If nodeSpec is a boolean, null, or number (literal from x())
    if (typeof nodeSpec === 'boolean' || nodeSpec === null || typeof nodeSpec === 'number') {
      return nodeSpec;
    }

    // If nodeSpec is an array (array literal from o())
    if (Array.isArray(nodeSpec)) {
      return { $array: nodeSpec };
    }

    // If nodeSpec is an object (from o())
    if (typeof nodeSpec === 'object') {
      // Handle special operators
      if (nodeSpec.$concat || nodeSpec.$array || nodeSpec.$passthrough) {
        return nodeSpec;
      }

      // Auto-add type if not present (for o() function)
      if (!nodeSpec.type && !nodeSpec.$noType) {
        return { type: lhs, ...nodeSpec };
      }

      return nodeSpec;
    }

    // Default pass-through for x() with no spec
    return '$1';
  }

  _assignPrecedence(production, precedence, operators, nonterminals) {
    if (precedence?.prec && operators[precedence.prec]) {
      production.precedence = operators[precedence.prec].precedence;
    } else if (production.precedence === 0) {
      // Use rightmost terminal's precedence
      for (let i = production.rhs.length - 1; i >= 0; i--) {
        const token = production.rhs[i];
        if (operators[token] && !nonterminals[token]) {
          production.precedence = operators[token].precedence;
          break;
        }
      }
    }
  }

  _generateActionCode(actionGroups) {
    const actions = [
      '/* this == yyval */',
      this.actionInclude || '',
      'var $0 = $$.length - 1;',
      'const hasProp = {}.hasOwnProperty;',
      'switch (yystate) {'
    ];

    for (const action in actionGroups) {
      const labels = actionGroups[action];
      actions.push(labels.join(' '), action, 'break;');
    }
    actions.push('}');

    return actions.join('\n')
      .replace(/YYABORT/g, 'return false')
      .replace(/YYACCEPT/g, 'return true');
  }

  _buildTerminalMappings(nonterminals) {
    this.terminalNames = {};

    for (const name in this.symbolIds) {
      const id = this.symbolIds[name];
      if (id >= 2 && !nonterminals[name]) {
        this.terminalNames[id] = name;
      }
    }
  }

  _augmentGrammar(grammar) {
    if (this.productions.length === 0) {
      throw new Error("Grammar error: must have at least one production rule.");
    }

    this.start = grammar.start || this.productions[0].lhs;
    if (!this.nonterminals[this.start]) {
      throw new Error(`Grammar error: start symbol '${this.start}' must be a nonterminal defined in the grammar.`);
    }

    const acceptProduction = new Production("$accept", [this.start, "$end"], 0);
    this.productions.push(acceptProduction);
    this.acceptProductionIndex = this.productions.length - 1;

    this.nonterminals.$accept = this.symbolTable.get("$accept");
    this.nonterminals.$accept.productions.push(acceptProduction);
    this.nonterminals[this.start].follows.add("$end");
  }

  // ============================================================================
  // LR Automaton Construction
  // ============================================================================
  buildLRAutomaton() {
    const acceptItem = new Item(this.productions[this.acceptProductionIndex]);
    const firstState = this._closure(new LRState(acceptItem));
    firstState.id = 0;
    firstState.signature = this._computeStateSignature(firstState);

    const states = [firstState];
    const stateMap = new Map(); // stateSignature -> state index
    stateMap.set(firstState.signature, 0);

    // Build automaton by exploring all transitions
    let marked = 0;
    while (marked < states.length) {
      const itemSet = states[marked++];
      const symbols = new Set();
      for (const item of itemSet.items) {
        const sym = item.nextSymbol;
        if (sym && sym !== '$end') {
          symbols.add(sym);
        }
      }
      for (const symbol of symbols) {
        this._insertLRState(symbol, itemSet, states, stateMap);
      }
    }

    this.states = states;
  }

  // Calculate unique identifier for a state based on its items
  _computeStateSignature(state) {
    const ids = [];
    for (const item of state.items) {
      ids.push(item.id);
    }
    return ids.sort((a, b) => a - b).join('|');
  }

  // Compute closure of an LR item set (lookaheads assigned later using FOLLOW sets)
  _closure(itemSet) {
    const closureSet = new LRState();
    const workingSet = new Set(itemSet.items);
    const itemCores = new Map(); // item.id -> item

    // Process all items
    while (workingSet.size > 0) {
      const newItems = new Set();

      // Only process item cores we haven't yet seen
      for (const item of workingSet) {
        if (!itemCores.has(item.id)) {
          // Add item to closure
          closureSet.items.add(item);
          itemCores.set(item.id, item);

          // Check item type
          const { nextSymbol } = item;

          if (!nextSymbol) {
            // Reduction item
            closureSet.reductions.add(item);
            closureSet.hasConflicts = closureSet.reductions.size > 1 || closureSet.hasShifts;
          } else if (!this.nonterminals[nextSymbol]) {
            // Shift item (terminal)
            closureSet.hasShifts = true;
            closureSet.hasConflicts = closureSet.reductions.size > 0;
          } else {
            // Nonterminal - add items for all its productions
            const nonterminal = this.nonterminals[nextSymbol];
            for (const production of nonterminal.productions) {
              // Create [B → •γ] with empty lookaheads (will be filled by FOLLOW sets later)
              const newItem = new Item(production);
              if (!itemCores.has(newItem.id)) {
                newItems.add(newItem);
              }
            }
          }
        }
      }

      workingSet.clear();
      for (const item of newItems) {
        workingSet.add(item);
      }
    }

    return closureSet;
  }

  // Compute GOTO(state, symbol) - transitions from one state to another
  _goto(itemSet, symbol) {
    const gotoSet = new LRState();

    for (const item of itemSet.items) {
      if (item.nextSymbol === symbol) {
        // Create advanced item (lookaheads will be set from FOLLOW sets later)
        const newItem = new Item(item.production, null, item.dot + 1);
        gotoSet.items.add(newItem);
      }
    }

    return gotoSet.items.size === 0 ? gotoSet : this._closure(gotoSet);
  }

  // Insert new state into automaton
  _insertLRState(symbol, itemSet, states, stateMap) {
    // Build kernel signature (advanced items) before computing closure
    const kernel = [];
    for (const item of itemSet.items) {
      if (item.nextSymbol === symbol) {
        kernel.push([item.production.id, item.dot + 1]);
      }
    }
    if (!kernel.length) {
      return;
    }

    kernel.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const kernelSig = kernel.map(([pid, pos]) => `${pid}.${pos}`).join('|');

    const existing = stateMap.get(kernelSig);
    if (existing !== undefined) {
      itemSet.transitions.set(symbol, existing);
      return;
    }

    // Kernel is new; compute closure now
    const gotoSet = this._goto(itemSet, symbol);
    if (gotoSet.items.size === 0) {
      return;
    }

    gotoSet.signature = kernelSig;
    gotoSet.id = states.length;
    stateMap.set(kernelSig, gotoSet.id);
    itemSet.transitions.set(symbol, gotoSet.id);
    states.push(gotoSet);
  }

  // ============================================================================
  // Lookahead Computation - SLR(1) Algorithm
  // ============================================================================
  processLookaheads() {
    this.processLookaheads = () => {}; // Computes once; no-op on subsequent calls
    this._computeNullableSets();  // ε-derivable symbols
    this._computeFirstSets();     // First terminals
    this._computeFollowSets();    // Following terminals
    this._assignItemLookaheads(); // FOLLOW(A) → item lookaheads
  }

  // Determine nullable symbols (can derive ε)
  _computeNullableSets() {
    let changed = true;
    while (changed) {
      changed = false;

      // Mark productions nullable if all handle symbols are nullable
      for (const production of this.productions) {
        if (!production.nullable) {
          if (production.rhs.every(symbol => this._isNullable(symbol))) {
            production.nullable = true;
            changed = true;
          }
        }
      }

      // Propagate to nonterminals
      for (const symbol in this.nonterminals) {
        const nonterminal = this.nonterminals[symbol];
        if (!this._isNullable(symbol)) {
          if (nonterminal.productions.some(p => p.nullable)) {
            nonterminal.nullable = true;
            changed = true;
          }
        }
      }
    }
  }

  _isNullable(symbol) {
    if (symbol === '') {
      return true;
    }
    if (Array.isArray(symbol)) {
      return symbol.every(s => this._isNullable(s));
    }
    return this.nonterminals[symbol]?.nullable || false;
  }

  // Compute FIRST sets (terminals that can begin derivations)
  _computeFirstSets() {
    let changed = true;
    while (changed) {
      changed = false;

      for (const production of this.productions) {
        const firsts = this._computeFirst(production.rhs);
        const oldSize = production.first.size;
        production.first.clear();
        firsts.forEach(item => production.first.add(item));
        if (production.first.size > oldSize) {
          changed = true;
        }
      }

      for (const symbol in this.nonterminals) {
        const nonterminal = this.nonterminals[symbol];
        const oldSize = nonterminal.first.size;
        nonterminal.first.clear();
        for (const production of nonterminal.productions) {
          production.first.forEach(s => nonterminal.first.add(s));
        }
        if (nonterminal.first.size > oldSize) {
          changed = true;
        }
      }
    }
  }

  _computeFirst(symbols) {
    if (symbols === '') {
      return new Set();
    }
    if (Array.isArray(symbols)) {
      return this._computeFirstOfSequence(symbols);
    }
    if (!this.nonterminals[symbols]) {
      return new Set([symbols]);
    }
    return this.nonterminals[symbols].first;
  }

  _computeFirstOfSequence(symbols) {
    const firsts = new Set();
    for (const symbol of symbols) {
      if (this.nonterminals[symbol]) {
        this.nonterminals[symbol].first.forEach(s => firsts.add(s));
      } else {
        firsts.add(symbol);
      }
      if (!this._isNullable(symbol)) {
        break;
      }
    }
    return firsts;
  }

  // Compute FOLLOW sets (terminals that can follow nonterminals)
  _computeFollowSets() {
    let changed = true;
    while (changed) {
      changed = false;

      for (const production of this.productions) {
        for (let i = 0; i < production.rhs.length; i++) {
          const symbol = production.rhs[i];
          if (this.nonterminals[symbol]) {
            const oldSize = this.nonterminals[symbol].follows.size;

            if (i === production.rhs.length - 1) {
              // Symbol at end: add FOLLOW(LHS)
              this.nonterminals[production.lhs].follows.forEach(item => {
                this.nonterminals[symbol].follows.add(item);
              });
            } else {
              // Add FIRST(β) where β follows symbol
              const beta = production.rhs.slice(i + 1);
              const firstSet = this._computeFirst(beta);

              firstSet.forEach(item => this.nonterminals[symbol].follows.add(item));

              // If β is nullable, also add FOLLOW(LHS)
              if (this._isNullable(beta)) {
                this.nonterminals[production.lhs].follows.forEach(item => {
                  this.nonterminals[symbol].follows.add(item);
                });
              }
            }

            if (this.nonterminals[symbol].follows.size > oldSize) {
              changed = true;
            }
          }
        }
      }
    }
  }

  // Assign FOLLOW sets to reduction items
  _assignItemLookaheads() {
    for (const state of this.states) {
      for (const item of state.reductions) {
        const follows = this.nonterminals[item.production.lhs]?.follows;
        if (follows) {
          item.lookaheads.clear();
          for (const terminal of follows) {
            item.lookaheads.add(terminal);
          }
        }
      }
    }
  }

  // ============================================================================
  // Parse Table Generation
  // ============================================================================
  buildParseTable(itemSets = this.states) {
    const states = [];
    const { nonterminals, operators } = this;
    const [NONASSOC, SHIFT, REDUCE, ACCEPT] = [0, 1, 2, 3];

    for (let k = 0; k < itemSets.length; k++) {
      const itemSet = itemSets[k];
      const state = states[k] = {};

      // Shift and goto actions
      for (const [stackSymbol, gotoState] of itemSet.transitions) {
        if (this.symbolIds[stackSymbol] !== undefined) {
          for (const item of itemSet.items) {
            if (item.nextSymbol === stackSymbol) {
              if (nonterminals[stackSymbol]) {
                state[this.symbolIds[stackSymbol]] = gotoState;
              } else {
                state[this.symbolIds[stackSymbol]] = [SHIFT, gotoState];
              }
            }
          }
        }
      }

      // Accept action
      for (const item of itemSet.items) {
        if (item.nextSymbol === "$end" && this.symbolIds["$end"] !== undefined) {
          state[this.symbolIds["$end"]] = [ACCEPT];
        }
      }

      // Reduce actions
      for (const item of itemSet.reductions) {
        for (const stackSymbol of item.lookaheads) {
          if (this.symbolIds[stackSymbol] !== undefined) {
            let action = state[this.symbolIds[stackSymbol]];
            const op = operators[stackSymbol];

            if (action) {
              // Resolve conflict
              const which = action[0] instanceof Array ? action[0] : action;
              const solution = this._resolveConflict(item.production, op, [REDUCE, item.production.id], which);

              if (solution.bydefault) {
                this.conflicts++;
              } else {
                action = solution.action;
              }
            } else {
              action = [REDUCE, item.production.id];
            }

            if (action?.length) {
              state[this.symbolIds[stackSymbol]] = action;
            } else if (action === NONASSOC) {
              state[this.symbolIds[stackSymbol]] = undefined;
            }
          }
        }
      }
    }

    this._computeDefaultActions(this.parseTable = states);
  }

  // Resolve conflicts using precedence and associativity
  _resolveConflict(production, op, reduce, shift) {
    const solution = { production, operator: op, r: reduce, s: shift };
    const [NONASSOC, SHIFT, REDUCE] = [0, 1, 2];

    if (shift[0] === REDUCE) {
      solution.action = shift[1] < reduce[1] ? shift : reduce;
      if (shift[1] !== reduce[1]) {
        solution.bydefault = true;
      }
      return solution;
    }

    if (production.precedence === 0 || !op) {
      solution.bydefault = true;
      solution.action = shift;
    } else if (production.precedence < op.precedence) {
      solution.action = shift;
    } else if (production.precedence === op.precedence) {
      solution.action = op.assoc === "right" ? shift : (op.assoc === "left" ? reduce : (op.assoc === "nonassoc" ? NONASSOC : shift));
    } else {
      solution.action = reduce;
    }

    return solution;
  }

  // Compute default actions for single-action states
  _computeDefaultActions(states) {
    const defaults = {};
    for (let k = 0; k < states.length; k++) {
      const state = states[k];
      let actionCount = 0;
      let lastAction = null;

      for (const action in state) {
        actionCount++;
        lastAction = state[action];
      }

      if (actionCount === 1 && lastAction[0] === 2) {
        defaults[k] = lastAction;
      }
    }

    this.defaultActions = defaults;
  }

  // ============================================================================
  // Code Generation
  // ============================================================================
  generate(options = {}) {
    this.options = {...this.options, ...options};
    const parserCode = this.generateModule(this.options);

    return this.options.compress ? this._compressParser(parserCode) : parserCode;
  }

  generateModule(options = {}) {
    const moduleName = options.moduleName || "parser";
    let out = `/* parser generated by Rip ${version} */\n`;
    out += moduleName.match(/\./) ? moduleName : `export const ${moduleName}`;
    return out + ` = ${this.generateModuleExpr()}`;
  }

  generateModuleExpr() {
    const module = this._generateModuleCore();
    return `(function(){
      const hasProp = {}.hasOwnProperty;
      ${module.commonCode}
      const parser = ${module.moduleCode};
      ${this.moduleInclude}
      function Parser () { this.yy = {}; }
      Parser.prototype = parser;
      parser.Parser = Parser;
      return new Parser;
    })();`;
  }

  _generateModuleCore() {
    const tableCode = this._generateTableCode(this.parseTable);

    const moduleCode = `{
      trace: function trace() {},
      yy: {},
      symbolIds: ${JSON.stringify(this.symbolIds)},
      terminalNames: ${JSON.stringify(this.terminalNames).replace(/"([0-9]+)":/g, "$1:")},
      productionData: ${JSON.stringify(this.productionData)},
      parseTable: ${tableCode.moduleCode},
      defaultActions: ${JSON.stringify(this.defaultActions).replace(/"([0-9]+)":/g, "$1:")},
      performAction: ${this.performAction},
      parseError: function ${this.parseError},
      parse: function ${this.parse}
    }`;

    return { commonCode: tableCode.commonCode, moduleCode };
  }

  _generateTableCode(stateTable) {
    const moduleCode = JSON.stringify(stateTable, null, 0).replace(/"([0-9]+)"(?=:)/g, "$1");
    return { commonCode: '', moduleCode };
  }

  _compressParser(parserCode) {
    // Compress the entire parser with Brotli
    const compressedData = this._brotliCompress(parserCode);

    return `/* Brotli-compressed parser generated by Rip ${version} */
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
      const compressedBuffer = Buffer.from('${compressedData}', 'base64');
      const decompressedBuffer = brotliDecode(compressedBuffer);
      const parserCode = decompressedBuffer.toString('utf8');

      // Evaluate the decompressed parser code
      return eval(parserCode);
    })();`;
  }

  _brotliCompress(data) {
    try {
      if (typeof require !== 'undefined') {
        // Try Node.js built-in zlib brotli first
        const zlib = require('zlib');
        if (zlib.brotliCompressSync) {
          const compressed = zlib.brotliCompressSync(Buffer.from(data));
          return compressed.toString('base64');
        }

        // Fallback to brotli package
        const brotli = require('brotli');
        const compressed = brotli.compress(Buffer.from(data));
        return Buffer.from(compressed).toString('base64');
      } else {
        throw new Error('Brotli compression requires Node.js environment');
      }
    } catch (error) {
      throw new Error(`Brotli compression failed: ${error.message}. Please ensure Brotli is available (Node.js 12+ or install 'brotli' package).`);
    }
  }

  // ============================================================================
  // Runtime Parser
  // ============================================================================
  parseError(str, hash) {
    if (hash.recoverable) {
      this.trace(str);
    } else {
      const error = new Error(str);
      error.hash = hash;
      throw error;
    }
  }

  parse(input) {
    let [stk, val, loc] = [[0], [null], []];
    const [parseTable, TERROR, EOF] = [this.parseTable, 2, 1];
    let [yytext, yylineno, yyleng, recovering] = ['', 0, 0, 0];

    const lexer = Object.create(this.lexer);
    const sharedState = { yy: {} };
    for (const k in this.yy) {
      if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
        sharedState.yy[k] = this.yy[k];
      }
    }

    lexer.setInput(input, sharedState.yy);
    [sharedState.yy.lexer, sharedState.yy.parser] = [lexer, this];

    if (!lexer.yylloc) {
      lexer.yylloc = {};
    }
    const yyloc = lexer.yylloc;
    loc.push(yyloc);

    const ranges = lexer.options?.ranges;

    this.parseError = typeof sharedState.yy.parseError === 'function'
      ? sharedState.yy.parseError
      : Object.getPrototypeOf(this).parseError;

    const lex = () => {
      let token = lexer.lex() || EOF;
      if (typeof token !== 'number') {
        token = this.symbolIds[token] || token;
      }
      return token;
    };

    let [symbol, preErrorSymbol, state, action, r, yyval, p, len, newState, expected] =
      [null, null, null, null, null, {}, null, null, null, null];

    while (true) {
      state = stk[stk.length - 1];
      action = this.defaultActions[state] || (symbol === null ? (symbol = lex(), parseTable[state]?.[symbol]) : parseTable[state]?.[symbol]);

      if (!action?.length || !action[0]) {
        let errStr = '';
        if (!recovering) {
          expected = [];
          for (const p in parseTable[state]) {
            if (this.terminalNames[p] && p > TERROR) {
              expected.push(`'${this.terminalNames[p]}'`);
            }
          }
        }
        errStr = lexer.showPosition
          ? `Parse error on line ${yylineno + 1}:\n${lexer.showPosition()}\nExpecting ${expected.join(', ')}, got '${this.terminalNames[symbol] || symbol}'`
          : `Parse error on line ${yylineno + 1}: Unexpected ${symbol === EOF ? "end of input" : `'${this.terminalNames[symbol] || symbol}'`}`;

        this.parseError(errStr, {
          text: lexer.match,
          token: this.terminalNames[symbol] || symbol,
          line: lexer.yylineno,
          loc: yyloc,
          expected
        });
        throw new Error(errStr);
      }

      if (action[0] instanceof Array && action.length > 1) {
        throw new Error(`Parse Error: multiple actions possible at state: ${state}, token: ${symbol}`);
      }

      switch (action[0]) {
        case 1: // shift
          stk.push(symbol, action[1]);
          val.push(lexer.yytext);
          loc.push(lexer.yylloc);
          symbol = null;
          if (!preErrorSymbol) {
            [yyleng, yytext, yylineno, yyloc] = [lexer.yyleng, lexer.yytext, lexer.yylineno, lexer.yylloc];
            if (recovering > 0) {
              recovering--;
            }
          } else {
            [symbol, preErrorSymbol] = [preErrorSymbol, null];
          }
          break;

        case 2: // reduce
          len = this.productionData[action[1]][1];
          yyval.$ = val[val.length - len];
          const [locFirst, locLast] = [loc[loc.length - (len || 1)], loc[loc.length - 1]];
          yyval._$ = {
            first_line: locFirst.first_line,
            last_line: locLast.last_line,
            first_column: locFirst.first_column,
            last_column: locLast.last_column
          };
          if (ranges) {
            yyval._$.range = [locFirst.range[0], locLast.range[1]];
          }

          r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], val, loc]);
          if (r !== undefined) {
            return r;
          }

          if (len) {
            stk.length -= len * 2;
            val.length -= len;
            loc.length -= len;
          }

          stk.push(this.productionData[action[1]][0]);
          val.push(yyval.$);
          loc.push(yyval._$);
          newState = parseTable[stk[stk.length - 2]][stk[stk.length - 1]];
          stk.push(newState);
          break;

        case 3: // accept
          return true;
      }
    }
  }

  trace(msg) { // Debug output (no-op by default)
    if (this.options?.debug) {
      console.log(msg);
    }
  }

  createParser() {
    const parser = eval(this.generateModuleExpr());
    parser.productions = this.productions;

    const bindMethod = (method) => () => {
      this.lexer = parser.lexer;
      return this[method].apply(this, arguments);
    };

    parser.lexer = this.lexer;
    parser.generate = bindMethod('generate');
    parser.generateModule = bindMethod('generateModule');

    return parser;
  }
}

// ==============================================================================
// Exports
// ==============================================================================

export const createParser = (grammar, options = {}) => {
  return new Generator(grammar, options).createParser();
};

// ==============================================================================
// CLI Interface
// ==============================================================================

// TODO: Add CLI support when needed for Rip compilation
// This would handle command-line usage of the parser generator