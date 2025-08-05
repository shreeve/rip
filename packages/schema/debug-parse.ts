#!/usr/bin/env bun

import { ColumnBuilder } from './builder'

console.log('🔍 Debugging parseField function')

// Create a ColumnBuilder to test parseField
const builder = new ColumnBuilder()

// Test the parseField method directly
const testCases = ['email!#', 'username#', 'handle#!', 'firstName!', 'bio']

for (const testCase of testCases) {
  const result = builder.parseField(testCase)
  console.log(
    `"${testCase}" → { name: "${result.name}", required: ${result.required}, unique: ${result.unique} }`,
  )
}
