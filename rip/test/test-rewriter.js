#!/usr/bin/env bun
// Test the Rip rewriter

import { execSync } from 'child_process';
import fs from 'fs';

console.log('🔄 Testing Rip Rewriter');
console.log('========================\n');

// Step 1: Compile the rewriter
console.log('📝 Compiling rewriter.rip...');
try {
  execSync('coffee -c -b -o lib/ src/rewriter.rip', {
    cwd: '/Users/shreeve/Data/Code/rip/rip'
  });

  // Fix ES6 modules
  let rewriterJs = fs.readFileSync('/Users/shreeve/Data/Code/rip/rip/lib/rewriter.js', 'utf-8');
  rewriterJs = rewriterJs
    .replace(/var\s+(\w+);?\s*\1\s*=\s*class\s+\1/g, 'const $1 = class $1')
    .replace(/module\.exports = (\w+);/, '')
    .replace(/export\s+\{\s*Rewriter\s*\};/, 'export { Rewriter };')
    .replace(/export\s+default\s+Rewriter;/, 'export default Rewriter;');

  if (!rewriterJs.includes('export default')) {
    rewriterJs += '\nexport default Rewriter;\nexport { Rewriter };';
  }

  fs.writeFileSync('/Users/shreeve/Data/Code/rip/rip/lib/rewriter.js', rewriterJs);
  console.log('✅ Rewriter compiled!\n');
} catch (e) {
  console.log('❌ Failed to compile rewriter:', e.message, '\n');
  process.exit(1);
}

// Step 2: Test the rewriter with mock tokens
console.log('🧪 Testing rewriter functions...\n');

const Rewriter = (await import('/Users/shreeve/Data/Code/rip/rip/lib/rewriter.js')).default;
const rewriter = new Rewriter();

// Test 1: Implicit function calls
console.log('Test 1: Implicit function calls');
console.log('Input: console.log "hello"');
let tokens = [
  {type: 'IDENTIFIER', value: 'console'},
  {type: '.', value: '.'},
  {type: 'IDENTIFIER', value: 'log'},
  {type: 'STRING', value: '"hello"'}
];

let rewritten = rewriter.rewrite([...tokens]);
console.log('Output tokens:');
rewritten.forEach(t => console.log(`  ${t.type}${t.generated ? ' (generated)' : ''}: ${t.value}`));
console.log();

// Test 2: Postfix conditionals
console.log('Test 2: Postfix conditionals');
console.log('Input: return x if y');
tokens = [
  {type: 'RETURN', value: 'return'},
  {type: 'IDENTIFIER', value: 'x'},
  {type: 'IF', value: 'if'},
  {type: 'IDENTIFIER', value: 'y'}
];

rewritten = rewriter.rewrite([...tokens]);
console.log('Output tokens:');
rewritten.forEach(t => console.log(`  ${t.type}${t.generated ? ' (generated)' : ''}: ${t.value}`));
console.log();

// Test 3: Single-line blocks
console.log('Test 3: Single-line blocks');
console.log('Input: -> x + 1');
tokens = [
  {type: '->', value: '->'},
  {type: 'IDENTIFIER', value: 'x'},
  {type: '+', value: '+'},
  {type: 'NUMBER', value: '1'}
];

rewritten = rewriter.rewrite([...tokens]);
console.log('Output tokens:');
rewritten.forEach(t => console.log(`  ${t.type}${t.generated ? ' (generated)' : ''}: ${t.value}`));
console.log();

// Test 4: Implicit objects
console.log('Test 4: Implicit objects');
console.log('Input: func a: 1, b: 2');
tokens = [
  {type: 'IDENTIFIER', value: 'func'},
  {type: 'IDENTIFIER', value: 'a'},
  {type: ':', value: ':'},
  {type: 'NUMBER', value: '1'},
  {type: ',', value: ','},
  {type: 'IDENTIFIER', value: 'b'},
  {type: ':', value: ':'},
  {type: 'NUMBER', value: '2'}
];

rewritten = rewriter.rewrite([...tokens]);
console.log('Output tokens:');
rewritten.forEach(t => console.log(`  ${t.type}${t.generated ? ' (generated)' : ''}: ${t.value}`));
console.log();

console.log('✅ Rewriter tests complete!');
