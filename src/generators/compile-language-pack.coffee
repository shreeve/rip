# Language Pack Compiler
# Reads raw .coffee language packs and generates optimized .js compiled packs

fs = require 'fs'
path = require 'path'

# Process a raw language pack into an optimized compiled pack
processLanguagePack = (rawPack) ->
  console.log "Processing language pack: #{rawPack.info.name} v#{rawPack.info.version}"

  # Extract components - handle both grammar/rules formats
  {info} = rawPack
  grammar = rawPack.grammar or rawPack.rules
  operators = rawPack.operators

  if not grammar
    throw new Error "Language pack must have 'grammar' or 'rules' property"

  if not operators
    throw new Error "Language pack must have 'operators' property"

  # Optimize grammar rules for runtime
  optimizedGrammar = optimizeGrammar(grammar)

  # Optimize operator precedence table
  optimizedOperators = optimizeOperators(operators)

  # Create compiled pack structure
  compiledPack = {
    info: info
    grammar: optimizedGrammar
    operators: optimizedOperators
    metadata: {
      compiledAt: new Date().toISOString()
      source: "#{info.name}.coffee"
      version: info.version
    }
  }

  # Include additional properties if they exist
  if rawPack.start
    compiledPack.start = rawPack.start
  if rawPack.createLexer
    compiledPack.createLexer = rawPack.createLexer
  if rawPack.constructors
    compiledPack.constructors = rawPack.constructors
  if rawPack.helpers
    compiledPack.helpers = rawPack.helpers
  if rawPack.debug
    compiledPack.debug = rawPack.debug

  return compiledPack

# Optimize grammar rules for faster runtime lookup
optimizeGrammar = (grammar) ->
  console.log "  Optimizing #{Object.keys(grammar).length} grammar rules..."

  optimized = {}

  for ruleName, productions of grammar
    # Convert productions to optimized format
    optimized[ruleName] = productions.map (production, index) ->
      [pattern, action, options] = production

      # Pre-compute pattern tokens for faster matching
      tokens = pattern.split(/\s+/).filter (token) -> token.length > 0

      {
        pattern: pattern
        tokens: tokens
        action: action
        options: options or {}
        index: index
      }

  return optimized

# Optimize operator precedence table
optimizeOperators = (operators) ->
  console.log "  Optimizing #{operators.length} operator precedence levels..."

  # Create lookup tables for faster precedence checking
  precedenceMap = {}
  associativityMap = {}

  operators.forEach (level, index) ->
    [assoc, ...ops] = level

    ops.forEach (op) ->
      precedenceMap[op] = index
      associativityMap[op] = assoc

  return
    levels:        operators
    precedence:    precedenceMap
    associativity: associativityMap
    count:         operators.length

# Generate JavaScript output for the compiled pack
generateJavaScript = (compiledPack) ->
  # Create CommonJS module export
  jsCode = """
// Compiled Language Pack - Generated from #{compiledPack.metadata.source}
// Generated at: #{compiledPack.metadata.compiledAt}

const compiledPack = #{JSON.stringify(compiledPack, null, 2)};

module.exports = compiledPack;
"""

  return jsCode

# Main compilation function
compileLanguagePack = (inputPath, outputPath) ->
  try
    console.log "🔄 Compiling language pack..."
    console.log "  Input:  #{inputPath}"
    console.log "  Output: #{outputPath}"

    # Read raw language pack
    rawPack = require path.resolve(inputPath)

    # Process and optimize
    compiledPack = processLanguagePack(rawPack)

    # Generate JavaScript
    jsCode = generateJavaScript(compiledPack)

    # Write compiled pack
    fs.writeFileSync outputPath, jsCode, 'utf8'

    console.log "✅ Successfully compiled language pack!"
    console.log "  Grammar rules: #{Object.keys(compiledPack.grammar).length}"
    console.log "  Operator levels: #{compiledPack.operators.count}"
    console.log "  Output size: #{(jsCode.length / 1024).toFixed(1)}KB"

    return true

  catch error
    console.error "❌ Error compiling language pack:", error.message
    return false

# CLI usage
if require.main is module
  # Get input and output paths from command line
  inputPath = process.argv[2]
  outputPath = process.argv[3]

  if not inputPath
    console.log "Usage: coffee compile-language-pack.coffee <input.coffee> [output.js]"
    console.log ""
    console.log "Examples:"
    console.log "  coffee compile-language-pack.coffee languages/coffeescript.coffee"
    console.log "  coffee compile-language-pack.coffee languages/rip.coffee languages/rip.js"
    process.exit 1

  # Auto-generate output path if not provided
  if not outputPath
    baseName = path.basename(inputPath, path.extname(inputPath))
    outputPath = path.join(path.dirname(inputPath), "#{baseName}.js")

  # Compile the language pack
  success = compileLanguagePack(inputPath, outputPath)
  process.exit if success then 0 else 1

module.exports = {
  compileLanguagePack
  processLanguagePack
  optimizeGrammar
  optimizeOperators
  generateJavaScript
}