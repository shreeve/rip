#!/usr/bin/env bun
// Test the "cheat" compiler that uses CoffeeScript

import CheatCompiler from '../lib/cheat-compiler.js';

console.log('🎰 Testing Cheat Compiler (using CoffeeScript)');
console.log('==============================================\n');

const compiler = new CheatCompiler();

// Test 1: Simple variable assignment
console.log('Test 1: Simple variable assignment');
const test1 = `
x = 42
console.log x
`;
console.log('Input:', test1.trim());

try {
  const js1 = compiler.compile(test1);
  console.log('Output JS:', js1.trim());
  console.log('✅ Success!\n');
} catch (e) {
  console.log('❌ Failed:', e.message, '\n');
}

// Test 2: Function definition
console.log('Test 2: Function definition');
const test2 = `
square = (x) -> x * x
result = square 5
console.log "Result:", result
`;
console.log('Input:', test2.trim());

try {
  const js2 = compiler.compile(test2);
  console.log('Output JS:', js2.trim());
  console.log('✅ Success!\n');

  // Actually run it!
  console.log('Running the compiled code:');
  eval(js2);
  console.log();
} catch (e) {
  console.log('❌ Failed:', e.message, '\n');
}

// Test 3: Object literal
console.log('Test 3: Object literal');
const test3 = `
person =
  name: "Steve"
  age: 42
  greet: -> console.log "Hi, I'm #{@name}"

person.greet()
`;
console.log('Input:', test3.trim());

try {
  const js3 = compiler.compile(test3);
  console.log('Output JS:', js3.trim());
  console.log('✅ Success!\n');

  // Actually run it!
  console.log('Running the compiled code:');
  eval(js3);
  console.log();
} catch (e) {
  console.log('❌ Failed:', e.message, '\n');
}

// Test 4: Class definition
console.log('Test 4: Class definition');
const test4 = `
class Animal
  constructor: (@name) ->

  speak: ->
    console.log "#{@name} makes a sound"

dog = new Animal "Rex"
dog.speak()
`;
console.log('Input:', test4.trim());

try {
  const js4 = compiler.compile(test4);
  console.log('Output JS:', js4.trim());
  console.log('✅ Success!\n');

  // Actually run it!
  console.log('Running the compiled code:');
  eval(js4);
} catch (e) {
  console.log('❌ Failed:', e.message, '\n');
}

console.log('\n🎯 Summary: We can compile Rip using CoffeeScript as a cheat!');
