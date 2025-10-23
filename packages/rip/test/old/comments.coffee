# Comments
# --------

# Comments in objects

test "comments in objects", """
  obj = {
  # comment
    one: 1
  # comment
    two: 2
  }
  [obj.one, obj.two]
""", [1, 2]

test "comments in YAML-style objects", """
  obj =
  # comment
    three: 3
  # comment
    four: 4
  [obj.three, obj.four]
""", [3, 4]

# Comments with operators

test "comments following operators", """
  sum =
    1 +
    1 + # comment
    1
  sum
""", 3

test "comments in arithmetic", """
  result =
    5 * # comment
    2 + # another comment
    3
  result
""", 13

# Comments in functions

test "comments in function body", """
  fn = ->
  # comment
    false
    false   # comment
    false
    # comment
    true
  fn()
""", true

test "trailing comment in function", """
  fn = -> #comment
    5
    # comment after return
  fn()
""", 5

# Comments with conditionals

test "comment with if statement", """
  nonce = {}
  result = if false # comment
    undefined
  #comment
  else # comment
    nonce
  result is nonce
""", true

test "comment in ternary", """
  x = true
  result = if x # condition
    1 # true branch
  else
    2 # false branch
  result
""", 1

# Comments in switch

test "comments in switch", """
  value = 2
  result = switch value #comment
    # comment
    when 1 then 'one'
    # comment
    when 2 #comment
      'two'
    else 'other' # comment
  result
""", 'two'

# Comments in arrays

test "comments in arrays", """
  arr = [
    1 # first
    2 # second
    # comment
    3 # third
  ]
  arr.length
""", 3

test "comments in array comprehension", """
  arr = for i in [1, 2, 3] # comment
    # comment in loop
    i * 2 # double it
  arr
""", [2, 4, 6]

# Comments in loops

test "comments in while loop", """
  i = 0
  sum = 0
  while i < 3 # condition
    sum += i # add
    i++ # increment
  sum
""", 3

test "comments in for loop", """
  sum = 0
  for x in [1, 2, 3] # iterate
    sum += x # accumulate
  sum
""", 6

# Block comments

test "block comment single line", """
  ### This is a block comment ###
  x = 5
  x
""", 5

test "block comment multiline", """
  ###
  This is a
  multiline block comment
  ###
  y = 10
  y
""", 10

test "block comment inline", """
  z = 1 ### inline comment ### + 2
  z
""", 3

# Comments with destructuring

test "comments in destructuring", """
  [
    a # first
    b # second
  ] = [1, 2]
  [a, b]
""", [1, 2]

test "comments in object destructuring", """
  {
    x # extract x
    y # extract y
  } = {x: 1, y: 2}
  [x, y]
""", [1, 2]

# Comments at end of line

test "comment at end of statement", """
  value = 42 # the answer
  value
""", 42

test "comment after return", """
  fn = ->
    return 5 # return value
  fn()
""", 5

# Empty lines with comments

test "empty lines with comments", """
  a = 1
  # comment

  # another comment
  b = 2
  a + b
""", 3

# Comments in class definitions

test "comments in class", """
  class Test
    # comment before constructor
    constructor: ->
      @value = 1 # initialize

    # comment before method
    method: ->
      @value # return value

  new Test().method()
""", 1

# Comments and indentation

test "comments preserve indentation", """
  if true
    # This comment is indented
    result = 'yes'
  else
    # This comment is also indented
    result = 'no'
  result
""", 'yes'

# Hashbang comments

test "hashbang is preserved", """
  code = '#!/usr/bin/env coffee\\nx = 1'
  compiled = CoffeeScript.compile(code)
  compiled.startsWith('#!/usr/bin/env coffee')
""", true

# Comments in regexes

test "comments in heregex", """
  regex = ///
    [a-z]+ # letters
    \\s*    # optional whitespace
    [0-9]+ # numbers
  ///
  regex.test('hello123')
""", true

# Comments don't break parsing

test "comments between tokens", """
  x = 5 # comment
  + # comment
  3 # comment
  x
""", 8

test "comment only line", """
  # Just a comment
  42
""", 42

# Block comment formatting tests
test "block comment before implicit call", """
  fn = (obj) -> obj.a
  ### block comment ###
  fn
    a: true
""", true

test "herecomments don't imply terminators", """
  (-> ### comment ### true)()
""", true

test "block comments in array literals", """
  arr = [
    ### comment ###
    3
    ### another ###
    42
  ]
  arr.join('-')
""", '3-42'

test "UTF-8 in comments", """
  # 智に働けば角が立つ
  'works'
""", 'works'

test "multiline comment at end of object", """
  obj =
    x: 3
    ###
    multiline
    comment
    ###
  obj.x
""", 3

test "spaced comments with conditionals", """
  result = if true
             # comment

             'yes'
           else
             'no'
  result
""", 'yes'

test "line comments in switch", """
  x = 2
  switch x
    # first comment
    when 1
      'one'
    # second comment
    when 2
      'two'
    # default comment
    else
      'other'
""", 'two'

test "comments in nested objects", """
  obj =
    # outer comment
    outer:
      # inner comment
      inner: 5
  obj.outer.inner
""", 5

test "comments in array comprehensions", """
  result = for i in [1..3]
    # double it
    i * 2
  result.join('-')
""", '2-4-6'

test "block comment inside function", """
  fn = ->
    ###
    This function
    returns 42
    ###
    42
  fn()
""", 42

test "comments between binary operators", """
  a = 1 +
    # comment
    2
  a
""", 3

test "comments in destructuring assignment", """
  [
    # first
    a
    # second
    b
  ] = [1, 2]
  a + b
""", 3

test "trailing block comment", """
  x = 5 ### block ###
  x
""", 5

# Complex comment formatting edge cases
code "jsdoc style block comment", """
  ###*
   * Function description
   * @param {string} x
   * @return {number}
  ###
  fn = (x) -> x.length
""", """
  /**
   * Function description
   * @param {string} x
   * @return {number}
   */
  var fn;

  fn = function(x) {
    return x.length;
  };
"""

code "block comments in array properly indented", """
  arr = [
    ### first ###
    1
    ###
    multiline
    comment
    ###
    2
  ]
""", """
  var arr;

  arr = [/* first */ 1,
    /*
    multiline
    comment
     */
    2];
"""

test "comments with no space after hash", """
  ###
  #No
  #whitespace
  ###
  5
""", 5

test "block comment in nested arrays", """
  arr = [
    [
      ### inner ###
      1
    ]
    ### outer ###
    2
  ]
  arr[0][0] + arr[1]
""", 3

code "single line block comment format", """
  ### Single comment here ###
  x = 1
""", """
  /* Single comment here */
  var x;

  x = 1;
"""

test "comment before throw statement", """
  fn = ->
    # comment
    throw 'error'

  try
    fn()
  catch e
    e
""", 'error'

test "block comment with conditional access", """
  obj = null
  ### comment ### obj?.val ? 'default'
""", 'default'

test "line comments in nested classes", """
  class Outer
    # outer comment
    constructor: ->
      # constructor comment
      @val = 1

    # method comment
    method: ->
      # inside method
      @val

  (new Outer).method()
""", 1

test "block comments between parameters", """
  fn = (
    a ### first ###,
    b ### second ###
  ) -> a + b

  fn(1, 2)
""", 3

test "comment after colon in object", """
  obj =
    key: # comment
      'value'

  obj.key
""", 'value'

test "comments in switch case", """
  x = 1
  switch x
    # before when
    when 1
      # in when
      'one'
    ### block before default ###
    else
      # in else
      'other'
""", 'one'

test "trailing comments on lines", """
  a = 1 # first
  b = 2 # second
  a + b # sum
""", 3

test "comment in parenthesized expression", """
  result = (
    # comment
    5
  )
  result
""", 5

test "block comment at end of object literal", """
  obj =
    x: 3
    ###
    ending comment
    ###
  obj.x
""", 3

test "comments with indented blocks", """
  if true
    ###
     Indented block
     comment here
    ###
    result = 42
  result
""", 42
