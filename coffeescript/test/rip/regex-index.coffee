# Regex Index Tests - Rip Language Enhancement
# ---------------------------------------------
# Tests for the Ruby-style variable[/regex/] syntax

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
  eq "(_ = str.match(/foo/)) && _[0];", CoffeeScript.compile("str[/foo/]", bare: yes).trim()

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