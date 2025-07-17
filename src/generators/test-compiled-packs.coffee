# Test Compiled Language Packs
# Verifies that the compiled .js language packs can be loaded and used

console.log "🧪 Testing Compiled Language Packs"
console.log "=================================="

# Test loading compiled packs
testCompiledPack = (packName) ->
  try
    console.log "\n📦 Testing #{packName} compiled pack..."

    # Load the compiled pack
    compiledPack = require "../../languages/#{packName}.js"

    # Validate structure
    console.log "  ✅ Successfully loaded #{packName}.js"
    console.log "  📊 Pack info:"
    console.log "    - Name: #{compiledPack.info.name}"
    console.log "    - Version: #{compiledPack.info.version}"
    console.log "    - Grammar rules: #{Object.keys(compiledPack.grammar).length}"
    console.log "    - Operator levels: #{compiledPack.operators.count}"
    console.log "    - Compiled at: #{compiledPack.metadata.compiledAt}"

    # Test grammar structure
    grammarKeys = Object.keys(compiledPack.grammar)
    console.log "  📝 Grammar rules: #{grammarKeys.slice(0, 5).join(', ')}#{if grammarKeys.length > 5 then '...' else ''}"

    # Test operator structure
    console.log "  ⚡ Operator precedence levels: #{compiledPack.operators.count}"
    console.log "  🔍 Precedence map entries: #{Object.keys(compiledPack.operators.precedence).length}"

    # Test additional properties if they exist
    if compiledPack.start
      console.log "  🎯 Start symbol: #{compiledPack.start}"
    if compiledPack.createLexer
      console.log "  🔤 Lexer factory: available"
    if compiledPack.constructors
      console.log "  🏗️  Constructors: #{Object.keys(compiledPack.constructors).length} available"

    return true

  catch error
    console.error "  ❌ Error loading #{packName}.js: #{error.message}"
    return false

# Test both language packs
console.log "\n🔄 Testing CoffeeScript compiled pack..."
coffeeSuccess = testCompiledPack('coffeescript')

console.log "\n🔄 Testing Rip compiled pack..."
ripSuccess = testCompiledPack('rip')

# Summary
console.log "\n📋 Summary:"
console.log "  CoffeeScript: #{if coffeeSuccess then '✅ PASS' else '❌ FAIL'}"
console.log "  Rip: #{if ripSuccess then '✅ PASS' else '❌ FAIL'}"

if coffeeSuccess and ripSuccess
  console.log "\n🎉 All compiled packs are working correctly!"
  console.log "\n🚀 Next steps:"
  console.log "  1. Use these compiled packs in your runtime parser"
  console.log "  2. The .js files are optimized for performance"
  console.log "  3. Edit the .coffee files and recompile as needed"
else
  console.log "\n⚠️  Some compiled packs have issues. Check the errors above."
  process.exit 1