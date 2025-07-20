# Sonar Parser Generator - Data Flow Analysis

This document traces the data flow through sonar.coffee's LALR(1) parser generation process, from initial grammar processing through lookahead computation.

## Overview

The parser generator follows these main phases:
1. **processGrammar** - Parse and validate input grammar
2. **buildLRAutomaton** - Construct LR(0) state machine
3. **computeLookaheads** - Calculate LALR(1) lookahead sets
4. **assignItemLookaheads** - Apply lookaheads to reduction items

---

## 1. processGrammar(grammar)

### Why Called
Entry point for grammar processing. Called from `_buildParser()` to transform raw grammar input into internal data structures.

### Purpose
- Validates and processes input grammar rules
- Creates symbol mappings and production rules
- Augments grammar with accept production for LALR(1)
- Sets up operator precedence and associativity

### Input Variables
- `grammar` - Raw grammar object containing:
  - `grammar.bnf` or `grammar.grammar` - BNF production rules
  - `grammar.operators` - Operator precedence declarations
  - `grammar.tokens` - Terminal symbol declarations
  - `grammar.start` or `grammar.startSymbol` - Start symbol name

### Calculations & Processing

#### Operator Processing (`_processOperators`)
```coffeescript
operators = {}
for precedence, i in ops
  for k in [1...precedence.length]
    operators[precedence[k]] = {precedence: i + 1, assoc: precedence[0]}
```

#### Production Building (`_buildProductions`)
- Creates local `symbolMap = {"$accept": 0, "$end": 1, "error": 2}`
- Processes each BNF rule to create `Production` objects
- Builds semantic actions code for parser runtime
- Maintains exact symbol ID compatibility with original system

#### Grammar Augmentation (`_augmentGrammar`)
- Validates start symbol exists as nonterminal
- Creates accept production: `$accept → startSymbol $end`
- Adds `$end` to start symbol's FOLLOW set

### Output/State Changes
- `@nonterminals` - Map of nonterminal name → Symbol object
- `@operators` - Map of operator → {precedence, assoc}
- `@productions` - Array of Production objects
- `@startSymbol` - Name of grammar start symbol
- `@acceptProductionIndex` - Index of augmented accept production
- `@symbolMap` - Map of symbol name → unique ID
- `@productionTable` - Array for runtime parser generation
- `@performAction` - Generated semantic action function code

---

## 2. buildLRAutomaton()

### Why Called
Called after grammar processing to construct the LR(0) finite state automaton that forms the basis of LALR(1) parsing.

### Purpose
- Builds LR(0) item sets and state transitions
- Creates the finite automaton that recognizes viable prefixes
- Computes GOTO table for state transitions
- Identifies shift/reduce conflicts

### Input Variables
- `@productions` - Production rules from processGrammar
- `@acceptProductionIndex` - Index of accept production

### Calculations & Processing

#### Initial State Creation
```coffeescript
item1 = new Item @productions[@acceptProductionIndex], 0, ["$end"]
firstState = @_closure new LRState item1
```

#### State Construction Algorithm
- Maintains `states` array and `states.has` hash for duplicate detection
- Uses worklist algorithm with `marked` counter
- For each state, computes transitions on all possible symbols

#### Closure Computation (`_closure`)
- Expands item sets by adding productions for nonterminals at dot position
- Creates `LRState` objects containing:
  - `items` - Set of LR(0) items `[A → α•β]`
  - `reductions` - Set of items with dot at end
  - `hasShifts` - Boolean indicating shift actions available
  - `hasConflicts` - Boolean indicating shift/reduce conflicts

#### State Insertion (`_insertLRState`)
- Computes GOTO(state, symbol) transitions
- Deduplicates states using item set signatures
- Builds transition table between states

### Output/State Changes
- `@states` - Array of `LRState` objects representing automaton states
- Each state contains:
  - Kernel and closure items
  - Transition mappings to other states
  - Reduction items for parser actions
  - Conflict indicators

---

## 3. computeLookaheads()

### Why Called
Called after automaton construction to compute LALR(1) lookahead information needed for conflict resolution.

### Purpose
- Computes nullable, FIRST, and FOLLOW sets for grammar symbols
- Enables LALR(1) parsing by providing lookahead information
- Uses standard algorithms from compiler theory

### Input Variables
- `@productions` - Production rules
- `@nonterminals` - Nonterminal symbols and their properties

### Calculations & Processing

#### Nullable Set Computation (`_computeNullableSets`)
Fixed-point algorithm:
```coffeescript
changed = true
while changed
  changed = false
  # Mark productions nullable if all handle symbols are nullable
  # Propagate nullability to nonterminals
```

#### FIRST Set Computation (`_computeFirstSets`)
- Computes terminals that can begin derivations from each nonterminal
- Uses recursive algorithm with memoization
- Handles nullable symbols correctly

#### FOLLOW Set Computation (`_computeFollowSets`)
- Computes terminals that can follow each nonterminal
- Processes each production: for `A → αBβ`, adds FIRST(β) to FOLLOW(B)
- If β nullable, adds FOLLOW(A) to FOLLOW(B)

### Helper Functions

#### `_isNullable(symbol)`
- Returns true if symbol can derive empty string
- Handles arrays of symbols recursively

#### `_first(symbols)`
- Returns FIRST set for symbol or sequence
- Special handling for sequences with nullable prefixes

### Output/State Changes
- `@productions[i].nullable` - Boolean for each production
- `@productions[i].first` - Set of terminals for each production
- `@nonterminals[name].nullable` - Boolean for each nonterminal
- `@nonterminals[name].first` - FIRST set for each nonterminal
- `@nonterminals[name].follows` - FOLLOW set for each nonterminal

---

## 4. assignItemLookaheads()

### Why Called
Final step before parse table construction to assign computed FOLLOW sets to individual reduction items.

### Purpose
- Applies LALR(1) lookahead information to LR(0) items
- Enables proper conflict resolution in parse table generation
- Converts global FOLLOW sets to local item lookaheads

### Input Variables
- `@states` - LR automaton states from buildLRAutomaton
- `@nonterminals` - Symbols with computed FOLLOW sets

### Calculations & Processing

#### Lookahead Assignment
```coffeescript
for state in @states
  for item from state.reductions
    follows = @nonterminals[item.production.symbol]?.follows
    if follows
      item.follows.length = 0
      item.follows.push terminal for terminal from follows
```

For each reduction item `[A → α•]`:
- Looks up FOLLOW(A) from nonterminal symbol
- Copies FOLLOW set to item's local lookahead array
- Clears any existing lookaheads first

### Output/State Changes
- `item.follows` - Array of terminal symbols for each reduction item
- These lookaheads will be used in `buildParseTable` to determine when reductions are valid

---

## Data Flow Summary

```
Grammar Input
     ↓
processGrammar()
     ↓
[@productions, @nonterminals, @symbols, @operators]
     ↓
buildLRAutomaton()
     ↓
[@states with LR(0) items and transitions]
     ↓
computeLookaheads()
     ↓
[FOLLOW sets in @nonterminals]
     ↓
assignItemLookaheads()
     ↓
[Reduction items with local lookaheads]
     ↓
→ Ready for buildParseTable()
```

The process transforms a context-free grammar into an LALR(1) automaton with all necessary lookahead information for generating parsing tables.