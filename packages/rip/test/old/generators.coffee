# Generators
# ----------

# Basic generator support
test 'generator function detection', """
  gen = -> yield
  gen.constructor.name
""", 'GeneratorFunction'

# Simple generator
test 'simple generator first value', """
  gen = ->
    yield 1
    yield 2
    yield 3
  g = gen()
  g.next().value
""", 1

test 'simple generator sequence', """
  gen = ->
    yield 1
    yield 2
    yield 3
  g = gen()
  values = []
  values.push g.next().value
  values.push g.next().value
  values.push g.next().value
  values
""", [1,2,3]

# Generator with return
test 'generator with return', """
  gen = ->
    yield 1
    return 2
  g = gen()
  g.next()
  g.next().value
""", 2

# yield in expressions
test 'yield in if statement', """
  gen = ->
    result = if yield 1 then 'yes' else 'no'
    result
  g = gen()
  g.next()
  g.next(true).value
""", 'yes'

# yield with no value
test 'yield undefined', """
  gen = ->
    yield
  g = gen()
  g.next().value
""", undefined

# Generator in for loop
test 'generator in for loop', """
  gen = ->
    for i in [1,2,3]
      yield i * 2
  g = gen()
  values = []
  values.push g.next().value
  values.push g.next().value
  values.push g.next().value
  values
""", [2,4,6]

# yield from
test 'yield from generator', """
  gen1 = ->
    yield 1
    yield 2
  gen2 = ->
    yield from gen1()
    yield 3
  g = gen2()
  values = []
  values.push g.next().value
  values.push g.next().value
  values.push g.next().value
  values
""", [1,2,3]

# Generator comprehension
test 'generator comprehension', """
  gen = ->
    yield i for i in [1,2,3]
  g = gen()
  g.next()
  g.next()
  g.next().value
""", [undefined, undefined, undefined]

# Generator with done flag
test 'generator done flag', """
  gen = ->
    yield 1
  g = gen()
  g.next()
  g.next().done
""", true

# Generator function expression
test 'generator function expression', """
  gen = -> yield 42
  g = gen()
  g.next().value
""", 42

# Nested generators
test 'nested generators', """
  outer = ->
    inner = ->
      yield 1
      yield 2
    g = inner()
    yield g.next().value
    yield g.next().value
  o = outer()
  values = []
  values.push o.next().value
  values.push o.next().value
  values
""", [1,2]
