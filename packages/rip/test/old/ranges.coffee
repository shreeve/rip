# Ranges
# ------

# Inclusive ranges

test "inclusive range", "[1..3]", [1, 2, 3]
test "inclusive range zero", "[0..2]", [0, 1, 2]
test "inclusive range negative", "[-2..0]", [-2, -1, 0]
test "inclusive range same", "[5..5]", [5]

# Exclusive ranges

test "exclusive range", "[1...4]", [1, 2, 3]
test "exclusive range zero", "[0...3]", [0, 1, 2]
test "exclusive range negative", "[-2...1]", [-2, -1, 0]
test "exclusive range same", "[5...5]", []

# Reverse ranges

test "reverse inclusive", "[3..1]", [3, 2, 1]
test "reverse exclusive", "[3...0]", [3, 2, 1]
test "reverse negative", "[0..-2]", [0, -1, -2]

# Ranges with variables

test "range with variables", """
  start = 2
  end = 5
  [start..end]
""", [2, 3, 4, 5]

test "range with expressions", """
  [1 + 1..2 * 3]
""", [2, 3, 4, 5, 6]

# Ranges by step

test "range by 2", """
  [0..10 by 2]
""", [0, 2, 4, 6, 8, 10]

test "range by 3", """
  [1..10 by 3]
""", [1, 4, 7, 10]

test "range by negative", """
  [10..0 by -2]
""", [10, 8, 6, 4, 2, 0]

test "range by variable", """
  step = 2
  [0..6 by step]
""", [0, 2, 4, 6]

# Range comprehensions

test "range comprehension", """
  (x for x in [1..3])
""", [1, 2, 3]

test "range comprehension with filter", """
  (x for x in [1..10] when x % 2 is 0)
""", [2, 4, 6, 8, 10]

test "range comprehension with transform", """
  (x * 2 for x in [1..3])
""", [2, 4, 6]

# String slicing with ranges

test "string slice inclusive", """
  'hello'[1..3]
""", 'ell'

test "string slice exclusive", """
  'hello'[1...4]
""", 'ell'

test "string slice from start", """
  'hello'[..2]
""", 'hel'

test "string slice to end", """
  'hello'[2..]
""", 'llo'

# Array slicing with ranges

test "array slice inclusive", """
  [1, 2, 3, 4, 5][1..3]
""", [2, 3, 4]

test "array slice exclusive", """
  [1, 2, 3, 4, 5][1...4]
""", [2, 3, 4]

test "array slice negative index", """
  [1, 2, 3, 4, 5][-2..]
""", [4, 5]

test "array slice reverse", """
  [1, 2, 3, 4, 5][3..1]
""", [4, 3, 2]

# Empty ranges

test "empty exclusive range", "[5...5]", []
test "empty reverse", "[1...1]", []

# Large ranges

test "large range length", """
  [1..100].length
""", 100

test "large range by step length", """
  [0..100 by 10].length
""", 11

# Character ranges (not built-in but useful pattern)

test "character code range", """
  (String.fromCharCode(i) for i in [65..67])
""", ['A', 'B', 'C']

# Range assignment

test "range assignment", """
  range = [1..3]
  range
""", [1, 2, 3]

test "range in condition", """
  x = 5
  result = if x in [1..10] then 'yes' else 'no'
  result
""", 'yes'

# Infinite-like patterns (with limits)

test "from zero", """
  [0..4]
""", [0, 1, 2, 3, 4]

test "negative to positive", """
  [-2..2]
""", [-2, -1, 0, 1, 2]

# Range with float (truncated)

test "float range", """
  [1.5..3.5]
""", [1.5, 2.5, 3.5]

# Range in switch

test "range in switch when", """
  x = 5
  result = switch
    when x in [1..3] then 'low'
    when x in [4..6] then 'mid'
    when x in [7..9] then 'high'
    else 'out'
  result
""", 'mid'

# Splicing with ranges

test "array splice with range", """
  arr = [1, 2, 3, 4, 5]
  arr[1..3] = ['a', 'b', 'c']
  arr
""", [1, 'a', 'b', 'c', 5]

test "array delete with range", """
  arr = [1, 2, 3, 4, 5]
  arr[1..3] = []
  arr
""", [1, 5]

# Range edge cases

test "backwards exclusive", """
  [5...2]
""", [5, 4, 3]

test "single element backwards", """
  [1..1]
""", [1]

# Range with unary operators

test "negative range values", """
  [-3..-1]
""", [-3, -2, -1]

test "range with calc", """
  n = 3
  [n-1..n+1]
""", [2, 3, 4]


