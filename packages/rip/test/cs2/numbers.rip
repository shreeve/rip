# Numbers
# -------

# Integer literals

test "decimal integer", "42", 42
test "negative integer", "-42", -42
test "zero", "0", 0

# Floating point

test "decimal float", "3.14", 3.14
test "negative float", "-3.14", -3.14
test "float without leading zero", ".5", 0.5
test "float without trailing digits", "5.", 5

# Scientific notation

test "scientific notation positive", "1.5e3", 1500
test "scientific notation negative exp", "1.5e-3", 0.0015
test "scientific notation capital E", "2E10", 20000000000

# Binary literals

test "binary literal", "0b1010", 10
test "binary literal long", "0b11111111", 255

# Octal literals

test "octal literal", "0o777", 511
test "octal literal simple", "0o10", 8

# Hexadecimal literals

test "hex literal lowercase", "0xff", 255
test "hex literal uppercase", "0xFF", 255
test "hex literal mixed", "0xDEADBEEF", 3735928559

# Numeric separators

test "underscore in decimal", "1_000_000", 1000000
test "underscore in float", "3.141_592", 3.141592
test "underscore in binary", "0b1111_0000", 240
test "underscore in hex", "0xFF_FF", 65535
test "underscore in scientific", "1.23e4_5", 1.23e45

# Special values

test "infinity", "Infinity", Infinity
test "negative infinity", "-Infinity", -Infinity
test "NaN is NaN", "isNaN(NaN)", true

# Number methods

test "number toString", "(42).toString()", "42"
test "number toFixed", "(3.14159).toFixed(2)", "3.14"
test "number toPrecision", "(123.456).toPrecision(4)", "123.5"

# Math operations

test "addition", "2 + 3", 5
test "subtraction", "5 - 3", 2
test "multiplication", "3 * 4", 12
test "division", "10 / 2", 5
test "modulo", "10 % 3", 1
test "floor division", "10 // 3", 3

# Math precedence

test "precedence multiply add", "2 + 3 * 4", 14
test "precedence with parens", "(2 + 3) * 4", 20

# Comparison

test "equality", "5 is 5", true
test "inequality", "5 isnt 6", true
test "less than", "3 < 5", true
test "greater than", "5 > 3", true
test "less or equal", "5 <= 5", true
test "greater or equal", "5 >= 5", true

# Type checking

test "typeof number", "typeof 42", "number"
test "number constructor", "(42).constructor.name", "Number"

# Number coercion

test "string to number", "+'42'", 42
test "boolean to number true", "+true", 1
test "boolean to number false", "+false", 0

# Bitwise operations

test "bitwise and", "5 & 3", 1
test "bitwise or", "5 | 3", 7
test "bitwise xor", "5 ^ 3", 6
test "bitwise not", "~5", -6
test "left shift", "5 << 2", 20
test "right shift", "20 >> 2", 5
test "zero-fill right shift", "20 >>> 2", 5

# Number properties

test "MAX_VALUE exists", "Number.MAX_VALUE > 0", true
test "MIN_VALUE exists", "Number.MIN_VALUE > 0", true
test "POSITIVE_INFINITY", "Number.POSITIVE_INFINITY", Infinity
test "NEGATIVE_INFINITY", "Number.NEGATIVE_INFINITY", -Infinity

# Integer methods

test "isInteger true", "Number.isInteger(42)", true
test "isInteger false", "Number.isInteger(42.5)", false
test "isFinite true", "Number.isFinite(42)", true
test "isFinite false", "Number.isFinite(Infinity)", false
test "isSafeInteger", "Number.isSafeInteger(42)", true

# Parsing

test "parseInt decimal", "parseInt('42')", 42
test "parseInt with radix", "parseInt('FF', 16)", 255
test "parseFloat", "parseFloat('3.14')", 3.14

# Math object

test "Math.PI", "Math.PI > 3", true
test "Math.E", "Math.E > 2", true
test "Math.abs", "Math.abs(-5)", 5
test "Math.ceil", "Math.ceil(4.3)", 5
test "Math.floor", "Math.floor(4.7)", 4
test "Math.round", "Math.round(4.5)", 5
test "Math.max", "Math.max(1, 5, 3)", 5
test "Math.min", "Math.min(1, 5, 3)", 1
test "Math.pow", "Math.pow(2, 3)", 8
test "Math.sqrt", "Math.sqrt(16)", 4


