# Soaks (Existential Operators)
# -----------------------------

# Soaked property access
test 'basic soaked property', """
  obj = {a: {b: 5}}
  obj?.a.b
""", 5

test 'soaked property on null', """
  obj = null
  obj?.a
""", undefined

test 'soaked property on undefined', """
  obj = undefined
  obj?.a
""", undefined

test 'nested soaked properties', """
  obj = {a: {b: {c: 10}}}
  obj?.a?.b?.c
""", 10

test 'soaked chain breaks', """
  obj = {a: null}
  obj?.a?.b?.c
""", undefined

test 'soaked bracket notation', """
  obj = {a: {b: 5}}
  obj?['a']['b']
""", 5

test 'mixed soaked access', """
  obj = {a: {b: 5}}
  obj?.a?['b']
""", 5

# Soaked method invocation
test 'soaked method call', """
  obj = {fn: -> 42}
  obj?.fn()
""", 42

test 'soaked method on null', """
  obj = null
  obj?.fn()
""", undefined

test 'nested soaked methods', """
  obj = {
    a: -> {
      b: -> 10
    }
  }
  obj?.a()?.b()
""", 10

test 'soaked method chain', """
  obj = {
    self: -> @
    value: 5
  }
  obj?.self()?.self()?.value
""", 5

# Soaked function invocation
test 'soaked function call', """
  fn = -> 42
  fn?()
""", 42

test 'soaked null function', """
  fn = null
  fn?()
""", undefined

test 'soaked undefined function', """
  fn = undefined
  fn?()
""", undefined

test 'soaked function with args', """
  fn = (a, b) -> a + b
  fn?(2, 3)
""", 5

# Soaked constructor
test 'soaked constructor', """
  +new Number?(42)
""", 42

test 'soaked missing constructor', """
  new NonExistent?()
""", undefined

# Soaked with operations
test 'soaked addition', """
  obj = {a: {b: 5}}
  obj?.a.b + 10
""", 15

test 'soaked on null addition', """
  obj = null
  result = obj?.a + 1
  isNaN(result)
""", true

# Soaked assignment
test 'soaked assignment', """
  obj = {a: {}}
  obj?.a.b = 5
  obj.a.b
""", 5

test 'soaked assignment on null', """
  obj = null
  obj?.a = 5
""", undefined

# Postfix existential with soak
test 'postfix with soak', """
  obj = null
  obj?.property?
""", false

test 'postfix with soak exists', """
  obj = {property: 5}
  obj?.property?
""", true

# Soaked in conditionals
test 'soaked in if', """
  obj = null
  if obj?.prop then 'yes' else 'no'
""", 'no'

test 'soaked in ternary', """
  obj = {prop: true}
  if obj?.prop then 'yes' else 'no'
""", 'yes'

# Compound soaked operations
test 'soaked increment', """
  obj = {a: {b: 5}}
  ++obj?.a.b
""", 6

test 'soaked increment on null', """
  obj = null
  ++obj?.a
""", undefined

test 'soaked compound assignment', """
  obj = {a: {b: 5}}
  obj?.a.b += 10
""", 15

test 'soaked delete', """
  obj = {a: {b: 5}}
  delete obj?.a.b
""", true

test 'soaked delete on null', """
  obj = null
  delete obj?.a
""", undefined

# Caching in soaked chains
test 'soaked caches calls', """
  counter = 0
  fn = ->
    counter++
    {value: 10}
  fn()?.value
  counter
""", 1

# Soaked with arrays
test 'soaked array access', """
  arr = [1, 2, 3]
  arr?[1]
""", 2

test 'soaked null array', """
  arr = null
  arr?[0]
""", undefined

test 'soaked array method', """
  arr = [1, 2, 3]
  arr?.length
""", 3

# Soaked with or assignment
test 'soaked or assignment', """
  obj = {a: null}
  obj?.a or= 5
  obj.a
""", 5

test 'soaked nullish assignment', """
  obj = {a: null}
  obj?.a ?= 10
  obj.a
""", 10

# Complex soaked expressions
test 'soaked in function arg', """
  fn = (x) -> x
  obj = null
  fn(obj?.prop)
""", undefined

test 'soaked property of function result', """
  fn = -> {value: 42}
  fn()?.value
""", 42

test 'soaked with spread', """
  obj = {fn: (args...) -> args.length}
  obj?.fn(1, 2, 3)
""", 3

# Edge cases
test 'soaked on zero', """
  (0)?()
""", undefined

test 'soaked on false', """
  (false)?()
""", undefined

test 'soaked on empty string', """
  ('')?()
""", undefined
