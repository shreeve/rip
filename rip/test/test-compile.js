#!/usr/bin/env bun
// Test the Rip compiler directly

import { compile } from '../lib/compiler.js';

// Test simple Rip code
const ripCode = `
# Simple Rip test
x = 42
message = "Hello from Rip!"
console.log message
console.log x
`;

console.log('Testing Rip Compiler');
console.log('====================');
console.log('Input Rip code:');
console.log(ripCode);
console.log('\n-------------------\n');

try {
  const jsCode = compile(ripCode, {
    header: true,
    filename: 'test.rip'
  });

  console.log('Generated JavaScript:');
  console.log(jsCode);

  console.log('\n-------------------\n');
  console.log('Executing generated code:');
  console.log('');

  // Execute the generated JavaScript
  eval(jsCode);

  console.log('\n✅ Test passed!');
} catch (error) {
  console.error('❌ Compilation failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
