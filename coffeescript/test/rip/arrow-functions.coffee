# Tests for rip's concise arrow function modernization

test "rip: generates concise arrow functions for simple expressions", ->
  code = 'add = (a, b) => a + b'
  compiled = CoffeeScript.compile code

  ok compiled.includes('add = (a, b) => a + b;'), "Should generate concise arrow function"
  ok not compiled.includes('return'), "Should not include return keyword"
  ok not compiled.includes('{'), "Should not include braces"


test "rip: preserves braces for multi-statement arrow functions", ->
  code = '''
    complex = (x) =>
      console.log x
      x + 1
  '''
  compiled = CoffeeScript.compile code

  ok compiled.includes('console.log(x);'), "Should preserve multiple statements"
  ok compiled.includes('return x + 1'), "Should include return for last statement"
  ok compiled.includes('{'), "Should include braces for complex body"


test "rip: handles parameterless arrow functions", ->
  code = 'getValue = => 42'
  compiled = CoffeeScript.compile code

  ok compiled.includes('getValue = () => 42;'), "Should generate concise parameterless arrow"


test "rip: preserves template literals in arrow functions", ->
  code = 'greet = (name) => "Hello #{name}!"'
  compiled = CoffeeScript.compile code

  ok compiled.includes('`Hello ${name}!`'), "Should use template literals"
  ok compiled.includes('greet = (name) => `Hello ${name}!`;'), "Should be concise with template literal"


test "rip: handles complex expressions in concise arrows", ->
  code = 'calc = (x, y, z) => x * y + z / 2'
  compiled = CoffeeScript.compile code

  ok compiled.includes('calc = (x, y, z) => x * y + z / 2;'), "Should handle complex arithmetic"
  ok not compiled.includes('{'), "Should not need braces for expression"


test "rip: preserves braces for function calls with complex arguments", ->
  code = '''
    process = (value) => someFunction(value, {
      prop: "test"
    })
  '''
  compiled = CoffeeScript.compile code

  ok compiled.includes('return someFunction'), "Should preserve return for complex calls"
  ok compiled.includes('{'), "Should preserve braces for complex function calls"


test "rip: preserves braces for object and array literals", ->
  code = '''
    makeObj = (x) => { key: x }
    makeArr = (x) => [x, x * 2]
  '''
  compiled = CoffeeScript.compile code

  ok compiled.includes('return {'), "Should preserve braces for object literals"
  ok compiled.includes('return ['), "Should preserve braces for array literals"