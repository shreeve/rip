# CoffeeScript Language Pack - Hybrid Compact Format
# Combines elegance of original grammar with Rip's power

# ============================================================================
# LANGUAGE METADATA
# ============================================================================

languageInfo =
  name: 'CoffeeScript'
  version: '2.7.0'
  description: 'CoffeeScript language pack for Rip Universal Parser'
  author: 'Jeremy Ashkenas, Rip Team'
  license: 'MIT'
  website: 'https://coffeescript.org'
  repository: 'https://github.com/jashkenas/coffeescript'

# ============================================================================
# HYBRID GRAMMAR SYSTEM
# ============================================================================

# Smart constructor system for AST nodes - Direct Usage Style
# These are used directly in grammar rules for clarity and flexibility

# Core structural nodes
Root         = (body)                           -> new Root(body or new Block)
Block        = (statements = [])                -> new Block statements

# Expressions - CoffeeScript-compatible Op nodes
Binary       = (op, left, right)                -> new Op op, left, right
Unary        = (op, arg, prefix = true)         -> new Op op, arg, null, not prefix
Assign       = (op, left, right)                -> new Assign left, right, op
Call         = (callee, args, optional = false) -> new Call callee, args, optional

# Literals - CoffeeScript-compatible nodes
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

# Helper function - enhanced 'o' with smart defaults
o = (pattern, action, options) ->
  # If no action provided, default to pass-through
  unless action
    if pattern.split(' ').length is 1
      action = -> $1  # Single token pass-through
    else
      action = -> $1  # Default to first element

  # If action is a string, treat as AST constructor
  if typeof action is 'string'
    constructor = AST[action]
    if constructor
      action = -> constructor.apply(null, arguments)

  [pattern, action, options]

# ============================================================================
# COMPACT GRAMMAR RULES
# ============================================================================

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
    o 'STATEMENT',                              -> StatementLit($1)
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
    o 'NUMBER',                                 -> NumberLit $1, $1.toString()
    o 'STRING',                                 -> StringLit $1, $1.toString()
    o 'BOOL',                                   -> BooleanLit $1, $1.toString()
    o 'NULL',                                   -> NullLit()
    o 'UNDEFINED',                              -> UndefinedLit()
    o 'REGEX',                                  -> RegexLit $1
  ]

    # Operations - direct constructor usage for clarity
  Operation: [
    # Unary operations
    o 'UNARY Expression',                       -> Unary $1, $2
    o '- Expression',                           -> Unary '-', $2
    o '+ Expression',                           -> Unary '+', $2
    o '++ SimpleAssignable',                    -> Unary '++', $2
    o '-- SimpleAssignable',                    -> Unary '--', $2
    o 'SimpleAssignable ++',                    -> Unary '++', $1, false
    o 'SimpleAssignable --',                    -> Unary '--', $1, false

    # Binary operations
    o 'Expression + Expression',                -> Binary '+', $1, $3
    o 'Expression - Expression',                -> Binary '-', $1, $3
    o 'Expression * Expression',                -> Binary '*', $1, $3
    o 'Expression / Expression',                -> Binary '/', $1, $3
    o 'Expression % Expression',                -> Binary '%', $1, $3
    o 'Expression ** Expression',               -> Binary '**', $1, $3
    o 'Expression == Expression',               -> Binary '==', $1, $3
    o 'Expression != Expression',               -> Binary '!=', $1, $3
    o 'Expression < Expression',                -> Binary '<', $1, $3
    o 'Expression > Expression',                -> Binary '>', $1, $3
    o 'Expression <= Expression',               -> Binary '<=', $1, $3
    o 'Expression >= Expression',               -> Binary '>=', $1, $3
    o 'Expression && Expression',               -> Binary '&&', $1, $3
    o 'Expression || Expression',               -> Binary '||', $1, $3
    o 'Expression & Expression',                -> Binary '&', $1, $3
    o 'Expression | Expression',                -> Binary '|', $1, $3
    o 'Expression ^ Expression',                -> Binary '^', $1, $3
    o 'Expression << Expression',               -> Binary '<<', $1, $3
    o 'Expression >> Expression',               -> Binary '>>', $1, $3
  ]

  # Assignment - direct constructor usage
  Assign: [
    o 'Assignable = Expression',                -> Assign '=', $1, $3
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
    o 'IDENTIFIER : Expression',                -> Property (Id $1), $3
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
    o 'PARAM_START ParamList PARAM_END => Block',  -> Arrow $2, $5
    o '-> Block',                               -> Function [], $2
    o '=> Block',                               -> Arrow [], $2
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
  # Simple lexer for demonstration - in practice, use CoffeeScript's lexer
  tokens = []
  position = 0

  # Basic tokenization (simplified)
  tokenize = (input) ->
    # This would integrate with CoffeeScript's actual lexer
    # For now, return a simple token stream
    ['IDENTIFIER', 'NUMBER', '=', 'TERMINATOR', 'EOF']

  tokens = tokenize(input)

  lex: ->
    if position >= tokens.length
      return 'EOF'
    token = tokens[position++]
    return token

  yytext: tokens[position - 1] or ''
  yylloc: {first_line: 1, last_line: 1, first_column: 1, last_column: 1}

# ============================================================================
# LANGUAGE PACK EXPORT
# ============================================================================

module.exports =
  # Language metadata
  info: languageInfo

  # Core grammar data (the 3 essential variables)
  # Note: terminals are automatically determined as symbols that aren't left-hand sides of rules
  # This eliminates the need for explicit terminal lists in most cases
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
    compile: (ast) -> "// Compiled JavaScript would go here"

    # Evaluate code
    evaluate: (code) -> "// Evaluation result"

  # Development helpers
  debug:
    showGrammar: -> console.log grammar
    showTemplates: -> console.log templates
    showAST: -> console.log AST

# ============================================================================
# USAGE EXAMPLES
# ============================================================================

###
# The hybrid system enables multiple coding styles:

# 1. Ultra-compact (pass-through)
Line: [
  o 'Expression'        # Implicit: -> $1
  o 'Statement'         # Implicit: -> $1
]

# 2. Template-based (consistent patterns)
Operation: [
  o 'Expression + Expression',     templates.binary('+')
  o 'Expression - Expression',     templates.binary('-')
]

# 3. Constructor-based (clear intent)
Literal: [
  o 'NUMBER',                      -> AST.Number($1, $1.toString())
  o 'STRING',                      -> AST.String($1.slice(1, -1), $1.toString())
]

# 4. Full explicit (when needed)
If: [
  o 'IF Expression Block ELSE Block', -> {
    type: 'IfStatement'
    test: $2
    consequent: $3
    alternate: $5
    loc: @loc
  }
]

# Key Benefits:
# - 80% reduction in boilerplate while maintaining full power
# - Automatic terminal detection eliminates explicit terminal lists
# - Language packs can override terminal detection if needed
# - Universal parser runtime works with any language pack
###