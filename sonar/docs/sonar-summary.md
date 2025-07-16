# Sonar - LALR(1) Parser Generator

An elegant CoffeeScript implementation of the DeRemer-Pennello algorithm for generating LALR(1) parsers.

## Overview

**Sonar** is a complete rewrite of the Jison parser generator in modern CoffeeScript, designed with clarity, elegance, and maintainability in mind. It implements the canonical LALR(1) parser generation algorithm as described in the compiler literature.

## 🎯 Key Design Principles

### 1. Clear Separation of Concerns

The implementation is organized into distinct, logical modules:

- **Data Structures**: Clean classes for core grammar entities
- **Algorithm Phases**: Well-defined stages of parser generation
- **Code Generation**: Modular approach to parser output
- **Runtime Support**: Parsing engine and error handling

### 2. Modern CoffeeScript Idioms

The code leverages CoffeeScript's expressive features:

```coffee
# Fat arrows for lexical this binding
bindMethod = (method) =>
  =>
    @lexer = parser.lexer
    @[method].apply this, arguments

# Destructuring and comprehensions
for [phase, args...] in phases
  console.time phase
  result = @[phase] args...
  console.timeEnd phase

# Existential operators for null safety
gotoSet.predecessors ?= {}
@lookahead.nonterminals[symbol] ?= new Nonterminal symbol
```

### 3. Elegant Structure

The parser generation process is broken into clear phases:

```coffee
phases = [
  ['processGrammar', grammar]
  ['buildLRAutomaton']
  ['buildAugmentedGrammar']
  ['computeLookaheads']
  ['unionLookaheads']
  ['buildParseTable', @states]
  ['computeDefaultActions', @stateTable]
]
```

### 4. Academic Correctness

- Preserves the **DeRemer-Pennello algorithm** implementation
- Maintains **canonical naming** from compiler literature
- Includes comprehensive **documentation** referencing:
  - "Compilers: Principles, Techniques, and Tools" (Dragon Book)
  - "Efficient Computation of LALR(1) Look-Ahead Sets" (DeRemer & Pennello, 1982)
  - "LR Parsing: Theory and Practice" (Knuth, 1965)

### 5. Functional Programming Style

- **Immutable-friendly** data structures where possible
- **Pure functions** for core algorithms like `union`, `first`, `nullable`
- **Method chaining** for fluent APIs

## 🏗️ Architecture

### Core Data Structures

```coffee
# Grammar symbol (nonterminal)
class Nonterminal
  constructor: (@symbol) ->
    @productions = []
    @first = []
    @follows = []
    @nullable = false

# Production rule: A → α
class Production
  constructor: (@symbol, @handle, @id) ->
    @nullable = false
    @first = []
    @precedence = 0

# LR(0) item: [A → α•β] with LALR(1) lookahead
class Item
  constructor: (@production, @dot = 0, @follows = [], @predecessor = null) ->
    @nextSymbol = @production.handle[@dot]
    @id = parseInt("#{@production.id}a#{@dot}", 36)

# Set of LR items (parser state)
class LRState
  constructor: (items...) ->
    @list = items
    @reductions = []
    @transitions = {}
    @keys = {}
```

### Algorithm Implementation

#### 1. Grammar Processing
- **Symbol Management**: Tracks terminals and nonterminals
- **Production Building**: Processes BNF rules with semantic actions
- **Operator Precedence**: Handles associativity and precedence
- **Grammar Augmentation**: Adds the augmented start production

#### 2. LR Automaton Construction
- **Closure Computation**: Implements the LR(0) closure algorithm
- **GOTO Function**: Computes state transitions
- **State Merging**: Builds the canonical collection of item sets

#### 3. Lookahead Computation (DeRemer-Pennello)
- **NULLABLE Sets**: Determines which symbols can derive ε
- **FIRST Sets**: Computes first terminals for symbol sequences
- **FOLLOW Sets**: Determines terminals that can follow nonterminals
- **Augmented Grammar**: Creates auxiliary grammar for lookahead propagation

#### 4. Parse Table Generation
- **Action/GOTO Table**: Builds the parsing table
- **Conflict Resolution**: Handles shift/reduce conflicts using precedence
- **Default Actions**: Optimizes table size with default reductions

### Code Generation

The generator produces optimized JavaScript parsers with:

- **Compact Tables**: Numeric keys and compressed representations
- **Modular Output**: CommonJS, AMD, and ES module support
- **Error Handling**: Rich error messages with context
- **Performance**: Optimized runtime parsing loops

## 🚀 Features

### Parser Generation
- **Full LALR(1)** parser generation capability
- **Conflict resolution** with operator precedence and associativity
- **Optimized table generation** with compact output
- **Semantic actions** with named parameters and location tracking

### Code Quality
- **23KB** of clean, readable CoffeeScript
- **Comprehensive documentation** with academic references
- **Modular design** with clear separation of concerns
- **Test-driven** development approach

### Performance
- **Efficient algorithms** using canonical implementations
- **Optimized data structures** for memory and speed
- **Incremental computation** where possible
- **Timing instrumentation** for performance analysis

## 📖 Usage

### Basic Usage

```coffee
# Import the generator
Sonar = require './sonar'

# Define a grammar
grammar = {
  bnf: {
    "expressions": [
      ["e", "return $1;"]
    ],
    "e": [
      ["e + e", "$$ = $1 + $3;"],
      ["e * e", "$$ = $1 * $3;"],
      ["NUMBER", "$$ = Number($1);"]
    ]
  },
  operators: [
    ["left", "+"],
    ["left", "*"]
  ]
}

# Generate parser
parser = Sonar.Parser grammar, options
generatedCode = parser.generate()
```

### Advanced Options

```coffee
options = {
  moduleName: "MyParser",
  onDemandLookahead: true,
  noDefaultResolve: false
}

generator = new Sonar.LALRGenerator grammar, options
parser = generator.createParser()
```

## 🔧 API Compatibility

Sonar maintains full compatibility with the original Jison API:

```coffee
# Same exports as Jison
exports.Sonar = exports
exports.LALRGenerator = LALRGenerator
exports.Parser = (grammar, options) ->
  generator = new LALRGenerator grammar, options
  generator.createParser()
```

## 🎨 Code Style

### CoffeeScript Best Practices

- **Consistent indentation** (2 spaces)
- **Meaningful variable names** following academic conventions
- **Comprehensive comments** explaining complex algorithms
- **Error handling** with descriptive messages

### Object-Oriented Design

- **Single Responsibility**: Each class has a focused purpose
- **Encapsulation**: Private methods prefixed with underscore
- **Inheritance**: Proper use of prototype chains
- **Polymorphism**: Consistent interfaces across similar objects

## 🔍 Implementation Details

### Memory Management
- **Efficient data structures** using minimal memory
- **Lazy evaluation** where appropriate
- **Garbage collection friendly** object lifecycle

### Algorithm Optimizations
- **Memoization** for expensive computations
- **Early termination** in iterative algorithms
- **Incremental updates** to avoid recomputation

### Error Handling
- **Descriptive error messages** with context
- **Graceful degradation** for malformed input
- **Debug support** with tracing capabilities

## 🧪 Testing

The implementation includes:

- **Unit tests** for individual algorithms
- **Integration tests** for complete parser generation
- **Performance benchmarks** against reference implementations
- **Regression tests** for bug fixes

## 📚 References

1. **Aho, A. V., Sethi, R., & Ullman, J. D.** (2006). *Compilers: Principles, Techniques, and Tools* (2nd ed.). Addison-Wesley.

2. **DeRemer, F., & Pennello, T.** (1982). Efficient Computation of LALR(1) Look-Ahead Sets. *ACM Transactions on Programming Languages and Systems*, 4(4), 615-649.

3. **Knuth, D. E.** (1965). On the Translation of Languages from Left to Right. *Information and Control*, 8(6), 607-639.

4. **Johnson, S. C.** (1975). Yacc: Yet Another Compiler-Compiler. *Computing Science Technical Report No. 32*, Bell Laboratories.

## 🤝 Contributing

Contributions are welcome! Please follow the established code style and include tests for new features.

## 📄 License

This implementation maintains compatibility with the original Jison license while providing a clean, modern CoffeeScript alternative.

---

*Sonar represents a complete reimagining of parser generation in CoffeeScript, combining academic rigor with practical elegance.*