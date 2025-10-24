# Formatting
# ----------

# Semicolons in expressions
test 'semicolon separated statements', '(1; 2; 3)', 3

test 'semicolon in function', """
  fn = -> (1; 2; 'result')
  fn()
""", 'result'

# Line continuation with dots
test 'method chaining on new lines', """
  'hello'
    .toUpperCase()
    .toLowerCase()
""", 'hello'

test 'method chaining starting with dot', """
  str = 'test'
  str
  .toUpperCase()
""", 'TEST'

# Operators continuing lines
test 'operators on new line', """
  1 +
  2 +
  3
""", 6

test 'operators continuing', """
  result = 10 *
           2 +
           5
  result
""", 25

# Array literals across lines
test 'array on multiple lines', """
  arr = [
    1
    2
    3
  ]
  arr.length
""", 3

test 'array with trailing comma', """
  arr = [
    1,
    2,
    3,
  ]
  arr[2]
""", 3

# Object literals across lines
test 'object on multiple lines', """
  obj =
    a: 1
    b: 2
  obj.a + obj.b
""", 3

test 'nested object formatting', """
  obj =
    outer:
      inner: 5
  obj.outer.inner
""", 5

# Function arguments on multiple lines
test 'function args on new lines', """
  fn = (a, b, c) -> a + b + c
  fn(
    1
    2
    3
  )
""", 6

test 'method call args on new lines', """
  Math.max(
    1,
    5,
    3
  )
""", 5

# String continuation
test 'string on multiple lines', """
  str = "hello \
world"
  str
""", 'hello world'

test 'multiline string literal', """
  str = "line 1
         line 2"
  str
""", 'line 1 line 2'

# Parentheses and indentation
test 'nested parentheses', """
  (
    (
      (1 + 2)
    ) * 3
  )
""", 9

# Existential operator continuation
test 'existential continues line', """
  obj = {a: {b: 5}}
  obj
  ?.a
  ?.b
""", 5

test 'existential with brackets', """
  arr = [1, 2, 3]
  arr
  ?[1]
""", 2

# Comments and formatting
test 'inline comments ignored', """
  1 + ### comment ### 2
""", 3

test 'comment at line end', """
  x = 5 # comment
  x
""", 5

# Implicit objects
test 'implicit object multiline', """
  fn = (obj) -> obj.a + obj.b
  fn
    a: 1
    b: 2
""", 3

# Unicode identifiers
test 'Unicode identifiers', """
  λ = 5
  λ
""", 5

test 'Unicode spaces not part of identifiers', """
  a = (x) -> x * 2
  b = 3
  # Using various Unicode spaces between a and b
  a b # U+00A0 NO-BREAK SPACE
""", 6

# Implicit calls
test 'implicit call multiline args', """
  fn = (a, b) -> a + b
  fn 1,
     2
""", 3

# Range formatting
test 'range on new line', """
  arr = [
    1..3
  ]
  arr.length
""", 1

test 'range elements', """
  [...[1..3]]
""", [1, 2, 3]

# Prototype access spacing
test 'prototype with space', """
  String:: ['charAt']
  typeof String::charAt
""", 'function'

test 'prototype continuation', """
  String
  ::
  charAt.name
""", 'charAt'

# Complex expressions
test 'complex nested expression', """
  result = (
    x = 5
    y = 10
    x + y
  )
  result
""", 15

# Template literals formatting
test 'template literal multiline', """
  x = 5
  `Line 1
   Line 2 \${x}`
""", 'Line 1\n   Line 2 5'

# Conditional formatting
test 'if on multiple lines', """
  if true
  then 1
  else 2
""", 1

test 'ternary on multiple lines', """
  true ?
    'yes' :
    'no'
""", 'yes'
