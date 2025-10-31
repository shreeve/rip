# Strict Mode
# -----------

# Octal literals
fail 'octal literal', '01'
fail 'octal literal long', '07777'
fail 'leading zero decimal', '09'

# Octal escape sequences in strings
fail 'octal escape', '"\\1"'
fail 'octal escape three digits', '"\\001"'
fail 'octal in middle', '"a\\1b"'

# Valid escape sequences
test 'null escape', '"\\0"', '\0'
test 'backslash number', '"\\\\1"', '\\1'

# Duplicate parameters
fail 'duplicate params', '(a, a) ->'
fail 'duplicate splat params', '(a, a...) ->'
fail 'duplicate destructured', '({a}, {a}) ->'
fail 'duplicate in array destructure', '([a], [a]) ->'
fail 'duplicate @ params', '(@a, @a) ->'

# Delete restrictions
fail 'delete parameter', '(a) -> delete a'
fail 'delete splat param', '(a...) -> delete a'
fail 'delete destructured param', '({a}) -> delete a'

# Reserved words as identifiers
fail 'implements as variable', 'implements = 1'
fail 'interface as variable', 'interface = 1'
fail 'let as variable', 'let = 1'
fail 'package as variable', 'package = 1'
fail 'private as variable', 'private = 1'
fail 'protected as variable', 'protected = 1'
fail 'public as variable', 'public = 1'
fail 'static as variable', 'static = 1'

# eval and arguments restrictions
fail 'eval as parameter', '(eval) ->'
fail 'arguments as parameter', '(arguments) ->'
fail 'eval assignment', 'eval = 1'
fail 'arguments assignment', 'arguments = 1'
fail 'eval increment', 'eval++'
fail 'arguments decrement', '--arguments'
fail 'eval as catch var', 'try throw 1 catch eval'
fail 'arguments as catch var', 'try throw 1 catch arguments'

# Valid uses
test 'eval property access', 'eval.toString', eval.toString
test 'arguments in function', '(-> arguments.length)(1,2,3)', 3

# With statement is always prohibited
fail 'with statement', 'with obj'

# Duplicate object keys (in strict mode)
test 'duplicate object keys allowed', '{a: 1, a: 2}', {a: 2}

# This in global scope
test 'global this', 'this', this

# Function declarations
fail 'class eval', 'class eval'
fail 'class arguments', 'class arguments'

# Valid property names
test 'reserved as property', 'obj = {static: 1}; obj.static', 1
test 'eval as property', 'obj = {eval: 2}; obj.eval', 2
test 'arguments as property', 'obj = {arguments: 3}; obj.arguments', 3
