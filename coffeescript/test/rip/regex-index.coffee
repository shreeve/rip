# Regex Index Tests - Rip Language Enhancement
# ---------------------------------------------
# Tests for the elegant str[/regex/] syntax that provides:
# - Automatic _ variable assignment for capture groups
# - Safe null handling when no match found
# - Clean, readable regex operations without .match() boilerplate
#
# Examples:
#   email[/@(.+)$/] and _[1]  # Gets domain, sets _ globally
#   phone[/^\d{10}$/]         # Returns match or null

test "regex index basic functionality", ->
  name = "Jonathan"
  initial = name[/[A-Z]/]
  eq initial, "J"

test "regex index with capture groups", ->
  phone = "1234567890"
  result = phone[/^(\d{3})(\d{3})(\d{4})$/]
  eq result, "1234567890"

test "regex index returns null for no match", ->
  text = "hello"
  result = text[/\d+/]
  eq result, null

test "regex index compilation", ->
  # Verifies the str[/regex/] syntax compiles to clean, safe JavaScript that:
  # - Uses toSearchable() for universal type coercion (handles null, numbers, symbols, etc.)
  # - Uses vanilla .match() after safe conversion
  # - Sets _ variable globally for subsequent capture group access
  # - Returns the match result or undefined (never throws on any input type)
  compiled = CoffeeScript.compile("str[/foo/]", bare: yes).trim()
  ok compiled.includes("(_ = toSearchable(str).match(/foo/)) && _[0]"), "Should use clean toSearchable().match() for safe type coercion"

test "regex index with flags", ->
  text = "Hello"
  result = text[/hello/i]
  eq result, "Hello"

test "regex index in assignment", ->
  extractFirst = (str) -> str[/\w/]
  eq extractFirst("abc123"), "a"
  eq extractFirst("123abc"), "1"
  eq extractFirst("!@#"), null

test "regex index sets _ variable with capture groups", ->
  phone = "1234567890"
  result = phone[/^(\d{3})(\d{3})(\d{4})$/]
  eq result, "1234567890"
  eq _[0], "1234567890"
  eq _[1], "123"
  eq _[2], "456"
  eq _[3], "7890"

test "regex index with capture group indexing", ->
  phone = "1234567890"
  eq phone[/^(\d{3})(\d{3})(\d{4})$/, 1], "123"
  eq phone[/^(\d{3})(\d{3})(\d{4})$/, 2], "456"
  eq phone[/^(\d{3})(\d{3})(\d{4})$/, 3], "7890"

test "regex index with chaining", ->
  text = "hello world"
  result = text[/(\w+)/].toUpperCase()
  eq result, "HELLO"

test "regex index with complex expressions", ->
  data = { text: "user123" }
  userId = data.text[/\d+/]
  eq userId, "123"

test "regex index with no capture groups but with index", ->
  text = "hello"
  result = text[/\w+/, 0]  # Should still work, accessing [0]
  eq result, "hello"

# Type Safety Tests - Enhanced regex indexing with universal type coercion
# These tests verify that str[/regex/] syntax safely handles ALL data types
# using the same compileMatchHelper infrastructure as the =~ operator

test "regex index handles null safely", ->
  input = null
  result = input[/hello/]
  eq result, null

test "regex index handles undefined safely", ->
  input = undefined
  result = input[/hello/]
  eq result, null

test "regex index handles numbers", ->
  input = 12345
  result = input[/(\d{3})/]
  eq result, "123"
  eq _[1], "123"

test "regex index handles booleans", ->
  input = true
  result = input[/true/]
  eq result, "true"

test "regex index handles arrays (CSV join)", ->
  input = [1, 2, 3]
  result = input[/2/]
  eq result, "2"

test "regex index handles objects with toString", ->
  input = { toString: -> "custom" }
  result = input[/custom/]
  eq result, "custom"

test "regex index handles plain objects safely", ->
  input = { foo: "bar" }
  result = input[/object/i]
  eq result, null

test "regex index handles symbols with description", ->
  input = Symbol("test")
  result = input[/test/]
  eq result, "test"

test "regex index handles symbols without description", ->
  input = Symbol()
  result = input[/symbol/]
  eq result, null

test "regex index with capture groups on various types", ->
  # Test that capture group indexing works with type coercion
  num = 12345
  area = num[/(\d{3})/, 1]
  eq area, "123"

  bool = false
  match = bool[/(false)/, 1]
  eq match, "false"