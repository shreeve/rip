// LALR(1) Parser Generator
//
// Original implementation by Jison team
// https://github.com/zaach/jison/blob/master/lib/jison.js
//
// Updated work and optimization by Steve Shreeve <steve.shreeve@gmail.com>
// https://github.com/shreeve/jison

var Jison = exports.Jison = exports;
var version = '0.5.2'; // require('../package.json').version;

// Nonterminal symbol
function Nonterminal(symbol) {
    this.symbol      = symbol;
    this.productions = [];
    this.nullable    = false;
    this.first       = new Set();
    this.follows     = new Set();
}

// Production rule: A → α
function Production(symbol, handle, id) {
    this.symbol     = symbol;
    this.handle     = handle;
    this.id         = id;
    this.nullable   = false;
    this.first      = new Set();
    this.precedence = 0;
}

// LR(0) item: [A → α•β] with LALR(1) lookahead
function Item(production, dot, follows) {
    this.production = production;
    this.dot        = dot     || 0;
    this.follows    = follows || [];
    this.nextSymbol = this.production.handle[this.dot];
    this.id         = parseInt(production.id + 'a' + dot, 36);
}

// LR parser state (set of items)
function LRState() {
    this.items        = new Set(arguments.length ? Array.prototype.slice.call(arguments) : []);
    this.reductions   = [];
    this.transitions  = {};
    this.hasShifts    = false;
    this.hasConflicts = false;
    this.id           = null;
}

// Generate unique string representation for ItemSet comparison
LRState.prototype.valueOf = function() {
    var v = Array.from(this.items).map(function(a) { return a.id; }).sort().join('|');
    this.valueOf = function() { return v; };
    return v;
};

// LALR(1) Parser Generator
function LALRGenerator(grammar, options) {
    // Configuration
    this.options = Object.assign({}, grammar.options, options);
    this.parseParams = grammar.parseParams;
    this.yy = {};

    // Grammar structures
    this.terminals   = {};
    this.operators   = {};
    this.productions = [];
    this.conflicts   = 0;
    this.resolutions = [];

    // Code generation setup
    this._setupCodeGeneration(grammar);
    this._buildParser(grammar);
}

LALRGenerator.prototype._setupCodeGeneration = function(grammar) {
    if (grammar.actionInclude) {
        if (typeof grammar.actionInclude === 'function') {
            this.actionInclude = String(grammar.actionInclude)
                .replace(/^\s*function \(\) \{/, '')
                .replace(/\}\s*$/, '');
        } else {
            this.actionInclude = grammar.actionInclude;
        }
    }
    this.moduleInclude = grammar.moduleInclude || '';
};

LALRGenerator.prototype._buildParser = function(grammar) {
    this.processGrammar(grammar);
    this.buildLRAutomaton();
    this.computeLookaheads();
    this.assignItemLookaheads();
    this.buildParseTable(this.states);
    this.computeDefaultActions(this.stateTable);
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

    this._augmentGrammar(grammar);
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
LALRGenerator.prototype._augmentGrammar = function(grammar) {
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
    this.nonterminals[this.startSymbol].follows.add(this.EOF);
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
    this.initializeSets();
    this.computeNullableSets();
    this.computeFirstSets();
    this.computeFollowSets();
};

// Assign FOLLOW sets to reduction items for LALR(1)
LALRGenerator.prototype.assignItemLookaheads = function() {
    var self = this;
    this.states.forEach(function(state) {
        state.reductions.forEach(function(item) {
            var follows = self.nonterminals[item.production.symbol] && self.nonterminals[item.production.symbol].follows;
            if (follows) {
                item.follows.length = 0;
                follows.forEach(function(terminal) {
                    item.follows.push(terminal);
                });
            }
        });
    });
};

// Initialize FIRST and FOLLOW sets as Sets for O(1) operations
LALRGenerator.prototype.initializeSets = function() {
    // Note: this.productions and this.nonterminals refer to the lookahead context here
    // Initialize production.first as Set
    for (var i = 0; i < this.productions.length; i++) {
        this.productions[i].first = new Set();
    }

    // Initialize nonterminal.first and nonterminal.follows as Sets
    for (var symbol in this.nonterminals) {
        this.nonterminals[symbol].first = new Set();
        this.nonterminals[symbol].follows = new Set();
    }
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
            var oldSize = production.first.size;
            // Clear and rebuild the Set
            production.first.clear();
            for (var i = 0; i < firsts.length; i++) {
                production.first.add(firsts[i]);
            }
            if (production.first.size > oldSize) {
                cont = true;
            }
        });

        for (var symbol in nonterminals) {
            var oldSize = nonterminals[symbol].first.size;
            nonterminals[symbol].first.clear();
            nonterminals[symbol].productions.forEach(function(production) {
                // Fast Set union using forEach
                production.first.forEach(function(item) {
                    nonterminals[symbol].first.add(item);
                });
            });
            if (nonterminals[symbol].first.size > oldSize) {
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
        var firstsSet = new Set();
        for (var i = 0, t; t = symbol[i]; ++i) {
            if (!this.nonterminals[t]) {
                firstsSet.add(t);
            } else {
                // Fast Set union using forEach
                this.nonterminals[t].first.forEach(function(item) {
                    firstsSet.add(item);
                });
            }
            if (!this.isNullable(t)) break;
        }
        // Convert Set back to Array
        return Array.from(firstsSet);
    }
    if (!this.nonterminals[symbol]) return [symbol];

    // Convert Set to Array
    return Array.from(this.nonterminals[symbol].first);
};

// Compute FOLLOW sets for all nonterminals
// Compute FOLLOW sets (terminals that can follow nonterminals)
LALRGenerator.prototype.computeFollowSets = function() {
    var changed = true;
    var self = this;

    while (changed) {
        changed = false;

        this.productions.forEach(function(production) {
            for (var i = 0; i < production.handle.length; i++) {
                var symbol = production.handle[i];
                if (!self.nonterminals[symbol]) continue;

                var oldSize = self.nonterminals[symbol].follows.size;

                if (i === production.handle.length - 1) {
                    // Symbol at end: add FOLLOW(LHS)
                    self.nonterminals[production.symbol].follows.forEach(function(item) {
                        self.nonterminals[symbol].follows.add(item);
                    });
                } else {
                    // Add FIRST(β) where β follows symbol
                    var beta = production.handle.slice(i + 1);
                    var firstSet = self.first(beta);

                    // Add first set items
                    for (var j = 0; j < firstSet.length; j++) {
                        self.nonterminals[symbol].follows.add(firstSet[j]);
                    }

                    // If β is nullable, also add FOLLOW(LHS)
                    if (self.isNullable(beta)) {
                        self.nonterminals[production.symbol].follows.forEach(function(item) {
                            self.nonterminals[symbol].follows.add(item);
                        });
                    }
                }

                if (self.nonterminals[symbol].follows.size > oldSize) {
                    changed = true;
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
        // Add all items from set to closureSet
        (set.items ? Array.from(set.items) : set).forEach(function(item) {
            closureSet.items.add(item);
        });

        (set.items ? Array.from(set.items) : set).forEach(function(item) {
            var symbol = item.nextSymbol;

            if (symbol && self.nonterminals[symbol]) {
                if (!syms[symbol]) {
                    self.nonterminals[symbol].productions.forEach(function(production) {
                        var newItem = new Item(production, 0);
                        if (!closureSet.items.has(newItem)) {
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

    itemSet.items.forEach(function(item) {
        if (item.nextSymbol === symbol) {
            gotoSet.items.add(new Item(item.production, item.dot + 1, item.follows));
        }
    });

    return gotoSet.items.size === 0 ? gotoSet : this.closure(gotoSet);
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

        itemSet.items.forEach(function(item) {
            if (item.nextSymbol && item.nextSymbol !== self.EOF) {
                self.insertLRState(item.nextSymbol, itemSet, states, marked - 1);
            }
        });
    }

    this.states = states;
};

// Insert or merge item set into canonical collection
LALRGenerator.prototype.insertLRState = function(symbol, itemSet, states, stateNum) {
                var g = this.goto(itemSet, symbol);
    if (!g.predecessors) g.predecessors = {};

    if (g.items.size > 0) {
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
            itemSet.items.forEach(function(item) {
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
        itemSet.items.forEach(function(item) {
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

    this.stateTable = states;
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
    this.defaultActions = defaults;
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
