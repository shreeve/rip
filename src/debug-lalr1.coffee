#!/usr/bin/env coffee

# LALR(1) Algorithm Verification and Debugging Script
# This script provides comprehensive verification methods for our LALR(1) implementation

fs = require 'fs'
path = require 'path'

# Load both implementations for comparison
originalSonar = require './sonar-original.coffee'
newSonar = require './sonar.coffee'

class LALR1Verifier
  constructor: (@grammarFile = '../old/coffeescript/grammar-data.json') ->
    @loadGrammar()

  loadGrammar: ->
    try
      @grammar = JSON.parse fs.readFileSync(@grammarFile, 'utf8')
      console.log "✅ Loaded grammar: #{@grammar.metadata.symbolCount} symbols, #{@grammar.metadata.productionCount} productions"
    catch error
      console.error "❌ Failed to load grammar: #{error.message}"
      process.exit(1)

  # ==========================================================================
  # Phase 1: Grammar Processing Verification
  # ==========================================================================

  verifyGrammarProcessing: ->
    console.log "\n🔍 Phase 1: Grammar Processing Verification"

    try
      # Test original implementation
      console.log "\n--- Original sonar-original.coffee ---"
      @originalGenerator = new originalSonar.LALRGenerator(@grammar, {timing: true})

      console.log "Original results:"
      console.log "  - Terminals: #{@originalGenerator.terminals ? Object.keys(@originalGenerator.terminals).length}"
      console.log "  - Nonterminals: #{@originalGenerator.nonterminals ? Object.keys(@originalGenerator.nonterminals).length}"
      console.log "  - Productions: #{@originalGenerator.productions?.length || 0}"

      # Test new implementation
      console.log "\n--- New sonar.coffee ---"
      @newGenerator = new newSonar.LALRGenerator(@grammar, {timing: true})

      console.log "New results:"
      console.log "  - Terminals: #{@newGenerator.terminals?.size || 0}"
      console.log "  - Nonterminals: #{@newGenerator.nonterminals?.size || 0}"
      console.log "  - Productions: #{@newGenerator.productions?.length || 0}"

      # Compare results
      @compareGrammarProcessing()

    catch error
      console.error "❌ Grammar processing failed: #{error.message}"
      console.error error.stack

  compareGrammarProcessing: ->
    console.log "\n📊 Grammar Processing Comparison:"

    # Check production counts
    origProdCount = @originalGenerator.productions?.length || 0
    newProdCount = @newGenerator.productions?.length || 0

    if origProdCount == newProdCount
      console.log "  ✅ Production count matches: #{origProdCount}"
    else
      console.log "  ❌ Production count mismatch: #{origProdCount} vs #{newProdCount}"

    # Check symbol counts
    origTermCount = Object.keys(@originalGenerator.terminals || {}).length
    newTermCount = @newGenerator.terminals?.size || 0

    if origTermCount == newTermCount
      console.log "  ✅ Terminal count matches: #{origTermCount}"
    else
      console.log "  ❌ Terminal count mismatch: #{origTermCount} vs #{newTermCount}"

  # ==========================================================================
  # Phase 2: Automaton Construction Verification
  # ==========================================================================

  verifyAutomatonConstruction: ->
    console.log "\n🔍 Phase 2: Automaton Construction Verification"

    # Log initial state details
    @debugInitialState()

    # Track state generation step by step
    @traceStateGeneration()

    # Compare final results
    @compareAutomatons()

  debugInitialState: ->
    console.log "\n--- Initial State Analysis ---"

    if @originalGenerator.states?[0]
      origState = @originalGenerator.states[0]
      console.log "Original initial state:"
      console.log "  - Items: #{origState.items?.size || origState.list?.length || 0}"
      console.log "  - Transitions: #{Object.keys(origState.transitions || {}).length}"

    if @newGenerator.states?[0]
      newState = @newGenerator.states[0]
      console.log "New initial state:"
      console.log "  - Items: #{newState.items?.length || 0}"
      console.log "  - Transitions: #{newState.transitions?.size || 0}"

      # Debug new state in detail
      console.log "\nNew initial state details:"
      if newState.items
        for item, i in newState.items
          console.log "    Item #{i}: #{item.production?.lhs?.name} -> #{item.production?.rhs?.map((s) -> s.name).join(' ')} [pos: #{item.position}]"

  traceStateGeneration: ->
    console.log "\n--- State Generation Trace ---"

    # Hook into new generator to trace state creation
    if @newGenerator and @newGenerator.states
      console.log "New generator state count: #{@newGenerator.states.length}"

      if @newGenerator.states.length == 1
        console.log "❌ CRITICAL: Only 1 state generated!"
        @diagnoseSingleStateIssue()

  diagnoseSingleStateIssue: ->
    console.log "\n🚨 Diagnosing Single State Issue:"

    if not @newGenerator.states?[0]
      console.log "  ❌ No initial state found"
      return

    state = @newGenerator.states[0]

    console.log "  Initial state analysis:"
    console.log "    - Total items: #{state.items?.length || 0}"
    console.log "    - Shift items: #{state.shifts?.length || 0}"
    console.log "    - Reduction items: #{state.reductions?.length || 0}"
    console.log "    - Transitions: #{state.transitions?.size || 0}"

    # Check if shifts exist but no new states are created
    if state.shifts?.length > 0 and state.transitions?.size == 0
      console.log "  ❌ PROBLEM: Shift items exist but no transitions created"

    # Check closure computation
    @debugClosureComputation(state)

  debugClosureComputation: (state) ->
    console.log "\n  🔍 Debugging closure computation:"

    if not state.items or state.items.length == 0
      console.log "    ❌ No items in state"
      return

    # Check if nonterminals have productions
    for item in state.items when not item.isComplete()
      nextSymbol = item.nextSymbol()
      if nextSymbol and not nextSymbol.isTerminal
        productionCount = nextSymbol.productions?.length || 0
        console.log "    Symbol '#{nextSymbol.name}': #{productionCount} productions"

        if productionCount == 0
          console.log "      ❌ PROBLEM: Nonterminal '#{nextSymbol.name}' has no productions!"

  compareAutomatons: ->
    console.log "\n📊 Automaton Comparison:"

    origStateCount = @originalGenerator.states?.length || 0
    newStateCount = @newGenerator.states?.length || 0

    console.log "  State counts:"
    console.log "    Original: #{origStateCount}"
    console.log "    New: #{newStateCount}"

    if newStateCount == 1 and origStateCount > 1
      console.log "  ❌ CRITICAL BUG: New implementation generates only 1 state!"
    else if newStateCount == origStateCount
      console.log "  ✅ State count matches"
    else
      console.log "  ⚠️  State count differs (might be normal for different algorithms)"

  # ==========================================================================
  # Phase 3: Parse Table Verification
  # ==========================================================================

  verifyParseTables: ->
    console.log "\n🔍 Phase 3: Parse Table Verification"

    if @newGenerator.states?.length == 1
      console.log "❌ Skipping parse table verification - only 1 state generated"
      return

    # Generate parse tables for both
    try
      console.log "Generating parse tables..."

      # Export data from both generators
      @exportVerificationData()

    catch error
      console.error "❌ Parse table verification failed: #{error.message}"

  exportVerificationData: ->
    console.log "\n📊 Exporting verification data..."

    # Export new generator data (what we saw was broken)
    if @newGenerator
      try
        newData = @newGenerator.export?() || @extractNewGeneratorData()
        fs.writeFileSync 'verification-new.json', JSON.stringify(newData, null, 2)
        console.log "  ✅ Exported new generator data to verification-new.json"
      catch error
        console.log "  ❌ Failed to export new data: #{error.message}"

    # Export original generator data for comparison
    if @originalGenerator
      try
        origData = @originalGenerator.export?() || @extractOriginalGeneratorData()
        fs.writeFileSync 'verification-original.json', JSON.stringify(origData, null, 2)
        console.log "  ✅ Exported original generator data to verification-original.json"
      catch error
        console.log "  ❌ Failed to export original data: #{error.message}"

  extractNewGeneratorData: ->
    {
      metadata: {
        generator: "New LALR(1)"
        states: @newGenerator.states?.length || 0
        terminals: @newGenerator.terminals?.size || 0
        nonterminals: @newGenerator.nonterminals?.size || 0
        productions: @newGenerator.productions?.length || 0
        conflicts: @newGenerator.conflicts || 0
      }
      stateCount: @newGenerator.states?.length || 0
      terminalCount: @newGenerator.terminals?.size || 0
      nonterminalCount: @newGenerator.nonterminals?.size || 0
      productionCount: @newGenerator.productions?.length || 0
    }

  extractOriginalGeneratorData: ->
    {
      metadata: {
        generator: "Original LALR(1)"
        states: @originalGenerator.states?.length || 0
        terminals: Object.keys(@originalGenerator.terminals || {}).length
        nonterminals: Object.keys(@originalGenerator.nonterminals || {}).length
        productions: @originalGenerator.productions?.length || 0
        conflicts: @originalGenerator.conflicts || 0
      }
      stateCount: @originalGenerator.states?.length || 0
      terminalCount: Object.keys(@originalGenerator.terminals || {}).length
      nonterminalCount: Object.keys(@originalGenerator.nonterminals || {}).length
      productionCount: @originalGenerator.productions?.length || 0
    }

  # ==========================================================================
  # Main Verification Runner
  # ==========================================================================

  runFullVerification: ->
    console.log "🔍 LALR(1) Algorithm Verification Suite"
    console.log "========================================"

    try
      @verifyGrammarProcessing()
      @verifyAutomatonConstruction()
      @verifyParseTables()

      console.log "\n✅ Verification complete!"

    catch error
      console.error "\n❌ Verification failed: #{error.message}"
      console.error error.stack

# =============================================================================
# Command Line Interface
# =============================================================================

if require.main == module
  verifier = new LALR1Verifier()
  verifier.runFullVerification()

module.exports = LALR1Verifier