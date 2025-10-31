#!/usr/bin/env node

/**
 * Example: Using the Rip Compiler
 *
 * This shows the simple way to compile Rip code to JavaScript.
 * Perfect for build tools, bundlers, or any time you need Rip → JS.
 */

import { compile } from 'rip'

// Simple compilation
const ripCode = `
# Elegant function syntax
greet = (name) -> "Hello, #{name}!"

# Array comprehensions
squares = (x * x for x in [1, 2, 3, 4, 5])

# Destructuring
{a, b} = {a: 1, b: 2}

# Export for use
export { greet, squares, a, b }
`

// Compile to JavaScript
const js = compile(ripCode)

console.log('=== Compiled JavaScript ===')
console.log(js)
console.log('\n=== Output ===')

// Run the compiled code
const module = { exports: {} }
const exportObj = {}
new Function('exports', js)(exportObj)

console.log('Exported:', exportObj)
