# Functions
# ---------

# Basic functions

test "basic function", """
  fn = -> 5
  fn()
""", 5

test "function with parameter", """
  fn = (x) -> x * 2
  fn(3)
""", 6

test "function with multiple parameters", """
  fn = (a, b) -> a + b
  fn(2, 3)
""", 5

# Arrow functions

test "fat arrow preserves this", """
  obj =
    value: 5
    thin: -> @value
    fat: => @value
  obj.value
""", 5

test "thin arrow function", """
  fn = (x) -> x + 1
  fn(5)
""", 6

# Default parameters

test "default parameter", """
  fn = (x = 5) -> x
  fn()
""", 5

test "default parameter with value", """
  fn = (x = 5) -> x
  fn(10)
""", 10

test "multiple defaults", """
  fn = (a = 1, b = 2) -> a + b
  fn()
""", 3

# Rest parameters

test "rest parameter", """
  fn = (first, rest...) -> rest
  fn(1, 2, 3, 4)
""", [2, 3, 4]

test "rest parameter only", """
  fn = (args...) -> args
  fn(1, 2, 3)
""", [1, 2, 3]

# Destructuring parameters

test "array destructuring parameter", """
  fn = ([a, b]) -> a + b
  fn([2, 3])
""", 5

test "object destructuring parameter", """
  fn = ({x, y}) -> x + y
  fn({x: 2, y: 3})
""", 5

# Function expressions

test "function expression", """
  result = ((x) -> x * 2)(5)
  result
""", 10

test "IIFE", """
  result = do -> 42
  result
""", 42

# Return values

test "implicit return", """
  fn = ->
    x = 5
    x * 2
  fn()
""", 10

test "explicit return", """
  fn = ->
    return 5
    10
  fn()
""", 5

test "empty function", """
  fn = ->
  fn()
""", undefined

# Function binding

test "bound function", """
  obj =
    value: 10
    getValue: -> @value
  fn = obj.getValue
  fn.call({value: 20})
""", 20

# Arguments object

test "arguments length", """
  fn = -> arguments.length
  fn(1, 2, 3)
""", 3

test "arguments access", """
  fn = -> arguments[1]
  fn('a', 'b', 'c')
""", 'b'

# Nested functions

test "nested function", """
  outer = ->
    inner = -> 5
    inner()
  outer()
""", 5

test "closure", """
  outer = (x) ->
    inner = -> x
    inner
  fn = outer(10)
  fn()
""", 10

# Function assignment

test "function to variable", """
  fn = -> 'hello'
  result = fn
  result()
""", 'hello'

test "function in object", """
  obj =
    method: -> 'result'
  obj.method()
""", 'result'

# Higher order functions

test "function returning function", """
  makeAdder = (x) -> (y) -> x + y
  add5 = makeAdder(5)
  add5(3)
""", 8

test "function as parameter", """
  apply = (fn, x) -> fn(x)
  double = (x) -> x * 2
  apply(double, 5)
""", 10

# Generators

test "generator function", """
  gen = ->
    yield 1
    yield 2
    yield 3
  [...gen()]
""", [1, 2, 3]

# Async functions

test "async function detection", """
  fn = -> await 1
  fn.constructor.name
""", "AsyncFunction"

# Partial application

test "partial application", """
  add = (a, b) -> a + b
  add5 = add.bind(null, 5)
  add5(3)
""", 8

# Method chaining

test "method chaining", """
  obj =
    value: 0
    add: (x) ->
      @value += x
      this
    multiply: (x) ->
      @value *= x
      this
  obj.add(5).multiply(2).value
""", 10

# Computed property methods

test "computed property method", """
  methodName = 'myMethod'
  obj =
    [methodName]: -> 'result'
  obj.myMethod()
""", 'result'


