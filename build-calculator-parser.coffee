# Build the calculator parser from the CoffeeScript grammar
# This follows the same approach as the Cakefile's buildParser function

fs = require 'fs'
{Parser} = require 'jison'

# Build the calculator parser from source
buildCalculatorParser = ->
  console.log 'Building calculator parser...'

  # Load our calculator grammar
  {parser} = require './calculator'

  # Generate the parser with the same options as CoffeeScript
  # We don't need `moduleMain`, since the parser is unlikely to be run standalone.
  generatedParser = parser.generate(moduleMain: ->)

  # Write the generated parser to a file
  fs.writeFileSync 'calculator-parser.js', generatedParser

  console.log 'Calculator parser generated: calculator-parser.js'

# Run the build
buildCalculatorParser()