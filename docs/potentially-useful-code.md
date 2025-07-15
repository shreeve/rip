# Potentially Useful Code Snippets

This file contains code implementations that might be useful in specific scenarios but are overkill for normal production use.

## Complex Grammar Cleanup Implementation

This is a comprehensive grammar cleanup implementation that removes unproductive and unreachable symbols. It's theoretically correct and includes extensive safety measures, but it's overkill for well-formed grammars like CoffeeScript.

**Use cases:**
- Debugging malformed grammars during development
- Catching typos and missing rules
- Educational purposes (standard LALR(1) algorithm)
- Grammar validation tools

**Performance:** ~2ms overhead, ~200 lines of code
**Benefit for production grammars:** Usually zero (most are already clean)

```coffee
# ============================================================================
# PHASE 3: GRAMMAR CLEANUP (COMPREHENSIVE VERSION)
# ============================================================================

# Eliminate unproductive and unreachable symbols
# Includes safety measures to prevent over-cleaning
cleanupGrammar: ->
  @timing "🧹 Cleanup Grammar"

  # Safety check: ensure we have essential symbols before cleanup
  unless @symbols.has('$accept') and @symbols.has('$end') and @symbols.has(@start)
    throw new Error("Missing essential symbols before cleanup")

  initialRuleCount = @rules.length
  initialSymbolCount = @symbols.size

  # Use iterative approach from rip-full to handle cascading dependencies
  loop
    beforeRuleCount = @rules.length
    beforeSymbolCount = @symbols.size

    # Step 1: Remove unproductive symbols (symbols that can't derive terminals)
    @eliminateUnproductive()

    # Step 2: Remove unreachable symbols (symbols not reachable from start)
    @eliminateUnreachable()

    # Stop if no changes were made (fixed-point reached)
    break if @rules.length == beforeRuleCount and @symbols.size == beforeSymbolCount

    # Safety check: ensure we still have essential symbols after each iteration
    unless @symbols.has('$accept') and @symbols.has('$end') and @symbols.has(@start)
      throw new Error("Essential symbols removed during cleanup - stopping")

    # Safety check: ensure we still have rules for the start symbol
    startRules = @symbolRules.get(@start) or []
    if startRules.length == 0
      throw new Error("All rules for start symbol removed during cleanup - stopping")

  # Final safety validation
  @validateGrammarAfterCleanup()

  # Report cleanup results
  removedRules = initialRuleCount - @rules.length
  removedSymbols = initialSymbolCount - @symbols.size

  if @debug >= NORMAL and (removedRules > 0 or removedSymbols > 0)
    console.log "\n🧹 Grammar Cleanup Results:"
    console.log "  Rules: #{initialRuleCount} → #{@rules.length} (removed #{removedRules})"
    console.log "  Symbols: #{initialSymbolCount} → #{@symbols.size} (removed #{removedSymbols})"

  @timing "🧹 Cleanup Grammar"

# Remove unproductive symbols (symbols that cannot derive terminal strings)
# Uses the robust approach from rip-full.coffee
eliminateUnproductive: ->
  productive = @findProductiveSymbols()

  # Find unproductive nonterminals
  unproductive = []
  for [name, symbol] from @symbols
    if not symbol.isTerminal and not productive.has(name)
      # Safety check: never remove essential symbols
      unless name in ['$accept', '$end', 'error', @start]
        unproductive.push(name)

  return unless unproductive.length > 0

  if @debug >= VERBOSE
    console.log "\n⚠️  Found unproductive nonterminals: #{unproductive.join(', ')}"

  # Remove rules containing unproductive symbols
  # Always preserve rule #0 (augmented start rule: $accept → start $end)
  augmentedRule = @rules[0]
  filteredRules = @rules.slice(1).filter (rule) =>
    # Remove if LHS is unproductive
    if rule.lhs in unproductive
      if @debug >= VERBOSE
        console.log "  Removing rule with unproductive LHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
      return false

    # Remove if any RHS symbol is unproductive (but not terminal)
    for symbol in rule.rhs
      if symbol in unproductive and not @getSymbol(symbol).isTerminal
        if @debug >= VERBOSE
          console.log "  Removing rule with unproductive RHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
        return false

    true

  # Rebuild rules array with augmented rule at index 0
  @rules = [augmentedRule].concat(filteredRules)

  # Remove unproductive symbols from symbol table
  for symbol in unproductive
    @symbols.delete(symbol)

  # Reassign IDs to maintain consistency
  @reassignIds()

# Find all productive symbols (symbols that can derive terminal strings)
findProductiveSymbols: ->
  productive = new Set()

  # All terminals are productive
  for [name, symbol] from @symbols
    if symbol.isTerminal
      productive.add(name)

  # Find productive nonterminals using fixed-point algorithm
  changed = true
  while changed
    changed = false

    for rule in @rules
      continue if productive.has(rule.lhs)

      # Check if all RHS symbols are productive
      allProductive = true
      for symbol in rule.rhs
        unless productive.has(symbol)
          allProductive = false
          break

      if allProductive
        productive.add(rule.lhs)
        changed = true

  productive

# Remove unreachable symbols (symbols not reachable from start symbol)
# Uses the robust approach from rip-full.coffee
eliminateUnreachable: ->
  reachable = @findReachableSymbols()

  # Find unreachable nonterminals
  unreachable = []
  for [name, symbol] from @symbols
    if not symbol.isTerminal and not reachable.has(name)
      # Safety check: never remove essential symbols
      unless name in ['$accept', '$end', 'error', @start]
        unreachable.push(name)

  return unless unreachable.length > 0

  if @debug >= VERBOSE
    console.log "\n⚠️  Found unreachable nonterminals: #{unreachable.join(', ')}"

  # Remove rules with unreachable LHS or RHS
  # Always preserve rule #0 (augmented start rule: $accept → start $end)
  augmentedRule = @rules[0]
  filteredRules = @rules.slice(1).filter (rule) =>
    # Remove if LHS is unreachable
    if rule.lhs in unreachable
      if @debug >= VERBOSE
        console.log "  Removing rule with unreachable LHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
      return false

    # Remove if any RHS symbol is unreachable (but not terminal)
    for symbol in rule.rhs
      if symbol in unreachable and not @getSymbol(symbol).isTerminal
        if @debug >= VERBOSE
          console.log "  Removing rule with unreachable RHS: #{rule.lhs} → #{rule.rhs.join(' ')}"
        return false

    true

  # Rebuild rules array with augmented rule at index 0
  @rules = [augmentedRule].concat(filteredRules)

  # Remove unreachable symbols from symbol table
  for symbol in unreachable
    @symbols.delete(symbol)

  # Reassign IDs to maintain consistency
  @reassignIds()

# Find all reachable symbols (symbols reachable from start symbol)
findReachableSymbols: ->
  reachable = new Set()

  # Essential symbols are always reachable
  reachable.add(@start)
  reachable.add('$accept')
  reachable.add('$end')
  reachable.add('error')

  # Fixed-point iteration to find all reachable symbols
  changed = true
  while changed
    changed = false

    for rule in @rules
      # If LHS is reachable, all RHS symbols become reachable
      if reachable.has(rule.lhs)
        for symbol in rule.rhs
          unless reachable.has(symbol)
            reachable.add(symbol)
            changed = true

  reachable

# Validate grammar integrity after cleanup
validateGrammarAfterCleanup: ->
  errors = []

  # Debug: Check what rules exist after cleanup
  if @debug >= DEBUG
    console.log "\n🔍 Rules after cleanup:"
    for rule in @rules
      console.log "  #{rule.id}: #{rule.lhs} → #{rule.rhs.join(' ')}"

  # Check that essential symbols exist
  unless @symbols.has('$accept')
    errors.push("Missing $accept symbol after cleanup")
  unless @symbols.has('$end')
    errors.push("Missing $end symbol after cleanup")
  unless @symbols.has(@start)
    errors.push("Missing start symbol '#{@start}' after cleanup")

  # Check that start symbol has at least one rule
  startRules = @symbolRules.get(@start) or []
  if startRules.length == 0
    errors.push("Start symbol '#{@start}' has no rules after cleanup")

  # Check that $accept has its augmented rule
  acceptRules = @symbolRules.get('$accept') or []
  if acceptRules.length == 0
    errors.push("$accept symbol has no rules after cleanup")
    if @debug >= DEBUG
      console.log "  Available rules by symbol:"
      for [symbol, rules] from @symbolRules
        console.log "    #{symbol}: #{rules.length} rules"

  # Check that all rules reference valid symbols
  for rule in @rules
    unless @symbols.has(rule.lhs)
      errors.push("Rule #{rule.id} references unknown LHS symbol '#{rule.lhs}'")

    for symbol in rule.rhs
      unless @symbols.has(symbol)
        errors.push("Rule #{rule.id} references unknown RHS symbol '#{symbol}'")

  if errors.length > 0
    throw new Error("Grammar validation failed after cleanup:\n  #{errors.join('\n  ')}")

  true
```

## Simple Production Version

For well-formed grammars, this simple version is sufficient:

```coffee
# Phase 3: Grammar Cleanup (Simple Version)
cleanupGrammar: ->
  # Skip cleanup for well-formed grammars
  # Most production language packs don't need this step
  # Use the comprehensive version above for debugging malformed grammars
  return
```