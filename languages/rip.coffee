# Rip Language Pack - A modern echo of CoffeeScript

# ============================================================================
# LANGUAGE METADATA
# ============================================================================

languageInfo =
  name: 'Rip'
  version: '1.0.0'
  description: 'A modern echo of CoffeeScript'
  author: 'Rip Language Team'
  license: 'MIT'
  website: 'https://rip-lang.org'
  repository: 'https://github.com/rip-lang/rip'

# ============================================================================
# HYBRID GRAMMAR SYSTEM
# ============================================================================

# Smart constructor system for AST nodes - Direct Usage Style
# These are used directly in grammar rules for clarity and flexibility

# Core structural nodes
Root         = (body)                           -> new Root(body or new Block)
Block        = (statements = [])                -> new Block statements

# Expressions
Binary       = (op, left, right)                -> new Op op, left, right
Unary        = (op, arg, prefix = true)         -> new Op op, arg, null, not prefix
Assign       = (op, left, right)                -> new Assign left, right, op
Call         = (callee, args, optional = false) -> new Call callee, args, optional

# Literals
NumberLit    = (value, raw)                     -> new NumberLiteral value, parsedValue: parseFloat(value)
StringLit    = (value, raw)                     -> new StringLiteral value.slice(1, -1), quote: value[0]
BooleanLit   = (value, raw)                     -> new BooleanLiteral value.toString(), originalValue: value
NullLit      =                                  -> new NullLiteral
UndefinedLit =                                  -> new UndefinedLiteral
RegexLit     = (pattern, flags)                 -> new RegexLiteral pattern, flags

# Identifiers and references
Id           = (name)                           -> new IdentifierLiteral name
This         =                                  -> new Value new ThisLiteral
PropertyName = (name)                           -> new PropertyName name

# Control flow
If           = (test, consequent, alternate)    -> new If test, consequent, alternate
While        = (test, body)                     -> new While test, body
Return       = (arg)                            -> new Return arg

# Functions
Function     = (params, body, glyph = '->')     -> new Code params, body, glyph
Arrow        = (params, body)                   -> new Code params, body, '=>'

# Collections
List         = (item)                           -> [item]
Concat       = (list, item)                     -> list.concat(item)
Push         = (list, item)                     -> list.push(item); list

# Values and accessors
Value        = (base, properties = [])          -> new Value base, properties
Access       = (property)                       -> new Access property
Index        = (expr)                           -> new Index expr

# Missing constructors for consistency
SuperCall    = (args)                           -> new SuperCall(new Super, args)
Property     = (key, value)                     -> new Property key, value
ArrayExpr    = (elements = [])                  -> new Arr elements
ObjectExpr   = (properties = [])                -> new Obj properties
StatementLit = (value)                          -> new StatementLiteral value
YieldReturn  = (arg)                            -> new YieldReturn arg
AwaitReturn  = (arg)                            -> new AwaitReturn arg

# Utility constructors
Literal      = (value)                          -> new Literal value

# ============================================================================
# COMPACT GRAMMAR RULES
# ============================================================================

o = (pattern, action, options) -> [pattern, action or (-> $1), options]

grammar =
  # Root - ultra-compact
  Root: [
    o '',                                       -> Root()
    o 'Body',                                   -> Root $1
  ]

  # Body - simple and clean
  Body: [
    o 'Line',                                   -> Block [$1]
    o 'Body TERMINATOR Line',                   -> Block $1.statements.concat [$3]
    o 'Body TERMINATOR'
  ]

  # Line - pass-through by default
  Line: [
    o 'Expression'
    o 'Statement'
    o 'FuncDirective'
  ]

  # Statements
  Statement: [
    o 'Return'
    o 'Import'
    o 'Export'
    o 'Class'
    o 'STATEMENT',                              -> StatementLit $1
  ]

  # Expressions - mostly pass-through
  Expression: [
    o 'Value'
    o 'Code'
    o 'Operation'
    o 'Assign'
    o 'If'
    o 'While'
    o 'For'
    o 'Try'
    o 'Throw'
  ]

  # Values - clean and simple
  Value: [
    o 'Literal'
    o 'Identifier'
    o 'This'
    o 'Parenthetical'
    o 'Array'
    o 'Object'
    o 'Invocation'
  ]

  # Identifiers
  Identifier: [
    o 'IDENTIFIER',                             -> Id $1
  ]

  # This references
  This: [
    o 'THIS',                                   -> This()
    o '@',                                      -> This()
  ]

  # Literals - direct constructor usage
  Literal: [
    o 'NUMBER',                                 -> NumberLit  $1, $1.toString()
    o 'STRING',                                 -> StringLit  $1, $1.toString()
    o 'BOOL',                                   -> BooleanLit $1, $1.toString()
    o 'NULL',                                   -> NullLit()
    o 'UNDEFINED',                              -> UndefinedLit()
    o 'REGEX',                                  -> RegexLit $1
  ]

  # Operations - direct constructor usage for clarity
  Operation: [
    # Unary operations
    o 'UNARY Expression',                       -> Unary $1  , $2
    o '- Expression',                           -> Unary '-' , $2
    o '+ Expression',                           -> Unary '+' , $2
    o '++ SimpleAssignable',                    -> Unary '++', $2
    o '-- SimpleAssignable',                    -> Unary '--', $2
    o 'SimpleAssignable ++',                    -> Unary '++', $1, false
    o 'SimpleAssignable --',                    -> Unary '--', $1, false

    # Binary operations
    o 'Expression +  Expression',               -> Binary '+' , $1, $3
    o 'Expression -  Expression',               -> Binary '-' , $1, $3
    o 'Expression *  Expression',               -> Binary '*' , $1, $3
    o 'Expression /  Expression',               -> Binary '/' , $1, $3
    o 'Expression %  Expression',               -> Binary '%' , $1, $3
    o 'Expression ** Expression',               -> Binary '**', $1, $3
    o 'Expression == Expression',               -> Binary '==', $1, $3
    o 'Expression != Expression',               -> Binary '!=', $1, $3
    o 'Expression <  Expression',               -> Binary '<' , $1, $3
    o 'Expression >  Expression',               -> Binary '>' , $1, $3
    o 'Expression <= Expression',               -> Binary '<=', $1, $3
    o 'Expression >= Expression',               -> Binary '>=', $1, $3
    o 'Expression && Expression',               -> Binary '&&', $1, $3
    o 'Expression || Expression',               -> Binary '||', $1, $3
    o 'Expression &  Expression',               -> Binary '&' , $1, $3
    o 'Expression |  Expression',               -> Binary '|' , $1, $3
    o 'Expression ^  Expression',               -> Binary '^' , $1, $3
    o 'Expression << Expression',               -> Binary '<<', $1, $3
    o 'Expression >> Expression',               -> Binary '>>', $1, $3
  ]

  # Assignment - direct constructor usage
  Assign: [
    o 'Assignable  = Expression',               -> Assign '=' , $1, $3
    o 'Assignable += Expression',               -> Assign '+=', $1, $3
    o 'Assignable -= Expression',               -> Assign '-=', $1, $3
    o 'Assignable *= Expression',               -> Assign '*=', $1, $3
    o 'Assignable /= Expression',               -> Assign '/=', $1, $3
  ]

  # Assignable targets
  Assignable: [
    o 'Identifier'
    o 'Value Accessor',                         -> Value $1, [$2]
  ]

  SimpleAssignable: [
    o 'Identifier'
    o 'Value Accessor',                         -> Value $1, [$2]
  ]

  # Function calls - clean and simple
  Invocation: [
    o 'Value Arguments',                        -> Call $1, $2
    o 'Value ? Arguments',                      -> Call $1, $3, true
    o 'SUPER Arguments',                        -> SuperCall $2
  ]

  # Arguments
  Arguments: [
    o 'CALL_START CALL_END',                    -> []
    o 'CALL_START ArgList CALL_END',            -> $2
  ]

  # Argument list - direct usage
  ArgList: [
    o 'Expression',                             -> List $1
    o 'ArgList , Expression',                   -> Concat $1, $3
  ]

  # Arrays - simple and clean
  Array: [
    o '[ ]',                                    -> ArrayExpr []
    o '[ ArgList ]',                            -> ArrayExpr $2
  ]

  # Objects
  Object: [
    o '{ }',                                    -> ObjectExpr []
    o '{ PropertyList }',                       -> ObjectExpr $2
  ]

  # Property list
  PropertyList: [
    o 'Property',                               -> List $1
    o 'PropertyList , Property',                -> Concat $1, $3
  ]

  # Object properties
  Property: [
    o 'IDENTIFIER : Expression',                -> Property (Id $1       ), $3
    o 'STRING : Expression',                    -> Property (StringLit $1), $3
    o 'NUMBER : Expression',                    -> Property (NumberLit $1), $3
  ]

  # Parenthetical expressions
  Parenthetical: [
    o '( Expression )',                         -> $2
  ]

  # Control flow - if statements
  If: [
    o 'IF Expression Block',                    -> If $2, $3
    o 'IF Expression Block ELSE Block',         -> If $2, $3, $5
    o 'Expression IF Expression',               -> If $3, Block [$1]
  ]

  # Blocks
  Block: [
    o 'INDENT Body OUTDENT',                    -> $2
    o 'INDENT OUTDENT',                         -> Block []
  ]

  # Return statements
  Return: [
    o 'RETURN',                                 -> Return()
    o 'RETURN Expression',                      -> Return $2
  ]

  # Functions - compact format
  Code: [
    o 'PARAM_START ParamList PARAM_END -> Block',  -> Function $2, $5
    o 'PARAM_START ParamList PARAM_END => Block',  -> Arrow    $2, $5
    o '-> Block',                                  -> Function [], $2
    o '=> Block',                                  -> Arrow    [], $2
  ]

  # Parameter list
  ParamList: [
    o '',                                       -> []
    o 'IDENTIFIER',                             -> [Id $1]
    o 'ParamList , IDENTIFIER',                 -> $1.concat [Id $3]
  ]

  # Accessors
  Accessor: [
    o '. IDENTIFIER',                           -> Access PropertyName $2
    o '[ Expression ]',                         -> Index $2
  ]

  # Optional comma
  OptComma: [
    o ''
    o ','
  ]

  # Function directives
  FuncDirective: [
    o 'YieldReturn'
    o 'AwaitReturn'
  ]

  YieldReturn: [
    o 'YIELD RETURN',                           -> YieldReturn null
    o 'YIELD RETURN Expression',                -> YieldReturn $3
  ]

  AwaitReturn: [
    o 'AWAIT RETURN',                           -> AwaitReturn null
    o 'AWAIT RETURN Expression',                -> AwaitReturn $3
  ]

# ============================================================================
# OPERATOR PRECEDENCE
# ============================================================================

operators = [
  ['right', '=>', '->']
  ['left' , 'IF', 'UNLESS', 'WHILE', 'UNTIL']
  ['right', '=', '+=', '-=', '*=', '/=']
  ['left' , '||']
  ['left' , '&&']
  ['left' , '|']
  ['left' , '^']
  ['left' , '&']
  ['left' , '==', '!=']
  ['left' , '<', '>', '<=', '>=']
  ['left' , '<<', '>>']
  ['left' , '+', '-']
  ['left' , '*', '/', '%']
  ['right', 'UNARY', '++', '--']
  ['right', '**']
  ['left' , '.']
  ['left' , 'CALL_START', 'CALL_END']
]

# ============================================================================
# LEXER INTEGRATION
# ============================================================================

createLexer = (input, options = {}) ->
  tokens = []
  position = 0

  # Simple tokenizer for our test case: "x = 41 + 1"
  tokenize = (input) ->
    tokens = []
    i = 0

    while i < input.length
      char = input[i]

      # Skip whitespace
      if /\s/.test(char)
        i++
        continue

      # Numbers
      if /\d/.test(char)
        start = i
        while i < input.length and /\d/.test(input[i])
          i++
        tokens.push(['NUMBER', input.slice(start, i)])
        continue

      # Identifiers
      if /[a-zA-Z_]/.test(char)
        start = i
        while i < input.length and /[a-zA-Z_0-9]/.test(input[i])
          i++
        tokens.push(['IDENTIFIER', input.slice(start, i)])
        continue

      # Operators and symbols
      switch char
        when '='
          tokens.push(['=', '='])
        when '+'
          tokens.push(['+', '+'])
        when '-'
          tokens.push(['-', '-'])
        when '*'
          tokens.push(['*', '*'])
        when '/'
          tokens.push(['/', '/'])
        when '('
          tokens.push(['(', '('])
        when ')'
          tokens.push([')', ')'])
        else
          throw new Error("Unexpected character: #{char}")

      i++

    tokens.push(['EOF', ''])
    return tokens

  tokens = tokenize(input)
  console.log "Tokens:", tokens  # Debug output

  lex: ->
    if position >= tokens.length
      return 'EOF'
    token = tokens[position++]
    @yytext = token[1]
    return token[0]

  yytext: ''
  yylloc: {first_line: 1, last_line: 1, first_column: 1, last_column: 1}

# ============================================================================
# TEST FUNCTION
# ============================================================================

testSimpleAssignment = ->
  console.log "Testing: x = 41 + 1"

  # Create a mock parser environment
  lexer = createLexer("x = 41 + 1")

  # Mock AST node classes for testing
  global.Root = class Root
    constructor: (@body) ->
    toString: -> "Root(#{@body})"

  global.Block = class Block
    constructor: (@statements) ->
    toString: -> "Block([#{@statements.join(', ')}])"

  global.Assign = class Assign
    constructor: (@left, @right, @op) ->
    toString: -> "Assign(#{@left}, #{@op}, #{@right})"

  global.Op = class Op
    constructor: (@op, @left, @right, @flip) ->
    toString: -> "Op(#{@op}, #{@left}, #{@right})"

  global.IdentifierLiteral = class IdentifierLiteral
    constructor: (@name) ->
    toString: -> "Id(#{@name})"

  global.NumberLiteral = class NumberLiteral
    constructor: (@value, @options) ->
    toString: -> "Num(#{@value})"

  # Test the lexer
  console.log "Lexer test:"
  testLexer = createLexer("x = 41 + 1")
  while true
    token = testLexer.lex()
    console.log "Token:", token, "Text:", testLexer.yytext
    break if token == 'EOF'

  console.log "Grammar rules that should match:"
  console.log "- Root -> Body"
  console.log "- Body -> Line"
  console.log "- Line -> Expression"
  console.log "- Expression -> Assign"
  console.log "- Assign -> Assignable = Expression"
  console.log "- Assignable -> Identifier"
  console.log "- Identifier -> IDENTIFIER"
  console.log "- Expression -> Operation"
  console.log "- Operation -> Expression + Expression"
  console.log "- Expression -> Value"
  console.log "- Value -> Literal"
  console.log "- Literal -> NUMBER"

# ============================================================================
# LANGUAGE PACK EXPORT
# ============================================================================

languagePack =
  # Language metadata
  info: languageInfo

  # Core grammar data
  symbols: Object.keys(grammar)
  rules: grammar
  states: null  # Generated by Rip

  # Operator precedence
  operators: operators.reverse()

  # Start symbol
  start: 'Root'

  # Lexer factory
  createLexer: createLexer

  # Optional: Override automatic terminal detection if needed
  # terminals: [1, 2, 3, ...]  # Uncomment to provide explicit terminal list
  #
  # Advanced: If you need to compute terminals from a different grammar format:
  # terminals: () -> Generator.determineTerminalsFromGrammar(@symbols, @rules)

  # Direct constructor functions
  constructors: {
    Root, Block, Binary, Unary, Assign, Call,
    NumberLit, StringLit, BooleanLit, NullLit, UndefinedLit, RegexLit,
    Id, This, PropertyName, Property, If, While, Return, Function, Arrow,
    List, Concat, Push, Value, Access, Index, Literal,
    SuperCall, ArrayExpr, ObjectExpr, StatementLit, YieldReturn, AwaitReturn
  }

  # Enhanced 'o' helper
  o: o

  # Utilities
  helpers:
    # Convert to standard AST format
    normalize: (ast) -> ast

    # Compile to JavaScript
    compile: (ast) -> "// Compiled Rip → JavaScript would go here"

    # Evaluate code
    evaluate: (code) -> "// Rip evaluation result"

  # Development helpers
  debug:
    showGrammar: -> console.log grammar
    showAST: -> console.log "Rip AST structure"
    testSimple: testSimpleAssignment

# ============================================================================
# RIP LANGUAGE FEATURES
# ============================================================================

###
# Rip Language Features (v1.0):
#
# ✅ INCLUDED (from CoffeeScript):
# - Elegant syntax with significant whitespace
# - Arrow functions (-> and =>)
# - Classes and inheritance
# - Destructuring assignment
# - String interpolation
# - Comprehensions
# - Existential operators (? and ?.)
# - Splats and rest parameters
# - Async/await support
# - Import/export statements
# - All standard operators and control flow
#
# ❌ REMOVED (from CoffeeScript):
# - JSX support (JSX_TAG, JSX_CLOSE tokens)
# - Literate CoffeeScript (.litcoffee files)
# - JSX-related grammar rules
# - Literate comment parsing
#
# 🚀 FUTURE ENHANCEMENTS:
# - Optional typing
# - Pattern matching
# - Pipe operators
# - Enhanced error handling
# - Universal parser integration
# - Cross-language interop
# - WASM compilation
###

# Export for ES6 modules (modern approach)
export default languagePack

# Also support named exports for flexibility
export {
  languageInfo,
  grammar,
  operators,
  createLexer,
  testSimpleAssignment,

  # Export constructor functions for direct use
  Root, Block, Binary, Unary, Assign, Call,
  NumberLit, StringLit, BooleanLit, NullLit, UndefinedLit, RegexLit,
  Id, This, PropertyName, Property, If, While, Return, Function, Arrow,
  List, Concat, Push, Value, Access, Index, Literal,
  SuperCall, ArrayExpr, ObjectExpr, StatementLit, YieldReturn, AwaitReturn
}