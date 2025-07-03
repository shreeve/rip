# Test the generated calculator parser
# This uses the standalone calculator-parser.js file

# Load the generated parser
parser = require './parser-calculator' # NOTE: This is the parser file!

# Simple test function
testCalculator = (expression, expected) ->
  try
    result = parser.parse expression
    passed = result is expected
    console.log "Testing: #{expression} = #{expected}"
    console.log "Result: #{result}, Expected: #{expected}, Pass: #{passed}"
    console.log ""
  catch error
    console.error "Error parsing \"#{expression}\": #{error.message}"
    console.log ""

# Test cases
console.log 'Generated Calculator Parser Test:\n'

testCalculator '2 + 3', 5
testCalculator '10 - 4', 6
testCalculator '3 * 7', 21
testCalculator '15 / 3', 5
testCalculator '2 + 3 * 4', 14  # Tests precedence
testCalculator '(2 + 3) * 4', 20 # Tests parentheses
testCalculator '-5', -5 # Tests unary minus

console.log 'All tests completed!'