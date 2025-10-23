# Assignment
# ----------

# Basic assignment
test 'simple assignment', """
  a = 5
  a
""", 5

test 'multiple assignment', """
  a = b = c = 10
  a + b + c
""", 30

# Context property assignment (@)
test 'this property assignment', """
  obj = {}
  fn = ->
    @value = 42
    this
  fn.call(obj).value
""", 42

test 'shorthand this assignment', """
  class A
    constructor: (@name) ->
  new A('test').name
""", 'test'

# Compound assignment
test 'addition assignment', """
  a = 5
  a += 3
  a
""", 8

test 'subtraction assignment', """
  a = 10
  a -= 3
  a
""", 7

test 'multiplication assignment', """
  a = 5
  a *= 3
  a
""", 15

test 'division assignment', """
  a = 15
  a /= 3
  a
""", 5

test 'modulo assignment', """
  a = 17
  a %= 5
  a
""", 2

test 'floor division assignment', """
  a = 17
  a //= 5
  a
""", 3

test 'exponentiation assignment', """
  a = 2
  a **= 3
  a
""", 8

# Boolean operators
test 'or assignment false', """
  a = false
  a or= 5
  a
""", 5

test 'or assignment true', """
  a = 10
  a or= 5
  a
""", 10

test 'and assignment true', """
  a = 10
  a and= 5
  a
""", 5

test 'and assignment false', """
  a = 0
  a and= 5
  a
""", 0

test 'nullish assignment null', """
  a = null
  a ?= 5
  a
""", 5

test 'nullish assignment value', """
  a = 10
  a ?= 5
  a
""", 10

# Destructuring assignment
test 'array destructuring', """
  [a, b, c] = [1, 2, 3]
  a + b + c
""", 6

test 'object destructuring', """
  {x, y} = {x: 10, y: 20}
  x + y
""", 30

test 'nested destructuring', """
  [a, {b, c}] = [1, {b: 2, c: 3}]
  a + b + c
""", 6

test 'destructuring with defaults', """
  {a = 5, b = 10} = {a: 1}
  a + b
""", 11

test 'array destructuring skip', """
  [a, , c] = [1, 2, 3]
  a + c
""", 4

test 'destructuring swap', """
  a = 1
  b = 2
  [a, b] = [b, a]
  a
""", 2

# Rest in destructuring
test 'array rest destructuring', """
  [first, rest...] = [1, 2, 3, 4]
  rest.length
""", 3

test 'object rest destructuring', """
  {a, rest...} = {a: 1, b: 2, c: 3}
  rest.b + rest.c
""", 5

# Compound assignment in expressions
test 'compound as sub-expression', """
  a = 1
  b = 2
  c = 3
  result = (a + (b += c))
  result
""", 6

test 'compound assignment return value', """
  a = 5
  b = (a += 3)
  b
""", 8

# Empty destructuring
test 'empty object destructuring', '{}  = {}', undefined
test 'empty array destructuring', '[]  = []', undefined

# Chained assignment
test 'chained simple assignment', """
  a = b = c = 5
  a + b + c
""", 15

test 'chained destructuring', """
  [a] = [b] = [c] = [5]
  a + b + c
""", 15

# Assignment with existence check
test 'conditional assignment exists', """
  a = 5
  a = 10 if a?
  a
""", 10

test 'conditional assignment missing', """
  a = undefined
  a = 10 if not a?
  a
""", 10

# Complex destructuring patterns
test 'destructuring rename', """
  {x: a, y: b} = {x: 1, y: 2}
  a + b
""", 3

test 'deep object destructuring', """
  obj = {a: {b: {c: 5}}}
  {a: {b: {c: value}}} = obj
  value
""", 5

test 'mixed destructuring', """
  data = {items: [1, 2, 3], count: 3}
  {items: [first], count} = data
  first + count
""", 4

# String key destructuring
test 'string key destructuring', """
  {'foo-bar': value} = {'foo-bar': 42}
  value
""", 42

# Computed property destructuring
test 'computed property destructuring', """
  key = 'prop'
  {[key]: value} = {prop: 100}
  value
""", 100

# Assignment precedence
test 'assignment precedence', """
  a = b = 0
  c = a or b = 5
  b
""", 5

# Multiple targets
test 'multiple array destructure', """
  [a, b] = [c, d] = [1, 2]
  a + b + c + d
""", 6

# Assignment in conditionals
test 'assignment in if', """
  if a = 5
    a * 2
""", 10

test 'assignment in while', """
  result = []
  i = 0
  while val = i++ when i <= 3
    result.push val
  result.length
""", 3

# Invalid assignments should fail
fail 'invalid assignment to literal', '5 = 10'
fail 'invalid assignment to string', '"hello" = "world"'
fail 'invalid assignment to call', 'fn() = 5'
