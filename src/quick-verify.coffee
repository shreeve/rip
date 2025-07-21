#!/usr/bin/env coffee

# Quick LALR(1) Verification Test
# Run this to immediately see what's wrong with our implementation

console.log "🔍 Quick LALR(1) Debug Test"
console.log "============================"

# Test with CoffeeScript grammar
try
  console.log "\n1️⃣ Loading grammar from rip.coffee..."

  # Use the working grammar from rip.coffee
  grammar =
    startSymbol: "Body"
    bnf:
      "Body": ["TERMINATOR Body", "Line Body", ""]
      "Line": ["Expression", "Statement"]
      "Expression": ["Value", "Invocation", "Code", "Operation", "Assign", "If", "Try", "While", "For", "Switch", "Class", "Throw"]
      "Value": ["Assignable", "Literal", "Parenthetical", "Range", "This"]
      "Assignable": ["Identifier", "Value Accessor", "Invocation Accessor", "ThisProperty"]
      "Literal": ["AlphaNumeric", "String", "Regex", "JS", "Bool", "Undefined", "Null"]
    operators: [
      ["left", ".", "?.", "::"]
      ["left", "CALL_START", "CALL_END"]
      ["left", "INDEX_START", "INDEX_END"]
      ["right", "UNARY"]
      ["left", "**"]
      ["left", "*", "/", "%"]
      ["left", "+", "-"]
    ]

  console.log "✅ Simple grammar loaded"
  console.log "   - #{Object.keys(grammar.bnf).length} nonterminals"
  console.log "   - #{grammar.operators.length} precedence levels"

  # Test our new LALR(1) implementation
  console.log "\n2️⃣ Testing NEW sonar.coffee..."

  NewSonar = require './sonar.coffee'

  console.log "Loading LALRGenerator..."
  newGen = new NewSonar.LALRGenerator(grammar, {timing: true})

  console.log "\n📊 NEW Implementation Results:"
  console.log "   - States: #{newGen.states?.length || 0}"
  console.log "   - Terminals: #{newGen.terminals?.size || 0}"
  console.log "   - Nonterminals: #{newGen.nonterminals?.size || 0}"
  console.log "   - Productions: #{newGen.productions?.length || 0}"

  if newGen.states?.length == 1
    console.log "\n❌ CRITICAL BUG CONFIRMED: Only 1 state generated!"

    # Debug the initial state
    state = newGen.states[0]
    console.log "\n🔍 Debugging initial state:"
    console.log "   - Items: #{state.items?.length || 0}"
    console.log "   - Shifts: #{state.shifts?.length || 0}"
    console.log "   - Reductions: #{state.reductions?.length || 0}"
    console.log "   - Transitions: #{state.transitions?.size || 0}"

    if state.items
      console.log "\n📋 Items in initial state:"
      for item, i in state.items[0..4]  # Show first 5
        prod = item.production
        rhs = prod.rhs.map((s) -> s.name).join(' ')
        console.log "   #{i+1}. #{prod.lhs.name} → #{rhs} [pos: #{item.position}]"

        if i == 4 and state.items.length > 5
          console.log "   ... and #{state.items.length - 5} more"

    # Check if the problem is in closure computation
    if state.shifts?.length > 0 and state.transitions?.size == 0
      console.log "\n🚨 IDENTIFIED PROBLEM: Shift items exist but no transitions!"
      console.log "   This suggests the GOTO computation is broken."
  else
    console.log "\n✅ State generation looks normal"

  # Test original for comparison
  console.log "\n3️⃣ Testing ORIGINAL sonar-original.coffee for comparison..."

  try
    OriginalSonar = require './sonar-original.coffee'
    origGen = new OriginalSonar.LALRGenerator(grammar, {timing: true})

    console.log "\n📊 ORIGINAL Implementation Results:"
    console.log "   - States: #{origGen.states?.length || 0}"
    console.log "   - Terminals: #{Object.keys(origGen.terminals || {}).length}"
    console.log "   - Nonterminals: #{Object.keys(origGen.nonterminals || {}).length}"
    console.log "   - Productions: #{origGen.productions?.length || 0}"

  catch origError
    console.log "⚠️ Could not test original: #{origError.message}"

catch error
  console.error "\n❌ Test failed: #{error.message}"
  console.error error.stack

console.log "\n" + "=".repeat(50)
console.log "💡 Next Steps:"
console.log "1. Fix the state generation bug in sonar.coffee"
console.log "2. Check closure() and buildLR0Automaton() methods"
console.log "3. Verify grammar processing creates correct productions"
console.log "4. Test with smaller grammar first"