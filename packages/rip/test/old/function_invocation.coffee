# Function Invocation
# -------------------

# Basic function calls
test 'basic function call', """
  fn = -> 42
  fn()
""", 42

test 'function call with argument', """
  fn = (x) -> x * 2
  fn(5)
""", 10

test 'function call multiple args', """
  fn = (a, b, c) -> a + b + c
  fn(1, 2, 3)
""", 6

# Optional parentheses
test 'optional parens single arg', """
  fn = (x) -> x * 2
  fn 5
""", 10

test 'optional parens multiple args', """
  fn = (a, b) -> a + b
  fn 2, 3
""", 5

# Arguments on separate lines
test 'arguments on separate lines', """
  fn = (a, b, c) -> a + b + c
  fn(
    1
    2
    3
  )
""", 6

# Method calls
test 'method call', """
  obj = {
    value: 10
    getValue: -> @value
  }
  obj.getValue()
""", 10

test 'method call with args', """
  obj = {
    add: (a, b) -> a + b
  }
  obj.add(5, 10)
""", 15

# Chained calls
test 'chained function calls', """
  fn = -> -> 42
  fn()()
""", 42

test 'chained method calls', """
  obj = {
    self: -> @
    value: 5
  }
  obj.self().self().value
""", 5

# Implicit calls
test 'implicit call with object', """
  fn = (obj) -> obj.value
  fn value: 10
""", 10

test 'implicit call nested', """
  outer = (fn) -> fn()
  outer -> 42
""", 42

# Splats in function calls
test 'splat arguments', """
  fn = (args...) -> args.length
  fn 1, 2, 3, 4, 5
""", 5

test 'splat with regular args', """
  fn = (first, rest...) -> first + rest.length
  fn 1, 2, 3, 4
""", 4

test 'splat expansion in call', """
  fn = (a, b, c) -> a + b + c
  args = [1, 2, 3]
  fn args...
""", 6

# Function calls with this/@
test '@ invocation', """
  obj = {
    fn: (x) -> x
    call: -> @fn 5
  }
  obj.call()
""", 5

test 'this invocation', """
  obj = {
    fn: (x) -> x * 2
    call: -> this.fn 3
  }
  obj.call()
""", 6

# Nested function calls
test 'nested calls', """
  add = (a) -> (b) -> a + b
  add(5)(10)
""", 15

# IIFE (Immediately Invoked Function Expression)
test 'IIFE basic', """
  (-> 42)()
""", 42

test 'IIFE with arguments', """
  ((x) -> x * 2)(5)
""", 10

test 'do notation', """
  do -> 42
""", 42

test 'do with arguments', """
  do (x = 5) -> x * 2
""", 10

# Apply and call
test 'function apply', """
  fn = (a, b) -> a + b
  fn.apply null, [2, 3]
""", 5

test 'function call method', """
  fn = (a, b) -> a + b
  fn.call null, 2, 3
""", 5

# Trailing commas
test 'trailing comma in call', """
  fn = (a, b) -> a + b
  fn(1, 2,)
""", 3

test 'trailing comma multiline', """
  fn = (a, b, c) -> a + b + c
  fn(
    1,
    2,
    3,
  )
""", 6

# Complex argument expressions
test 'expression as argument', """
  fn = (x) -> x
  fn(2 + 3)
""", 5

test 'function call as argument', """
  double = (x) -> x * 2
  triple = (x) -> x * 3
  double(triple(2))
""", 12

# Array/object method calls
test 'array method call', """
  [1, 2, 3].length
""", 3

test 'array method with args', """
  [1, 2, 3].slice(1, 2)
""", [2]

test 'string method call', """
  "hello".toUpperCase()
""", 'HELLO'

# Constructor calls
test 'constructor with new', """
  class A
    constructor: (@value) ->
  new A(42).value
""", 42

test 'constructor without parens', """
  class A
    constructor: -> @value = 10
  new A().value
""", 10

# Default parameters
test 'default parameter unused', """
  fn = (x = 10) -> x
  fn()
""", 10

test 'default parameter overridden', """
  fn = (x = 10) -> x
  fn(5)
""", 5

# Rest parameters
test 'rest parameter empty', """
  fn = (args...) -> args.length
  fn()
""", 0

test 'rest with initial', """
  fn = (first, rest...) -> rest.length
  fn(1)
""", 0

# Invalid calls should fail
fail 'leading comma in args', 'fn(,1)'
fail 'double semicolon in args', 'fn(1;;2)'
fail 'comma semicolon in args', 'fn(1;,2)'

# Advanced invocation tests
test 'destructuring in function args', """
  fn = ([a, b]) -> a + b
  fn([2, 3])
""", 5

test 'destructuring object in args', """
  fn = ({x, y}) -> x + y
  fn({x: 10, y: 20})
""", 30

test 'splats with super in classes', """
  class Parent
    meth: (args...) -> args.join('-')

  class Child extends Parent
    meth: -> super 3, 2, 1

  (new Child).meth()
""", '3-2-1'

test 'splat on number method', """
  11.toString([2]...)
""", '1011'

test 'execution context for splats', """
  contextTest = -> @ is null or @.constructor?.name is 'Object'
  array = []
  contextTest(array...)
""", true

test 'caching base value', """
  obj =
    index: 0
    0: {method: -> @val is 5}
    val: 5
  obj[obj.index++].method()
""", true

test 'implicit calls with control structures', """
  save = (x) -> x

  result = save if false
    'false'
  else
    'true'

  result
""", 'true'

test 'new with nested new', """
  nonce = {}
  obj = new new -> -> {prop: nonce}
  obj.prop is nonce
""", true

test 'accessing prototype after invocation', """
  class Test
    id: 5

  fn = -> Test
  fn()::id
""", 5

test 'improved do with parameters', """
  do (x = 5) -> x
""", 5

test 'implicit object as last argument', """
  fn = (a, obj) -> obj.b
  fn 1,
    b: 2
""", 2

test 'multiline chained calls', """
  obj =
    fn: -> obj
    val: -> 42

  obj
    .fn()
    .val()
""", 42

test 'passing multiple functions', """
  caller = (f1, f2) -> f1() + f2()
  caller (-> 1), (-> 2)
""", 3

test 'function with trailing if', """
  fn = (x) -> x * 2
  result = fn 5 if true
  result
""", 10

test 'nested implicit calls', """
  outer = (x) -> x
  inner = (y) -> y + 1
  outer inner 5
""", 6

test 'optional parens nested', """
  Math.max 1, Math.min 5, 3
""", 3

test 'method calls on parenthesized values', """
  (-> 'hello').call(null).toUpperCase()
""", 'HELLO'

test 'spread with preceding space', """
  f = (a) -> a.length
  a = [1, 2, 3]
  f(...a) is f(... a)
""", true
