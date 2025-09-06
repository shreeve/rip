#!/usr/bin/env node

import { Generator } from '../lib/solar.js';
import { grammar } from '../lib/grammar-solar.js';
import Lexer from '../lib/lexer.js';
import Rewriter from '../lib/rewriter.js';

// Create parser
const generator = new Generator(grammar, { debug: false });
const parser = generator.createParser();

// Test code
const code = 'x = 42';

// Tokenize and rewrite
const lexer = new Lexer();
const tokens = lexer.tokenize(code);
const rewriter = new Rewriter();
const rewritten = rewriter.rewrite(tokens);

console.log('Tokens:');
rewritten.forEach(t => {
  console.log(' ', t[0] + ':', JSON.stringify(t[1]));
});

// Manually trace through parsing
const stk = [0];
const symbolIds = parser.symbolIds;
const parseTable = parser.parseTable;

console.log('\nManual parse trace:');

// Token 1: IDENTIFIER
let state = stk[stk.length - 1];
let symbol = symbolIds.IDENTIFIER; // 38
console.log(`State ${state}, symbol IDENTIFIER (${symbol})`);
console.log(`  Action:`, parseTable[state]?.[symbol]);

// Let's see what's in state 0
console.log('\nState 0 entries:');
Object.entries(parseTable[0]).slice(0, 10).forEach(([sym, action]) => {
  // Find symbol name
  const symName = Object.entries(symbolIds).find(([name, id]) => id == sym)?.[0] || sym;
  console.log(`  ${symName} (${sym}): ${JSON.stringify(action)}`);
});

