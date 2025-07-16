#!/usr/bin/env coffee

# Example of using the timing formatter with actual parser generation data
# This shows how to collect timing data and format it consistently

{formatTimingTable} = require './timing-formatter'

# Simulate collecting timing data from your parser generation
collectTimingData = ->
  # This would be replaced with actual timing collection from your parser generator
  # For now, simulating the inconsistent data you mentioned

  # Example: symbols shows "user" value, but terminals/nonterminals show "total"
  # This is the inconsistency you want to fix

  data =
    'Grammar Analysis':
      'symbols':
        user: 42          # User-defined symbols
        total: 89         # Total symbols (including generated)
        notes: 'user vs generated'
        userType: 'count'
        totalType: 'count'
        notesType: 'text'
      'terminals':
        user: 156         # User-defined terminals
        total: 203        # Total terminals (including auto-generated)
        notes: '77% user-defined'
        userType: 'count'
        totalType: 'count'
        notesType: 'percent'
      'nonterminals':
        user: 67          # User-defined nonterminals
        total: 67         # Total nonterminals (same as user in this case)
        notes: 'all user-defined'
        userType: 'count'
        totalType: 'count'
        notesType: 'text'

    'Generation Time':
      'processGrammar':
        user: 1.3         # User CPU time
        total: 1.5        # Total elapsed time
        notes: '87% efficiency'
        userType: 'time'
        totalType: 'time'
        notesType: 'percent'
      'buildAutomaton':
        user: 950         # User CPU time
        total: 1020       # Total elapsed time
        notes: '93% efficiency'
        userType: 'time'
        totalType: 'time'
        notesType: 'percent'
      'unionLookaheads':
        user: 6700        # User CPU time (the heavy computation)
        total: 6850       # Total elapsed time
        notes: '98% efficiency'
        userType: 'time'
        totalType: 'time'
        notesType: 'percent'
      'buildParseTable':
        user: 32          # User CPU time
        total: 35         # Total elapsed time
        notes: '91% efficiency'
        userType: 'time'
        totalType: 'time'
        notesType: 'percent'

    'Memory Usage':
      'states':
        user: 1024        # User-allocated states
        total: 1024       # Total states (same)
        notes: 'no duplicates'
        userType: 'count'
        totalType: 'count'
        notesType: 'text'
      'items':
        user: 15680       # User-created items
        total: 18450      # Total items (including temporaries)
        notes: '85% retained'
        userType: 'count'
        totalType: 'count'
        notesType: 'percent'
      'memory':
        user: 45600000    # User memory
        total: 52300000   # Total memory (including GC overhead)
        notes: '87% efficiency'
        userType: 'count'
        totalType: 'count'
        notesType: 'percent'

# Example of how to integrate with your existing timing code
simulateParserGeneration = ->
  console.log "🔧 Generating parser with timing analysis..."

  # Your existing timing code would go here
  # For example:
  # console.time 'processGrammar'
  # processGrammar()
  # console.timeEnd 'processGrammar'

  # Collect the timing data
  timingData = collectTimingData()

  # Format and display the table
  console.log "\n"
  console.log formatTimingTable(timingData, {
    title: 'Parser Generation Statistics'
    showColors: true
  })

# Example with different options
showCompactTable = ->
  timingData = collectTimingData()

  console.log "\n" + formatTimingTable(timingData, {
    title: 'Compact Parser Stats'
    showColors: true
    columnWidths:
      section: 10
      metric: 14
      user: 10
      total: 10
      notes: 16
  })

# Example without colors for logging
showLogTable = ->
  timingData = collectTimingData()

  console.log "\n" + formatTimingTable(timingData, {
    title: 'Parser Generation Log'
    showColors: false
    showHeader: true
  })

# Run the examples
if require.main is module
  simulateParserGeneration()
  showCompactTable()
  showLogTable()

  console.log "\n💡 Integration Tips:"
  console.log "   • Replace collectTimingData() with your actual timing collection"
  console.log "   • Use console.time/timeEnd or process.hrtime for accurate timing"
  console.log "   • Set userType/totalType to 'time' for milliseconds, 'count' for numbers"
  console.log "   • Use notesType 'percent' for percentages, 'text' for descriptions"
  console.log "   • Call formatTimingTable() after your parser generation completes"

module.exports = { collectTimingData, simulateParserGeneration }