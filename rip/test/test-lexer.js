#!/usr/bin/env bun
// Test our minimal lexer

import MinimalLexer from '../lib/minimal-lexer.js';

const lexer = new MinimalLexer();

console.log('🔤 Testing Minimal Lexer');
console.log('========================\n');

const code = `
# This is a comment
x = 42
name = "Steve"
square = (x) -> x * x

if x > 40
  console.log "Big number!"
else
  console.log "Small number"

person =
  name: "Bob"
  age: 30
`;

console.log('Input code:');
console.log(code);
console.log('\n---\n');

const tokens = lexer.tokenize(code);

console.log('Tokens:');
tokens.forEach(token => {
  const value = token.value ? ` (${JSON.stringify(token.value)})` : '';
  console.log(`  ${token.type}${value}`);
});

console.log(`\n✅ Tokenized ${tokens.length} tokens successfully!`);
