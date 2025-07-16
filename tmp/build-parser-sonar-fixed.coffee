#!/usr/bin/env coffee

# Build CoffeeScript parser using Sonar with syntax fixes
# Usage: coffee build-parser-sonar-fixed.coffee

fs = require 'fs'
path = require 'path'

# Require Sonar parser generator
{LALRGenerator} = require './node_modules/jison/lib/sonar'

console.log "🔧 Building CoffeeScript parser with Sonar (with fixes)..."

try
  # Before requiring the grammar, we need to intercept the jison module
  # to capture the raw grammar specification
  capturedGrammar = null

  # Create a mock Parser constructor
  MockParser = (spec) ->
    capturedGrammar = spec
    # Return a minimal parser object
    return {
      generate: -> ''
      generateModule: -> ''
      generateCommonJSModule: -> ''
    }

  # Temporarily replace the jison module in the require cache
  originalJison = require.cache[require.resolve('jison')]
  mockJison = { Parser: MockParser }
  require.cache[require.resolve('jison')] = { exports: mockJison }

  # Now require the grammar - this will call our MockParser and capture the spec
  grammarModule = require './src/grammar'

  # Restore the original jison module
  if originalJison
    require.cache[require.resolve('jison')] = originalJison
  else
    delete require.cache[require.resolve('jison')]

  if not capturedGrammar
    throw new Error "Failed to capture grammar specification"

  console.log "   Grammar captured from src/grammar.coffee"
  console.log "   Grammar has #{Object.keys(capturedGrammar.bnf).length} rules"
  console.log "   Grammar has #{capturedGrammar.tokens.split(' ').length} tokens"
  console.log "   Start symbol: #{capturedGrammar.startSymbol}"

  # Create parser using Sonar
  generator = new LALRGenerator capturedGrammar

  # Generate the parser code
  console.log "   Generating parser code..."
  generatedCode = generator.generate()

  # Fix the location tracking syntax (@1, @2, etc.)
  console.log "   Fixing location tracking syntax..."
  fixedCode = generatedCode
    .replace(/@(\d+)/g, 'null')  # Replace @1 with null for now (location tracking disabled)

  # Write to parser.js
  outputPath = 'lib/coffeescript/parser.js'
  fs.writeFileSync outputPath, fixedCode

  # Get file size
  stats = fs.statSync outputPath

  console.log "✨ Parser generated successfully!"
  console.log "   Output: #{outputPath}"
  console.log "   Size: #{stats.size} bytes"
  console.log "   Location tracking syntax fixed"

catch error
  console.error "❌ Error generating parser:", error.message
  console.error error.stack if error.stack
  process.exit 1