# Edge Cases and Compilation Errors
# ----------------------------------

# Unicode support
test 'unicode identifiers', """
  λ = 5
  λ
""", 5

test 'unicode function', """
  σ = (x) -> x * 2
  σ(3)
""", 6

# Unicode spaces (should work as separators)
test 'unicode space separators', """
  fn = (x) -> x * 2
  # Using various unicode spaces
  fn 3
""", 6

# Carriage returns (Windows line endings)
test 'carriage return handling', """
  x = 1
  y = 2
  x + y
""", 3

# Splat on its own line is invalid
fail 'splat on own line', """
  x 'a'
  ...
"""

# Invalid constructs
fail 'unclosed function', 'f(->'
fail 'break outside loop', 'a = (break)'
fail 'return in comprehension', 'a = (return 5 for item in list)'
fail 'return in while expression', 'a = (return 5 while condition)'
fail 'for with return in body', 'a = for x in y\n  return 5'

# Multiple else clauses
fail 'multiple else', """
  if a
    b
  else
    c
  else
    d
"""

# __proto__ should work
test '__proto__ access', """
  obj = {}
  obj.__proto__ = {value: 5}
  obj.value
""", 5

# Invalid object keys
fail 'invalid @ key', '@key: value'

# String interpolation is not implicit function call
fail 'interpolation as function', '"int#{1}polated" arg'

# own keyword position
fail 'own before for', 'a for own b in c'

# Single-line if requires then
fail 'if without then', 'if b else x'

# Empty block comments
test 'empty block comment', '### ### 5', 5

# Closing comment from within
fail 'closing comment inside', '### */ ###'

# Escaped quotes in heredocs
fail 'escaped quote at end of heredoc', '"""\\"""'
fail 'triple escaped quote at end', '"""\\\\\\"""'

# Keywords shouldn't be stringified
test 'this not stringified', """
  (-> this == 'this')()
""", false

# Unicode in object keys
test 'unicode object key', """
  obj = {'κλειδί': 42}
  obj['κλειδί']
""", 42

# Implicit object edge cases
test 'implicit object in parens', """
  fn = (obj) -> obj.x
  fn(x: 10)
""", 10

# Complex property access
test 'computed member access', """
  obj = {prop: 5}
  key = 'prop'
  obj[key]
""", 5

# Trailing comma in last line
test 'trailing comma function call', """
  Math.max 1,
           2,
""", 2

# Empty while body
test 'empty while loop', """
  i = 0
  while i++ < 3 then
  i
""", 4

# Regex as argument
test 'regex argument', """
  fn = (r) -> r.test('hello')
  fn /ell/
""", true

# Dynamic object keys with interpolation
test 'dynamic key interpolation', """
  key = 'prop'
  obj = {"#{key}": 10}
  obj.prop
""", 10

# Multiple semicolons
test 'multiple semicolons', """
  a = 1;; b = 2
  a + b
""", 3

# Object with numeric keys
test 'numeric object keys', """
  obj = {0: 'a', 1: 'b'}
  obj[0] + obj[1]
""", 'ab'

# Empty destructuring
test 'empty object destructure', """
  {} = {a: 1}
  true
""", true

test 'empty array destructure', """
  [] = [1, 2]
  true
""", true

# Single expression parentheses
test 'parentheses expression sequence', """
  (1; 2; 3)
""", 3

# Void operator
test 'void operator', """
  void 0
""", undefined

# In operator edge cases
test 'in operator with array', """
  2 in [1, 2, 3]
""", true

test 'in operator with string', """
  'e' in 'hello'
""", true

# Complex ternary
test 'nested ternary', """
  a = true
  b = false
  if a then if b then 1 else 2 else 3
""", 2

# Empty function
test 'empty function', """
  fn = ->
  fn()
""", undefined

# Property of primitives
test 'string property access', """
  "hello".length
""", 5

test 'number property access', """
  (42).toString().length
""", 2

# Chained comparisons
test 'chained comparison true', """
  1 < 2 < 3
""", true

test 'chained comparison false', """
  1 < 2 > 3
""", false

# Object shorthand with reserved words
test 'reserved word shorthand', """
  class Cls
  obj = {class: Cls}
  obj.class is Cls
""", true

# Nested interpolations
test 'nested string interpolation', """
  x = 5
  "outer #{
    y = 10
    "inner #{x + y}"
  }"
""", 'outer inner 15'

# Variable name edge cases
test 'hasOwnProperty as variable name', """
  hasOwnProperty = 0
  a = 1
  hasOwnProperty + a
""", 1

test 'carriage returns work in source', """
  one = 1\r\ntwo = 2
  one + two
""", 3

test 'while with empty body compiles', """
  i = 0
  while i++ < 3 then
  i
""", 4

test 'implicit call with regex argument', """
  obj = {key: (r) -> r.test('test')}
  obj.key /test/
""", true

test 'multiple generated references', """
  a = {b: []}
  a.b[true] = -> @toString() == '[object Array]'
  c = 0
  d = []
  a.b[0<++c<2](d...)
""", true
