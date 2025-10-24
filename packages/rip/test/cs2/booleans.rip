# Boolean Literals
# ----------------

# Booleans should be indexable

test "boolean indexable with bracket notation true", """
  toString = Boolean::toString
  toString is true['toString']
""", true

test "boolean indexable with bracket notation false", """
  toString = Boolean::toString
  toString is false['toString']
""", true

test "boolean indexable yes", """
  toString = Boolean::toString
  toString is yes['toString']
""", true

test "boolean indexable no", """
  toString = Boolean::toString
  toString is no['toString']
""", true

test "boolean indexable on", """
  toString = Boolean::toString
  toString is on['toString']
""", true

test "boolean indexable off", """
  toString = Boolean::toString
  toString is off['toString']
""", true

# Boolean dot notation

test "boolean dot notation true", """
  toString = Boolean::toString
  toString is true.toString
""", true

test "boolean dot notation false", """
  toString = Boolean::toString
  toString is false.toString
""", true

test "boolean dot notation yes", """
  toString = Boolean::toString
  toString is yes.toString
""", true

test "boolean dot notation no", """
  toString = Boolean::toString
  toString is no.toString
""", true

test "boolean dot notation on", """
  toString = Boolean::toString
  toString is on.toString
""", true

test "boolean dot notation off", """
  toString = Boolean::toString
  toString is off.toString
""", true

# Boolean values

test "boolean values true", "true", true
test "boolean values false", "false", false
test "boolean values yes", "yes", true
test "boolean values no", "no", false
test "boolean values on", "on", true
test "boolean values off", "off", false

# Boolean operations

test "boolean not true", "not true", false
test "boolean not false", "not false", true
test "boolean not not true", "not not true", true

test "boolean and", "true and true", true
test "boolean and false", "true and false", false
test "boolean or", "false or true", true
test "boolean or false", "false or false", false

# Boolean conversions

test "boolean to string true", "true.toString()", "true"
test "boolean to string false", "false.toString()", "false"

test "boolean coercion", "!!1", true
test "boolean coercion zero", "!!0", false
test "boolean coercion string", "!!'hello'", true
test "boolean coercion empty string", "!!''", false


