# Operators
# ---------

# Arithmetic operators

test "addition", "2 + 3", 5
test "subtraction", "5 - 3", 2
test "multiplication", "3 * 4", 12
test "division", "10 / 2", 5
test "modulo", "10 % 3", 1
test "floor division", "7 // 2", 3
test "exponentiation", "2 ** 3", 8

# Comparison operators

test "equality", "5 == 5", true
test "strict equality", "5 === 5", true
test "CoffeeScript is", "5 is 5", true
test "inequality", "5 != 3", true
test "strict inequality", "5 !== 3", true
test "CoffeeScript isnt", "5 isnt 3", true
test "less than", "3 < 5", true
test "greater than", "5 > 3", true
test "less or equal", "3 <= 3", true
test "greater or equal", "3 >= 3", true

# Logical operators

test "logical and", "true and true", true
test "logical and false", "true and false", false
test "logical or", "false or true", true
test "logical or false", "false or false", false
test "logical not", "not true", false
test "logical not false", "not false", true

# Bitwise operators

test "bitwise and", "5 & 3", 1
test "bitwise or", "5 | 3", 7
test "bitwise xor", "5 ^ 3", 6
test "bitwise not", "~5", -6
test "left shift", "5 << 2", 20
test "right shift", "20 >> 2", 5
test "zero fill right shift", "-1 >>> 1", 2147483647

# Assignment operators

test "basic assignment", """
  x = 5
  x
""", 5

test "addition assignment", """
  x = 5
  x += 3
  x
""", 8

test "subtraction assignment", """
  x = 5
  x -= 2
  x
""", 3

test "multiplication assignment", """
  x = 5
  x *= 2
  x
""", 10

test "division assignment", """
  x = 10
  x /= 2
  x
""", 5

test "modulo assignment", """
  x = 10
  x %= 3
  x
""", 1

test "floor division assignment", """
  x = 7
  x //= 2
  x
""", 3

test "exponentiation assignment", """
  x = 2
  x **= 3
  x
""", 8

# Logical assignment operators

test "or assignment null", """
  x = null
  x ||= 5
  x
""", 5

test "or assignment truthy", """
  x = 3
  x ||= 5
  x
""", 3

test "and assignment truthy", """
  x = 3
  x &&= 5
  x
""", 5

test "and assignment falsy", """
  x = 0
  x &&= 5
  x
""", 0

test "nullish assignment null", """
  x = null
  x ?= 5
  x
""", 5

test "nullish assignment value", """
  x = 0
  x ?= 5
  x
""", 0

# Unary operators

test "unary plus", "+5", 5
test "unary minus", "-5", -5
test "typeof operator", "typeof 5", "number"
test "typeof string", "typeof 'hello'", "string"
test "delete operator", """
  obj = {a: 1}
  delete obj.a
  obj.a
""", undefined

# Ternary operator

test "ternary true", """
  true ? 1 : 2
""", 1

test "ternary false", """
  false ? 1 : 2
""", 2

test "CoffeeScript conditional", """
  if true then 1 else 2
""", 1

# Existential operator

test "existential null", """
  x = null
  x ? 5
""", 5

test "existential undefined", """
  x = undefined
  x ? 5
""", 5

test "existential value", """
  x = 0
  x ? 5
""", 0

test "soaked access", """
  obj = null
  obj?.prop
""", undefined

test "soaked call", """
  fn = null
  fn?()
""", undefined

# Range operators

test "inclusive range", """
  [1..3]
""", [1, 2, 3]

test "exclusive range", """
  [1...4]
""", [1, 2, 3]

# Splat operator

test "splat in array", """
  arr = [1, 2, 3]
  [...arr, 4]
""", [1, 2, 3, 4]

test "splat in function", """
  fn = (a, b, c) -> a + b + c
  args = [1, 2, 3]
  fn(...args)
""", 6

# Destructuring operators

test "array destructuring", """
  [a, b] = [1, 2]
  [a, b]
""", [1, 2]

test "object destructuring", """
  {x, y} = {x: 1, y: 2}
  [x, y]
""", [1, 2]

# Chained comparisons

test "chained comparison true", """
  x = 5
  1 < x < 10
""", true

test "chained comparison false", """
  x = 15
  1 < x < 10
""", false

# Operator precedence

test "precedence multiply before add", """
  2 + 3 * 4
""", 14

test "precedence with parentheses", """
  (2 + 3) * 4
""", 20

test "precedence exponent before multiply", """
  2 * 3 ** 2
""", 18

# of/in operators

test "of operator", """
  'a' of {a: 1}
""", true

test "in operator array", """
  2 in [1, 2, 3]
""", true

test "in operator array false", """
  4 in [1, 2, 3]
""", false

# instanceof operator

test "instanceof Array", """
  [] instanceof Array
""", true

test "instanceof Object", """
  {} instanceof Object
""", true

# Comma operator

test "comma operator", """
  (1, 2, 3)
""", 3


