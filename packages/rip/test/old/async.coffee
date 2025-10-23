# Async/Await Tests
# -----------------

# Functions that contain the `await` keyword will compile into async functions.
# Tests wrapped in `do ->` to create async context for top-level await.

test "async as argument", '''
  fn = (f) -> f.constructor.name
  fn ->
    await Promise.resolve()
''', "AsyncFunction"

test "explicit async", '''
  do ->
    await Promise.resolve(5)
''', 5

test "async functions return promises", '''
  a = ->
    await Promise.resolve(5)

  a().constructor.name
''', "Promise"

test "implicit async", '''
  winning = (val) -> Promise.resolve val

  do ->
    x = await winning(5)
    y = await winning(4)
    z = await winning(3)
    [x, y, z]
''', [5, 4, 3]

test "async return value (implicit)", '''
  winning = (val) -> Promise.resolve val

  a = ->
    x = await winning(5)
    y = await winning(4)
    z = await winning(3)
    [x, y, z]

  do ->
    await a()
''', [5, 4, 3]

test "async return value (explicit)", '''
  a = ->
    await Promise.resolve([5, 2, 3])

  do ->
    await a()
''', [5, 2, 3]

test "async parameters", '''
  a = (a, [b, c]) ->
    arr = [a]
    arr.push b
    arr.push c
    await Promise.resolve(arr)

  do ->
    await a(5, [4, 3])
''', [5, 4, 3]

test "async parameters with defaults", '''
  b = (a, b, c = 5) ->
    arr = [a]
    arr.push b
    arr.push c
    await Promise.resolve(arr)

  do ->
    await b(4, 4)
''', [4, 4, 5]

test "async this scoping - bound", '''
  obj =
    bound: ->
      return do =>
        await Promise.resolve(@)

  do ->
    bnd = await obj.bound()
    bnd is obj
''', true

test "async this scoping - unbound", '''
  obj =
    unbound: ->
      return do ->
        await Promise.resolve(@)

  do ->
    ubnd = await obj.unbound()
    ubnd isnt obj
''', true

test "async this scoping - nested", '''
  obj =
    nested: ->
      return do =>
        await do =>
          await do =>
            await Promise.resolve(@)

  do ->
    nst = await obj.nested()
    nst is obj
''', true

test "await precedence", '''
  fn = (resolve, reject) ->
    resolve(3)

  do ->
    # assert precedence between unary (new) and power (**) operators
    1 + await new Promise(fn) ** 2
''', 10

test "await inside switch", '''
  winning = (val) -> Promise.resolve val

  do ->
    x = switch 4
      when 2
        await winning(1)
      when 4
        await winning(5)
      when 7
        await winning(2)
    x
''', 5

test "await inside try/catch", '''
  winning = (val) -> Promise.resolve val

  do ->
    y = try
      throw new Error("this should be caught")
      await winning(1)
    catch e
      await winning(4)
    y
''', 4

test "await inside for loop", '''
  winning = (val) -> Promise.resolve val

  do ->
    z = for i in [0..5]
      a = i * i
      await winning(a)
    z
''', [0, 1, 4, 9, 16, 25]

test "error handling", '''
  failing = (val) -> Promise.reject new Error val

  a = ->
    try
      await failing("fail")
    catch e
      return e

  do ->
    res = await a()
    res.message
''', "fail"

test "error handling with side effect", '''
  failing = (val) -> Promise.reject new Error val

  val = 0
  a = ->
    try
      await failing("fail")
    catch e
      val = 7  # to assure the catch block runs
      return e

  do ->
    await a()
    val
''', 7

test "await expression evaluates to argument if not promise", '''
  do ->
    await 4
''', 4

test "implicit call with await", '''
  winning = (val) -> Promise.resolve val
  addOne = (arg) -> arg + 1

  do ->
    a = addOne await winning(3)
    a
''', 4

test "async static method", '''
  winning = (val) -> Promise.resolve val

  class Base
    @static: ->
      await winning(1)

  do ->
    await Base.static()
''', 1

test "async instance method", '''
  winning = (val) -> Promise.resolve val

  class Base
    method: ->
      await winning(2)

  do ->
    await new Base().method()
''', 2

test "async method inheritance", '''
  winning = (val) -> Promise.resolve val

  class Base
    @static: ->
      await winning(1)
    method: ->
      await winning(2)

  class Child extends Base
    @static: -> super()
    method: -> super()

  do ->
    s = await Child.static()
    m = await new Child().method()
    s + m
''', 3

test "await multiline implicit object", '''
  do ->
    y =
      if no then await
        type: 'a'
        msg: 'b'
    y
''', undefined

# Complex async patterns
test "parallel await with Promise.all", '''
  winning = (val) -> Promise.resolve val

  do ->
    [a, b, c] = await Promise.all([
      winning(1)
      winning(2)
      winning(3)
    ])
    a + b + c
''', 6

test "sequential await", '''
  winning = (val) -> Promise.resolve val

  do ->
    a = await winning(1)
    b = await winning(2)
    c = await winning(3)
    a + b + c
''', 6

test "await in conditional", '''
  winning = (val) -> Promise.resolve val

  do ->
    result = if await winning(true)
      await winning('yes')
    else
      await winning('no')
    result
''', 'yes'

test "await in ternary-like expression", '''
  winning = (val) -> Promise.resolve val

  do ->
    x = true
    result = if x then await winning('true') else await winning('false')
    result
''', 'true'

test "await with destructuring", '''
  winning = (val) -> Promise.resolve val

  do ->
    [a, b] = await winning([1, 2])
    {x, y} = await winning({x: 3, y: 4})
    a + b + x + y
''', 10

test "async generator function", '''
  winning = (val) -> Promise.resolve val

  gen = ->
    yield await winning(1)
    yield await winning(2)
    yield await winning(3)

  do ->
    g = gen()
    results = []
    results.push (await g.next()).value
    results.push (await g.next()).value
    results.push (await g.next()).value
    results
''', [1, 2, 3]

test "Promise.race", '''
  do ->
    delay = (ms, val) -> new Promise (r) -> setTimeout (-> r(val)), ms

    result = await Promise.race([
      delay(100, 'slow')
      delay(1, 'fast')
    ])
    result
''', 'fast'

test "async iterators", '''
  asyncIterable =
    [Symbol.asyncIterator]: ->
      i = 0
      next: ->
        if i < 3
          Promise.resolve {value: i++, done: false}
        else
          Promise.resolve {done: true}

  do ->
    results = []
    iter = asyncIterable[Symbol.asyncIterator]()
    while true
      {value, done} = await iter.next()
      break if done
      results.push value
    results
''', [0, 1, 2]

test "await in object method", '''
  winning = (val) -> Promise.resolve val

  obj =
    value: 10
    method: ->
      result = await winning(5)
      @value + result

  do ->
    await obj.method()
''', 15

test "await with spread operator", '''
  winning = (val) -> Promise.resolve val

  do ->
    arr = await winning([1, 2, 3])
    [...arr, 4]
''', [1, 2, 3, 4]

test "nested async functions", '''
  winning = (val) -> Promise.resolve val

  outer = ->
    inner = ->
      await winning('inner')

    result = await inner()
    "outer: #{result}"

  do ->
    await outer()
''', 'outer: inner'

test "async IIFE in expression", '''
  winning = (val) -> Promise.resolve val

  do ->
    x = 5
    y = await do ->
      await winning(10)
    x + y
''', 15

test "await with throw", '''
  winning = (val) -> Promise.resolve val

  do ->
    fn = ->
      throw new Error('thrown')
      await winning('never')

    try
      await fn()
      'should not reach'
    catch e
      e.message
''', 'thrown'

test "finally with async", '''
  do ->
    result = []

    fn = ->
      try
        await Promise.resolve('try')
      finally
        result.push 'finally'

    await fn()
    result
''', ['finally']

test "async class constructor alternative", '''
  winning = (val) -> Promise.resolve val

  class AsyncInit
    constructor: ->
      @ready = @init()

    init: ->
      @value = await winning(42)
      @

  do ->
    obj = new AsyncInit
    await obj.ready
    obj.value
''', 42

# Additional tests restored from original async.coffee

test "await in arithmetic", '''
  do ->
    1 + await Promise.resolve(2)
''', 3

test "await in array literal", '''
  do ->
    [await Promise.resolve(1), await Promise.resolve(2), await Promise.resolve(3)]
''', [1, 2, 3]

test "await in object literal", '''
  do ->
    obj =
      a: await Promise.resolve(1)
      b: await Promise.resolve(2)
    [obj.a, obj.b]
''', [1, 2]

test "multiple awaits in expression", '''
  do ->
    (await Promise.resolve(1)) + (await Promise.resolve(2)) + (await Promise.resolve(3))
''', 6

test "nested awaits", '''
  do ->
    await Promise.resolve(await Promise.resolve(await Promise.resolve(5)))
''', 5

test "await with existential", '''
  do ->
    a = await Promise.resolve(5)
    a ? 10
''', 5

test "await undefined", '''
  do ->
    await undefined
''', undefined

test "await null", '''
  do ->
    await null
''', null

test "await boolean", '''
  do ->
    await true
''', true

test "await in string interpolation", '''
  do ->
    x = Promise.resolve(5)
    "value: #{await x}"
''', "value: 5"

test "await with property access", '''
  do ->
    obj = {value: 42}
    (await Promise.resolve(obj)).value
''', 42

test "await with method call", '''
  do ->
    str = "hello"
    (await Promise.resolve(str)).length
''', 5

test "await with splat", '''
  do ->
    arr = [1, 2, 3]
    [...await Promise.resolve(arr)]
''', [1, 2, 3]

test "await in splat expression", '''
  do ->
    [...(await Promise.resolve([1, 2])), await Promise.resolve(3)]
''', [1, 2, 3]

test "await precedence with power", '''
  do ->
    2 ** await Promise.resolve(3)
''', 8

test "await precedence with unary", '''
  do ->
    -await Promise.resolve(5)
''', -5

test "await precedence with typeof", '''
  do ->
    typeof await Promise.resolve("string")
''', "string"

test "await in array comprehension", '''
  do ->
    (await Promise.resolve(x) for x in [1, 2, 3])
''', [1, 2, 3]

test "await in filtered comprehension", '''
  do ->
    (await Promise.resolve(x) for x in [1, 2, 3, 4, 5] when x > 2)
''', [3, 4, 5]

test "await in if condition", '''
  do ->
    if await Promise.resolve(true)
      1
    else
      2
''', 1

test "await in while condition", '''
  do ->
    count = 0
    x = 3
    while await Promise.resolve(x)
      count++
      x--
    count
''', 3

test "async arrow function", '''
  fn = -> await Promise.resolve(1)
  fn.constructor.name
''', "AsyncFunction"

test "async fat arrow function", '''
  fn = => await Promise.resolve(1)
  fn.constructor.name
''', "AsyncFunction"

test "await in function body makes it async", '''
  fn = (x) ->
    await Promise.resolve(x)
  fn.constructor.name
''', "AsyncFunction"

# Compilation tests from v28

code "top-level await in bare mode", '''
  await null
''', '''
  await null;
'''

test "top-level await requires async context", '''
  # Top-level await works because test runner wraps in do ->
  do ->
    await Promise.resolve("works")
''', "works"

code "do block with await is async", '''
  do ->
    await null
''', '''
  (async function() {
    return (await null);
  })();
'''

code "await with this in fat arrow do block", '''
  do =>
    await @value
''', '''
  (async() => {
    return (await this.value);
  })();
'''

code "bound async method preserves this", '''
  obj =
    value: 42
    method: =>
      await @value
''', '''
  var obj;

  obj = {
    value: 42,
    method: async() => {
      return (await this.value);
    }
  };
'''

# Note: .call(this) appears in non-bare mode when top-level code uses await with @
# But our test runner uses bare: yes, so we can't test that pattern directly here.
# Example that would produce .call(this) in non-bare mode:
#   await @value
# Would compile to:
#   (async function() { await this.value; }).call(this);

code "do block without await is not async", '''
  do -> 5
''', '''
  (function() {
    return 5;
  })();
'''