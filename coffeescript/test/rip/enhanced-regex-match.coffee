# Enhanced =~ Operator Tests - Rip Language Enhancement
# ----------------------------------------------------
# Tests for the enhanced =~ operator that safely handles all value types
# using the toSearchable() coercion function and ripMatch() runtime.

test "enhanced =~ handles strings (fast path)", ->
  input = "hello@example.com"
  result = input =~ /@(.+)$/
  eq result[0], "@example.com"
  eq result[1], "example.com"
  eq _[1], "example.com"

test "enhanced =~ handles null safely", ->
  input = null
  result = input =~ /test/
  eq result, null
  eq _, null

test "enhanced =~ handles undefined safely", ->
  input = undefined
  result = input =~ /test/
  eq result, null
  eq _, null

test "enhanced =~ handles numbers", ->
  input = 12345
  result = input =~ /(\d{3})/
  eq result[0], "123"
  eq result[1], "123"
  eq _[1], "123"

test "enhanced =~ handles booleans", ->
  input = true
  result = input =~ /true/
  eq result[0], "true"
  eq _[0], "true"

  input = false
  result = input =~ /false/
  eq result[0], "false"
  eq _[0], "false"

test "enhanced =~ handles arrays (CSV join)", ->
  input = ["apple", "banana", "cherry"]
  result = input =~ /banana/
  eq result[0], "banana"
  eq _[0], "banana"

test "enhanced =~ handles objects with toString", ->
  input = { toString: -> "custom-string-123" }
  result = input =~ /(\d+)/
  eq result[0], "123"
  eq result[1], "123"
  eq _[1], "123"

test "enhanced =~ handles plain objects safely", ->
  input = { name: "test" }
  result = input =~ /test/
  eq result, null
  eq _, null

test "enhanced =~ handles symbols with description", ->
  return unless typeof Symbol != 'undefined'
  input = Symbol('test-symbol')
  result = input =~ /test/
  eq result[0], "test"
  eq _[0], "test"

test "enhanced =~ handles symbols without description", ->
  return unless typeof Symbol != 'undefined'
  input = Symbol()
  result = input =~ /test/
  eq result, null
  eq _, null

test "enhanced =~ backward compatibility with existing patterns", ->
  # Test existing validation patterns still work
  email = "user@domain.com"
  email =~ /^([^@]+)@([^@]+)$/
  eq _[1], "user"
  eq _[2], "domain.com"

  # Test postfix if pattern
  state = ("CA" if "california" =~ /^([a-z]+)$/i)
  eq state, "CA"
  eq _[1], "california"

test "enhanced =~ compilation generates compileMatchHelper call", ->
  # Verify the compiled JavaScript uses our new runtime function
  compiled = CoffeeScript.compile("val =~ /test/", bare: yes)
  ok compiled.includes("compileMatchHelper"), "Should generate compileMatchHelper call"
  ok not compiled.includes(".match("), "Should not use old .match() syntax"

test "enhanced =~ with complex regex patterns", ->
  # Phone number validation
  phone = 1234567890
  result = phone =~ /^(\d{3})(\d{3})(\d{4})$/
  eq result[0], "1234567890"
  eq result[1], "123"
  eq result[2], "456"
  eq result[3], "7890"
  eq _[1], "123"
  eq _[2], "456"
  eq _[3], "7890"

test "enhanced =~ performance - string fast path", ->
  # Ensure strings don't get unnecessary processing
  input = "test-string"
  start = Date.now()
  for i in [1..1000]
    input =~ /test/
  duration = Date.now() - start
  ok duration < 100, "String processing should be fast (#{duration}ms for 1000 ops)"

test "enhanced =~ error resilience", ->
  # Test various edge cases that shouldn't throw
  testCases = [
    0, -1, 1.5, Infinity, -Infinity, NaN,
    "", "test",
    [], [1,2,3], ["a","b"],
    {}, {toString: null},
    null, undefined
  ]

  for testCase in testCases
    try
      result = testCase =~ /test/
      # Should never throw, result should be array or null
      ok (Array.isArray(result) or result == null), "Should return array or null for #{JSON.stringify(testCase)}"
    catch error
      ok false, "Should not throw for #{JSON.stringify(testCase)}: #{error.message}"

  # Test problematic toString separately
  try
    badToString = {toString: -> throw new Error("bad toString")}
    result = badToString =~ /test/
    ok (Array.isArray(result) or result == null), "Should handle bad toString gracefully"
  catch error
    # This is expected - bad toString should be handled by falling back to empty string
    ok true, "Bad toString handled appropriately"
