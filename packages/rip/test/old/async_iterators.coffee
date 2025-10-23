# Async Iterator Tests
# --------------------

# Note: These test compilation of async iterator syntax
# Runtime behavior would require Promise support in test runner

# Basic async iteration syntax

code "async for-from loop", """
  for await x from iterable
    x
""", """
  var x;

  for await (x of iterable) {
    x;
  }
"""

code "async for-from with destructuring", """
  for await [a, b] from iterable
    a + b
""", """
  var a, b;

  for await ([a, b] of iterable) {
    a + b;
  }
"""

# Async generator functions

test "async generator detection", """
  foo = ->
    yield await 1
  foo.constructor.name
""", "AsyncGeneratorFunction"

test "async generator with multiple yields", """
  fn = ->
    yield await 1
    yield await 2
    yield 3
  fn.constructor.name
""", "AsyncGeneratorFunction"

# Async comprehensions

code "async comprehension", """
  (x for await x from asyncIterable)
""", """
  var x;

  (async function*() {
    for await (x of asyncIterable) {
      yield x;
    }
  }).call(this);
"""

code "async comprehension with filter", """
  (x for await x from asyncIterable when x > 5)
""", """
  var x;

  (async function*() {
    for await (x of asyncIterable) {
      if (x > 5) {
        yield x;
      }
    }
  }).call(this);
"""

code "async comprehension with mapping", """
  (x * 2 for await x from asyncIterable)
""", """
  var x;

  (async function*() {
    for await (x of asyncIterable) {
      yield x * 2;
    }
  }).call(this);
"""

# Nested async iterations

code "nested async for loops", """
  for await x from iter1
    for await y from iter2
      [x, y]
""", """
  var x, y;

  for await (x of iter1) {
    for await (y of iter2) {
      [x, y];
    }
  }
"""

# Async iteration with destructuring

code "async iteration with object destructuring", """
  for await {a, b} from iterable
    a + b
""", """
  var a, b;

  for await ({a, b} of iterable) {
    a + b;
  }
"""

code "async iteration with nested destructuring", """
  for await {x: [a, b]} from iterable
    [a, b]
""", """
  var a, b;

  for await ({
    x: [a, b]
  } of iterable) {
    [a, b];
  }
"""

# Async iteration in functions

test "async iteration makes function async", """
  fn = ->
    for await x from iterable
      x
  fn.constructor.name
""", "AsyncFunction"

test "async generator from regular function", """
  fn = ->
    yield 1
    yield 2
  fn.constructor.name
""", "GeneratorFunction"

# Edge cases

code "async for with break", """
  for await x from iterable
    break if x > 10
    x
""", """
  var x;

  for await (x of iterable) {
    if (x > 10) {
      break;
    }
    x;
  }
"""

code "async for with continue", """
  for await x from iterable
    continue if x < 5
    x
""", """
  var x;

  for await (x of iterable) {
    if (x < 5) {
      continue;
    }
    x;
  }
"""

# Async generator delegation

code "async yield delegation", """
  fn = ->
    yield from await asyncGen()
""", """
  var fn;

  fn = async function*() {
    return (yield* (await asyncGen()));
  };
"""

# Complex async iteration patterns

code "async for with index", """
  for await x, i from iterable
    [x, i]
""", """
  var i, x;

  for await ([x, i] of iterable) {
    [x, i];
  }
"""

test "async iteration with splat", """
  fn = ->
    for await [first, rest...] from iterable
      rest
  fn.constructor.name
""", "AsyncFunction"


