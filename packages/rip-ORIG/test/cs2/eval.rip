# Eval Tests
# ----------

# Basic eval
test 'basic eval', """
  eval('1 + 1')
""", 2

test 'eval with variable', """
  code = '2 * 3'
  eval(code)
""", 6

test 'eval accessing outer scope', """
  x = 10
  eval('x + 5')
""", 15

test 'eval creating variable', """
  eval('var y = 20')
  y
""", 20

test 'eval with string interpolation', """
  value = 5
  eval("value * #{2}")
""", 10

# Eval in function context
test 'eval in function', """
  fn = ->
    local = 7
    eval('local * 2')
  fn()
""", 14

# Dynamic code execution
test 'dynamic code execution', """
  operation = '+'
  a = 3
  b = 4
  eval("a #{operation} b")
""", 7
