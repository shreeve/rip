# Objects
# -------

# Object literals

test "empty object", "{}", {}
test "simple object", "{a: 1}", {a: 1}
test "object with multiple properties", """
  {a: 1, b: 2, c: 3}
""", {a: 1, b: 2, c: 3}

# Property access

test "dot notation", """
  obj = {a: 1}
  obj.a
""", 1

test "bracket notation", """
  obj = {a: 1}
  obj['a']
""", 1

test "computed property access", """
  obj = {a: 1}
  key = 'a'
  obj[key]
""", 1

# Nested objects

test "nested object", """
  obj = {a: {b: {c: 1}}}
  obj.a.b.c
""", 1

test "nested access mixed", """
  obj = {a: {b: {c: 1}}}
  obj['a'].b['c']
""", 1

# YAML-style objects

test "YAML-style object", """
  obj =
    a: 1
    b: 2
  [obj.a, obj.b]
""", [1, 2]

test "nested YAML-style", """
  obj =
    a:
      b: 1
      c: 2
  obj.a.b
""", 1

# Shorthand properties

test "shorthand property", """
  a = 1
  obj = {a}
  obj.a
""", 1

test "mixed shorthand", """
  a = 1
  b = 2
  obj = {a, b: b, c: 3}
  [obj.a, obj.b, obj.c]
""", [1, 2, 3]

# Computed property names

test "computed property name", """
  key = 'myKey'
  obj = {[key]: 1}
  obj.myKey
""", 1

test "computed with expression", """
  obj = {['a' + 'b']: 1}
  obj.ab
""", 1

# Object methods

test "method in object", """
  obj =
    method: -> 5
  obj.method()
""", 5

test "method with this", """
  obj =
    value: 10
    getValue: -> @value
  obj.getValue()
""", 10

# Property assignment

test "property assignment", """
  obj = {}
  obj.a = 1
  obj.a
""", 1

test "nested property assignment", """
  obj = {}
  obj.a = {}
  obj.a.b = 1
  obj.a.b
""", 1

# Object spread

test "object spread", """
  obj1 = {a: 1, b: 2}
  obj2 = {...obj1, c: 3}
  [obj2.a, obj2.b, obj2.c]
""", [1, 2, 3]

test "object spread override", """
  obj1 = {a: 1, b: 2}
  obj2 = {...obj1, a: 3}
  obj2.a
""", 3

# Object rest

test "object rest", """
  {a, ...rest} = {a: 1, b: 2, c: 3}
  [a, rest.b, rest.c]
""", [1, 2, 3]

# Object.keys/values/entries

test "Object.keys", """
  Object.keys({a: 1, b: 2})
""", ['a', 'b']

test "Object.values", """
  Object.values({a: 1, b: 2})
""", [1, 2]

test "Object.entries", """
  Object.entries({a: 1, b: 2})
""", [['a', 1], ['b', 2]]

# Property existence

test "in operator", """
  'a' in {a: 1}
""", true

test "in operator false", """
  'b' in {a: 1}
""", false

test "hasOwnProperty", """
  {a: 1}.hasOwnProperty('a')
""", true

# Delete property

test "delete property", """
  obj = {a: 1, b: 2}
  delete obj.a
  obj.a
""", undefined

# Object.create

test "Object.create", """
  proto = {a: 1}
  obj = Object.create(proto)
  obj.a
""", 1

# Object.assign

test "Object.assign", """
  obj = Object.assign({}, {a: 1}, {b: 2})
  [obj.a, obj.b]
""", [1, 2]

# Getters and setters (via Object.defineProperty)

test "defineProperty", """
  obj = {}
  Object.defineProperty(obj, 'a', {value: 1})
  obj.a
""", 1

# Object comparison

test "object equality same", """
  obj = {a: 1}
  obj is obj
""", true

test "object equality different", """
  {a: 1} is {a: 1}
""", false

# Empty object patterns

test "empty object in array", """
  [{}, x] = [{}, 5]
  x
""", 5

# Prototype chain

test "prototype property", """
  fn = ->
  fn.prototype.method = -> 5
  obj = new fn()
  obj.method()
""", 5

# Object with symbols

test "object with string key", """
  obj = {'string-key': 1}
  obj['string-key']
""", 1

# Object destructuring with defaults

test "object destructuring defaults", """
  {a = 5} = {}
  a
""", 5

# Object with reserved words

test "reserved word properties", """
  obj = {class: 1, if: 2, for: 3}
  [obj.class, obj.if, obj.for]
""", [1, 2, 3]

# Implicit objects

test "implicit object single line", """
  fn = (obj) -> obj.a
  fn a: 1
""", 1

test "implicit object multiline", """
  obj =
    a: 1
    b:
      c: 2
  obj.b.c
""", 2


