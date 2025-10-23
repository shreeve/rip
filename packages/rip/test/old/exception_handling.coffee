# Exception Handling
# ------------------

# Try/Catch basics

test "try catch basic", """
  try
    throw new Error('test')
    'not reached'
  catch e
    'caught'
""", 'caught'

test "try without error", """
  try
    'success'
  catch e
    'error'
""", 'success'

test "catch error message", """
  try
    throw new Error('my message')
  catch e
    e.message
""", 'my message'

# Finally block

test "try finally without error", """
  result = []
  try
    result.push 'try'
  finally
    result.push 'finally'
  result
""", ['try', 'finally']

test "try finally with error", """
  result = []
  try
    result.push 'try'
    throw new Error('test')
  catch e
    result.push 'catch'
  finally
    result.push 'finally'
  result
""", ['try', 'catch', 'finally']

test "finally always runs", """
  result = []
  fn = ->
    try
      result.push 'try'
      return 'early'
    finally
      result.push 'finally'
  fn()
  result
""", ['try', 'finally']

# Error types

test "throw string", """
  try
    throw 'string error'
  catch e
    e
""", 'string error'

test "throw number", """
  try
    throw 42
  catch e
    e
""", 42

test "throw object", """
  try
    throw {code: 'ERR'}
  catch e
    e.code
""", 'ERR'

# Custom errors

test "custom error class", """
  class CustomError extends Error
    constructor: (@code) ->
      super('Custom error')

  try
    throw new CustomError('E001')
  catch e
    e.code
""", 'E001'

# Nested try/catch

test "nested try catch", """
  try
    try
      throw new Error('inner')
    catch e
      throw new Error('outer')
  catch e
    e.message
""", 'outer'

# Try as expression

test "try as expression", """
  result = try
    10 / 2
  catch e
    0
  result
""", 5

test "try as expression with error", """
  result = try
    throw new Error('test')
    10
  catch e
    0
  result
""", 0

# Re-throwing errors

test "re-throw error", """
  try
    try
      throw new Error('original')
    catch e
      throw e
  catch e
    e.message
""", 'original'

# Error handling in functions

test "function with try", """
  fn = ->
    try
      throw new Error('test')
    catch e
      'handled'
  fn()
""", 'handled'

test "async function error", """
  fn = ->
    try
      await throw new Error('test')
    catch e
      'caught'
  # Just test that it compiles
  typeof fn
""", 'function'

# Error stack

test "error has stack", """
  try
    throw new Error('test')
  catch e
    typeof e.stack
""", 'string'

# Conditional catch

test "conditional error handling", """
  try
    throw {type: 'custom', value: 42}
  catch e
    if e.type is 'custom'
      e.value
    else
      0
""", 42

# Try without catch

test "try finally without catch", """
  result = null
  try
    result = 'set'
  finally
    # cleanup
  result
""", 'set'

# Error in finally

test "error in finally", """
  try
    try
      'original'
    finally
      throw new Error('finally error')
  catch e
    e.message
""", 'finally error'

# Assert-like patterns

test "assertion pattern", """
  assert = (condition, message) ->
    throw new Error(message) unless condition

  try
    assert(false, 'Assertion failed')
    'not reached'
  catch e
    e.message
""", 'Assertion failed'

# Error handling with destructuring

test "destructure error", """
  try
    error = {code: 'E001', message: 'Test error'}
    throw error
  catch {code, message}
    [code, message]
""", ['E001', 'Test error']

# Safe property access in catch

test "safe access in catch", """
  try
    throw null
  catch e
    e?.message ? 'no message'
""", 'no message'

# Multiple error types

test "handle different errors", """
  handleError = (type) ->
    try
      switch type
        when 'type1' then throw new TypeError()
        when 'type2' then throw new RangeError()
        else throw new Error()
    catch e
      e.constructor.name

  handleError('type1')
""", 'TypeError'


