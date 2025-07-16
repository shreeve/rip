#!/usr/bin/env coffee

# Advanced Sonar parser builder with options and comparison
# Usage: coffee build-parser-sonar-advanced.coffee [options]

fs = require 'fs'
path = require 'path'

# Parse command line arguments
args = process.argv[2..]
options =
  backup: '--backup' in args
  compare: '--compare' in args
  optimize: '--optimize' in args
  timing: '--timing' in args

# Require Sonar parser generator
{LALRGenerator} = require './node_modules/jison/lib/sonar'

# Get the CoffeeScript grammar
grammarModule = require './lib/coffeescript/grammar'

# Extract grammar specification
grammarSpec =
  tokens: grammarModule.parser.tokens
  bnf: grammarModule.parser.bnf
  operators: grammarModule.parser.operators
  startSymbol: grammarModule.parser.startSymbol

console.log "🔧 Building CoffeeScript parser with Sonar (Advanced Mode)"
console.log "   Grammar: #{Object.keys(grammarSpec.bnf).length} rules, #{grammarSpec.tokens.split(' ').length} tokens"
console.log "   Options: #{Object.keys(options).filter((k) -> options[k]).join(', ') or 'none'}"

# Backup original if requested
if options.backup
  originalPath = 'lib/coffeescript/parser.js'
  backupPath = 'lib/coffeescript/parser.js.backup'
  if fs.existsSync originalPath
    fs.copyFileSync originalPath, backupPath
    console.log "💾 Backed up original to #{backupPath}"

# Create parser using Sonar with advanced options
try
  generatorOptions = {}
  generatorOptions.onDemandLookahead = true if options.optimize

  console.time 'Parser Generation' if options.timing

  generator = new LALRGenerator grammarSpec, generatorOptions
  generatedCode = generator.generate()

  console.timeEnd 'Parser Generation' if options.timing

  # Write to output
  outputPath = 'lib/coffeescript/parser.js'
  fs.writeFileSync outputPath, generatedCode

  # Get file size and stats
  stats = fs.statSync outputPath
  size = Math.round(stats.size / 1024)

  console.log "✨ Parser generated successfully!"
  console.log "   Output: #{outputPath}"
  console.log "   Size: #{size} KB"
  console.log "   Conflicts: #{generator.conflicts}"
  console.log "   States: #{generator.states.length}"

  # Compare with backup if requested
  if options.compare and fs.existsSync 'lib/coffeescript/parser.js.backup'
    backupStats = fs.statSync 'lib/coffeescript/parser.js.backup'
    backupSize = Math.round(backupStats.size / 1024)
    sizeDiff = size - backupSize
    console.log "📊 Comparison with original:"
    console.log "   Original: #{backupSize} KB"
    console.log "   New: #{size} KB"
    console.log "   Difference: #{if sizeDiff > 0 then '+' else ''}#{sizeDiff} KB"

catch error
  console.error "❌ Error generating parser:"
  console.error error.message
  console.error error.stack if options.timing
  process.exit 1