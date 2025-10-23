# Scope
# -----

# Variable safety and scoping
test 'arguments in functions', """
  fn = ->
    sum = 0
    sum += arg for arg in arguments
    sum
  fn(1, 2, 3, 4)
""", 10

test 'variable shadowing', """
  x = 10
  fn = (x) -> x = 20
  fn(5)
  x
""", 10

test 'nested function scope', """
  outer = 5
  fn = ->
    inner = 10
    -> outer + inner
  fn()()
""", 15

# Loop variables
test 'for loop variable accessible after', """
  for x in [1, 2, 3]
    x
  x
""", 3

test 'for-of loop variable', """
  for key of {a: 1}
    key
  key
""", 'a'

test 'for-from loop variable', """
  for x from [1, 2]
    x
  x
""", 2

# Do blocks (auto-closure)
test 'do block basic', """
  x = 5
  do -> x = 10
  x
""", 5

test 'do block with parameter', """
  x = 5
  do (x = 10) -> x
""", 10

test 'do in loop', """
  fns = []
  for i in [0..2]
    do (i) ->
      fns.push -> i
  fns[1]()
""", 1

# Catch scope
test 'catch variable scope', """
  e = 'outer'
  try
    throw 'error'
  catch e
    e
  e
""", 'outer'

test 'catch variable accessible in catch', """
  result = null
  try
    throw 'error'
  catch e
    result = e
  result
""", 'error'

# This/@ parameters
test '@ parameter', """
  fn = (@value) ->
  obj = {}
  fn.call(obj, 42)
  obj.value
""", 42

test 'splat @ parameter', """
  fn = (@values...) -> @values
  fn.call({}, 1, 2, 3)
""", [1, 2, 3]

# Closure scope
test 'closure captures variables', """
  x = 10
  fn = -> -> x
  inner = fn()
  x = 20
  inner()
""", 20

test 'nested closures', """
  x = 1
  fn1 = ->
    x = 2
    fn2 = ->
      x = 3
      -> x
    fn2()
  fn1()()
""", 3

# Global scope protection
test 'no global leak from function', """
  do ->
    localVar = 10
  typeof localVar
""", 'undefined'

test 'explicit global access', """
  global.testGlobal = 'test'
  global.testGlobal
""", 'test'

# Super with scoping
test 'super in fat arrow', """
  class A
    getValue: -> 10

  class B extends A
    getValue: => super()

  new B().getValue()
""", 10

test 'super in closure', """
  class A
    getValue: -> 5

  class B extends A
    getValue: ->
      fn = => super()
      fn()

  new B().getValue()
""", 5

# Destructuring scope
test 'destructuring parameters', """
  fn = ({a}, [b]) ->
    a + b
  fn({a: 1}, [2])
""", 3

test 'destructuring @ params', """
  fn = ({@x}) ->
  obj = {}
  fn.call(obj, {x: 5})
  obj.x
""", 5

# Variable hoisting
test 'function hoisting', """
  result = fn()
  fn = -> 42
  result
""", 42

test 'var declaration hoisting', """
  if false
    x = 10
  x
""", undefined

# Lexical this binding
test 'fat arrow preserves this', """
  obj =
    value: 42
    getFn: -> => @value
  fn = obj.getFn()
  fn()
""", 42

test 'thin arrow dynamic this', """
  obj =
    value: 42
    getFn: -> -> @value
  fn = obj.getFn()
  fn.call({value: 100})
""", 100

# Block scope with let/const behavior
test 'variable reassignment', """
  x = 1
  do ->
    x = 2
  x
""", 2

test 'parameter reassignment', """
  fn = (x) ->
    x = 10
    x
  fn(5)
""", 10
