#!/usr/bin/env coffee

# Enhanced parser generation with consistent timing display
# This shows how to integrate the timing formatter with your existing code

{formatTimingTable} = require './timing-formatter'
{LALRGenerator} = require './node_modules/jison/lib/sonar'

# Timing data collector
class TimingCollector
  constructor: ->
    @data = {}
    @startTimes = {}
    @currentSection = null

  section: (name) ->
    @currentSection = name
    @data[name] ?= {}

  start: (metric) ->
    @startTimes[metric] = process.hrtime()

  end: (metric, userValue = null, totalValue = null, notes = null) ->
    unless @currentSection
      throw new Error "Must call section() before timing metrics"

    elapsed = process.hrtime(@startTimes[metric])
    elapsedMs = elapsed[0] * 1000 + elapsed[1] / 1000000

    @data[@currentSection][metric] = {
      user: userValue || elapsedMs
      total: totalValue || elapsedMs
      notes: notes
      userType: if userValue then 'count' else 'time'
      totalType: if totalValue then 'count' else 'time'
      notesType: if notes?.includes('%') then 'percent' else 'text'
    }

  addMetric: (metric, user, total, notes = null, userType = 'count', totalType = 'count') ->
    unless @currentSection
      throw new Error "Must call section() before adding metrics"

    @data[@currentSection][metric] = {
      user: user
      total: total
      notes: notes
      userType: userType
      totalType: totalType
      notesType: if notes?.includes('%') then 'percent' else 'text'
    }

  getResults: -> @data

# Enhanced parser generation with timing
generateParserWithTiming = (grammarSpec, options = {}) ->
  timing = new TimingCollector()

  console.log "🔧 Building parser with comprehensive timing..."

  # Grammar Analysis Section
  timing.section 'Grammar Analysis'

  # Count user-defined vs total symbols
  userSymbols = Object.keys(grammarSpec.bnf).length
  totalSymbols = userSymbols + 10  # Simulated additional generated symbols
  timing.addMetric 'symbols', userSymbols, totalSymbols, 'user-defined vs total'

  # Count terminals (user-defined vs total including generated)
  userTerminals = grammarSpec.tokens.split(' ').length
  totalTerminals = userTerminals + 47  # Simulated additional generated terminals
  coverage = Math.round((userTerminals / totalTerminals) * 100)
  timing.addMetric 'terminals', userTerminals, totalTerminals, "#{coverage}% user-defined"

  # Count nonterminals (typically all user-defined)
  nonterminals = Object.keys(grammarSpec.bnf).length
  timing.addMetric 'nonterminals', nonterminals, nonterminals, 'all user-defined'

  # Generation Time Section
  timing.section 'Generation Time'

  # Simulate the actual parser generation phases
  generator = new LALRGenerator grammarSpec, options

  # Process Grammar
  timing.start 'processGrammar'
  # Simulate work
  start = Date.now()
  while Date.now() - start < 2  # 2ms of work
    Math.random()
  timing.end 'processGrammar', null, null, 'grammar preprocessing'

  # Build LR Automaton
  timing.start 'buildAutomaton'
  # Simulate work
  start = Date.now()
  while Date.now() - start < 50  # 50ms of work
    Math.random()
  timing.end 'buildAutomaton', null, null, 'LR(0) item sets'

  # Union Lookaheads (the expensive part)
  timing.start 'unionLookaheads'
  # Simulate work
  start = Date.now()
  while Date.now() - start < 200  # 200ms of work (simulated)
    Math.random()
  timing.end 'unionLookaheads', null, null, 'LALR(1) computation'

  # Build Parse Table
  timing.start 'buildParseTable'
  # Simulate work
  start = Date.now()
  while Date.now() - start < 10  # 10ms of work
    Math.random()
  timing.end 'buildParseTable', null, null, 'action/goto tables'

  # Memory Usage Section
  timing.section 'Memory Usage'

  # Simulate memory usage statistics
  states = generator.states?.length || 1024
  timing.addMetric 'states', states, states, 'no duplicates'

  # Simulate items statistics
  userItems = states * 15  # Average items per state
  totalItems = Math.round(userItems * 1.18)  # 18% overhead
  retention = Math.round((userItems / totalItems) * 100)
  timing.addMetric 'items', userItems, totalItems, "#{retention}% retained"

  # Simulate memory usage
  userMemory = 45600000
  totalMemory = 52300000
  efficiency = Math.round((userMemory / totalMemory) * 100)
  timing.addMetric 'memory', userMemory, totalMemory, "#{efficiency}% efficiency"

  # Generate the actual parser
  generatedCode = generator.generate()

  # Display results
  console.log "\n"
  console.log formatTimingTable(timing.getResults(), {
    title: 'Parser Generation Statistics'
    showColors: true
  })

  return {
    code: generatedCode
    timing: timing.getResults()
    generator: generator
  }

# Example usage
if require.main is module
  # Get the CoffeeScript grammar
  try
    # Mock the grammar capture (same as in your existing scripts)
    capturedGrammar = null

    MockParser = (spec) ->
      capturedGrammar = spec
      return {
        generate: -> ''
        generateModule: -> ''
        generateCommonJSModule: -> ''
      }

    originalJison = require.cache[require.resolve('jison')]
    mockJison = { Parser: MockParser }
    require.cache[require.resolve('jison')] = { exports: mockJison }

    grammarModule = require './src/grammar'

    if originalJison
      require.cache[require.resolve('jison')] = originalJison
    else
      delete require.cache[require.resolve('jison')]

    if not capturedGrammar
      throw new Error "Failed to capture grammar specification"

    # Generate parser with timing
    result = generateParserWithTiming(capturedGrammar, {
      optimize: true
      debug: false
    })

    console.log "\n✨ Parser generation complete!"
    console.log "   Code size: #{result.code.length} characters"
    console.log "   States: #{result.generator.states?.length || 'unknown'}"
    console.log "   Conflicts: #{result.generator.conflicts || 0}"

  catch error
    console.error "❌ Error:", error.message
    process.exit 1

module.exports = { TimingCollector, generateParserWithTiming }