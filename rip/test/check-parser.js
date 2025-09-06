#!/usr/bin/env node

import { Generator } from '../lib/solar.js';
import { grammar } from '../lib/grammar-solar.js';

// Create generator and parser
const generator = new Generator(grammar, { debug: false });
const parser = generator.createParser();

// Check what's in the parser
console.log('Parser has parseTable?', !!parser.parseTable);
console.log('parseTable is array?', Array.isArray(parser.parseTable));
console.log('parseTable length:', parser.parseTable?.length);

// Check first few states
if (parser.parseTable) {
  console.log('\nFirst 3 states:');
  for (let i = 0; i < Math.min(3, parser.parseTable.length); i++) {
    const state = parser.parseTable[i];
    console.log(`State ${i}:`, JSON.stringify(state).substring(0, 200) + '...');
  }
}

// Check symbol mappings
console.log('\nKey symbols:');
console.log('IDENTIFIER:', parser.symbolIds?.IDENTIFIER);
console.log('=:', parser.symbolIds?.['=']);
console.log('NUMBER:', parser.symbolIds?.NUMBER);
console.log('TERMINATOR:', parser.symbolIds?.TERMINATOR);

// Check if we have the assignment production
console.log('\nProductions (first 10):');
for (let i = 0; i < Math.min(10, generator.productions.length); i++) {
  const p = generator.productions[i];
  console.log(`  ${i}: ${p.lhs?.name || p.lhs} → ${p.rhs.map(s => s?.name || s).join(' ')}`);
}

