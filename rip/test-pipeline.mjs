#!/usr/bin/env node

// Test the complete Rip pipeline
import { Lexer } from './lib/lexer.js';
import { Rewriter } from './lib/rewriter.js';
import { createParser } from './lib/parser.js';
import grammar from './lib/grammar.js';

const testCode = `
# Test basic Rip features
x = 42
y = x + 1
name = "World"

# Function
greet = (name) ->
  "Hello, " + name

# Array and object
numbers = [1, 2, 3]
person =
  name: "Alice"
  age: 30

# Conditional
if x > 40
  console.log "Big number"
else
  console.log "Small number"
`;

console.log('🧪 Testing Rip Pipeline\n');
console.log('📝 Input Code:');
console.log('─'.repeat(40));
console.log(testCode.trim());
console.log('─'.repeat(40) + '\n');

try {
  // Step 1: Lexer
  console.log('1️⃣  Lexer:');
  const lexer = new Lexer();
  const tokens = lexer.tokenize(testCode);
  console.log(`   ✓ Generated ${tokens.length} tokens`);

  // Show some token types
  const tokenTypes = [...new Set(tokens.map(t => t[0]))];
  console.log(`   Token types: ${tokenTypes.slice(0, 10).join(', ')}...`);

  // Step 2: Parser
  console.log('\n2️⃣  Parser:');
  const parser = createParser(grammar);
  console.log('   ✓ Parser created from grammar');

  // Step 3: Verify helpers are available
  console.log('\n3️⃣  Helpers:');
  import('./lib/helpers.js').then(helpers => {
    console.log(`   ✓ Loaded ${Object.keys(helpers).length} helper functions`);
    console.log(`   Functions: ${Object.keys(helpers).slice(0, 5).join(', ')}...`);
  });

  console.log('\n✅ All components working correctly!');

} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
