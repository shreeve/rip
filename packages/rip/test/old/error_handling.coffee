# Error Handling and Edge Cases
# ------------------------------

# Parser errors
fail 'unmatched closing brace', """
  normalObject = {}
  insideOutObject = }{
"""

fail 'unexpected in', 'foo in bar or in baz'

fail 'unexpected comma', 'a:, b'

fail 'unexpected closing paren', '(a:)'

fail 'unexpected end after colon', 'a:'

fail 'unexpected end after plus', 'a +'

fail 'unexpected regex as key', '{/a/i: val}'

# Invalid assignments
fail 'eval parameter', '(foo, eval, bar) ->'

fail 'arguments parameter', '(foo, arguments, bar) ->'

fail 'number assignment', '1 = 2'

fail 'string assignment', '"foo" = "bar"'

fail 'regex assignment', '/foo/ = /bar/'

fail 'boolean assignment', 'true = false'

# Invalid operators
fail 'double comma', 'a(1,,2)'

fail 'invalid extends', '3 extends 2'

fail 'modulo requires expression', 'a %'

# Super usage errors
fail 'super outside method', 'super'

fail 'super in root', 'super()'

# Invalid splats
fail 'multiple splats in array', '[a..., b...]'

fail 'multiple splats in params', '(a..., b...) ->'

fail 'splat not at end', '(a..., b) ->'

# Loop errors
fail 'own in for-from', 'for own x from array'

fail 'from with object', 'for x from {a: 1}'

fail 'by without range', 'for x in arr by 2'

# Class errors
fail 'anonymous bound constructor', """
  class
    constructor: =>
"""

fail 'bound static method', """
  class A
    @fn: =>
"""

fail 'constructor with splat and default', """
  class A
    constructor: (args..., a = 1) ->
"""

# Yield errors
fail 'yield outside function', 'yield 1'

fail 'yield in constructor', """
  class A
    constructor: -> yield
"""

fail 'yield from without value', '-> yield from'

# Import/export errors (if supported)
fail 'import outside top', 'if true then import "foo"'

fail 'export in function', '-> export x = 1'

# Invalid destructuring
fail 'number in destructuring', '{1} = obj'

fail 'invalid array destructure', '[1, a] = arr'

# Interpolation errors
fail 'unclosed interpolation', '"#{a"'

fail 'nested interpolation quotes', '"#{"nested"broken"}"'

# Heredoc errors
fail 'unmatched heredoc indentation', """
  '''
    indented
  not indented
  '''
"""

# Regex errors
fail 'empty regex', '//'

fail 'regex with only space', '/ /'

fail 'unclosed regex', '/unclosed'

# Object literal errors
fail 'duplicate keys in destructure', '{a, a} = obj'

fail 'number as shorthand', '{1}'

# Invalid chains
fail 'new with existential', 'new A?()'

fail 'delete non-reference', 'delete 5'

# Comment errors
fail 'unclosed block comment', '### unclosed'

# Range errors
fail 'range with step', '[1..10 by 2]'

# Invalid await/async
fail 'await outside async', 'await promise'

fail 'top-level await', 'x = await fetch()'

# JSX errors (if applicable)
fail 'jsx self-close with children', '<div />text</div>'

fail 'jsx mismatched tags', '<div></span>'

# Invalid comprehensions
fail 'comprehension without target', 'x for'

fail 'when without comprehension', 'x when true'

# Arrow function errors
fail 'bound generator', '=>*'

fail 'async bound constructor', """
  class A
    constructor: => await
"""

# Template literal errors
fail 'unclosed template', '`unclosed'

fail 'invalid template tag', '5`template`'

# Do block errors
fail 'do with non-function', 'do 5'

fail 'do with string', 'do "not a function"'

# Invalid operators combinations
fail 'double dot', 'a..b'

fail 'triple dot without context', 'a ... b'

# Switch errors
fail 'switch without condition', 'switch'

fail 'switch without when', """
  switch x
    else
"""

# Try/catch errors
fail 'catch without try', 'catch e'

fail 'finally without try', 'finally cleanup()'

# Invalid property access
fail 'property of undefined literal', 'undefined.prop'

fail 'property of null literal', 'null.prop'
