// LALR(1) Parser Generator - DeRemer-Pennello Algorithm Implementation
//
// This implementation uses canonical naming conventions from established literature to
// serve as a reference implementation for computer science education and research.
// Canonical naming conventions based on established literature:
//
// - "Compilers: Principles, Techniques, and Tools" (Dragon Book)
// - "Efficient Computation of LALR(1) Look-Ahead Sets" (DeRemer & Pennello, 1982)
// - "LR Parsing: Theory and Practice" (Knuth, 1965)
//
// Function Reference:
//
// Utility Functions:
// - union(a, b) - Merge array b into array a, avoiding duplicates
//
// Constructor Functions:
// - Nonterminal(symbol) - Represents a nonterminal symbol in the grammar
// - Production(symbol, handle, id) - Represents a production rule in the grammar
// - Item(production, dot, lookaheadSet, predecessor) - Represents an LR(0) item [A → α•β] with lookahead
// - LRState() - Represents a set of LR items (parser state)
// - LALRGenerator(grammar, options) - Unified LALR(1) parser generator class
//
// LRState Methods:
// - concat(set) - Merge another LRState or array into this LRState
// - push(item) - Add an item to this LRState
// - contains(item) - Check if this LRState contains a specific item
// - valueOf() - Generate unique string representation for ItemSet comparison
//
// LALRGenerator Core Methods:
// - gotoEncoded(stateId, symbolSequence) - Specialized GOTO method for lookahead computation
// - processGrammar(grammar) - Process and validate the input grammar specification
// - processOperators(ops) - Process operator precedence and associativity declarations
// - augmentGrammar(grammar) - Add augmented start production for parser generation
// - buildProductions(bnf, productions, nonterminals, symbols, operators) - Build production rules from BNF grammar
//
// Lookahead Computation:
// - computeLookaheads() - Compute LALR(1) lookaheads using DeRemer-Pennello algorithm
// - computeNullableSets() - Compute NULLABLE sets for all nonterminals
// - isNullable(symbol) - Check if a symbol or symbol sequence is nullable
// - computeFirstSets() - Compute FIRST sets for all nonterminals
// - first(symbol) - Get FIRST set for a symbol or symbol sequence
// - computeFollowSets() - Compute FOLLOW sets for all nonterminals
//
// LR Automaton Construction:
// - closure(itemSet) - Compute closure of an item set (add all implied items)
// - goto(itemSet, symbol) - Compute goto operation (items after shifting a symbol)
// - buildLRAutomaton() - Generate canonical collection of LR(0) item sets
// - insertLRState(symbol, itemSet, states, stateNum) - Insert or merge item set into canonical collection
//
// Parse Table Generation:
// - buildParseTable(itemSets) - Generate LALR(1) parsing table from item sets
// - resolveConflict(production, op, reduce, shift) - Resolve shift/reduce conflicts using operator precedence
// - computeDefaultActions(states) - Find default actions for parser states to reduce table size
// - getLookaheadSet(state, item) - Get lookahead symbols for an item in a state
//
// Navigation and State Management:
// - gotoState(startState, symbolSequence) - Navigate through parser states following a symbol sequence
// - gotoStateWithPath(startState, symbolSequence) - Navigate through parser states and record the path taken
// - buildAugmentedGrammar() - Build augmented grammar for lookahead computation
// - unionLookaheads() - Propagate lookaheads from augmented grammar back to original states
//
// Code Generation:
// - generate(opt) - Generate parser code with specified options
// - generateCommonJSModule(opt) - Generate CommonJS module wrapper for parser
// - generateModule(opt) - Generate module wrapper for parser
// - generateModuleExpr() - Generate self-executing module expression
// - generateModule_() - Generate core parser module code
// - generateTableCode(table) - Generate optimized parsing table code
//
// Parser Runtime:
// - parseError(str, hash) - Handle parsing errors with context information
// - parse(input) - Parse input string using generated LALR(1) parser
// - trace() - Debug tracing function (no-op by default)
// - createParser() - Create executable parser instance from generated code
//
// Export Functions:
// - Jison.Parser(grammar, options) - Create parser from grammar
// - Jison.Generator(g, options) - Create generator instance
// - Parser(g, options) - Main parser factory function
//
// Original implementation by Jison team
// https://github.com/zaach/jison/blob/master/lib/jison.js

var Jison = exports.Jison = exports;
var version = require('../package.json').version;

// Merge array b into array a, avoiding duplicates
function union(a, b) {
    var s = Object.create(null);
    var i, len;
    for (i = 0, len = a.length; i < len; i++) {
        s[a[i]] = 1;
    }
    for (i = 0, len = b.length; i < len; i++) {
        if (!s[b[i]]) {
            a.push(b[i]);
        }
    }
    return a;
}

// Represents a nonterminal symbol in the grammar
function Nonterminal(symbol) {
    this.symbol = symbol;
    this.productions = [];
    this.first = [];
    this.follows = [];
    this.nullable = false;
}

// Represents a production rule in the grammar
function Production(symbol, handle, id) {
    this.symbol = symbol;
    this.handle = handle;
    this.id = id;
    this.nullable = false;
    this.first = [];
    this.precedence = 0;
}

// Represents an LR(0) item [A → α•β] with lookahead (canonical: LR item)
function Item(production, dot, lookaheadSet, predecessor) {
    this.production = production;
    this.dot = dot || 0;  // Position of • in production
    this.follows = lookaheadSet || []; // LALR(1) lookahead symbols
    this.predecessor = predecessor;
    this.nextSymbol = this.production.handle[this.dot]; // Symbol after •
    this.id = parseInt(production.id + 'a' + this.dot, 36);
}

// Represents a set of LR items (parser state) - canonical: LR state
function LRState() {
    this.list = [];
    this.length = 0;
    this.reductions = []; // Reductions in this state
    this.handleToSymbols = {}; // Maps production handles to generating symbols
    this.transitions = {}; // State transitions
    this.hasShifts = false; // Has shift actions
    this.hasConflicts = false; // Has SR/RR conflicts
    this.keys = {};

    if (arguments.length) {
        this.list = Array.prototype.slice.call(arguments);
        this.length = this.list.length;
        for (var i = this.length - 1; i >= 0; i--) {
            this.keys[this.list[i].id] = true;
        }
    }
}

// Merge another LRState or array into this LRState
LRState.prototype.concat = function(set) {
    var a = set.list || set;
    for (var i = a.length - 1; i >= 0; i--) {
        this.keys[a[i].id] = true;
    }
    this.list.push.apply(this.list, a);
    this.length = this.list.length;
    return this;
};

// Add an item to this LRState
LRState.prototype.push = function(item) {
    this.keys[item.id] = true;
    this.list.push(item);
    this.length = this.list.length;
    return this.length;
};

// Check if this LRState contains a specific item
LRState.prototype.contains = function(item) {
    return this.keys[item.id];
};

// Generate unique string representation for ItemSet comparison
LRState.prototype.valueOf = function() {
    var v = this.list.map(function(a) { return a.id; }).sort().join('|');
    this.valueOf = function() { return v; };
    return v;
};

// Unified LALR(1) parser generator class (canonical: LALRGenerator)
function LALRGenerator(grammar, options) {
    options = Object.assign({}, grammar.options, options);
    this.terminals = {}; // Terminal symbols
    this.operators = {};
    this.productions = [];
    this.conflicts = 0;
    this.resolutions = [];
    this.options = options;
    this.parseParams = grammar.parseParams;
    this.yy = {};

    if (grammar.actionInclude) {
        if (typeof grammar.actionInclude === 'function') {
            grammar.actionInclude = String(grammar.actionInclude)
                .replace(/^\s*function \(\) \{/, '')
                .replace(/\}\s*$/, '');
        }
        this.actionInclude = grammar.actionInclude;
    }
    this.moduleInclude = grammar.moduleInclude || '';

    console.time('processGrammar');
    this.processGrammar(grammar);
    console.timeEnd('processGrammar');

    console.time('buildLRAutomaton');
    this.states = this.buildLRAutomaton();
    console.timeEnd('buildLRAutomaton');

    this.terminalMap = {}; // Maps symbols to terminal representations

    // Initialize lookahead state (replaces newg creation)
    this.lookahead = {
        nonterminalMap: {}, // Maps nonterminals to states
        nonterminals: {},
        productions: []
    };

    this.conflictStates = []; // States with conflicts
    this.onDemandLookahead = options.onDemandLookahead || false;

    console.time('buildAugmentedGrammar');
    this.buildAugmentedGrammar();
    console.timeEnd('buildAugmentedGrammar');

    // Compute lookaheads in lookahead context (replaces newg.computeLookaheads())
    var savedNonterminals = this.nonterminals;
    var savedProductions = this.productions;

    this.nonterminals = this.lookahead.nonterminals;
    this.productions = this.lookahead.productions;

    console.time('computeLookaheads');
    this.computeLookaheads();
    console.timeEnd('computeLookaheads');

    this.nonterminals = savedNonterminals;
    this.productions = savedProductions;

    console.time('unionLookaheads');
    this.unionLookaheads();
    console.timeEnd('unionLookaheads');

    console.time('buildParseTable');
    this.stateTable = this.buildParseTable(this.states);
    console.timeEnd('buildParseTable');

    console.time('computeDefaultActions');
    this.defaultActions = this.computeDefaultActions(this.stateTable);
    console.timeEnd('computeDefaultActions');
}

// Specialized GOTO method for lookahead computation (DeRemer-Pennello algorithm)
LALRGenerator.prototype.gotoEncoded = function(stateId, symbolSequence) {
    stateId = stateId.split(":")[0];
    symbolSequence = symbolSequence.map(function(s) { return s.slice(s.indexOf(":") + 1); });
    return this.gotoState(stateId, symbolSequence);
};

// Process and validate the input grammar specification
LALRGenerator.prototype.processGrammar = function(grammar) {
    var bnf = grammar.bnf;
    var tokens = grammar.tokens;
    var nonterminals = this.nonterminals = {};
    var productions = this.productions;
    var symbols = this.symbols = [];
    var operators = this.operators = this.processOperators(grammar.operators);

    if (tokens) {
        tokens = typeof tokens === 'string' ? tokens.trim().split(' ') : tokens.slice(0);
    }

    this.buildProductions(bnf, productions, nonterminals, symbols, operators);

    if (tokens && this.terminals.length !== tokens.length) {
        this.trace("Warning: declared tokens differ from tokens found in rules.");
    }

    this.augmentGrammar(grammar);
};

// Process operator precedence and associativity declarations
LALRGenerator.prototype.processOperators = function(ops) {
    if (!ops) return {};
    var operators = {};
    for (var i = 0, prec; prec = ops[i]; i++) {
        for (var k = 1; k < prec.length; k++) {
            operators[prec[k]] = {
                precedence: i + 1,
                assoc: prec[0]
            };
        }
    }
    return operators;
};

// Add augmented start production for parser generation
LALRGenerator.prototype.augmentGrammar = function(grammar) {
    if (this.productions.length === 0) {
        throw new Error("Grammar error: must have at least one rule.");
    }

    this.startSymbol = grammar.start || grammar.startSymbol || this.productions[0].symbol;
    if (!this.nonterminals[this.startSymbol]) {
        throw new Error("Grammar error: startSymbol must be a non-terminal found in your grammar.");
    }

    this.EOF = "$end";
    var acceptProduction = new Production('$accept', [this.startSymbol, '$end'], 0);
    this.productions.unshift(acceptProduction);
    this.symbols.unshift("$accept", this.EOF);
    this.symbolMap.$accept = 0;
    this.symbolMap[this.EOF] = 1;
    this.terminals.unshift(this.EOF);

    this.nonterminals.$accept = new Nonterminal("$accept");
    this.nonterminals.$accept.productions.push(acceptProduction);
    this.nonterminals[this.startSymbol].follows.push(this.EOF);
};

// Build production rules from BNF grammar specification
LALRGenerator.prototype.buildProductions = function(bnf, productions, nonterminals, symbols, operators) {
    var actions = [
        '/* this == yyval */',
        this.actionInclude || '',
        'var $0 = $$.length - 1;',
        'switch (yystate) {'
    ];
    var actionGroups = {};
    var productionTable = [0];
    var symbolId = 1;
    var symbolMap = {};

    function addSymbol(s) {
        if (s && !symbolMap[s]) {
            symbolMap[s] = ++symbolId;
            symbols.push(s);
        }
    }

    addSymbol("error");

    for (var symbol in bnf) {
        if (!bnf.hasOwnProperty(symbol)) continue;

        addSymbol(symbol);
        nonterminals[symbol] = new Nonterminal(symbol);

        var prods = typeof bnf[symbol] === 'string' ?
            bnf[symbol].split(/\s*\|\s*/g) :
            bnf[symbol].slice(0);

        prods.forEach(function(handle) {
            var r, rhs, i;
            if (handle.constructor === Array) {
                rhs = typeof handle[0] === 'string' ?
                    handle[0].trim().split(' ') :
                    handle[0].slice(0);

                for (i = 0; i < rhs.length; i++) {
                    addSymbol(rhs[i]);
                }

                if (typeof handle[1] === 'string' || handle.length === 3) {
                    var label = 'case ' + (productions.length + 1) + ':';
                    var action = handle[1];

                    // Process named semantic values
                    if (action.match(/[$@][a-zA-Z][a-zA-Z0-9_]*/)) {
                        var count = {}, names = {};
                        for (i = 0; i < rhs.length; i++) {
                            var rhs_i = rhs[i].match(/\[[a-zA-Z][a-zA-Z0-9_-]*\]/);
                            if (rhs_i) {
                                rhs_i = rhs_i[0].substr(1, rhs_i[0].length - 2);
                                rhs[i] = rhs[i].substr(0, rhs[i].indexOf('['));
                            } else {
                                rhs_i = rhs[i];
                            }

                            if (names[rhs_i]) {
                                names[rhs_i + (++count[rhs_i])] = i + 1;
                            } else {
                                names[rhs_i] = i + 1;
                                names[rhs_i + "1"] = i + 1;
                                count[rhs_i] = 1;
                            }
                        }

                        action = action.replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, function(str, pl) {
                            return names[pl] ? '$' + names[pl] : str;
                        }).replace(/@([a-zA-Z][a-zA-Z0-9_]*)/g, function(str, pl) {
                            return names[pl] ? '@' + names[pl] : str;
                        });
                    }

                    action = action
                        .replace(/([^'"])\$\$|^\$\$/g, '$1this.$')
                        .replace(/@[0$]/g, "this._$")
                        .replace(/\$(-?\d+)/g, function(_, n) {
                            return "$$[$0" + (parseInt(n, 10) - rhs.length || '') + "]";
                        })
                        .replace(/@(-?\d+)/g, function(_, n) {
                            return "_$[$0" + (n - rhs.length || '') + "]";
                        });

                    if (actionGroups[action]) {
                        actionGroups[action].push(label);
                    } else {
                        actionGroups[action] = [label];
                    }

                    rhs = rhs.map(function(e) {
                        return e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '');
                    });

                    r = new Production(symbol, rhs, productions.length + 1);
                    if (handle[2] && operators[handle[2].prec]) {
                        r.precedence = operators[handle[2].prec].precedence;
                    }
                } else {
                    rhs = rhs.map(function(e) {
                        return e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '');
                    });

                    r = new Production(symbol, rhs, productions.length + 1);
                    if (operators[handle[1].prec]) {
                        r.precedence = operators[handle[1].prec].precedence;
                    }
                }
            } else {
                handle = handle.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '');
                rhs = handle.trim().split(' ');
                for (i = 0; i < rhs.length; i++) {
                    addSymbol(rhs[i]);
                }
                r = new Production(symbol, rhs, productions.length + 1);
            }

            if (r.precedence === 0) {
                for (i = r.handle.length - 1; i >= 0; i--) {
                    if (!(r.handle[i] in nonterminals) && r.handle[i] in operators) {
                        r.precedence = operators[r.handle[i]].precedence;
                        break;
                    }
                }
            }

            productions.push(r);
            productionTable.push([symbolMap[r.symbol], r.handle[0] === '' ? 0 : r.handle.length]);
            nonterminals[symbol].productions.push(r);
        });
    }

    for (var action in actionGroups) {
        actions.push(actionGroups[action].join(' '), action, 'break;');
    }

    var terms = [], terms_ = {};
    for (var sym in symbolMap) {
        id = symbolMap[sym];
        if (!nonterminals[sym]) {
            terms.push(sym);
            terms_[id] = sym;
        }
    }

    this.terminals = terms;
    this.terminals_ = terms_;
    this.symbolMap = symbolMap;
    this.productionTable = productionTable;

    actions.push('}');
    var actionsCode = actions.join("\n")
        .replace(/YYABORT/g, 'return false')
        .replace(/YYACCEPT/g, 'return true');

    var parameters = "yytext, yyleng, yylineno, yy, yystate, $$, _$";
    if (this.parseParams) {
        parameters += ', ' + this.parseParams.join(', ');
    }

    this.performAction = "function anonymous(" + parameters + ") {\n" + actionsCode + "\n}";
};

// Lookahead computation
// Compute LALR(1) lookaheads using DeRemer-Pennello algorithm
LALRGenerator.prototype.computeLookaheads = function() {
    this.computeLookaheads = function() {};
    this.computeNullableSets();
    this.computeFirstSets();
    this.computeFollowSets();
};

// Compute NULLABLE sets for all nonterminals (canonical: NULLABLE computation)
LALRGenerator.prototype.computeNullableSets = function() {
    var nonterminals = this.nonterminals;
    var self = this;
    var cont = true;

    while (cont) {
        cont = false;

        this.productions.forEach(function(production) {
            if (!production.nullable) {
                var n = 0;
                for (var i = 0, t; t = production.handle[i]; ++i) {
                    if (self.isNullable(t)) n++;
                }
                if (n === i) {
                    production.nullable = cont = true;
                }
            }
        });

        for (var symbol in nonterminals) {
            if (!this.isNullable(symbol)) {
                for (var i = 0, production; production = nonterminals[symbol].productions[i]; i++) {
                    if (production.nullable) {
                        nonterminals[symbol].nullable = cont = true;
                        break;
                    }
                }
            }
        }
    }
};

// Check if a symbol or symbol sequence is nullable (canonical: NULLABLE predicate)
LALRGenerator.prototype.isNullable = function(symbol) {
    if (symbol === '') return true;
    if (symbol instanceof Array) {
        for (var i = 0, t; t = symbol[i]; ++i) {
            if (!this.isNullable(t)) return false;
        }
        return true;
    }
    return !this.nonterminals[symbol] ? false : this.nonterminals[symbol].nullable;
};

// Compute FIRST sets for all nonterminals (canonical: FIRST computation)
LALRGenerator.prototype.computeFirstSets = function() {
    var productions = this.productions;
    var nonterminals = this.nonterminals;
    var self = this;
    var cont = true;

    while (cont) {
        cont = false;

        productions.forEach(function(production) {
            var firsts = self.first(production.handle);
            if (firsts.length !== production.first.length) {
                production.first = firsts;
                cont = true;
            }
        });

        for (var symbol in nonterminals) {
            var firsts = [];
            nonterminals[symbol].productions.forEach(function(production) {
                union(firsts, production.first);
            });
            if (firsts.length !== nonterminals[symbol].first.length) {
                nonterminals[symbol].first = firsts;
                cont = true;
            }
        }
    }
};

// Get FIRST set for a symbol or symbol sequence
LALRGenerator.prototype.first = function(symbol) {
    if (symbol === '') return [];
    if (symbol instanceof Array) {
        var firsts = [];
        for (var i = 0, t; t = symbol[i]; ++i) {
            if (!this.nonterminals[t]) {
                if (firsts.indexOf(t) === -1) firsts.push(t);
            } else {
                union(firsts, this.nonterminals[t].first);
            }
                            if (!this.isNullable(t)) break;
        }
        return firsts;
    }
    return !this.nonterminals[symbol] ? [symbol] : this.nonterminals[symbol].first;
};

// Compute FOLLOW sets for all nonterminals
LALRGenerator.prototype.computeFollowSets = function() {
    var productions = this.productions;
    var nonterminals = this.nonterminals;
    var self = this;
    var cont = true;

    while (cont) {
        cont = false;

        productions.forEach(function(production) {
            var q = !!self.go_;
            var ctx = q;

            for (var i = 0, t; t = production.handle[i]; ++i) {
                if (!nonterminals[t]) continue;

                if (ctx) {
                    q = self.gotoEncoded(production.symbol, production.handle.slice(0, i));
                }
                var bool = !ctx || q === parseInt(self.lookahead.nonterminalMap[t], 10);

                var set;
                if (i === production.handle.length - 1 && bool) {
                    set = nonterminals[production.symbol].follows;
                } else {
                    var part = production.handle.slice(i + 1);
                    set = self.first(part);
                    if (self.isNullable(part) && bool) {
                        set.push.apply(set, nonterminals[production.symbol].follows);
                    }
                }

                var oldcount = nonterminals[t].follows.length;
                union(nonterminals[t].follows, set);
                if (oldcount !== nonterminals[t].follows.length) {
                    cont = true;
                }
            }
        });
    }
};

// Compute closure of an item set (add all implied items)
LALRGenerator.prototype.closure = function(itemSet) {
    var closureSet = new LRState();
    var self = this;
    var set = itemSet;
    var itemQueue, syms = {};

    do {
        itemQueue = [];
        closureSet.concat(set);

        (set.list || set).forEach(function(item) {
            var symbol = item.nextSymbol;

            if (symbol && self.nonterminals[symbol]) {
                if (!syms[symbol]) {
                    self.nonterminals[symbol].productions.forEach(function(production) {
                        var newItem = new Item(production, 0);
                        if (!closureSet.contains(newItem)) {
                            itemQueue.push(newItem);
                        }
                    });
                    syms[symbol] = true;
                }
            } else if (!symbol) {
                closureSet.reductions.push(item);
                closureSet.hasConflicts = closureSet.reductions.length > 1 || closureSet.hasShifts;
            } else {
                closureSet.hasShifts = true;
                closureSet.hasConflicts = closureSet.reductions.length > 0;
            }
        });

        set = itemQueue;
    } while (itemQueue.length > 0);

    return closureSet;
};

// Compute goto operation (items after shifting a symbol)
LALRGenerator.prototype.goto = function(itemSet, symbol) {
    var gotoSet = new LRState();
    var self = this;

    itemSet.list.forEach(function(item, n) {
        if (item.nextSymbol === symbol) {
            gotoSet.push(new Item(item.production, item.dot + 1, item.follows, n));
        }
    });

    return gotoSet.length === 0 ? gotoSet : this.closure(gotoSet);
};

// Generate canonical collection of LR(0) item sets
LALRGenerator.prototype.buildLRAutomaton = function() {
    var item1 = new Item(this.productions[0], 0, [this.EOF]);
    var firstState = this.closure(new LRState(item1));
    var states = [firstState];
    var marked = 0;
    var self = this;

    states.has = {};
    states.has[firstState] = 0;

    while (marked !== states.length) {
        var itemSet = states[marked];
        marked++;

        itemSet.list.forEach(function(item) {
            if (item.nextSymbol && item.nextSymbol !== self.EOF) {
                self.insertLRState(item.nextSymbol, itemSet, states, marked - 1);
            }
        });
    }

    return states;
};

// Insert or merge item set into canonical collection
LALRGenerator.prototype.insertLRState = function(symbol, itemSet, states, stateNum) {
                var g = this.goto(itemSet, symbol);
    if (!g.predecessors) g.predecessors = {};

    if (g.length > 0) {
        var gv = g.valueOf();
        var i = states.has[gv];
        if (i === -1 || typeof i === 'undefined') {
            states.has[gv] = states.length;
            itemSet.transitions[symbol] = states.length;
            states.push(g);
            g.predecessors[symbol] = [stateNum];
        } else {
            itemSet.transitions[symbol] = i;
            states[i].predecessors[symbol].push(stateNum);
        }
    }
};

// Parse table generation
// Generate LALR(1) parsing table from item sets
LALRGenerator.prototype.buildParseTable = function(itemSets) {
    var states = [];
    var nonterminals = this.nonterminals;
    var operators = this.operators;
    var conflictedStates = {};
    var self = this;
    var s = 1, r = 2, a = 3;
    var NONASSOC = 0;

    itemSets.forEach(function(itemSet, k) {
        var state = states[k] = {};

        // Set shift and goto actions
        for (var stackSymbol in itemSet.transitions) {
            itemSet.list.forEach(function(item) {
                if (item.nextSymbol === stackSymbol) {
                    var gotoState = itemSet.transitions[stackSymbol];
                    if (nonterminals[stackSymbol]) {
                        state[self.symbolMap[stackSymbol]] = gotoState;
                    } else {
                        state[self.symbolMap[stackSymbol]] = [s, gotoState];
                    }
                }
            });
        }

        // Set accept action
        itemSet.list.forEach(function(item) {
            if (item.nextSymbol === self.EOF) {
                state[self.symbolMap[self.EOF]] = [a];
            }
        });

        var allterms = self.getLookaheadSet ? false : self.terminals;

        // Set reductions
        itemSet.reductions.forEach(function(item) {
            var terminals = allterms || self.getLookaheadSet(itemSet, item);

            terminals.forEach(function(stackSymbol) {
                var action = state[self.symbolMap[stackSymbol]];
                var op = operators[stackSymbol];

                if (action || (action && action.length)) {
                    var sol = self.resolveConflict(item.production, op, [r, item.production.id],
                        action[0] instanceof Array ? action[0] : action);
                    self.resolutions.push([k, stackSymbol, sol]);

                    if (sol.bydefault) {
                        self.conflicts++;
                        conflictedStates[k] = true;
                        if (self.options.noDefaultResolve) {
                            if (!(action[0] instanceof Array)) {
                                action = [action];
                            }
                            action.push(sol.r);
                        }
                    } else {
                        action = sol.action;
                    }
                } else {
                    action = [r, item.production.id];
                }

                if (action && action.length) {
                    state[self.symbolMap[stackSymbol]] = action;
                } else if (action === NONASSOC) {
                    state[self.symbolMap[stackSymbol]] = undefined;
                }
            });
        });
    });

    return states;
};

// Resolve shift/reduce conflicts using operator precedence
LALRGenerator.prototype.resolveConflict = function(production, op, reduce, shift) {
    var sln = {
        production: production,
        operator: op,
        r: reduce,
        s: shift
    };
    var s = 1, r = 2, NONASSOC = 0;

    if (shift[0] === r) {
        sln.action = shift[1] < reduce[1] ? shift : reduce;
        if (shift[1] !== reduce[1]) sln.bydefault = true;
        return sln;
    }

    if (production.precedence === 0 || !op) {
        sln.bydefault = true;
        sln.action = shift;
    } else if (production.precedence < op.precedence) {
        sln.action = shift;
    } else if (production.precedence === op.precedence) {
        if (op.assoc === "right") {
            sln.action = shift;
        } else if (op.assoc === "left") {
            sln.action = reduce;
        } else if (op.assoc === "nonassoc") {
            sln.action = NONASSOC;
        }
    } else {
        sln.action = reduce;
    }

    return sln;
};

// Find default actions for parser states to reduce table size
LALRGenerator.prototype.computeDefaultActions = function(states) {
    var defaults = {};
    states.forEach(function(state, k) {
        var i = 0, act;
        for (act in state) {
            if ({}.hasOwnProperty.call(state, act)) i++;
        }
        if (i === 1 && state[act][0] === 2) {
            defaults[k] = state[act];
        }
    });
    return defaults;
};

// LALR-specific methods
// Get lookahead symbols for an item in a state
LALRGenerator.prototype.getLookaheadSet = function(state, item) {
    return (!!this.onDemandLookahead && !state.hasConflicts) ? this.terminals : item.follows;
};

// Navigate through parser states following a symbol sequence
LALRGenerator.prototype.gotoState = function(startState, symbolSequence) {
    var currentState = parseInt(startState, 10);
    for (var i = 0; i < symbolSequence.length; i++) {
        currentState = this.states[currentState].transitions[symbolSequence[i]] || currentState;
    }
    return currentState;
};

// Navigate through parser states and record the path taken
LALRGenerator.prototype.gotoStateWithPath = function(startState, symbolSequence) {
    var currentState = parseInt(startState, 10);
    var path = [];
    for (var i = 0; i < symbolSequence.length; i++) {
        var transition = symbolSequence[i] ? currentState + ":" + symbolSequence[i] : '';
        if (transition) this.lookahead.nonterminalMap[transition] = currentState;
        path.push(transition);
        currentState = this.states[currentState].transitions[symbolSequence[i]] || currentState;
        this.terminalMap[transition] = symbolSequence[i];
    }
    return { path: path, endState: currentState };
};

// Build augmented grammar for lookahead computation
LALRGenerator.prototype.buildAugmentedGrammar = function() {
    var self = this;
    var newg = this.lookahead;

    this.states.forEach(function(state, i) {
        state.list.forEach(function(item) {
            if (item.dot === 0) {
                var symbol = i + ":" + item.production.symbol;
                self.terminalMap[symbol] = item.production.symbol;
                newg.nonterminalMap[symbol] = i;
                if (!newg.nonterminals[symbol]) {
                    newg.nonterminals[symbol] = new Nonterminal(symbol);
                }
                var pathInfo = self.gotoStateWithPath(i, item.production.handle);
                var p = new Production(symbol, pathInfo.path, newg.productions.length);
                newg.productions.push(p);
                newg.nonterminals[symbol].productions.push(p);

                var handle = item.production.handle.join(' ');
                var handleToSymbols = self.states[pathInfo.endState].handleToSymbols;
                if (!handleToSymbols[handle]) {
                    handleToSymbols[handle] = [];
                }
                handleToSymbols[handle].push(symbol);
            }
        });
        if (state.hasConflicts) {
            self.conflictStates.push(i);
        }
    });
};

// Propagate lookaheads from augmented grammar back to original states
LALRGenerator.prototype.unionLookaheads = function() {
    var self = this;
    var newg = this.lookahead;
    var states = !!this.onDemandLookahead ? this.conflictStates : this.states;

    states.forEach(function(i) {
        var state = typeof i === 'number' ? self.states[i] : i;
        if (state.reductions.length) {
            state.reductions.forEach(function(item) {
                var follows = {};
                for (var k = 0; k < item.follows.length; k++) {
                    follows[item.follows[k]] = true;
                }
                state.handleToSymbols[item.production.handle.join(' ')].forEach(function(symbol) {
                    newg.nonterminals[symbol].follows.forEach(function(symbol) {
                        var terminal = self.terminalMap[symbol];
                        if (!follows[terminal]) {
                            follows[terminal] = true;
                            item.follows.push(terminal);
                        }
                    });
                });
            });
        }
    });
};

// Code generation
// Generate parser code with specified options
LALRGenerator.prototype.generate = function(opt) {
    opt = Object.assign({}, this.options, opt);
    var moduleName = opt.moduleName || "parser";
    if (!moduleName.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)) {
        moduleName = "parser";
    }
    return this.generateCommonJSModule(opt);
};

// Generate CommonJS module wrapper for parser
LALRGenerator.prototype.generateCommonJSModule = function(opt) {
    opt = Object.assign({}, this.options, opt);
    var moduleName = opt.moduleName || "parser";
    var out = this.generateModule(opt) +
        "\n\n\nif (typeof require !== 'undefined' && typeof exports !== 'undefined') {" +
        "\nexports.parser = " + moduleName + ";" +
        "\nexports.Parser = " + moduleName + ".Parser;" +
        "\nexports.parse = function () { return " + moduleName + ".parse.apply(" + moduleName + ", arguments); };" +
        "\nexports.main = function() {};" +
        "\nif (typeof module !== 'undefined' && require.main === module) {\n" +
        "  exports.main(process.argv.slice(1));\n}" +
        "\n}";
    return out;
};

// Generate module wrapper for parser
LALRGenerator.prototype.generateModule = function(opt) {
    opt = Object.assign({}, this.options, opt);
    var moduleName = opt.moduleName || "parser";
    var out = "/* parser generated by jison " + version + " */\n";
    out += (moduleName.match(/\./) ? moduleName : "var " + moduleName) +
        " = " + this.generateModuleExpr();
    return out;
};

// Generate self-executing module expression
LALRGenerator.prototype.generateModuleExpr = function() {
    var module = this.generateModule_();
    var out = "(function(){\n";
    out += module.commonCode;
    out += "\nvar parser = " + module.moduleCode;
    out += "\n" + this.moduleInclude;
    out += "\nfunction Parser () {\n  this.yy = {};\n}\n" +
        "Parser.prototype = parser;" +
        "parser.Parser = Parser;" +
        "\nreturn new Parser;\n})();";
    return out;
};

// Generate core parser module code
LALRGenerator.prototype.generateModule_ = function() {
    var tableCode = this.generateTableCode(this.stateTable);
    var moduleCode = "{";
    moduleCode += [
        "trace: function trace() {}",
        "yy: {}",
        "symbolMap: " + JSON.stringify(this.symbolMap),
        "terminals_: " + JSON.stringify(this.terminals_).replace(/"([0-9]+)":/g, "$1:"),
        "productionTable: " + JSON.stringify(this.productionTable),
        "stateTable: " + tableCode.moduleCode,
        "defaultActions: " + JSON.stringify(this.defaultActions).replace(/"([0-9]+)":/g, "$1:"),
        "performAction: " + String(this.performAction),
        "parseError: " + String(this.parseError),
        "parse: " + String(this.parse)
    ].join(",\n");
    moduleCode += "};";

    return {
        commonCode: tableCode.commonCode,
        moduleCode: moduleCode
    };
};

// Generate optimized parsing table code
LALRGenerator.prototype.generateTableCode = function(stateTable) {
    // Generate compact JSON without spaces and with unquoted numeric keys
    var moduleCode = JSON.stringify(stateTable, null, 0);

    // Remove quotes around numeric object keys
    moduleCode = moduleCode.replace(/"([0-9]+)"(?=:)/g, "$1");

    return {
        commonCode: '',
        moduleCode: moduleCode
    };
};

// Handle parsing errors with context information
LALRGenerator.prototype.parseError = function(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        var error = new Error(str);
        error.hash = hash;
        throw error;
    }
};

// Parse input string using generated LALR(1) parser
LALRGenerator.prototype.parse = function(input) {
    var self = this;
    var stk = [0];
    var val = [null];
    var loc = [];
    var stateTable = this.stateTable;
    var yytext = '';
    var yylineno = 0;
    var yyleng = 0;
    var recovering = 0;
    var TERROR = 2;
    var EOF = 1;

    var lexer = Object.create(this.lexer);
    var sharedState = { yy: {} };

    for (var k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
            sharedState.yy[k] = this.yy[k];
        }
    }

    lexer.setInput(input, sharedState.yy);
    sharedState.yy.lexer = lexer;
    sharedState.yy.parser = this;

    if (typeof lexer.yylloc === 'undefined') {
        lexer.yylloc = {};
    }
    var yyloc = lexer.yylloc;
    loc.push(yyloc);

    var ranges = lexer.options && lexer.options.ranges;

    if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }

    var lex = function() {
        var token = lexer.lex() || EOF;
        if (typeof token !== 'number') {
            token = self.symbolMap[token] || token;
        }
        return token;
    };

    var symbol, preErrorSymbol, state, action, r, yyval = {};
    var p, len, newState, expected;

    while (true) {
        var stkLen = stk.length;
        state = stk[stkLen - 1];

        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol === 'undefined') {
                symbol = lex();
            }
            action = stateTable[state] && stateTable[state][symbol];
        }

        if (typeof action === 'undefined' || !action.length || !action[0]) {
            var errStr = '';

            if (!recovering) {
                expected = [];
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push("'" + this.terminals_[p] + "'");
                for (p in stateTable[state]) {
                    }
                }
                if (lexer.showPosition) {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ":\n" +
                        lexer.showPosition() + "\nExpecting " + expected.join(', ') +
                        ", got '" + (this.terminals_[symbol] || symbol) + "'";
                } else {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ": Unexpected " +
                        (symbol === EOF ? "end of input" :
                            ("'" + (this.terminals_[symbol] || symbol) + "'"));
                }
                this.parseError(errStr, {
                    text: lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: lexer.yylineno,
                    loc: yyloc,
                    expected: expected
                });
            }

            throw new Error(errStr);
        }

        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }

        switch (action[0]) {
            case 1: // shift
                stk.push(symbol);
                val.push(lexer.yytext);
                loc.push(lexer.yylloc);
                stk.push(action[1]);
                symbol = null;
                if (!preErrorSymbol) {
                    yyleng = lexer.yyleng;
                    yytext = lexer.yytext;
                    yylineno = lexer.yylineno;
                    yyloc = lexer.yylloc;
                    if (recovering > 0) {
                        recovering--;
                    }
                } else {
                    symbol = preErrorSymbol;
                    preErrorSymbol = null;
                }
                break;

            case 2: // reduce
                len = this.productionTable[action[1]][1];
                var valLen = val.length;
                var locLen = loc.length;
                yyval.$ = val[valLen - len];
                var locFirst = loc[locLen - (len || 1)];
                var locLast = loc[locLen - 1];
                yyval._$ = {
                    first_line: locFirst.first_line,
                    last_line: locLast.last_line,
                    first_column: locFirst.first_column,
                    last_column: locLast.last_column
                };
                if (ranges) {
                    yyval._$.range = [locFirst.range[0], locLast.range[1]];
                }
                r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy,
                                                     action[1], val, loc]);

                if (typeof r !== 'undefined') {
                    return r;
                }

                if (len) {
                    stk.length = stk.length - (len * 2);
                    val.length = val.length - len;
                    loc.length = loc.length - len;
                }

                stk.push(this.productionTable[action[1]][0]);
                val.push(yyval.$);
                loc.push(yyval._$);
                stkLen = stk.length;
                newState = stateTable[stk[stkLen - 2]][stk[stkLen - 1]];
                stk.push(newState);
                break;

            case 3: // accept
                return true;
        }
    }
};

// Debug tracing function (no-op by default)
LALRGenerator.prototype.trace = function() {};

// Create executable parser instance from generated code
LALRGenerator.prototype.createParser = function() {
    var p = eval(this.generateModuleExpr());
    p.productions = this.productions;

    var self = this;
    function bind(method) {
        return function() {
            self.lexer = p.lexer;
            return self[method].apply(self, arguments);
        };
    }

    p.lexer = this.lexer;
    p.generate = bind('generate');
    p.generateModule = bind('generateModule');
    p.generateCommonJSModule = bind('generateCommonJSModule');

    return p;
};

// Exports
Jison.Parser = function(grammar, options) {
    var gen = new LALRGenerator(grammar, options);
    return gen.createParser();
};

exports.LALRGenerator = LALRGenerator;

Jison.Generator = function(g, options) {
    var opt = Object.assign({}, g.options, options);
    return new LALRGenerator(g, opt);
};

return function Parser(g, options) {
    var gen = Jison.Generator(g, options);
    return gen.createParser();
};
