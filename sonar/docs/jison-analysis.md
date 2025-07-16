# Jison LALR(1) Algorithm Analysis

## 🔍 **Key Finding: Why Sonar is Fast (But Wrong)**

**Sonar is NOT implementing LALR(1)** - it's missing the core lookahead propagation algorithm, which is why it runs in ~1 second instead of ~8 seconds.

## 📊 **Timing Breakdown**

### Production Jison (8.3 seconds total):
- `processGrammar`: 3ms
- `buildLRAutomaton`: 950ms
- `buildAugmentedGrammar`: 50ms
- `computeLookaheads`: 20ms
- **`unionLookaheads`: 6.7 seconds** ⬅️ **THE REAL WORK**
- `buildParseTable`: 35ms

### Sonar (1.1 seconds total):
- `processGrammar`: 1.3ms
- `buildLRAutomaton`: 950ms
- `buildAugmentedGrammar`: 50ms
- `computeLookaheads`: 20ms
- **`unionLookaheads`: 3ms** ⬅️ **INCOMPLETE/MISSING**
- `buildParseTable`: 35ms

## 🏗️ **Real LALR(1) Algorithm Structure**

### Phase 1: Basic Grammar Processing
```javascript
// processGrammar() - Convert BNF to internal representation
// buildLRAutomaton() - Generate LR(0) item sets and transitions
```

### Phase 2: Lookahead Preparation
```javascript
// buildAugmentedGrammar() - Create augmented grammar for lookahead computation
LALRGenerator.prototype.buildAugmentedGrammar = function() {
    // For each state and each item with dot at start
    this.states.forEach(function(state, i) {
        state.list.forEach(function(item) {
            if (item.dot === 0) {
                // Create augmented nonterminal: "stateId:symbol"
                var symbol = i + ":" + item.production.symbol;

                // Track path through parser states
                var pathInfo = self.gotoStateWithPath(i, item.production.handle);

                // Create production in augmented grammar
                var p = new Production(symbol, pathInfo.path, newg.productions.length);
                newg.productions.push(p);
            }
        });
    });
};
```

### Phase 3: Basic Sets Computation
```javascript
// computeLookaheads() - Compute NULLABLE, FIRST, FOLLOW sets
// This is the same in both Jison and Sonar
```

### Phase 4: **THE REAL LALR(1) WORK** - Lookahead Propagation
```javascript
// unionLookaheads() - Propagate lookaheads using augmented grammar
LALRGenerator.prototype.unionLookaheads = function() {
    var newg = this.lookahead; // augmented grammar
    var states = this.states;

    states.forEach(function(state) {
        if (state.reductions.length) {
            state.reductions.forEach(function(item) {
                // Get current lookaheads for this item
                var follows = {};
                for (var k = 0; k < item.follows.length; k++) {
                    follows[item.follows[k]] = true;
                }

                // Propagate lookaheads from augmented grammar
                state.handleToSymbols[item.production.handle.join(' ')].forEach(function(symbol) {
                    newg.nonterminals[symbol].follows.forEach(function(followSymbol) {
                        var terminal = self.terminalMap[followSymbol];
                        if (!follows[terminal]) {
                            follows[terminal] = true;
                            item.follows.push(terminal); // ⬅️ ACTUAL PROPAGATION
                        }
                    });
                });
            });
        }
    });
};
```

## 🚨 **What Sonar is Missing**

### Sonar's Incomplete `unionLookaheads`:
```coffeescript
unionLookaheads: ->
  # Starts correctly but is INCOMPLETE
  for i in statesToProcess
    state = if typeof i is 'number' then @states[i] else i
    if state.reductions.length
      for item in state.reductions
        follows = {}
        follows[follow] = true for follow in item.follows
        # MISSING: The actual lookahead propagation logic!
        # Should iterate through handleToSymbols and propagate from augmented grammar
```

### Missing Components:
1. **Augmented Grammar Lookahead Propagation**: The core of LALR(1)
2. **DeRemer-Pennello Algorithm**: Efficient lookahead computation
3. **Proper Lookahead Sets**: Currently using incomplete/incorrect lookaheads

## 🎯 **Why This Matters**

**LALR(1) vs LR(0):**
- **LR(0)**: Can only handle simple grammars, many shift/reduce conflicts
- **LALR(1)**: Can handle complex grammars like CoffeeScript by using lookahead

**Current Status:**
- ✅ Sonar generates **syntactically valid** parsers
- ❌ Sonar parsers will have **incorrect conflict resolution**
- ❌ Sonar parsers will **fail on complex grammar constructs**

## 🔧 **Next Steps**

1. **Implement Real `unionLookaheads`**: Port Jison's lookahead propagation
2. **Add Missing `buildAugmentedGrammar`**: Currently incomplete in Sonar
3. **Test with Complex Grammar**: Verify LALR(1) behavior vs LR(0)
4. **Performance Optimization**: Once correct, optimize the 6.7s bottleneck

## 📚 **References**

- **"Efficient Computation of LALR(1) Look-Ahead Sets"** (DeRemer & Pennello, 1982)
- **"Compilers: Principles, Techniques, and Tools"** (Dragon Book)
- **Original Jison Implementation**: `/node_modules/jison/lib/jison.js`