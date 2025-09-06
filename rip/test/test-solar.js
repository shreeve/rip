#!/usr/bin/env bun
// Test Solar parser generation directly

import Solar from '../lib/solar.js';
import { grammar } from '../lib/grammar.js';

console.log('Testing Solar Parser Generator');
console.log('==============================');
console.log('');

// No need for nodes - we use simple objects!
// grammar.yy = {};  // Would be set if needed

try {
  console.log('Creating generator...');
  const generator = new Solar.Generator(grammar, {
    debug: false
  });

  console.log('\n✅ Generator created successfully!');
  console.log('\nParser Statistics:');
  console.log(`  • Terminals: ${Object.keys(generator.terminalNames || {}).length}`);
  console.log(`  • Nonterminals: ${Object.keys(generator.nonterminals || {}).length}`);
  console.log(`  • Productions: ${generator.productions?.length || 0}`);
  console.log(`  • States: ${generator.states?.length || 0}`);
  console.log(`  • Conflicts: ${generator.conflicts || 0}`);

  console.log('\nCreating parser...');
  const parser = generator.createParser();

  console.log('✅ Parser created successfully!');

  // Test with a simple token stream
  const testTokens = [
    { type: 'IDENTIFIER', value: 'x' },
    { type: 'ASSIGN', value: '=' },
    { type: 'NUMBER', value: '42' },
    { type: 'EOF', value: '' }
  ];

  console.log('\nTest tokens:', testTokens.map(t => t.type).join(' '));

} catch (error) {
  console.error('❌ Failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
