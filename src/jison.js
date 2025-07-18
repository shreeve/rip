// LALR(1) Parser Generator - Optimized Integer-Only Implementation
// High-performance implementation using typed arrays for ultra-fast set operations

var Jison = exports.Jison = exports;
var version = '0.5.0';

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

// Represents an LR(0) item [A → α•β] with lookahead
function Item(production, dot, lookaheadSet, predecessor) {
    this.production = production;
    this.dot = dot || 0;
    this.follows = lookaheadSet || [];
    this.predecessor = predecessor;
    this.nextSymbol = this.production.handle[this.dot];
    this.id = parseInt(production.id + 'a' + this.dot, 36);
}

// Represents a set of LR items (parser state)
function LRState() {
    this.list = [];
    this.length = 0;
    this.reductions = [];
    this.handleToSymbols = {};
    this.transitions = {};
    this.hasShifts = false;
    this.hasConflicts = false;
    this.keys = {};

    if (arguments.length) {
        this.list = Array.prototype.slice.call(arguments);
        this.length = this.list.length;
        for (var i = this.length - 1; i >= 0; i--) {
            this.keys[this.list[i].id] = true;
        }
    }
}

LRState.prototype.concat = function(set) {
    var a = set.list || set;
    for (var i = a.length - 1; i >= 0; i--) {
        this.keys[a[i].id] = true;
    }
    this.list.push.apply(this.list, a);
    this.length = this.list.length;
    return this;
};

LRState.prototype.push = function(item) {
    this.keys[item.id] = true;
    this.list.push(item);
    this.length = this.list.length;
    return this.length;
};

LRState.prototype.contains = function(item) {
    return this.keys[item.id];
};

LRState.prototype.valueOf = function() {
    var v = this.list.map(function(a) { return a.id; }).sort().join('|');
    this.valueOf = function() { return v; };
    return v;
};

// Unified LALR(1) parser generator with integer-only optimization
function LALRGenerator(grammar, options) {
    options = Object.assign({}, grammar.options, options);
    this.terminals = {};
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

    this.processGrammar(grammar);
    this.setupIntegerMappings();
    this.states = this.buildLRAutomaton();
    this.terminalMap = {};

    this.lookahead = {
        nonterminalMap: {},
        nonterminals: {},
        productions: []
    };

    this.conflictStates = [];
    this.onDemandLookahead = options.onDemandLookahead || false;

    this.buildAugmentedGrammar();

    // Compute lookaheads in lookahead context
    var savedNonterminals = this.nonterminals;
    var savedProductions = this.productions;

    this.nonterminals = this.lookahead.nonterminals;
    this.productions = this.lookahead.productions;

    this.computeLookaheads();

    this.nonterminals = savedNonterminals;
    this.productions = savedProductions;

    this.unionLookaheads();
    this.stateTable = this.buildParseTable(this.states);
    this.defaultActions = this.computeDefaultActions(this.stateTable);
}

LALRGenerator.prototype.gotoEncoded = function(stateId, symbolSequence) {
    stateId = stateId.split(":")[0];
    symbolSequence = symbolSequence.map(function(s) { return s.slice(s.indexOf(":") + 1); });
    return this.gotoState(stateId, symbolSequence);
};

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

// Setup integer mappings for ultra-fast lookahead computation
LALRGenerator.prototype.setupIntegerMappings = function() {
    this.nonterminalToIndex = {};
    this.indexToNonterminal = [];
    var ntIndex = 0;
    for (var symbol in this.nonterminals) {
        this.nonterminalToIndex[symbol] = ntIndex;
        this.indexToNonterminal[ntIndex] = symbol;
        ntIndex++;
    }
    this.nonterminalCount = ntIndex;

    this.terminalToIndex = {};
    this.indexToTerminal = [];
    var termIndex = 0;
    for (var i = 0; i < this.terminals.length; i++) {
        var terminal = this.terminals[i];
        this.terminalToIndex[terminal] = termIndex;
        this.indexToTerminal[termIndex] = terminal;
        termIndex++;
    }
    this.terminalCount = termIndex;

    var ArrayType = this.terminalCount < 256 ? Uint8Array : Uint16Array;
    this.firstSets = new ArrayType(this.nonterminalCount * this.terminalCount);
    this.followSets = new ArrayType(this.nonterminalCount * this.terminalCount);
    this.nullableSets = new Uint8Array(this.nonterminalCount);
};

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
        var id = symbolMap[sym];
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

// Compute LALR(1) lookaheads using optimized integer-only operations
LALRGenerator.prototype.computeLookaheads = function() {
    this.computeLookaheads = function() {};
    this.computeNullableSets();
    this.computeFirstSets();
    this.computeFollowSets();
};

// Compute NULLABLE sets using integer-only operations
LALRGenerator.prototype.computeNullableSets = function() {
    var cont = true;
    var self = this;

    while (cont) {
        cont = false;

        this.productions.forEach(function(production) {
            if (!production.nullable) {
                var allNullable = true;
                for (var i = 0, t; t = production.handle[i]; ++i) {
                    if (!self.isNullable(t)) {
                        allNullable = false;
                        break;
                    }
                }
                if (allNullable) {
                    production.nullable = cont = true;
                }
            }
        });

        for (var ntIndex = 0; ntIndex < this.nonterminalCount; ntIndex++) {
            if (!this.nullableSets[ntIndex]) {
                var symbol = this.indexToNonterminal[ntIndex];
                var nonterminal = this.nonterminals[symbol];
                if (nonterminal && nonterminal.productions) {
                    for (var i = 0, production; production = nonterminal.productions[i]; i++) {
                        if (production.nullable) {
                            this.nullableSets[ntIndex] = 1;
                            cont = true;
                            break;
                        }
                    }
                }
            }
        }
    }
};

LALRGenerator.prototype.isNullable = function(symbol) {
    if (symbol === '') return true;
    if (symbol instanceof Array) {
        for (var i = 0, t; t = symbol[i]; ++i) {
            if (!this.isNullable(t)) return false;
        }
        return true;
    }

    var ntIndex = this.nonterminalToIndex[symbol];
    return ntIndex !== undefined ? this.nullableSets[ntIndex] : false;
};

// Compute FIRST sets using integer-only operations (no union calls!)
LALRGenerator.prototype.computeFirstSets = function() {
    var self = this;
    var cont = true;

    while (cont) {
        cont = false;

        this.productions.forEach(function(production) {
            var newFirst = self.computeFirst(production.handle);
            var changed = false;

            for (var i = 0; i < newFirst.length; i++) {
                if (production.first.indexOf(newFirst[i]) === -1) {
                    production.first.push(newFirst[i]);
                    changed = true;
                }
            }

            if (changed) cont = true;
        });

        for (var ntIndex = 0; ntIndex < this.nonterminalCount; ntIndex++) {
            var symbol = this.indexToNonterminal[ntIndex];
            var nonterminal = this.nonterminals[symbol];
            if (!nonterminal) continue;

            var baseOffset = ntIndex * this.terminalCount;
            var changed = false;

            for (var i = 0; i < nonterminal.productions.length; i++) {
                var production = nonterminal.productions[i];
                for (var j = 0; j < production.first.length; j++) {
                    var termIndex = this.terminalToIndex[production.first[j]];
                    if (termIndex !== undefined && !this.firstSets[baseOffset + termIndex]) {
                        this.firstSets[baseOffset + termIndex] = 1;
                        changed = true;
                    }
                }
            }

            if (changed) {
                nonterminal.first = [];
                for (var i = 0; i < this.terminalCount; i++) {
                    if (this.firstSets[baseOffset + i]) {
                        nonterminal.first.push(this.indexToTerminal[i]);
                    }
                }
                cont = true;
            }
        }
    }
};

LALRGenerator.prototype.computeFirst = function(sequence) {
    if (sequence === '') return [];
    if (sequence instanceof Array) {
        var firsts = [];
        for (var i = 0, t; t = sequence[i]; ++i) {
            if (!this.nonterminals[t]) {
                if (firsts.indexOf(t) === -1) firsts.push(t);
            } else {
                for (var j = 0; j < this.nonterminals[t].first.length; j++) {
                    var sym = this.nonterminals[t].first[j];
                    if (firsts.indexOf(sym) === -1) firsts.push(sym);
                }
            }
            if (!this.isNullable(t)) break;
        }
        return firsts;
    }
    return !this.nonterminals[sequence] ? [sequence] : this.nonterminals[sequence].first;
};

LALRGenerator.prototype.first = function(symbol) {
    return this.computeFirst(symbol);
};

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
                        set = set.concat(nonterminals[production.symbol].follows);
                    }
                }

                var oldcount = nonterminals[t].follows.length;
                for (var j = 0; j < set.length; j++) {
                    if (nonterminals[t].follows.indexOf(set[j]) === -1) {
                        nonterminals[t].follows.push(set[j]);
                    }
                }
                if (oldcount !== nonterminals[t].follows.length) {
                    cont = true;
                }
            }
        });
    }
};

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

LALRGenerator.prototype.goto = function(itemSet, symbol) {
    var gotoSet = new LRState();

    itemSet.list.forEach(function(item, n) {
        if (item.nextSymbol === symbol) {
            gotoSet.push(new Item(item.production, item.dot + 1, item.follows, n));
        }
    });

    return gotoSet.length === 0 ? gotoSet : this.closure(gotoSet);
};

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

        itemSet.list.forEach(function(item) {
            if (item.nextSymbol === self.EOF) {
                state[self.symbolMap[self.EOF]] = [a];
            }
        });

        var allterms = self.getLookaheadSet ? false : self.terminals;

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

LALRGenerator.prototype.getLookaheadSet = function(state, item) {
    return (!!this.onDemandLookahead && !state.hasConflicts) ? this.terminals : item.follows;
};

LALRGenerator.prototype.gotoState = function(startState, symbolSequence) {
    var currentState = parseInt(startState, 10);
    for (var i = 0; i < symbolSequence.length; i++) {
        currentState = this.states[currentState].transitions[symbolSequence[i]] || currentState;
    }
    return currentState;
};

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

LALRGenerator.prototype.generate = function(opt) {
    opt = Object.assign({}, this.options, opt);
    var moduleName = opt.moduleName || "parser";
    if (!moduleName.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)) {
        moduleName = "parser";
    }
    return this.generateCommonJSModule(opt);
};

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

LALRGenerator.prototype.generateModule = function(opt) {
    opt = Object.assign({}, this.options, opt);
    var moduleName = opt.moduleName || "parser";
    var out = "/* parser generated by jison " + version + " */\n";
    out += (moduleName.match(/\./) ? moduleName : "var " + moduleName) +
        " = " + this.generateModuleExpr();
    return out;
};

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

LALRGenerator.prototype.generateTableCode = function(stateTable) {
    var moduleCode = JSON.stringify(stateTable, null, 0);
    moduleCode = moduleCode.replace(/"([0-9]+)"(?=:)/g, "$1");
    return {
        commonCode: '',
        moduleCode: moduleCode
    };
};

LALRGenerator.prototype.parseError = function(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        var error = new Error(str);
        error.hash = hash;
        throw error;
    }
};

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
                for (p in stateTable[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push("'" + this.terminals_[p] + "'");
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
            case 1:
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

            case 2:
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

            case 3:
                return true;
        }
    }
};

LALRGenerator.prototype.trace = function() {};

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
