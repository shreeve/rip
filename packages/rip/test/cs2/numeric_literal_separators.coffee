# Numeric Literal Separators
# --------------------------

# Integer literals with separators
test 'integer literal separator', '123_456', 123456
test 'integer literal multiple separators', '12_34_56', 123456

# Decimal literals with separators
test 'decimal literal with separator', '1_2.34_5', 12.345
test 'scientific notation with separator', '1_0e1_0', 10e10
test 'decimal scientific with separators', '1_2.34_5e6_7', 12.345e67

# Hexadecimal literals with separators
test 'hex literal with separators', '0x1_2_3_4', 0x1234

# Binary literals with separators
test 'binary literal with separators', '0b10_10', 0b1010

# Octal literals with separators
test 'octal literal with separators', '0o7_7_7', 0o777

# Infinity with separator
test 'infinity with separator', '2e3_08', Infinity

# Range with separators
test 'range with separators', """
  range = [10_000...10_002]
  range.length
""", 2

test 'range with separators first element', """
  range = [10_000...10_002]
  range[0]
""", 10000

# Property access on a number
test 'number property access toFixed', '3.toFixed()', '3'

test 'number property with underscore', """
  Number::_23 = 'x'
  result = 1._23
  delete Number::_23
  result
""", 'x'

test 'undefined property with underscore', """
  1._34
""", undefined

# Invalid separators should not compile
fail 'invalid decimal separator at start', '1_.23'
fail 'invalid scientific separator', '1e_2'
fail 'invalid scientific separator at end', '1e2_'
fail 'invalid separator at end', '1_'
fail 'invalid double separator', '1__2'

fail 'invalid hex separator at start', '0x_1234'
fail 'invalid hex separator at end', '0x1234_'
fail 'invalid hex double separator', '0x1__34'

fail 'invalid binary separator at start', '0b_100'
fail 'invalid binary separator at end', '0b100_'
fail 'invalid binary double separator', '0b1__1'

fail 'invalid octal separator at start', '0o_777'
fail 'invalid octal separator at end', '0o777_'
fail 'invalid octal double separator', '0o6__6'
