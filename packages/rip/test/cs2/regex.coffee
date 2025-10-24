# Regular Expressions
# -------------------

# Basic regex

test "basic regex", "/abc/.test('abc')", true
test "basic regex no match", "/abc/.test('def')", false
test "regex source", "/abc/.source", 'abc'

# Regex flags

test "case insensitive flag", "/abc/i.test('ABC')", true
test "global flag", '("abcabc".match(/abc/g) || []).length', 2
test "multiline flag", "/^abc$/m.test('\\nabc\\n')", true
test "dotall flag", "/a.c/s.test('a\\nc')", true

# Character classes

test "digit class", '/\\d+/.test("123")', true
test "word class", '/\\w+/.test("hello")', true
test "whitespace class", '/\\s+/.test("  ")', true
test "non-digit class", '/\\D+/.test("abc")', true
test "custom class", '/[aeiou]/.test("e")', true
test "range class", '/[a-z]/.test("m")', true
test "negated class", '/[^abc]/.test("d")', true

# Quantifiers

test "zero or more", '/ab*c/.test("ac")', true
test "one or more", '/ab+c/.test("abbc")', true
test "zero or one", '/ab?c/.test("ac")', true
test "exact count", '/a{3}/.test("aaa")', true
test "range count", '/a{2,4}/.test("aaa")', true
test "min count", '/a{2,}/.test("aaaa")', true

# Anchors

test "start anchor", '/^abc/.test("abcdef")', true
test "end anchor", '/abc$/.test("xyzabc")', true
test "word boundary", '/\\bhello\\b/.test("hello world")', true
test "non-word boundary", '/\\Bhello/.test("ahello")', true

# Groups

test "capturing group", """
  match = "abc".match(/(b)/)
  match[1]
""", 'b'

test "non-capturing group", """
  match = "abc".match(/(?:a)(b)/)
  match[1]
""", 'b'

test "named group", """
  match = "abc".match(/(?<letter>b)/)
  match.groups?.letter
""", 'b'

# Alternation

test "alternation", '/cat|dog/.test("dog")', true
test "alternation first", '/cat|dog/.test("cat")', true
test "alternation none", '/cat|dog/.test("bird")', false

# Lookahead/Lookbehind

test "positive lookahead", '/\\d(?=px)/.test("10px")', true
test "negative lookahead", '/\\d(?!px)/.test("10em")', true

# Regex methods

test "regex exec", """
  /b/.exec("abc")[0]
""", 'b'

test "regex test method", """
  /hello/.test("hello world")
""", true

test "string match", """
  "hello".match(/l+/)[0]
""", 'll'

test "string search", """
  "hello".search(/l/)
""", 2

test "string replace", """
  "hello".replace(/l/, "L")
""", 'heLlo'

test "string replace global", """
  "hello".replace(/l/g, "L")
""", 'heLLo'

test "string split", """
  "a,b,c".split(/,/)
""", ['a', 'b', 'c']

# Heregex (multiline regex)

test "heregex basic", """
  regex = ///
    abc  # letters
    123  # numbers
  ///
  regex.test("abc123")
""", true

test "heregex with spaces", """
  regex = ///
    a b c  # letters with spaces
  ///x
  regex.test("abc")
""", true

test "heregex interpolation", """
  str = "world"
  regex = ///hello\\ \#{str}///
  regex.test("hello world")
""", true

# Special characters

test "escaped special char", '/\\./.test(".")', true
test "escaped slash", '/\\//.test("/")', true
test "escaped backslash", '/\\\\/.test("\\\\")', true

# Unicode

test "unicode escape", '/\\u0041/.test("A")', true
test "unicode property", '/\\p{L}/u.test("a")', true

# Regex constructor

test "regex from string", """
  pattern = "abc"
  regex = new RegExp(pattern)
  regex.test("abc")
""", true

test "regex with flags from string", """
  regex = new RegExp("abc", "i")
  regex.test("ABC")
""", true

# Empty regex
# NOTE: test removed - it's a parse error!
# test "empty regex", "//", //

test "empty regex test", '/(?:)/.test("")', true

# Complex patterns

test "email pattern", """
  email = /^[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}$/i
  email.test("user@example.com")
""", true

test "URL pattern", """
  url = /^https?:\\/\\//
  url.test("https://example.com")
""", true

# Backreferences

test "backreference", '/(\\w)\\1/.test("aa")', true
test "backreference no match", '/(\\w)\\1/.test("ab")', false

# Regex lastIndex

test "lastIndex with global", """
  regex = /a/g
  regex.exec("aaa")
  regex.lastIndex
""", 1

# Sticky flag

test "sticky flag", """
  regex = /a/y
  regex.exec("ba")
""", null

# Regex compilation

test "regex literal compiles", """
  code = CoffeeScript.compile('/abc/')
  code.includes('/abc/')
""", true

test "regex interpolation compiles", """
  code = CoffeeScript.compile('///a\#{b}c///')
  code.includes('RegExp')
""", true
