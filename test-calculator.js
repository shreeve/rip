// Test the calculator grammar
const fs = require('fs');
const path = require('path');

// Simple test function
function testCalculator(expression, expected) {
  try {
    // In a real implementation, you would use the generated parser here
    // For now, we'll just log the test cases
    console.log(`Testing: ${expression} = ${expected}`);

    // This is where you would call the parser:
    // const result = parser.parse(expression);
    // console.log(`Result: ${result}, Expected: ${expected}, Pass: ${result === expected}`);

  } catch (error) {
    console.error(`Error parsing "${expression}":`, error.message);
  }
}

// Test cases
console.log('Calculator Grammar Test Cases:\n');

testCalculator('2 + 3', 5);
testCalculator('10 - 4', 6);
testCalculator('3 * 7', 21);
testCalculator('15 / 3', 5);
testCalculator('2 + 3 * 4', 14);  // Tests precedence
testCalculator('(2 + 3) * 4', 20); // Tests parentheses
testCalculator('-5', -5); // Tests unary minus
testCalculator('3.14 + 2.86', 6); // Tests decimals

console.log('\nTo use this grammar:');
console.log('1. Install jison: npm install -g jison');
console.log('2. Generate parser: jison calculator.jison -o calculator.js');
console.log('3. Use the generated parser in your code');