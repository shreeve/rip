# Exponentiation
# --------------

# Basic exponentiation

test "basic exponentiation", "2 ** 3", 8
test "exponentiation zero", "5 ** 0", 1
test "exponentiation negative", "2 ** -2", 0.25
test "exponentiation fractional", "4 ** 0.5", 2
test "exponentiation large", "10 ** 6", 1000000

# Precedence

test "exponentiation precedence with multiplication", """
  2 ** 3 * 4
""", 32

test "exponentiation precedence with parentheses", """
  2 ** (3 * 4)
""", 4096

test "exponentiation right associative", """
  2 ** 2 ** 3
""", 256

test "exponentiation with unary minus", """
  -2 ** 2
""", -4

test "exponentiation with parentheses unary", """
  (-2) ** 2
""", 4

# Compound assignment

test "exponentiation compound assignment", """
  x = 2
  x **= 3
  x
""", 8

test "exponentiation compound with negative", """
  x = 5
  x **= -1
  x
""", 0.2

# With variables

test "exponentiation with variables", """
  base = 3
  exp = 4
  base ** exp
""", 81

test "exponentiation in expression", """
  x = 2
  y = 3
  result = (x + 1) ** y
  result
""", 27

# Edge cases

test "exponentiation NaN base", """
  isNaN(NaN ** 2)
""", true

test "exponentiation infinity", """
  2 ** Infinity
""", Infinity

test "exponentiation negative infinity", """
  2 ** -Infinity
""", 0

test "exponentiation zero base zero exp", """
  0 ** 0
""", 1

# Floating point

test "exponentiation floating point", """
  2.5 ** 2
""", 6.25

test "exponentiation negative base odd exp", """
  (-3) ** 3
""", -27

test "exponentiation negative base even exp", """
  (-3) ** 2
""", 9

# In arrays and objects

test "exponentiation in array", """
  [2 ** 1, 2 ** 2, 2 ** 3]
""", [2, 4, 8]

test "exponentiation in object", """
  obj =
    a: 2 ** 3
    b: 3 ** 2
  [obj.a, obj.b]
""", [8, 9]

# With functions

test "exponentiation with function call", """
  square = (x) -> x ** 2
  square(5)
""", 25

test "exponentiation in return", """
  fn = -> 2 ** 4
  fn()
""", 16

# Complex expressions

test "exponentiation complex", """
  result = (2 + 3) ** (1 + 1)
  result
""", 25

test "exponentiation chain", """
  x = 2
  y = x ** 2 ** 2
  y
""", 16


