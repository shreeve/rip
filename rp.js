// rip-parser: Minimal LALR(1) Parser Generator
//
// Generates LALR(1) parser tables and JavaScript code from BNF grammar definitions.
// Based on Jison but stripped down to essentials only.
//
// Features:
// - LALR(1) parse table generation
// - First/Follow set computation
// - Conflict resolution with precedence
// - ES module output
// - Recursion-safe algorithms

// Represents a non-terminal symbol in the grammar
class Nonterminal {
  constructor(symbol) {
    this.symbol = symbol;
    this.productions = [];  // Productions where this is the left-hand side
    this.first = [];        // First set for this non-terminal
    this.follows = [];      // Follow set for this non-terminal
    this.nullable = false;  // Whether this non-terminal can derive epsilon
  }
}

// Represents a production rule in the grammar
class Production {
  constructor(symbol, handle, id) {
    this.symbol = symbol;     // Left-hand side non-terminal
    this.handle = handle;     // Right-hand side symbols (array)
    this.nullable = false;    // Whether this production can derive epsilon
    this.id = id;            // Unique production ID
    this.first = [];         // First set for this production
    this.precedence = 0;     // Operator precedence for conflict resolution
  }

  toString() {
    return `${this.symbol} -> ${this.handle.join(' ')}`;
  }
}

// Represents an LR(0) item: a production with a position marker
class Item {
  constructor(production, dot, follows) {
    this.production = production;  // The production rule
    this.dot = dot;               // Position in the right-hand side (0-based)
    this.follows = follows || []; // Lookahead symbols for LALR(1)
  }

  // Returns the symbol at the current dot position
  markedSymbol() {
    return this.production.handle[this.dot];
  }

  // Returns the remaining symbols after the dot
  remainingHandle() {
    return this.production.handle.slice(this.dot + 1);
  }

  // Returns true if the dot is at the end of the production
  isComplete() {
    return this.dot >= this.production.handle.length;
  }

  // Returns a new item with the dot advanced by one position
  shift() {
    return new Item(this.production, this.dot + 1, this.follows);
  }

  // Compares this item with another for equality
  equals(other) {
    return this.production.id === other.production.id &&
           this.dot === other.dot &&
           this.follows.length === other.follows.length &&
           this.follows.every(f => other.follows.includes(f));
  }
}

// Represents a set of LR(0) items (a parser state)
class ItemSet {
  constructor() {
    this.items = [];
  }

  // Adds an item to the set if it's not already present
  add(item) {
    if (!this.has(item)) {
      this.items.push(item);
    }
  }

  // Checks if an item is already in the set
  has(item) {
    return this.items.some(i => i.equals(item));
  }

  // Adds all items from another set to this set
  concat(other) {
    other.items.forEach(item => this.add(item));
    return this;
  }

  // Returns true if the set is empty
  isEmpty() {
    return this.items.length === 0;
  }

  // Compares this set with another for equality
  equals(other) {
    if (this.items.length !== other.items.length) return false;
    return this.items.every(item => other.has(item));
  }
}

// Generates LALR(1) parse tables and parser code from BNF grammar definitions.
class Generator {
  constructor(grammar, options = {}) {
    this.options = options;
    this.operators = {};
    this.productions = [];
    this.nonterminals = {};
    this.terminals = [];
    this.symbols = [];
    this.states = [];
    this.table = [];
    this.defaultActions = {};

    // Process grammar
    this.processGrammar(grammar);
    this.augmentGrammar(grammar);

    // Build parse table
    this.buildTable();
  }

  // Processes the input grammar and builds internal data structures
  processGrammar(grammar) {
    const bnf = grammar.bnf;
    const tokens = grammar.tokens;

    // Initialize terminals from tokens
    if (tokens) {
      this.terminals = typeof tokens === 'string' ? tokens.trim().split(' ') : tokens.slice(0);
    }

    // Process operators for precedence and associativity
    this.operators = this.processOperators(grammar.operators);

    // Build productions from BNF
    this.buildProductions(bnf);
  }

  // Processes operator precedence and associativity rules
  processOperators(ops) {
    if (!ops) return {};

    const operators = {};
    for (let i = 0; i < ops.length; i++) {
      const rule = ops[i];
      const associativity = rule[0];  // 'left', 'right', or 'nonassoc'

      // Process each operator in this precedence level
      for (let k = 1; k < rule.length; k++) {
        const operator = rule[k];
        operators[operator] = {
          precedence: i + 1,
          associativity: associativity
        };
      }
    }
    return operators;
  }

  // Builds production rules from BNF grammar and generates action code
  buildProductions(bnf) {
    const actions = [
      '// this == yyval',
      'var $0 = $$.length - 1;',
      'switch (yystate) {'
    ];

    let actionIndex = 0;

    // Process each non-terminal in the grammar
    for (const symbol in bnf) {
      // Create non-terminal if it doesn't exist
      if (!this.nonterminals[symbol]) {
        this.nonterminals[symbol] = new Nonterminal(symbol);
      }

      const alternatives = bnf[symbol];

      // Process each alternative production for this non-terminal
      for (const alt of alternatives) {
        const handle = alt[0].split(' ');
        let action = alt[1];

        // Add symbols to the global symbol list
        for (const token of handle) {
          if (!this.symbols.includes(token)) {
            this.symbols.push(token);
          }
        }

        // Create and register the production
        const production = new Production(symbol, handle, this.productions.length);
        production.precedence = this.getPrecedence(handle, this.operators);
        this.productions.push(production);
        this.nonterminals[symbol].productions.push(production);

        // --- Action code rewriting ---
        // Replace @n with _$[n], $n with $$[n], $$ with this.$, @$ with this._$
        let processedAction = action
          .replace(/@(-?\d+)/g     , (_, n) => `_$[${n}]`) // @n (location stack)
          .replace(/\$(-?\d+)/g    , (_, n) => `$$[${n}]`) // $n (value stack)
          .replace(/([^'"\w])\$\$/g, "$1this.$")           // $$ (result value) outside of strings
          .replace(/([^'"\w])@\$/g , "$1this._$");         // @$ (result location) outside of strings
        // ----------------------------------------

        actions.push(`case ${actionIndex++}:`);
        actions.push(`  ${processedAction}`);
        actions.push('  break;');
      }
    }

    actions.push('}');
    this.performAction = actions.join('\n');
  }

  // Gets the precedence of a production based on its rightmost operator
  getPrecedence(handle, operators) {
    // Check from right to left (rightmost operator takes precedence)
    for (let i = handle.length - 1; i >= 0; i--) {
      const token = handle[i];
      if (operators[token]) {
        return operators[token].precedence;
      }
    }
    return 0;  // No precedence if no operators found
  }

  // Augments the grammar with an accept production and sets up parser tokens
  augmentGrammar(grammar) {
    if (this.productions.length === 0) {
      throw new Error("Grammar error: must have at least one rule.");
    }

    // Determine the start symbol
    this.startSymbol = grammar.start || grammar.startSymbol || this.productions[0].symbol;
    if (!this.nonterminals[this.startSymbol]) {
      throw new Error("Grammar error: startSymbol must be a non-terminal found in your grammar.");
    }

    this.EOF = "$end";

    // Augment grammar with accept production: $accept -> startSymbol $end
    const acceptProduction = new Production('$accept', [this.startSymbol, '$end'], 0);
    this.productions.unshift(acceptProduction);

    // Add parser tokens to symbol lists
    this.symbols.unshift("$accept", this.EOF);
    this.terminals.unshift(this.EOF);

    // Create the $accept non-terminal
    this.nonterminals.$accept = new Nonterminal("$accept");
    this.nonterminals.$accept.productions.push(acceptProduction);

    // Add EOF to the follow set of the start symbol
    this.nonterminals[this.startSymbol].follows.push(this.EOF);
  }

  // Builds the complete LALR(1) parse table
  buildTable() {
    // Step 1: Compute first sets for all productions
    this.firstSets();

    // Step 2: Compute follow sets for all non-terminals
    this.followSets();

    // Step 3: Build the canonical collection of LR(0) items
    this.states = this.canonicalCollection();

    // Step 4: Build the parse table from the states
    this.table = this.parseTable(this.states);

    // Step 5: Find default actions for states with single actions
    this.defaultActions = this.findDefaults(this.table);
  }

  firstSets() {
    let changed = true;
    let iterations = 0;
    const maxIterations = 1000; // Prevent infinite loops

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const production of this.productions) {
        const first = this.first(production.handle);
        for (const symbol of first) {
          if (!production.first.includes(symbol)) {
            production.first.push(symbol);
            changed = true;
          }
        }
      }
    }

    if (iterations >= maxIterations) {
      throw new Error("First set computation exceeded maximum iterations - possible circular grammar");
    }
  }

  first(symbols) {
    if (symbols.length === 0) return [];

    const symbol = symbols[0];
    const first = [];

    if (this.terminals.includes(symbol)) {
      first.push(symbol);
    } else if (this.nonterminals[symbol]) {
      // Prevent infinite recursion by tracking visited symbols
      if (!this._firstVisited) this._firstVisited = new Set();
      if (this._firstVisited.has(symbol)) return [];

      this._firstVisited.add(symbol);
      for (const production of this.nonterminals[symbol].productions) {
        first.push(...this.first(production.handle));
      }
      this._firstVisited.delete(symbol);
    }

    return first;
  }

  followSets() {
    let changed = true;
    let iterations = 0;
    const maxIterations = 1000; // Prevent infinite loops

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const production of this.productions) {
        for (let i = 0; i < production.handle.length; i++) {
          const symbol = production.handle[i];
          if (this.nonterminals[symbol]) {
            const follow = this.follow(production, i);
            for (const term of follow) {
              if (!this.nonterminals[symbol].follows.includes(term)) {
                this.nonterminals[symbol].follows.push(term);
                changed = true;
              }
            }
          }
        }
      }
    }

    if (iterations >= maxIterations) {
      throw new Error("Follow set computation exceeded maximum iterations - possible circular grammar");
    }
  }

  follow(production, position) {
    const follows = [];
    const remaining = production.handle.slice(position + 1);

    if (remaining.length === 0) {
      follows.push(...this.nonterminals[production.symbol].follows);
    } else {
      const first = this.first(remaining);
      follows.push(...first);
    }

    return follows;
  }

  canonicalCollection() {
    const states = [];
    const initialItem = new Item(this.productions[0], 0, [this.EOF]);
    const initialSet = new ItemSet();
    initialSet.add(initialItem);

    const closure = this.closure(initialSet);
    states.push(closure);

    let changed = true;
    let iterations = 0;
    const maxIterations = 1000; // Prevent infinite loops

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        for (const symbol of this.symbols) {
          const goto = this.goto(state, symbol);
          if (goto && !goto.isEmpty()) {
            const closure = this.closure(goto);
            let stateIndex = states.findIndex(s => s.equals(closure));
            if (stateIndex === -1) {
              stateIndex = states.length;
              states.push(closure);
              changed = true;
            }
            state.edges = state.edges || {};
            state.edges[symbol] = stateIndex;
          }
        }
      }
    }

    if (iterations >= maxIterations) {
      throw new Error("Canonical collection computation exceeded maximum iterations - possible circular grammar");
    }

    return states;
  }

  closure(itemSet) {
    const closure = new ItemSet();
    closure.concat(itemSet);

    let changed = true;
    let iterations = 0;
    const maxIterations = 1000; // Prevent infinite loops

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const item of closure.items) {
        const symbol = item.markedSymbol();
        if (symbol && this.nonterminals[symbol]) {
          const first = this.first(item.remainingHandle());
          for (const production of this.nonterminals[symbol].productions) {
            const newItem = new Item(production, 0, first);
            if (!closure.has(newItem)) {
              closure.add(newItem);
              changed = true;
            }
          }
        }
      }
    }

    if (iterations >= maxIterations) {
      throw new Error("Closure computation exceeded maximum iterations - possible circular grammar");
    }

    return closure;
  }

  goto(itemSet, symbol) {
    const goto = new ItemSet();
    for (const item of itemSet.items) {
      if (item.markedSymbol() === symbol) {
        goto.add(item.shift());
      }
    }
    return goto;
  }

  parseTable(states) {
    const table = [];

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      const row = {};

      // Add shifts
      if (state.edges) {
        for (const symbol in state.edges) {
          if (this.terminals.includes(symbol)) {
            row[symbol] = ['shift', state.edges[symbol]];
          }
        }
      }

      // Add reductions
      for (const item of state.items) {
        if (item.isComplete()) {
          const follows = this.lookAheads(state, item);
          for (const symbol of follows) {
            if (row[symbol]) {
              // Conflict - resolve by precedence
              const resolved = this.resolveConflict(item, symbol, row[symbol]);
              row[symbol] = resolved;
            } else {
              row[symbol] = ['reduce', item.production.id];
            }
          }
        }
      }

      table.push(row);
    }

    return table;
  }

  lookAheads(state, item) {
    return this.nonterminals[item.production.symbol].follows;
  }

  resolveConflict(item, symbol, existing) {
    // Simple precedence-based conflict resolution
    const itemPrec = item.production.precedence;
    const existingPrec = existing[1] < this.productions.length ?
      this.productions[existing[1]].precedence : 0;

    if (itemPrec > existingPrec) {
      return ['reduce', item.production.id];
    } else {
      return existing;
    }
  }

  findDefaults(table) {
    const defaults = {};
    for (let i = 0; i < table.length; i++) {
      const row = table[i];
      const actions = Object.values(row);
      if (actions.length === 1) {
        defaults[i] = actions[0];
      }
    }
    return defaults;
  }

  // Generates the complete parser code as an ES module
  generate(options = {}) {
    const moduleName = options.moduleName || "parser";
    return `// parser generated by rip-parser
export class ${moduleName} {
  constructor() {
    // yy will be set externally by the consumer
  }

  trace() {}

  get symbols_() {
    return ${JSON.stringify(this.symbols)};
  }

  get terminals_() {
    return ${JSON.stringify(this.terminals)};
  }

  get productions_() {
    return ${JSON.stringify(this.productions.map(p => [p.symbol, p.handle]))};
  }

  performAction(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
${this.performAction}
  }

  get table() {
    return ${JSON.stringify(this.table)};
  }

  get defaultActions() {
    return ${JSON.stringify(this.defaultActions)};
  }

  parseError(str, hash) {
    throw new Error(str);
  }

  parse(tokens) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;

    this.lexer.setTokens(tokens);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == "undefined") this.lexer.yylloc = {};
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);

    if (typeof this.yy.parseError === "function") this.parseError = this.yy.parseError;

    function popStack(n) {
      stack.length = stack.length - 2 * n;
      vstack.length = vstack.length - n;
      lstack.length = lstack.length - n;
    }

    _token_stack:
    var lex = function() {
      var token = self.lexer.lex();
      if (token === undefined || token === null) {
        console.log('[PARSER DEBUG] Lexer returned EOF (undefined/null)');
      } else {
        console.log('[PARSER DEBUG] Lexer returned token:', token);
      }
      return token;
    };
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    let __debug_iter = 0;
    while (true) {
      __debug_iter++;
      state = stack[stack.length - 1];
      if (this.defaultActions[state]) {
        action = this.defaultActions[state];
      } else {
        if (symbol === null || typeof symbol == 'undefined') {
          symbol = lex();
        }
        action = table[state] && table[state][symbol];
      }
      console.log('[PARSER DEBUG] iter=' + __debug_iter + ' state=' + state + ' symbol=' + symbol + ' action=' + JSON.stringify(action));
      if (__debug_iter > 1000) {
        console.error('[PARSER DEBUG] Breaking after 1000 iterations to prevent infinite loop.');
        break;
      }
      if (typeof action === 'undefined' || !action.length || !action[0]) {
        var errStr = '';
        expected = [];
        for (p in table[state]) if (this.terminals_[p] && p > 2) {
          expected.push("'" + this.terminals_[p] + "'");
        }
        if (this.lexer.showPosition) {
          errStr = "Parse error on line " + (yylineno + 1) + ":\\n" + this.lexer.showPosition() + "\\nExpecting " + expected.join(', ') + ", got '" + (this.terminals_[symbol] || symbol) + "'";
        } else {
          errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == 1 ? "end of input" : "'" + (this.terminals_[symbol] || symbol) + "'");
        }
        this.parseError(errStr, {
          text: this.lexer.match,
          token: this.terminals_[symbol] || symbol,
          line: this.lexer.yylineno,
          loc: yyloc,
          expected: expected
        });
      }
      if (action[0] instanceof Array && action.length > 1) {
        throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
      }
      switch (action[0]) {
        case 1:
          stack.push(symbol);
          vstack.push(this.lexer.yytext);
          lstack.push(this.lexer.yylloc);
          stack.push(action[1]);
          symbol = null;
          if (!preErrorSymbol) {
            yyleng = this.lexer.yyleng;
            yytext = this.lexer.yytext;
            yylineno = this.lexer.yylineno;
            yyloc = this.lexer.yylloc;
            if (recovering > 0) recovering--;
          } else {
            symbol = preErrorSymbol;
            preErrorSymbol = null;
          }
          break;
        case 2:
          len = this.productions_[action[1]][1];
          yyval.$ = vstack[vstack.length - len];
          yyval._$ = {
            first_line: lstack[lstack.length - (len || 1)].first_line,
            last_line: lstack[lstack.length - 1].last_line,
            first_column: lstack[lstack.length - (len || 1)].first_column,
            last_column: lstack[lstack.length - 1].last_column
          };
          r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
          if (typeof r !== 'undefined') {
            return r;
          }
          if (len) {
            stack = stack.slice(0, -1 * len * 2);
            vstack = vstack.slice(0, -1 * len);
            lstack = lstack.slice(0, -1 * len);
          }
          stack.push(this.productions_[action[1]][0]);
          vstack.push(yyval.$);
          lstack.push(yyval._$);
          newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
          stack.push(newState);
          break;
        case 3:
          console.log('[PARSER DEBUG] Parser ACCEPTS input');
          return vstack[1];
        case 'reduce':
          console.log('[PARSER DEBUG] Parser REDUCES: state=' + state + ' symbol=' + symbol + ' action=' + JSON.stringify(action));
          break;
      }
    }
    return true;
  }
}
`;
  }
}

export { Generator as ParserGenerator };
