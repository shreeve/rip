# String Tests
# ------------

# Basic strings

test "empty string", '""', ''
test "single char", '"a"', 'a'
test "basic string", '"hello"', 'hello'
test "string with spaces", '"hello world"', 'hello world'

# Single vs double quotes

test "single quotes", "'hello'", 'hello'
test "double quotes", '"hello"', 'hello'
test "mixed quotes", """
  "it's"
""", "it's"

# String concatenation

test "concatenation", '"hello" + " " + "world"', 'hello world'
test "concatenation numbers", '"age: " + 25', 'age: 25'

# String interpolation

test "basic interpolation", """
  x = 5
  "x = \#{x}"
""", 'x = 5'

test "expression interpolation", """
  a = 2
  b = 3
  "sum = \#{a + b}"
""", 'sum = 5'

test "multiple interpolations", """
  x = 5
  y = 10
  "x = \#{x}, y = \#{y}, sum = \#{x + y}"
""", 'x = 5, y = 10, sum = 15'

# Escape sequences

test "escape newline", '"line1\\nline2"', "line1\nline2"
test "escape tab", '"col1\\tcol2"', "col1\tcol2"
test "escape quote", '"He said \\"Hello\\""', 'He said "Hello"'
test "escape backslash", '"C:\\\\path"', 'C:\\path'

# String methods

test "length", '"hello".length', 5
test "toUpperCase", '"hello".toUpperCase()', 'HELLO'
test "toLowerCase", '"HELLO".toLowerCase()', 'hello'
test "charAt", '"hello".charAt(1)', 'e'
test "indexOf", '"hello".indexOf("l")', 2
test "lastIndexOf", '"hello".lastIndexOf("l")', 3
test "substring", '"hello".substring(1, 4)', 'ell'
test "substr", '"hello".substr(1, 3)', 'ell'
test "slice", '"hello".slice(1, 4)', 'ell'
test "slice negative", '"hello".slice(-3)', 'llo'
test "split", '"a,b,c".split(",")', ['a', 'b', 'c']
test "replace", '"hello".replace("l", "r")', 'herlo'
test "replaceAll", '"hello".replace(/l/g, "r")', 'herro'
test "trim", '"  hello  ".trim()', 'hello'
test "trimStart", '"  hello".trimStart()', 'hello'
test "trimEnd", '"hello  ".trimEnd()', 'hello'

# String comparisons

test "equality", '"hello" == "hello"', true
test "inequality", '"hello" == "world"', false
test "less than", '"a" < "b"', true
test "greater than", '"b" > "a"', true

# String coercion

test "number to string", '5 + ""', '5'
test "boolean to string", 'true + ""', 'true'
test "array to string", '[1, 2] + ""', '1,2'

# String searching

test "includes", '"hello".includes("ll")', true
test "startsWith", '"hello".startsWith("he")', true
test "endsWith", '"hello".endsWith("lo")', true
test "match", '"hello".match(/l+/)[0]', 'll'

# String repetition

test "repeat", '"ab".repeat(3)', 'ababab'
test "repeat zero", '"ab".repeat(0)', ''

# String padding

test "padStart", '"5".padStart(3, "0")', "005"
test "padEnd", '"5".padEnd(3, "0")', '500'

# CoffeeScript string interpolation (compiles to JS template literals)
test "basic string", '"hello"', 'hello'
test "string interpolation", '''
  x = 'world'
  "hello #{x}"
''', 'hello world'

# Verify that CoffeeScript interpolation compiles to JS template literals
code "interpolation compiles to template literal", '''
  x = 5
  "value is #{x}"
''', '''
  var x;

  x = 5;

  `value is ${x}`;
'''

# Test JavaScript template literal pass-through with triple backticks
code "JS template literal pass-through", '''
  x = 'world'
  ```
  `hello ${x}`
  ```
''', '''
  var x;

  x = 'world';


  `hello ${x}`
  ;
'''

# We can execute JS template literals if we return them from the JS block
test "JS template literal execution", '''
  x = 'world'
  ```
  (function() { return `hello ${x}`; })()
  ```
''', 'hello world'

# Tagged template literals - CoffeeScript has its own syntax
# that compiles to JavaScript tagged templates

code "tagged template compilation", '''
  tag = (strings, values...) -> strings[0]
  tag"""hello world"""
''', '''
  var tag;

  tag = function(strings, ...values) {
    return strings[0];
  };

  tag`hello world`;
'''

# String iteration

test "string spread", '[..."abc"]', ['a', 'b', 'c']
test "string for loop", """
  result = []
  for char in 'abc'
    result.push char
  result
""", ['a', 'b', 'c']

# Empty string checks

test "empty string falsy", '!! ""', false
test "non-empty string truthy", '!! "hello"', true

# String raw - not directly accessible in CoffeeScript
# Use escaped strings instead

test "escaped newline char", '"\\\\n"', '\\n'

# Backslash escapes
test 'backslash escapes', '"\\/\\\\"', '/\\'

# Unicode escapes
test 'unicode escape', '"\\u0041"', 'A'
test 'unicode escape emoji', '"\\u{1F600}"', '😀'

# String indexing
test 'string bracket indexing', '"hello"[1]', 'e'
test 'string negative indexing', '"hello"[-1]', undefined

# toString on string literals
test 'string toString', '"hello".toString()', 'hello'

# String constructor with new
test 'new String', '(new String("hello")).valueOf()', 'hello'

# Character codes
test 'charCodeAt', '"A".charCodeAt(0)', 65
test 'fromCharCode', 'String.fromCharCode(65)', 'A'

# String localeCompare
test 'localeCompare equal', '"a".localeCompare("a")', 0
test 'localeCompare less', '"a".localeCompare("b") < 0', true
test 'localeCompare greater', '"b".localeCompare("a") > 0', true

# Regex test with strings
test 'regex test', '/hello/.test("hello world")', true
test 'regex test fail', '/goodbye/.test("hello world")', false

# String normalization
test 'normalize', '"e\\u0301".normalize("NFC").length', 1

# Code point methods
test 'codePointAt', '"😀".codePointAt(0)', 128512
test 'fromCodePoint', 'String.fromCodePoint(128512)', '😀'

# String valueOf
test 'valueOf', '"hello".valueOf()', 'hello'

# String Symbol.iterator
test 'iterator', """
  str = 'ab'
  it = str[Symbol.iterator]()
  [it.next().value, it.next().value]
""", ['a', 'b']

# String at method (ES2022)
# test 'at method', '"hello".at(1)', 'e'
# test 'at negative', '"hello".at(-1)', 'o'

# Multiline continuation
test 'multiline continuation', """
  "one \\
two \\
three"
""", 'one two three'

# Raw strings - test backslash preservation
test 'raw string equivalent', '"\\\\n"', '\\n'

# Multiline strings and heredocs

code "multiline string basic", '''
  """
  Line 1
  Line 2
  """
''', '''
  `Line 1
  Line 2`;
'''

code "multiline string indented", '''
  str = """
    Indented
    String
  """
''', '''
  var str;

  str = `Indented
  String`;
'''

code "block string single quotes", """
  '''
  Block
  String
  '''
""", """
  `Block
  String`;
"""

test "heredoc preserves indentation", '''
  """
    This is a heredoc
    It preserves indentation
  """
''', 'This is a heredoc\nIt preserves indentation'

code "interpolation in multiline", '''
  name = "World"
  """
  Hello
  #{name}
  """
''', '''
  var name;

  name = "World";

  `Hello
  ${name}`;
'''

code "escaped newlines in strings", '''
  "line1\\
  line2"
''', '''
  "line1line2";
'''

code "multiple heredocs", '''
  a = """
    First
  """
  b = """
    Second
  """
''', '''
  var a, b;

  a = `First`;

  b = `Second`;
'''

test "multiline string concatenation", '''
  "one
   two
   three"
''', 'one two three'

test "heredoc with backslash", '''
  """\\
  test"""
''', 'test'

test "empty multiline string", '''
  """
  """
''', ''

test "single line in triple quotes", '''
  """single"""
''', 'single'

code "nested interpolation in heredoc", '''
  x = 5
  """
  Value: #{
    if x > 3
      "big"
    else
      "small"
  }
  """
''', '''
  var x;

  x = 5;

  `Value: ${x > 3 ? "big" : "small"}`;
'''

# Additional multiline and block string tests

code "herecomment", '''
  ###
  This is a block comment
  It spans multiple lines
  ###
  5
''', '''
  /*
  This is a block comment
  It spans multiple lines
  */
  5;
'''

test "escaped quotes in heredocs", '''
  """
  She said, \\"Hello\\"
  """
''', 'She said, "Hello"'

test "indentation removal in heredocs", '''
  html = """
         <div>
           <p>Hello</p>
         </div>
         """
  html
''', '<div>\n  <p>Hello</p>\n</div>'

code "regex in heredoc interpolation", '''
  """
  Match: #{ /test/.test("test") }
  """
''', '''
  `Match: ${/test/.test("test")}`;
'''

# CoffeeScript doesn't auto-concatenate adjacent strings
test "explicit concatenation", '''
  'Hello ' + 'World'
''', 'Hello World'

test "multiline regex", '''
  ///
    ^   # Start
    \\w+ # Word
    $   # End
  ///.test("hello")
''', true

code "tagged template literal", '''
  tag = (strings, values...) -> strings[0] + values[0]
  tag"""Hello #{42}"""
''', '''
  var tag;

  tag = function(strings, ...values) {
    return strings[0] + values[0];
  };

  tag`Hello ${42}`;
'''

test "line continuation in string", '''
  "abc\\
  def"
''', 'abcdef'

test "empty heredoc", '''
  """

  """
''', ''

# Heredocs with only whitespace produce a single newline
test "heredoc only whitespace", '''
  """


  """.trim()
''', ''

code "complex multiline interpolation", '''
  items = ["a", "b", "c"]
  """
  Items:
  #{
    items.map((i) -> "  - " + i).join("\\n")
  }
  """
''', '''
  var items;

  items = ["a", "b", "c"];

  `Items:
  ${items.map(function(i) {
    return "  - " + i;
  }).join("\\n")}`;
'''

test "unicode in multiline", '''
  """
  😀 Emoji
  """
''', '😀 Emoji'

# Heredocs remove common indentation
test "tabs in heredocs", '''
  "\\tTabbed"
''', '\tTabbed'

code "jsx-like in heredoc", '''
  """
  <Component>
    <Child />
  </Component>
  """
''', '''
  `<Component>
    <Child />
  </Component>`;
'''

test "backslash at end of heredoc line", '''
  """
  Line 1\\
  Line 2
  """
''', 'Line 1Line 2'
