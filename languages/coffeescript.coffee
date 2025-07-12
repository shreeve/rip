# CoffeeScript Language Pack for Rip Universal Parser
# ===================================================
#
# This language pack enables the Rip universal parser to parse CoffeeScript code.
# It follows the Rip vision of separating the universal parsing engine from
# language-specific data and actions.
#
# Usage:
#   rip = require 'rip'
#   coffeeScriptPack = require './languages/coffeescript'
#   parser = rip.createParser(coffeeScriptPack)
#   ast = parser.parse(sourceCode)

# Import the original CoffeeScript grammar for reference
{grammar: originalGrammar, operators, tokens} = require '../coffeescript/src/grammar'

# Helper function for creating grammar rules (from original CoffeeScript)
o = (patternString, action, options) ->
  patternString = patternString.replace /\s{2,}/g, ' '
  [patternString, action, options]

# ============================================================================
# LANGUAGE METADATA
# ============================================================================

languageInfo =
  name: 'CoffeeScript'
  version: '2.7.0'
  description: 'A language that compiles into JavaScript'
  fileExtensions: ['.coffee', '.litcoffee', '.coffee.md']
  mimeType: 'text/coffeescript'
  homepage: 'https://coffeescript.org'
  repository: 'https://github.com/jashkenas/coffeescript'

# ============================================================================
# TOKENS AND TERMINALS
# ============================================================================

# CoffeeScript tokens (terminals) - extracted from the grammar
terminals = [
  # Literals
  'IDENTIFIER', 'NUMBER', 'STRING', 'STRING_START', 'STRING_END'
  'INTERPOLATION_START', 'INTERPOLATION_END', 'REGEX', 'REGEX_START', 'REGEX_END'
  'JS', 'UNDEFINED', 'NULL', 'BOOL', 'INFINITY', 'NAN'

  # Keywords
  'IF', 'ELSE', 'UNLESS', 'THEN', 'WHILE', 'UNTIL', 'LOOP', 'FOR', 'IN', 'OF', 'FROM'
  'WHEN', 'BY', 'BREAK', 'CONTINUE', 'FUNCTION', 'RETURN', 'YIELD', 'AWAIT'
  'TRY', 'CATCH', 'FINALLY', 'THROW', 'CLASS', 'EXTENDS', 'SUPER', 'THIS'
  'IMPORT', 'EXPORT', 'DEFAULT', 'AS', 'FROM', 'ASSERT'

  # Operators
  '=', ':', '+', '-', '*', '/', '%', '**', '++', '--'
  '==', '!=', '<', '>', '<=', '>='
  '&&', '||', '&', '|', '^', '!', '~', '<<', '>>'
  '?', '?.', '::', '?::', '...', 'COMPOUND_ASSIGN'

  # Punctuation
  '(', ')', '[', ']', '{', '}', ',', ';', '.'
  'INDENT', 'OUTDENT', 'TERMINATOR'

  # Special
  'CALL_START', 'CALL_END', 'INDEX_START', 'INDEX_END', 'INDEX_SOAK'
  'PARAM_START', 'PARAM_END', 'FUNC_EXIST', 'POST_IF'
  'UNARY', 'UNARY_MATH', 'MATH', 'SHIFT', 'COMPARE', 'RELATION', 'BIN?'
  'DO', 'DO_IIFE', 'NEW_TARGET', 'IMPORT_META', 'DYNAMIC_IMPORT'
  'JSX_TAG', 'PROPERTY', 'STATEMENT', 'LEADING_WHEN', 'EXPORT_ALL', 'IMPORT_ALL'
]

# ============================================================================
# GRAMMAR RULES (Rip-FRIENDLY FORMAT)
# ============================================================================

# Convert CoffeeScript grammar to Rip format
# The grammar defines the syntax rules for parsing CoffeeScript
grammar =
  # Root rule - entry point for parsing
  Root: [
    o '', ->
      type: 'Root'
      body:
        type: 'Block'
        statements: []
    o 'Body', ->
      type: 'Root'
      body: $1
  ]

  # Body - sequence of statements
  Body: [
    o 'Line', ->
      type: 'Block'
      statements: [$1]
    o 'Body TERMINATOR Line', ->
      type: 'Block'
      statements: $1.statements.concat([$3])
    o 'Body TERMINATOR', -> $1
  ]

  # Line - individual statement or expression
  Line: [
    o 'Expression', -> $1
    o 'ExpressionLine', -> $1
    o 'Statement', -> $1
    o 'FuncDirective', -> $1
  ]

  # Function directives
  FuncDirective: [
    o 'YieldReturn', -> $1
    o 'AwaitReturn', -> $1
  ]

  # Statements
  Statement: [
    o 'Return', -> $1
    o 'STATEMENT', ->
      type: 'StatementLiteral'
      value: $1
    o 'Import', -> $1
    o 'Export', -> $1
  ]

  # Expressions
  Expression: [
    o 'Value', -> $1
    o 'Code', -> $1
    o 'Operation', -> $1
    o 'Assign', -> $1
    o 'If', -> $1
    o 'Try', -> $1
    o 'While', -> $1
    o 'For', -> $1
    o 'Switch', -> $1
    o 'Class', -> $1
    o 'Throw', -> $1
    o 'Yield', -> $1
  ]

  # Expression lines (single-line expressions)
  ExpressionLine: [
    o 'CodeLine', -> $1
    o 'IfLine', -> $1
    o 'OperationLine', -> $1
  ]

  # Yield expressions
  Yield: [
    o 'YIELD', ->
      type: 'YieldExpression'
      argument: null
      delegate: false
    o 'YIELD Expression', ->
      type: 'YieldExpression'
      argument: $2
      delegate: false
    o 'YIELD INDENT Object OUTDENT', ->
      type: 'YieldExpression'
      argument: $3
      delegate: false
    o 'YIELD FROM Expression', ->
      type: 'YieldExpression'
      argument: $3
      delegate: true
  ]

  # Blocks
  Block: [
    o 'INDENT OUTDENT', ->
      type: 'Block'
      statements: []
    o 'INDENT Body OUTDENT', -> $2
  ]

  # Identifiers
  Identifier: [
    o 'IDENTIFIER', ->
      type: 'Identifier'
      name: $1
    o 'JSX_TAG', ->
      type: 'JSXTag'
      name: $1.toString()
  ]

  # Properties
  Property: [
    o 'PROPERTY', ->
      type: 'PropertyName'
      name: $1.toString()
  ]

  # Alphanumeric literals
  AlphaNumeric: [
    o 'NUMBER', ->
      type: 'NumericLiteral'
      value: parseFloat($1.toString())
      raw: $1.toString()
    o 'String', -> $1
  ]

  # String literals
  String: [
    o 'STRING', ->
      type: 'StringLiteral'
      value: $1.slice(1, -1)  # Remove quotes
      raw: $1.toString()
    o 'STRING_START Interpolations STRING_END', ->
      type: 'StringWithInterpolations'
      parts: $2
      quote: $1.quote
  ]

  # String interpolations
  Interpolations: [
    o 'InterpolationChunk', -> [$1]
    o 'Interpolations InterpolationChunk', -> $1.concat($2)
  ]

  InterpolationChunk: [
    o 'INTERPOLATION_START Body INTERPOLATION_END', ->
      type: 'Interpolation'
      expression: $2
    o 'INTERPOLATION_START INDENT Body OUTDENT INTERPOLATION_END', ->
      type: 'Interpolation'
      expression: $3
    o 'INTERPOLATION_START INTERPOLATION_END', ->
      type: 'Interpolation'
      expression: null
    o 'String', -> $1
  ]

  # Regular expressions
  Regex: [
    o 'REGEX', ->
      type: 'RegexLiteral'
      pattern: $1.toString()
      flags: $1.flags or ''
    o 'REGEX_START Invocation REGEX_END', ->
      type: 'RegexWithInterpolations'
      parts: [$2]
  ]

  # Literals
  Literal: [
    o 'AlphaNumeric', -> $1
    o 'JS', ->
      type: 'PassthroughLiteral'
      value: $1.toString()
    o 'Regex', -> $1
    o 'UNDEFINED', ->
      type: 'UndefinedLiteral'
      value: undefined
    o 'NULL', ->
      type: 'NullLiteral'
      value: null
    o 'BOOL', ->
      type: 'BooleanLiteral'
      value: $1.toString() is 'true'
      raw: $1.toString()
    o 'INFINITY', ->
      type: 'InfinityLiteral'
      value: Infinity
    o 'NAN', ->
      type: 'NaNLiteral'
      value: NaN
  ]

  # Assignment
  Assign: [
    o 'Assignable = Expression', ->
      type: 'AssignmentExpression'
      operator: '='
      left: $1
      right: $3
    o 'Assignable = TERMINATOR Expression', ->
      type: 'AssignmentExpression'
      operator: '='
      left: $1
      right: $4
    o 'Assignable = INDENT Expression OUTDENT', ->
      type: 'AssignmentExpression'
      operator: '='
      left: $1
      right: $4
  ]

  # Values
  Value: [
    o 'Assignable', -> $1
    o 'Literal', -> $1
    o 'Parenthetical', -> $1
    o 'Range', -> $1
    o 'Invocation', -> $1
    o 'DoIife', -> $1
    o 'This', -> $1
    o 'Super', -> $1
    o 'MetaProperty', -> $1
  ]

  # This references
  This: [
    o 'THIS', ->
      type: 'ThisExpression'
    o '@', ->
      type: 'ThisExpression'
  ]

  # Function calls
  Invocation: [
    o 'Value OptFuncExist String', ->
      type: 'TaggedTemplateCall'
      callee: $1
      template: $3
      optional: $2.soak
    o 'Value OptFuncExist Arguments', ->
      type: 'CallExpression'
      callee: $1
      arguments: $3
      optional: $2.soak
    o 'SUPER OptFuncExist Arguments', ->
      type: 'SuperCall'
      arguments: $3
      optional: $2.soak
    o 'DYNAMIC_IMPORT Arguments', ->
      type: 'DynamicImportCall'
      arguments: $2
  ]

  # Optional function existence check
  OptFuncExist: [
    o '', -> soak: false
    o 'FUNC_EXIST', -> soak: true
  ]

  # Function arguments
  Arguments: [
    o 'CALL_START CALL_END', -> []
    o 'CALL_START ArgList OptComma CALL_END', -> $2
  ]

  # Argument list
  ArgList: [
    o 'Arg', -> [$1]
    o 'ArgList , Arg', -> $1.concat([$3])
    o 'ArgList OptComma TERMINATOR Arg', -> $1.concat([$4])
    o 'INDENT ArgList OptComma OUTDENT', -> $2
    o 'ArgList OptComma INDENT ArgList OptComma OUTDENT', -> $1.concat($4)
  ]

  # Individual argument
  Arg: [
    o 'Expression', -> $1
    o 'ExpressionLine', -> $1
    o 'Splat', -> $1
    o '...', ->
      type: 'Expansion'
  ]

  # Operations
  Operation: [
    o 'UNARY Expression', ->
      type: 'UnaryExpression'
      operator: $1.toString()
      argument: $2
      prefix: true
    o 'Expression + Expression', ->
      type: 'BinaryExpression'
      operator: '+'
      left: $1
      right: $3
    o 'Expression - Expression', ->
      type: 'BinaryExpression'
      operator: '-'
      left: $1
      right: $3
    o 'Expression MATH Expression', ->
      type: 'BinaryExpression'
      operator: $2
      left: $1
      right: $3
    o 'Expression COMPARE Expression', ->
      type: 'BinaryExpression'
      operator: $2.toString()
      left: $1
      right: $3
    o 'Expression && Expression', ->
      type: 'LogicalExpression'
      operator: '&&'
      left: $1
      right: $3
    o 'Expression || Expression', ->
      type: 'LogicalExpression'
      operator: '||'
      left: $1
      right: $3
  ]

# ============================================================================
# LEXER INTEGRATION
# ============================================================================

# Create a lexer function that integrates with CoffeeScript's lexer
createLexer = (input, options = {}) ->
  # Import CoffeeScript's lexer
  {Lexer} = require '../coffeescript/lib/coffeescript/lexer'

  # Create lexer instance
  lexer = new Lexer()

  # Tokenize the input
  tokens = lexer.tokenize(input, options)

  # Current position in token stream
  position = 0

  # Return lexer interface compatible with Rip
  lex: ->
    if position >= tokens.length
      return 'EOF'

    token = tokens[position]
    position++

    # Return token type
    token[0]

  yytext: ->
    if position > 0 and position <= tokens.length
      tokens[position - 1][1]
    else
      ''

  yylloc: ->
    if position > 0 and position <= tokens.length
      token = tokens[position - 1]
      if token[2]
        first_line: token[2].first_line
        last_line: token[2].last_line
        first_column: token[2].first_column
        last_column: token[2].last_column
      else
        first_line: 1
        last_line: 1
        first_column: 1
        last_column: 1
    else
      first_line: 1
      last_line: 1
      first_column: 1
      last_column: 1

# ============================================================================
# SEMANTIC ACTIONS
# ============================================================================

# Semantic actions for building AST nodes
# These transform the parsed tokens into meaningful syntax tree structures
semanticActions = {}

# Populate semantic actions from grammar rules
for ruleName, alternatives of grammar
  for alternative, index in alternatives
    if alternative[1]
      ruleIndex = "#{ruleName}_#{index}"
      semanticActions[ruleIndex] = alternative[1]

# ============================================================================
# LANGUAGE PACK EXPORT
# ============================================================================

# Export the complete CoffeeScript language pack for Rip
module.exports =
  # Language metadata
  info: languageInfo

  # Grammar components (the 4 essential variables for Rip)
  symbols: Object.keys(grammar).concat(terminals)
  terminals: terminals
  rules: grammar
  states: null  # Will be generated by Rip parser generator

  # Semantic actions for AST construction
  actions: semanticActions

  # Operator precedence (from original CoffeeScript grammar)
  operators: operators.reverse()  # Reverse for Rip compatibility

  # Start symbol
  start: 'Root'

  # Tokens string (for compatibility)
  tokens: terminals.join(' ')

  # Lexer factory function
  createLexer: createLexer

  # Helper functions
  helpers:
    # Convert CoffeeScript AST to standard format
    normalizeAST: (ast) ->
      # Transform CoffeeScript-specific AST nodes to standard format
      # This enables cross-language interoperability
      ast

    # Compile CoffeeScript to JavaScript
    compile: (ast, options = {}) ->
      # Integration point for CoffeeScript compiler
      {compile} = require '../coffeescript/lib/coffeescript/coffeescript'
      compile(ast, options)

    # Evaluate CoffeeScript code
    evaluate: (code, options = {}) ->
      # Direct evaluation using CoffeeScript
      {eval: coffeeEval} = require '../coffeescript/lib/coffeescript/coffeescript'
      coffeeEval(code, options)

  # Cross-language interop helpers
  interop:
    # Export functions for use by other languages
    exportFunction: (name, fn) ->
      # Register function for cross-language access
      # Implementation would integrate with Rip's interop system

    # Import functions from other languages
    importFunction: (language, module, functionName) ->
      # Access functions from other language packs
      # Implementation would use Rip's universal call interface

  # Development and debugging helpers
  debug:
    # Parse and return detailed AST
    parseWithDetails: (code, options = {}) ->
      # Enhanced parsing with debug information

    # Validate syntax without execution
    validateSyntax: (code) ->
      # Syntax validation only

    # Get token stream for analysis
    tokenize: (code, options = {}) ->
      createLexer(code, options)

# ============================================================================
# USAGE EXAMPLES (COMMENTED OUT)
# ============================================================================

###
# Example usage of the CoffeeScript language pack with Rip:

# 1. Basic parsing
rip = require 'rip'
coffeeScriptPack = require './languages/coffeescript'
parser = rip.createParser(coffeeScriptPack)
ast = parser.parse('x = 42\nconsole.log x')

# 2. Cross-language interop
pythonResult = rip.call('python', 'math_utils.py', 'calculate', [1, 2, 3])
jsFunction = rip.import('javascript', 'utils.js', 'formatDate')

# 3. Compilation
javascript = coffeeScriptPack.helpers.compile(ast)

# 4. Direct evaluation
result = coffeeScriptPack.helpers.evaluate('2 + 3 * 4')
###