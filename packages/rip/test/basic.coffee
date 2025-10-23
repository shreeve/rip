# Basic tests for CoffeeScript v29
# No imports needed - runner provides test, code, fail

test 'basic arithmetic', '''
  2 + 2
''', 4

test 'string interpolation', '''
  name = 'CoffeeScript'
  version = 3
  "Hello from #{name} v#{version}!"
''', 'Hello from CoffeeScript v3!'

test 'array comprehension', '''
  (x * 2 for x in [1, 2, 3])
''', [2, 4, 6]

# Test compilation output - verify generated JavaScript
code 'arrow function compiles to ES6', '''
  square = (x) => x * x
''', '''
  var square;

  square = (x) => {
    return x * x;
  };
'''

code 'destructuring assignment', '''
  {a, b} = {a: 1, b: 2}
''', '''
  var a, b;

  ({a, b} = {
    a: 1,
    b: 2
  });
'''

# Test compilation failures - ensure invalid code is rejected
fail 'indentation mismatch throws error', '''
  if true
    x = 1
      y = 2  # Wrong indentation
'''

fail 'unexpected token', '''
  x = -> -> ->
    @@invalid@@
'''

fail 'invalid operator combination', '''
  a == == b
'''
