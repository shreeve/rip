# Tagged Template Literals
# ------------------------

# Basic tagged template
test 'basic tagged template', """
  tag = (strings, ...values) -> strings[0]
  tag\`hello\`
""", 'hello'

test 'tagged template with expression', """
  tag = (strings, ...values) -> strings[0] + values[0] + strings[1]
  value = 5
  tag\`Value is \${value}\`
""", 'Value is 5'

test 'tagged template with multiple expressions', """
  tag = (strings, ...values) -> values.reduce((acc, val, i) ->
    acc + val + strings[i + 1]
  , strings[0])
  a = 2
  b = 3
  tag\`Sum of \${a} and \${b} is \${a + b}\`
""", 'Sum of 2 and 3 is 5'

# Tagged template with CoffeeScript strings
test 'tagged CS single quote', """
  tag = (strings) -> strings[0]
  tag'hello world'
""", 'hello world'

test 'tagged CS double quote', """
  tag = (strings) -> strings[0]
  tag"hello world"
""", 'hello world'

test 'tagged CS interpolation', """
  tag = (strings, ...values) -> strings[0] + values[0] + strings[1]
  x = 42
  tag"Value: \#{x}"
""", 'Value: 42'

# Tagged template with block strings
test 'tagged block string', """
  tag = (strings) -> strings[0]
  tag'''
    multiline
    string
  '''
""", 'multiline\\nstring'

test 'tagged interpolated block string', """
  tag = (strings, ...values) -> strings.join('|')
  x = 5
  tag\"\"\"
    Line 1: \#{x}
    Line 2
  \"\"\"
""", 'Line 1: |\\nLine 2'

# Object method as tag
test 'object method tag', """
  obj = {
    tag: (strings) -> strings[0]
  }
  obj.tag'test'
""", 'test'

test 'nested property tag', """
  outer = {
    inner: {
      tag: (strings) -> strings[0]
    }
  }
  outer.inner.tag'nested'
""", 'nested'

# Array access as tag
test 'bracket notation tag', """
  obj = {
    tag: (strings) -> strings[0]
  }
  obj['tag']'bracket'
""", 'bracket'

# Function returning tag
test 'function returning tag', """
  getTag = -> (strings) -> strings[0]
  getTag()'dynamic'
""", 'dynamic'

# Empty tagged template
test 'empty tagged template', """
  tag = (strings) -> strings.length
  tag''
""", 1

test 'empty interpolated tagged', """
  tag = (strings, ...values) -> strings.length
  tag"\#{}"
""", 1

# Raw strings
test 'raw strings access', """
  tag = (strings) -> strings.raw[0]
  tag\`line1\\nline2\`
""", 'line1\\nline2'

# Nested templates
test 'nested tagged template', """
  outer = (strings, ...values) -> values[0]
  inner = (strings) -> 'inner'
  outer"Result: \#{inner'test'}"
""", 'inner'

# Multiple values
test 'multiple interpolations', """
  tag = (strings, ...values) -> values.length
  a = 1
  b = 2
  c = 3
  tag"\#{a} \#{b} \#{c}"
""", 3

# Edge cases
test 'single expression only', """
  tag = (strings, ...values) -> values[0]
  tag"\#{42}"
""", 42

test 'strings array length', """
  tag = (strings, ...values) -> strings.length
  tag"a\#{1}b\#{2}c"
""", 3

# Complex expressions
test 'function call in template', """
  tag = (strings, ...values) -> values[0]
  fn = -> 10
  tag"Result: \#{fn()}"
""", 10

test 'object in template', """
  tag = (strings, ...values) -> values[0].x
  tag"Obj: \#{{x: 5}}"
""", 5

# Template literal passthrough
test 'backticks in string', """
  tag = (strings) -> strings[0]
  tag"ES templates use \`backticks\`"
""", 'ES templates use `backticks`'

# HTML templating example
test 'html template tag', """
  html = (strings, ...values) ->
    result = strings[0]
    for value, i in values
      result += value + strings[i + 1]
    result
  name = 'World'
  html"<h1>Hello \#{name}</h1>"
""", '<h1>Hello World</h1>'
