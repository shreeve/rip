# Object Rest and Spread
# ----------------------

# Object spread
test 'basic object spread', """
  obj1 = {a: 1, b: 2}
  obj2 = {...obj1, c: 3}
  obj2.c
""", 3

test 'object spread preserves properties', """
  obj1 = {a: 1, b: 2}
  obj2 = {...obj1}
  obj2.a + obj2.b
""", 3

test 'object spread override', """
  obj1 = {a: 1, b: 2}
  obj2 = {...obj1, a: 5}
  obj2.a
""", 5

test 'multiple object spreads', """
  obj1 = {a: 1}
  obj2 = {b: 2}
  obj3 = {...obj1, ...obj2, c: 3}
  obj3.a + obj3.b + obj3.c
""", 6

# Object rest in destructuring
test 'basic object rest', """
  obj = {a: 1, b: 2, c: 3}
  {a, rest...} = obj
  rest.b + rest.c
""", 5

test 'object rest excludes extracted', """
  obj = {a: 1, b: 2, c: 3}
  {a, rest...} = obj
  rest.a
""", undefined

test 'object rest with multiple extractions', """
  obj = {a: 1, b: 2, c: 3, d: 4}
  {a, b, rest...} = obj
  rest.c + rest.d
""", 7

# Rest with renamed properties
test 'rest with renamed property', """
  obj = {a: 1, b: 2, c: 3}
  {a: x, rest...} = obj
  x + rest.b
""", 3

# Empty rest
test 'empty object rest', """
  obj = {a: 1}
  {a, rest...} = obj
  Object.keys(rest).length
""", 0

# Nested rest
test 'nested object rest', """
  obj = {a: {x: 1, y: 2}, b: 3}
  {a: {x, nested...}, rest...} = obj
  nested.y + rest.b
""", 5

# Rest in function parameters
test 'rest in function params', """
  fn = ({a, rest...}) -> rest.b
  fn({a: 1, b: 2, c: 3})
""", 2

# Spread in object literal
test 'spread at beginning', """
  obj1 = {a: 1, b: 2}
  obj2 = {...obj1, b: 5}
  obj2.b
""", 5

test 'spread at end', """
  obj1 = {a: 1}
  obj2 = {b: 2, ...obj1}
  obj2.a
""", 1

test 'spread in middle', """
  obj1 = {b: 2}
  obj2 = {a: 1, ...obj1, c: 3}
  obj2.b
""", 2

# Conditional spread
test 'conditional spread', """
  condition = true
  obj = {...(if condition then {a: 1} else {}), b: 2}
  obj.a
""", 1

# Spread with computed properties
test 'spread with computed property', """
  key = 'dynamic'
  obj1 = {a: 1}
  obj2 = {...obj1, [key]: 2}
  obj2.dynamic
""", 2

# Rest and default values
test 'rest with defaults', """
  obj = {a: 1}
  {a, b = 5, rest...} = obj
  b
""", 5

# Object rest in arrays
test 'object rest in array destructuring', """
  arr = [{a: 1, b: 2, c: 3}]
  [{a, rest...}] = arr
  rest.b
""", 2

# Multiple rest error
fail 'multiple rest elements', '{a, r1..., r2...} = obj'

# Rest must be last
fail 'rest not last', '{rest..., a} = obj'
