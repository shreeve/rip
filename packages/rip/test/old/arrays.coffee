# Array Literals
# --------------

# * Array Literals
# * Splats in Array Literals

# Trailing commas
test "trailing comma simple", "[1, 2, 3,].length", 3
test "trailing comma access", "[1, 2, 3,][2]", 3

test "trailing comma multiline", """
  trailingComma = [
    1, 2, 3,
    4, 5, 6
    7, 8, 9,
  ]
  trailingComma.length
""", 9

test "trailing comma sum", """
  trailingComma = [
    1, 2, 3,
    4, 5, 6
    7, 8, 9,
  ]
  sum = 0
  sum = (sum or 0) + n for n in trailingComma
  sum
""", 45

test "array with functions", """
  a = [((x) -> x), ((x) -> x * x)]
  a.length
""", 2

# Incorrect indentation without commas
test "array mixed indentation", """
  result = [['a']
   {b: 'c'}]
  result[0][0]
""", 'a'

test "array mixed indentation object", """
  result = [['a']
   {b: 'c'}]
  result[1]['b']
""", 'c'

# Elisions
test "elision at start", "[,1].length", 2
test "elision multiple", "[,,1,2,,].length", 5

test "elision with assignment", """
  arr = [1,,2]
  arr.length
""", 3

test "elision undefined check", """
  arr = [1,,2]
  arr[1]
""", undefined

test "elision only", "[,,].length", 2

# Array elisions indentation and commas
test "complex elisions", """
  arr1 = [
    , 1, 2, , , 3,
    4, 5, 6
    , , 8, 9,
  ]
  arr1.length
""", 12

test "complex elisions access", """
  arr1 = [
    , 1, 2, , , 3,
    4, 5, 6
    , , 8, 9,
  ]
  arr1[5]
""", 3

test "complex elisions undefined", """
  arr1 = [
    , 1, 2, , , 3,
    4, 5, 6
    , , 8, 9,
  ]
  arr1[9]
""", undefined

# Elisions in destructuring
test "elision destructuring simple", """
  arr = [1,2,3,4,5,6,7,8,9]
  [,a] = arr
  a
""", 2

test "elision destructuring skip three", """
  arr = [1,2,3,4,5,6,7,8,9]
  [,,,b] = arr
  b
""", 4

test "elision destructuring multiple", """
  arr = [1,2,3,4,5,6,7,8,9]
  [,a,,b,,c,,,d] = arr
  [a,b,c,d]
""", [2,4,6,9]

test "elision destructuring multiline", """
  arr = [1,2,3,4,5,6,7,8,9]
  [
    ,e,
    ,f,
    ,g,
    ,,h] = arr
  [e,f,g,h]
""", [2,4,6,9]

# Elisions with splats
test "elision with splat", """
  arr = [1,2,3,4,5,6,7,8,9]
  [,a,,,b...] = arr
  [a,b]
""", [2,[5,6,7,8,9]]

test "elision with middle splat", """
  arr = [1,2,3,4,5,6,7,8,9]
  [,c,...,,d,,e] = arr
  [c,d,e]
""", [2,7,9]

test "elision with leading splat", """
  arr = [1,2,3,4,5,6,7,8,9]
  [...,f,,,g,,,] = arr
  [f,g]
""", [4,7]

# Elisions as function parameters
test "elision in function param", """
  arr = [1,2,3,4,5,6,7,8,9]
  foo = ([,a]) -> a
  foo arr
""", 2

test "elision in function skip three", """
  arr = [1,2,3,4,5,6,7,8,9]
  foo = ([,,,a]) -> a
  foo arr
""", 4

test "elision in function multiple", """
  arr = [1,2,3,4,5,6,7,8,9]
  foo = ([,a,,b,,c,,,d]) -> [a,b,c,d]
  foo arr
""", [2,4,6,9]

# Nested destructuring with elisions
test "elision nested array", """
  arr = [
    1,
    [2,3, [4,5,6, [7,8,9] ] ]
  ]
  [,a] = arr
  a[2][3]
""", [7,8,9]

test "elision nested deep", """
  arr = [
    1,
    [2,3, [4,5,6, [7,8,9] ] ]
  ]
  [,[,,[,b,,[,,c]]]] = arr
  [b, c]
""", [5, 9]

test "elision nested object", """
  aobj = [
    {},
    {x: 2},
    {},
    [
      {},
      {},
      {z:1, w:[1,2,4], p:3, q:4}
      {},
      {}
    ]
  ]
  [,d,,[,,{w}]] = aobj
  [d.x, w]
""", [2, [1,2,4]]

# #5112: array elisions not detected inside strings
test "elision in string interpolation", """
  arr = [
    str: ", \#{3}"
  ]
  arr[0].str
""", ', 3'

# Splats in Array Literals
test "array splat with assignments", """
  nums = [1, 2, 3]
  list = [a = 0, nums..., b = 4]
  [a, b, list]
""", [0, 4, [0,1,2,3,4]]

# Mixed shorthand objects in array lists
test "mixed shorthand objects", """
  arr = [
    a:1
    'b'
    c:1
  ]
  arr.length
""", 3

test "mixed shorthand object access", """
  arr = [
    a:1
    'b'
    c:1
  ]
  arr[2].c
""", 1

test "shorthand with values", """
  arr = [b: 1, a: 2, 100]
  arr[1]
""", 100

test "shorthand with expression", """
  arr = [a:0, b:1, (1 + 1)]
  arr[1]
""", 2

test "shorthand mixed types", """
  arr = [a:1, 'a', b:1, 'b']
  [arr.length, arr[2].b, arr[3]]
""", [4, 1, 'b']

# Array splats with nested arrays
test "splat with nested array", """
  nonce = {}
  a = [nonce]
  list = [1, 2, a...]
  [list[0], list[2] is nonce]
""", [1, true]

test "splat with double nested", """
  nonce = {}
  a = [[nonce]]
  list = [1, 2, a...]
  [list.length, Array.isArray(list[2]), list[2][0] is nonce]
""", [3, true, true]

# #4260: splat after existential operator soak
test "splat after existential", """
  a = {b: [3]}
  [a?.b...]
""", [3]

test "splat existential with default", """
  c = null
  [c?.b ? []...]
""", []

test "splat before existential", """
  a = {b: [3]}
  [...a?.b]
""", [3]

test "splat before existential default", """
  c = null
  [...c?.b ? []]
""", []

test "splat existential in function", """
  a = {b: [3]}
  foo = (a) -> [a]
  foo(a?.b...)
""", [3]

test "splat existential in function spread", """
  a = {b: [3]}
  foo = (a) -> [a]
  foo(...a?.b)
""", [3]

test "conditional splat true", """
  a = {b: [3]}
  e = yes
  [(a if e)?.b...]
""", [3]

test "conditional splat false", """
  a = {b: [3]}
  f = null
  [(a if f)?.b ? []...]
""", []

# #1349: trailing if after splat
test "trailing if splat", """
  a = [3]
  b = yes
  [a if b...]
""", [3]

test "trailing if splat false", """
  a = [3]
  c = null
  [(a if c) ? []...]
""", []

test "trailing if spread", """
  a = [3]
  b = yes
  [...a if b]
""", [3]

# #1274: `[] = a()` compiles to `false` instead of `a()`
test "empty destructuring executes", """
  a = false
  fn = -> a = true
  [] = fn()
  a
""", true

# #3194: string interpolation in array
test "string in array", """
  arr = [ "a"
          key: 'value'
        ]
  arr.length
""", 2

test "string interpolation in array", """
  b = 'b'
  arr = [ "a\#{b}"
          key: 'value'
        ]
  [arr[0], arr[1].key]
""", ['ab', 'value']

# Regex interpolation in array
test "regex in array", """
  arr = [ /a/
          key: 'value'
        ]
  [arr.length, arr[0].source, arr[1].key]
""", [2, 'a', 'value']

test "regex interpolation in array", """
  b = 'b'
  arr = [ ///a\#{b}///
          key: 'value'
        ]
  [arr.length, arr[0].source, arr[1].key]
""", [2, 'ab', 'value']

# Splat extraction from generators
test "generator splat", """
  gen = ->
    yield 1
    yield 2
    yield 3
  [ gen()... ]
""", [1, 2, 3]

# For-from loops over Array
test "for-from simple", """
  array1 = [50, 30, 70, 20]
  array2 = []
  for x from array1
    array2.push(x)
  array2
""", [50, 30, 70, 20]

test "for-from destructuring", """
  array1 = [[20, 30], [40, 50]]
  array2 = []
  for [a, b] from array1
    array2.push(b)
    array2.push(a)
  array2
""", [30, 20, 50, 40]

test "for-from object destructuring", """
  array1 = [{a: 10, b: 20, c: 30}, {a: 40, b: 50, c: 60}]
  array2 = []
  for {a: a, b, c: d} from array1
    array2.push([a, b, d])
  array2
""", [[10, 20, 30], [40, 50, 60]]

test "for-from splat destructuring", """
  array1 = [[10, 20, 30, 40, 50]]
  result = null
  for [a, b..., c] from array1
    result = [a, b, c]
  result
""", [10, [20, 30, 40], 50]

# For-from comprehensions over Array
test "for-from comprehension", """
  (x + 10 for x from [10, 20, 30])
""", [20, 30, 40]

test "for-from comprehension with condition", """
  (x for x from [30, 41, 57] when x %% 3 is 0)
""", [30, 57]

test "for-from comprehension destructuring", """
  (b + 5 for [a, b] from [[20, 30], [40, 50]])
""", [35, 55]

test "for-from comprehension with filter", """
  (a + b for [a, b] from [[10, 20], [30, 40], [50, 60]] when a + b >= 70)
""", [70, 110]

# #5201: simple indented elisions
test "indented elisions", """
  arr1 = [
    ,
    1,
    2,
    ,
    ,
    3,
    4,
    5,
    6
    ,
    ,
    8,
    9,
  ]
  [arr1.length, arr1[5], arr1[9]]
""", [12, 3, undefined]

test "indented elisions 2", """
  arr2 = [
    ,
    ,
    1,
    2,
    ,
    3,
    ,
    4,
    5
    6
    ,
    ,
    ,
  ]
  [arr2.length, arr2[8], arr2[1]]
""", [12, 5, undefined]

test "only indented elisions", """
  arr3 = [
    ,
    ,
    ,
  ]
  arr3.length
""", 3

test "inline elisions only", """
  arr4 = [, , ,]
  arr4.length
""", 3
