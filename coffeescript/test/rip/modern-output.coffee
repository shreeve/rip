# Tests for rip's modern JavaScript output features

test "rip: generates clean bare mode output (no IIFE wrapper)", ->
  code = '''
    name = "rip"
    console.log "Hello #{name}!"
  '''

  compiled = CoffeeScript.compile code

  # Should NOT have IIFE wrapper
  ok not compiled.includes('(function()'), "Should not have IIFE wrapper"
  ok not compiled.includes('.call(this)'), "Should not have .call(this)"

  # Should have clean variable declarations
  ok compiled.includes('var name'), "Should have var declaration"
  ok compiled.includes('name = "rip"'), "Should have clean assignment"


test "rip: generates modern ES6 class syntax", ->
  code = '''
    class Person
      constructor: (@name) ->
      greet: -> "Hello, I'm #{@name}!"
  '''

  compiled = CoffeeScript.compile code

  # Should use ES6 class syntax
  ok compiled.includes('class Person'), "Should use ES6 class syntax"
  ok compiled.includes('constructor(name)'), "Should have ES6 constructor"
  ok not compiled.includes('function Person'), "Should not use old function syntax"


test "rip: preserves modern template literals", ->
  code = 'message = "Hello #{name}!"'
  compiled = CoffeeScript.compile code

  # Should use template literals, not string concatenation
  ok compiled.includes('`Hello ${name}!`'), "Should use template literals"
  ok not compiled.includes('" + '), "Should not use string concatenation"


test "rip: top-level async gets bare mode", ->
  code = 'await fetch("/api/data")'
  compiled = CoffeeScript.compile code

  # Should be bare async, not wrapped
  ok compiled.includes('await fetch'), "Should have bare await"
  ok not compiled.includes('(async function'), "Should not wrap in async IIFE"