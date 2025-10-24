#!/usr/bin/env bun

/**
 * Example: Using Rip files directly in Bun
 * 
 * Prerequisites:
 *   1. Install dependencies: bun install
 *   2. Add to bunfig.toml:
 *      [bun]
 *      preload = ["rip/bun"]
 * 
 * Then just import .rip files like normal TypeScript/JavaScript!
 */

// Import from .rip file - works seamlessly!
import { greet, Calculator, fibonacci, utils } from './app.rip'

console.log('🚀 Rip + Bun Example\n')

// Use the imported function
console.log(greet('World'))

// Use the class
const calc = new Calculator(10)
console.log('\nCalculator:', calc.add(5).multiply(2).result()) // (10 + 5) * 2 = 30

// Use array comprehensions
console.log('\nFibonacci sequence (10):', fibonacci(10))

// Use utility functions
const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
console.log('\nNumbers:', numbers)
console.log('Sum:', utils.sum(numbers))
console.log('Average:', utils.average(numbers))
console.log('Max:', utils.max(numbers))
console.log('Min:', utils.min(numbers))

console.log('\n✅ Rip imports working perfectly with Bun!')

