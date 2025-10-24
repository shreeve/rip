# Control Flow
# ------------

# If/Else statements

test "basic if statement", """
  result = if true
    'yes'
  result
""", 'yes'

test "if else statement", """
  x = false
  result = if x
    'yes'
  else
    'no'
  result
""", 'no'

test "if elsif else", """
  x = 2
  result = if x is 1
    'one'
  else if x is 2
    'two'
  else
    'other'
  result
""", 'two'

# Unless statements

test "unless statement", """
  result = unless false
    'yes'
  result
""", 'yes'

test "unless else statement", """
  result = unless true
    'no'
  else
    'yes'
  result
""", 'yes'

# Postfix conditions

test "postfix if", """
  result = 'yes' if true
  result
""", 'yes'

test "postfix unless", """
  result = 'yes' unless false
  result
""", 'yes'

test "postfix if false", """
  result = undefined
  result = 'yes' if false
  result
""", undefined

# Ternary expressions

test "ternary expression", """
  x = true
  result = if x then 'yes' else 'no'
  result
""", 'yes'

test "nested ternary", """
  x = 2
  result = if x is 1 then 'one' else if x is 2 then 'two' else 'other'
  result
""", 'two'

# Switch statements

test "switch statement", """
  x = 2
  result = switch x
    when 1 then 'one'
    when 2 then 'two'
    else 'other'
  result
""", 'two'

test "switch with multiple cases", """
  x = 'b'
  result = switch x
    when 'a', 'b' then 'first'
    when 'c' then 'second'
    else 'other'
  result
""", 'first'

test "switch with break", """
  x = 1
  result = switch x
    when 1
      y = 'one'
      break
    when 2
      y = 'two'
  y
""", 'one'

# While loops

test "while loop", """
  i = 0
  sum = 0
  while i < 3
    sum += i
    i++
  sum
""", 3

test "while loop with break", """
  i = 0
  while i < 10
    break if i is 3
    i++
  i
""", 3

test "while loop with continue", """
  i = 0
  sum = 0
  while i < 5
    i++
    continue if i is 3
    sum += i
  sum
""", 12

# Until loops

test "until loop", """
  i = 0
  until i is 3
    i++
  i
""", 3

test "until with condition", """
  x = 5
  until x < 0
    x--
  x
""", -1

# For loops

test "for in loop", """
  sum = 0
  for x in [1, 2, 3]
    sum += x
  sum
""", 6

test "for of loop", """
  obj = {a: 1, b: 2}
  sum = 0
  for key, val of obj
    sum += val
  sum
""", 3

test "for in with index", """
  result = []
  for val, i in ['a', 'b']
    result.push [i, val]
  result
""", [[0, 'a'], [1, 'b']]

# Loop control

test "loop with break", """
  i = 0
  loop
    i++
    break if i is 5
  i
""", 5

test "nested loops with break", """
  count = 0
  for i in [1, 2, 3]
    for j in [1, 2, 3]
      count++
      break if j is 2
  count
""", 6

# Try/Catch/Finally

test "try catch", """
  result = try
    throw new Error('test')
  catch e
    'caught'
  result
""", 'caught'

test "try catch finally", """
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

test "try without error", """
  result = try
    'success'
  catch e
    'error'
  result
""", 'success'

# Return statements

test "early return", """
  fn = ->
    return 5
    10
  fn()
""", 5

test "conditional return", """
  fn = (x) ->
    return 'negative' if x < 0
    return 'zero' if x is 0
    'positive'
  fn(-1)
""", 'negative'

# Do expressions

test "do expression", """
  result = do ->
    x = 5
    y = 10
    x + y
  result
""", 15

test "do with parameters", """
  result = do (x = 5) ->
    x * 2
  result
""", 10

# Existential operator

test "existential operator", """
  x = null
  result = x ? 'default'
  result
""", 'default'

test "existential with value", """
  x = 'value'
  result = x ? 'default'
  result
""", 'value'

# Soaked operations

test "soaked property access", """
  obj = null
  result = obj?.property
  result
""", undefined

test "soaked method call", """
  obj = null
  result = obj?.method?()
  result
""", undefined

# Chained comparisons

test "chained comparisons", """
  x = 5
  result = 1 < x < 10
  result
""", true

test "chained equality", """
  x = y = z = 5
  result = x is y is z is 5
  result
""", true

# Control flow edge cases
test "switch without condition", """
  switch
    when false then 'no'
    when [] instanceof Array then 'yes'
    else 'maybe'
""", 'yes'

test "switch with @ property", """
  obj =
    num: 5
    test: ->
      switch @num
        when 5 then 'five'
        else 'other'
  obj.test()
""", 'five'

test "switch with break as loop return", """
  i = 5
  results = while i > 0
    i--
    switch i % 2
      when 1 then i
      when 0 then break

  results.join(',')
""", '3,1'

test "throw as expression", """
  try
    false or throw 'error'
  catch e
    e
""", 'error'

test "single line try catch", """
  (-> try throw 'up' catch then 'caught')()
""", 'caught'

test "single line try finally", """
  (-> try 'ok' finally 'done')()
""", 'ok'

test "super in for loop", """
  class Foo
    sum: 0
    add: (val) -> @sum += val

  class Bar extends Foo
    add: (vals...) ->
      super val for val in vals
      @sum

  (new Bar).add 2, 3, 5
""", 10

test "break at top level", """
  result = 0
  for i in [1, 2, 3]
    result = i
    if i == 2
      break
  result
""", 2

test "nested if then else chains", """
  a = b = true
  result = if a
    if b
      'both'
    else
      'a'
  else if b
    'b'
  else
    'none'

  result
""", 'both'

test "unless with multiple conditions", """
  x = 5
  result = unless x < 3 or x > 7
    'in range'
  else
    'out of range'

  result
""", 'in range'

test "conditional assignment in while", """
  i = 0
  arr = []
  while val = i++
    arr.push val
    break if val >= 3

  arr.join(',')
""", '1,2,3'

test "postfix conditional with complex expression", """
  fn = -> true
  result = 'yes' if fn() and true
  result
""", 'yes'

test "switch fallthrough prevention", """
  val = 0
  switch true
    when true
      if false
        val = 5
    else
      val = 10

  val
""", 0

test "loop with continue", """
  result = []
  for i in [1..5]
    continue if i % 2 == 0
    result.push i

  result.join(',')
""", '1,3,5'

test "while over continue", """
  i = 0
  result = []
  while i++ < 5
    continue if i == 2
    result.push i

  result.join(',')
""", '1,3,4,5'

test "empty while body", """
  i = 0
  while i++ < 3 then
  i
""", 4

test "if inside while condition", """
  i = 0
  while if i++ < 3 then true else false
    i
  i
""", 4

test "try with implicit call", """
  fn = (x) -> x
  result = fn try
    'success'
  catch
    'failed'

  result
""", 'success'

test "complex ternary nesting", """
  a = true
  b = false
  c = true

  result = if a then (if b then 1 else 2) else (if c then 3 else 4)
  result
""", 2

test "for loop with object destructuring", """
  items = [{a: 1}, {a: 2}, {a: 3}]
  sum = 0
  for {a} in items
    sum += a
  sum
""", 6
