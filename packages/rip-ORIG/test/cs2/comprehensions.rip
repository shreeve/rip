# Comprehensions
# --------------

# Array comprehensions

test "basic array comprehension", """
  (x for x in [1, 2, 3])
""", [1, 2, 3]

test "array comprehension with transformation", """
  (x * 2 for x in [1, 2, 3])
""", [2, 4, 6]

test "array comprehension with filter", """
  (x for x in [1, 2, 3, 4, 5] when x > 2)
""", [3, 4, 5]

test "array comprehension with filter and transform", """
  (x * 2 for x in [1, 2, 3, 4, 5] when x % 2 is 0)
""", [4, 8]

# Object comprehensions

test "object comprehension values", """
  obj = {a: 1, b: 2, c: 3}
  (v for k, v of obj)
""", [1, 2, 3]

test "object comprehension keys", """
  obj = {a: 1, b: 2, c: 3}
  (k for k of obj)
""", ['a', 'b', 'c']

test "object comprehension key-value", """
  obj = {a: 1, b: 2}
  ([k, v] for k, v of obj)
""", [['a', 1], ['b', 2]]

# Range comprehensions

test "range comprehension inclusive", """
  (x for x in [1..3])
""", [1, 2, 3]

test "range comprehension exclusive", """
  (x for x in [1...4])
""", [1, 2, 3]

test "range comprehension by step", """
  (x for x in [0..10] by 2)
""", [0, 2, 4, 6, 8, 10]

# Nested comprehensions

test "nested array comprehensions", """
  (x + y for x in [1, 2] for y in [3, 4])
""", [4, 5, 5, 6]

test "nested with filter", """
  (x + y for x in [1, 2, 3] for y in [4, 5] when x + y > 5)
""", [6, 6, 7, 7, 8]

# Comprehensions with destructuring

test "comprehension with array destructuring", """
  pairs = [[1, 2], [3, 4], [5, 6]]
  (a + b for [a, b] in pairs)
""", [3, 7, 11]

test "comprehension with object destructuring", """
  items = [{x: 1, y: 2}, {x: 3, y: 4}]
  (x + y for {x, y} in items)
""", [3, 7]

# Comprehensions with splats

test "comprehension with splat", """
  arrays = [[1, 2, 3], [4, 5, 6]]
  (first for [first, rest...] in arrays)
""", [1, 4]

# String comprehensions

test "string comprehension", """
  (c.toUpperCase() for c in "abc")
""", ['A', 'B', 'C']

test "string comprehension with index", """
  (c + i for c, i in "abc")
""", ['a0', 'b1', 'c2']

# Comprehensions as expressions

test "comprehension in function call", """
  Math.max((x for x in [3, 1, 4, 1, 5])...)
""", 5

test "comprehension with postfix if", """
  result = (x for x in [1, 2, 3] when x > 1) if true
  result
""", [2, 3]

# Own properties

test "own properties iteration", """
  parent = {a: 1}
  child = Object.create(parent)
  child.b = 2
  (v for own k, v of child)
""", [2]

# Do comprehensions

test "do in comprehension", """
  fns = (do (x) -> -> x for x in [1, 2, 3])
  (fn() for fn in fns)
""", [1, 2, 3]

# While comprehensions

test "while as comprehension", """
  i = 0
  result = while i < 3
    i++
  result
""", [1, 2, 3]

test "until as comprehension", """
  i = 0
  result = until i is 3
    i++
  result
""", [1, 2, 3]

# Comprehension assignment

test "comprehension assignment", """
  arr = for x in [1, 2, 3]
    x * 2
  arr
""", [2, 4, 6]

test "comprehension multiple assignment", """
  [a, b] = (x for x in [1, 2])
  [a, b]
""", [1, 2]

# Edge cases

test "empty comprehension", """
  (x for x in [])
""", []

test "comprehension with break", """
  result = for x in [1, 2, 3, 4, 5]
    break if x is 3
    x
  result
""", [1, 2]

test "comprehension with continue", """
  result = for x in [1, 2, 3, 4, 5]
    continue if x is 3
    x
  result
""", [1, 2, 4, 5]

# Comprehensions with guards

test "multiple guards", """
  (x for x in [1, 2, 3, 4, 5, 6] when x > 2 when x < 5)
""", [3, 4]

# Index and value

test "array with index", """
  ([i, x] for x, i in ['a', 'b', 'c'])
""", [[0, 'a'], [1, 'b'], [2, 'c']]

test "object with value and key", """
  obj = {a: 1, b: 2}
  ([k, v] for k, v of obj)
""", [['a', 1], ['b', 2]]


