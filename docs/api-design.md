<div align="center">
  <img src="assets/logos/rip-icon-512wa.png" alt="Rip Logo" width="100">
</div>

# Rip API Design

**Universal Language Definition & Analysis**

This document outlines the design decisions behind Rip's Language API, explaining the problem space, options considered, and the final immutable design that prioritizes clarity and predictability.

## The Problem

When designing a parser generator API, we face a fundamental tension:

**How do we handle grammar modifications after initial analysis?**

Consider this scenario:
```coffee
# User creates a language and analyzes it
lang = new Language({rules: [...], operators: [...]})
lang.analyze()
console.log "States: #{lang.states.length}"  # e.g., 50 states

# User wants to add a new rule
lang.rules.push(newRule)
# Now what? How do we get updated statistics?
```

This simple question reveals deep architectural decisions about:
- **State management** - How to handle mutable vs immutable data
- **Performance transparency** - When expensive operations happen
- **API simplicity** - How intuitive the interface should be
- **Analysis lifecycle** - When and how to regenerate parse tables

## Options Considered

### Option 1: Pure Immutability
```coffee
# User creates new Language objects
lang = new Language({rules: [...], operators: [...]})
lang.analyze()
newLang = new Language({rules: [...lang.rules, newRule], ...})
newLang.analyze()
```

**Pros:**
- ✅ Simple, predictable, no hidden state
- ✅ Thread-safe, no side effects
- ✅ Easy to test and reason about
- ✅ No complex clearing logic needed

**Cons:**
- ❌ User has to manually manage object creation
- ❌ More verbose API
- ❌ Potential memory overhead (though minimal)

### Option 2: Mutable API with Internal Regeneration
```coffee
# User modifies rules directly
lang = new Language({rules: [...], operators: [...]})
lang.analyze()
lang.rules.push(newRule)  # Triggers internal regeneration
```

**Pros:**
- ✅ Simple, intuitive API
- ✅ User doesn't think about immutability
- ✅ Still immutable internally

**Cons:**
- ❌ Hidden complexity (user doesn't know regeneration happens)
- ❌ Potential performance surprises
- ❌ Harder to debug (when did regeneration happen?)
- ❌ More complex implementation

### Option 3: Explicit Re-analysis
```coffee
# User explicitly calls re-analyze
lang = new Language({rules: [...], operators: [...]})
lang.analyze()
lang.rules.push(newRule)
lang.analyze()  # User knows this is expensive
```

**Pros:**
- ✅ Explicit about performance cost
- ✅ User controls when analysis happens
- ✅ Simple implementation

**Cons:**
- ❌ User has to remember to call analyze()
- ❌ Easy to forget and get stale data
- ❌ More error-prone

## Our Decision: Pure Immutability

After careful consideration, we chose **Option 1: Pure Immutability** for the following reasons:

### **1. Clarity Over Convenience**
Modern JavaScript/TypeScript developers are comfortable with immutable patterns. The slight verbosity is worth the clarity and predictability.

### **2. Performance Transparency**
No hidden expensive operations. Users know exactly when analysis happens and can optimize accordingly.

### **3. Simplicity of Implementation**
No complex internal state management or clearing logic needed.

### **4. Debugging and Testing**
Easy to reason about, test, and debug. Each Language object is independent.

### **5. Future-Proof**
Follows functional programming principles that scale well as the codebase grows.

## The Rip Language API

### **1. Language Object Design**

**Pure immutability** with clear separation between core data and computed analysis:

```coffee
# Constructor makes defensive copies
lang = new Language({
  rules: [...],      # Grammar rules
  operators: [...],  # Precedence/associativity
  start: 'Root'      # Start symbol
})

# All data is immutable
lang.rules.push(newRule)  # This creates a new Language internally
```

### **2. Analysis Phases**

Rip uses a clear 4-phase analysis pipeline:

```
Phase 0: Language Preparation  → Reset & create special symbols ($accept, $end, error)
Phase 1: Symbol Analysis      → Process user's grammar (symbols, rules, precedence)
Phase 2: State Construction   → Build LALR(1) machine (augmented rule, states, lookaheads)
Phase 3: Table Generation     → Create parse table (table, conflicts, optimizations)
```

Each phase has a single responsibility and builds on the previous phase.

### **3. Usage Pattern**

```coffee
# Define language
lang = new Language({
  rules: [
    ['Expression', ['Number', '+', 'Number']],
    ['Expression', ['Number']]
  ],
  operators: [['left', '+', '-']],
  start: 'Expression'
})

# Analyze for stats/diagnostics
lang.analyze()
console.log "States: #{lang.states.length}"
console.log "Conflicts: #{lang.conflicts.length}"
console.log "Symbols: #{lang.symbols.size}"

# Add rules = create new language
newLang = new Language({
  rules: [...lang.rules, ['Expression', ['Expression', '*', 'Number']]],
  operators: lang.operators,
  start: lang.start
})
newLang.analyze()
```

### **4. Value Chain**

Each step in the Rip pipeline provides different value:

| Step | Returns | Purpose | Value |
|------|---------|---------|-------|
| **Define** | Language object | Grammar definition | Grammar validation |
| **Analyze** | Statistics | Build LALR(1) state machine | Diagnostics, conflict info |
| **Compile** | Language pack | Convert to runtime format | Optimized data for Universal Parser |
| **Generate** | JavaScript code | Create standalone parser | Complete parser for distribution |

### **5. Key Principles**

- **Fail fast** - Robust validation in constructor
- **Clear phases** - Each analysis step has single responsibility
- **Immutable data** - No hidden state mutations
- **Simple API** - User controls when expensive operations happen
- **Performance transparency** - No hidden expensive operations

## Implementation Details

### **Constructor Validation**
```coffee
constructor: (language = {}) ->
  # Robust validation of user input
  @validateGrammarInput(language)

  # Defensive copying of core data
  @languageCopy = {
    info:      {...(language.info      or {})}
    rules:     [...(language.rules     or [])]
    operators: [...(language.operators or [])]
    start:     language.start or 'Root'
  }
```

### **Analysis Pipeline**
```coffee
analyze: ->
  unless @analyzed
    # Phase 0: Language Preparation
    @clear()
    @createSpecialSymbols()

    # Phase 1: Symbol Analysis
    @buildSymbols()
    @buildPrecedence()
    @buildSymbolRules()

    # Phase 2: State Construction
    @augmentStartRule()
    @buildStates()
    @computeLookaheads()

    # Phase 3: Table Generation
    @buildTable()
    @resolveConflicts()
    @buildDefaultActions()

    @analyzed = true
```

## Benefits of This Design

1. **Predictable** - No hidden state changes or side effects
2. **Testable** - Each operation is isolated and testable
3. **Debuggable** - Easy to trace what's happening
4. **Performant** - Users know when expensive operations occur
5. **Future-proof** - Follows modern functional programming patterns

This design prioritizes **clarity and predictability** over convenience, resulting in a robust, maintainable API that scales well with complex grammar development workflows.