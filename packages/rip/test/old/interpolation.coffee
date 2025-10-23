# Interpolation
# -------------

# Basic string interpolation
test 'simple interpolation', '"Hello #{1 + 1} World"', 'Hello 2 World'
test 'variable interpolation', """
  name = 'World'
  "Hello \#{name}"
""", 'Hello World'

test 'multiple interpolations', """
  a = 1
  b = 2
  "\#{a} + \#{b} = \#{a + b}"
""", '1 + 2 = 3'

# Empty interpolation
test 'empty interpolation', '"#{}"', ''
test 'multiple empty', '"#{}A#{} #{} #{}B#{}"', 'A  B'

# Escaping
test 'escaped interpolation', '"\\#{42}"', '#{42}'
test 'escaped in middle', '"Test \\#{x} here"', 'Test #{x} here'

# Double hash
test 'double hash', '"I won ##20"', 'I won #20'
test 'double hash with interpolation', '"I won ##{20}"', 'I won #20'

# Complex expressions
test 'expression interpolation', '"Result: #{2 * 3 + 1}"', 'Result: 7'
test 'function call interpolation', """
  fn = -> 42
  "Answer: \#{fn()}"
""", 'Answer: 42'

# Nested interpolation
test 'nested objects', """
  obj = {value: 10}
  "Value: \#{obj.value}"
""", 'Value: 10'

test 'array access', """
  arr = [1, 2, 3]
  "Second: \#{arr[1]}"
""", 'Second: 2'

# Multi-line strings
test 'multiline interpolation', """
  x = 5
  result = \"\"\"
  Line 1: \#{x}
  Line 2: \#{x * 2}
  \"\"\"
  result
""", "Line 1: 5\nLine 2: 10"

# Mixed literals
test 'number to string', '"#{42}"', '42'
test 'boolean to string', '"#{true}"', 'true'
test 'undefined to string', '"#{undefined}"', 'undefined'
test 'null to string', '"#{null}"', 'null'

# Concatenation
test 'concat with interpolation', """
  'start' + "\#{ 1 + 1 }" + 'end'
""", 'start2end'

# Special characters
test 'quotes in interpolation', '"#{"\\"test\\""}"', '"test"'
test 'newline in interpolation', '"#{"\\n"}"', '\n'

# Division vs regex
test 'division in interpolation', '"#{4/2}"', '2'
test 'multiple divisions', '"#{6/2}#{6/2}"', '33'

# Object property interpolation
test 'object method', """
  obj =
    getValue: -> 'test'
  "Result: \#{obj.getValue()}"
""", 'Result: test'

# Conditional interpolation
test 'ternary in interpolation', """
  x = true
  "Value: \#{if x then 'yes' else 'no'}"
""", 'Value: yes'

# Template literal style
test 'backtick strings', """
  x = 10
  `Value: ${'${'}x}`
""", 'Value: ${x}'
