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
# COMPLETE CONSTRUCTOR SYSTEM
# ============================================================================

# Core structural nodes
Root                      = (body)                              -> new Root(body or new Block)
Block                     = (statements = [])                   -> new Block statements
Line                      = (expr)                              -> expr
Body                      = (statements)                        -> Block statements

# Literals
NumberLiteral             = (value, opts = {})                  -> new NumberLiteral value.toString(), ({ parsedValue = value.parsedValue } = opts)
StringLiteral             = (value, opts = {})                  -> new StringLiteral value.slice(1, -1), ({ quote = value.quote, initialChunk = value.initialChunk, finalChunk = value.finalChunk, indent = value.indent, double = value.double, heregex = value.heregex } = opts)
StringWithInterpolations  = (interpolations, opts = {})         -> new StringWithInterpolations Block.wrap(interpolations), ({ quote, startQuote } = opts.quote)
BooleanLiteral            = (value, opts = {})                  -> new BooleanLiteral value.toString(), ({ originalValue = value.original } = opts)
NullLiteral               = (value)                             -> new NullLiteral value
UndefinedLiteral          = (value)                             -> new UndefinedLiteral value
InfinityLiteral           = (value, opts = {})                  -> new InfinityLiteral value.toString(), ({ originalValue = value.original } = opts)
NaNLiteral                = (value)                             -> new NaNLiteral value
RegexLiteral              = (value, opts = {})                  -> new RegexLiteral value.toString(), ({ delimiter = value.delimiter, heregexCommentTokens = value.heregexCommentTokens } = opts)
RegexWithInterpolations   = (invocation, opts = {})             -> new RegexWithInterpolations invocation, ({ heregexCommentTokens } = opts)
PassthroughLiteral        = (value, opts = {})                  -> new PassthroughLiteral value.toString(), ({ here = value.here, generated = value.generated } = opts)
Literal                   = (value)                             -> new Literal value
StatementLiteral          = (value)                             -> new StatementLiteral value
DefaultLiteral            = (value)                             -> new DefaultLiteral value

# Identifiers and references
IdentifierLiteral         = (name)                              -> new IdentifierLiteral name
PropertyName              = (name)                              -> new PropertyName name.toString()
ComputedPropertyName      = (expr)                              -> new ComputedPropertyName expr
ThisLiteral               = (value)                             -> new ThisLiteral value

# Values and expressions
Value                     = (base, properties = [], context)    -> new Value base, properties, context
Op                        = (op, left, right, flip, opts = {})  -> new Op op, left, right, flip, ({ originalOperator, invertOperator } = opts)
Existence                 = (expr)                              -> new Existence expr
Assign                    = (left, right, context, opts = {})   -> new Assign left, right, context, ({ operatorToken, originalContext, moduleDeclaration } = opts)

# Function related
Code                      = (params, body, glyph, opts = {})    -> new Code params, body, glyph, opts.paramStart
FuncGlyph                 = (glyph)                             -> new FuncGlyph glyph
Param                     = (name, fallback, splat, opts = {})  -> new Param name, fallback, splat, ({ postfix } = opts)
Expansion                 = ()                                  -> new Expansion
Splat                     = (name, opts = {})                   -> new Splat name, ({ postfix } = opts)

# Function calls
Call                      = (variable, args, soak)              -> new Call variable, args, soak
SuperCall                 = (superKeyword, args, soak, token)   -> new SuperCall superKeyword, args, soak, token
DynamicImportCall         = (importKeyword, args)               -> new DynamicImportCall importKeyword, args
TaggedTemplateCall        = (variable, arg, soak)               -> new TaggedTemplateCall variable, arg, soak
Super                     = (accessor, superKeyword)            -> new Super accessor, superKeyword
MetaProperty              = (meta, property)                    -> new MetaProperty meta, property
DynamicImport             = ()                                  -> new DynamicImport

# Control flow
If                        = (condition, body, opts = {})        -> new If condition, body, ({ type, postfix } = opts)
While                     = (condition, opts = {})              -> new While condition, ({ guard, invert, isLoop } = opts)
For                       = (body, opts = {})                   -> new For body, ({source, guard, step, name, index, awaitTag, own, ownTag, object, from, postfix} = opts) #!# FIXME: lost 'await'?
Switch                    = (subject, cases, defaultCase)       -> new Switch subject, cases, defaultCase
SwitchWhen                = (conditions, body)                  -> new SwitchWhen conditions, body
Try                       = (attempt, err, recover, ensure, kw) -> new Try attempt, err, recover, ensure, kw
Catch                     = (body, err)                         -> new Catch body, err
Throw                     = (expression)                        -> new Throw expression
Return                    = (expression)                        -> new Return expression
YieldReturn               = (expression, opts = {})             -> new YieldReturn expression, ({ returnKeyword } = opts)
AwaitReturn               = (expression, opts = {})             -> new AwaitReturn expression, ({ returnKeyword } = opts)

# Collections
Arr                       = (objects)                           -> new Arr objects
Obj                       = (properties, generated)             -> new Obj properties, generated
Range                     = (from, to, exclusive)               -> new Range from, to, exclusive
Slice                     = (range)                             -> new Slice range
Elision                   = ()                                  -> new Elision

# Accessors
Access                    = (name, opts = {})                   -> new Access name, ({ soak, shorthand } = opts)
Index                     = (index, opts = {})                  -> new Index index, ({ soak            } = opts)

# Interpolation
Interpolation             = (expression)                        -> new Interpolation expression

# Classes
Class                     = (variable, superclass, body)        -> new Class variable, superclass, body

# Modules
ImportDeclaration         = (clause, source, assertions)        -> new ImportDeclaration clause, source, assertions
ImportClause              = (defaultBinding, namedImports)      -> new ImportClause defaultBinding, namedImports
ImportDefaultSpecifier    = (local)                             -> new ImportDefaultSpecifier local
ImportNamespaceSpecifier  = (local, imported)                   -> new ImportNamespaceSpecifier local, imported
ImportSpecifier           = (imported, local)                   -> new ImportSpecifier imported, local
ImportSpecifierList       = (specifiers)                        -> new ImportSpecifierList specifiers
ExportNamedDeclaration    = (specifiers, source, assertions)    -> new ExportNamedDeclaration specifiers, source, assertions
ExportDefaultDeclaration  = (declaration)                       -> new ExportDefaultDeclaration declaration
ExportAllDeclaration      = (exported, source, assertions)      -> new ExportAllDeclaration exported, source, assertions
ExportSpecifier           = (local, exported)                   -> new ExportSpecifier local, exported
ExportSpecifierList       = (specifiers)                        -> new ExportSpecifierList specifiers

# Parentheses and utilities
Parens                    = (body)                              -> new Parens body
extend                    = (object, properties)                -> yy.extend object, properties

# Utility functions
BlockWrap                 = (statements)                        -> Block.wrap statements
List                      = (item)                              -> [item]
Concat                    = (list, item)                        -> list.concat item
Push                      = (list, item)                        -> list.push item; list

# ============================================================================
# COMPLETE GRAMMAR RULES
# ============================================================================

# Beautiful, aligned grammar rules extracted from the complete reference
o = (pattern, action, options) -> [pattern, action or (-> $1), options]

grammar =

  Root: [
    o '',                                                           -> Root()
    o 'Body',                                                       -> Root $1
  ]

  Body: [
    o 'Line',                                                       -> BlockWrap [$1]
    o 'Body TERMINATOR Line',                                       -> $1.push $3
    o 'Body TERMINATOR'
  ]

  Line: [
    o 'Expression'
    o 'ExpressionLine'
    o 'Statement'
    o 'FuncDirective'
  ]

  FuncDirective: [
    o 'YieldReturn'
    o 'AwaitReturn'
  ]

  Statement: [
    o 'Return'
    o 'STATEMENT',                                                  -> StatementLiteral $1
    o 'Import'
    o 'Export'
  ]

  Expression: [
    o 'Value'
    o 'Code'
    o 'Operation'
    o 'Assign'
    o 'If'
    o 'Try'
    o 'While'
    o 'For'
    o 'Switch'
    o 'Class'
    o 'Throw'
    o 'Yield'
  ]

  ExpressionLine: [
    o 'CodeLine'
    o 'IfLine'
    o 'OperationLine'
  ]

  Yield: [
    o 'YIELD',                                                      -> Op $1, Value(Literal '')
    o 'YIELD Expression',                                           -> Op $1, $2
    o 'YIELD INDENT Object OUTDENT',                                -> Op $1, $3
    o 'YIELD FROM Expression',                                      -> Op $1.concat($2), $3
  ]

  Block: [
    o 'INDENT OUTDENT',                                             -> Block()
    o 'INDENT Body OUTDENT',                                        -> $2
  ]

  Identifier: [
    o 'IDENTIFIER',                                                 -> IdentifierLiteral $1
  ]

  Property: [
    o 'PROPERTY',                                                   -> PropertyName $1.toString()
  ]

  AlphaNumeric: [
    o 'NUMBER',                                                     -> NumberLiteral $1.toString(), parsedValue: $1.parsedValue
    o 'String'
  ]

  String: [
    o 'STRING',                                                     -> StringLiteral $1.slice(1, -1), quote: $1.quote, initialChunk: $1.initialChunk, finalChunk: $1.finalChunk, indent: $1.indent, double: $1.double, heregex: $1.heregex
    o 'STRING_START Interpolations STRING_END',                     -> StringWithInterpolations BlockWrap($2), quote: $1.quote, startQuote: Literal($1.toString())
  ]

  Interpolations: [
    o 'InterpolationChunk',                                         -> [$1]
    o 'Interpolations InterpolationChunk',                          -> $1.concat $2
  ]

  InterpolationChunk: [
    o 'INTERPOLATION_START Body INTERPOLATION_END',                 -> Interpolation $2
    o 'INTERPOLATION_START INDENT Body OUTDENT INTERPOLATION_END',  -> Interpolation $3
    o 'INTERPOLATION_START INTERPOLATION_END',                      -> Interpolation()
    o 'String',                                                     -> $1
  ]

  Regex: [
    o 'REGEX',                                                      -> RegexLiteral $1.toString(), delimiter: $1.delimiter, heregexCommentTokens: $1.heregexCommentTokens
    o 'REGEX_START Invocation REGEX_END',                           -> RegexWithInterpolations $2,                          heregexCommentTokens: $3.heregexCommentTokens
  ]

  Literal: [
    o 'AlphaNumeric'
    o 'JS',                                                         -> PassthroughLiteral $1.toString(), here: $1.here, generated: $1.generated
    o 'Regex'
    o 'UNDEFINED',                                                  -> UndefinedLiteral $1
    o 'NULL',                                                       -> NullLiteral $1
    o 'BOOL',                                                       -> BooleanLiteral  $1.toString(), originalValue: $1.original
    o 'INFINITY',                                                   -> InfinityLiteral $1.toString(), originalValue: $1.original
    o 'NAN',                                                        -> NaNLiteral $1
  ]

  Assign: [
    o 'Assignable = Expression',                                    -> Assign $1, $3
    o 'Assignable = TERMINATOR Expression',                         -> Assign $1, $4
    o 'Assignable = INDENT Expression OUTDENT',                     -> Assign $1, $4
  ]

  AssignObj: [
    o 'ObjAssignable',                                              -> Value $1
    o 'ObjRestValue'
    o 'ObjAssignable : Expression',                                 -> Assign Value($1), $3, 'object', operatorToken: Literal($2)
    o 'ObjAssignable : INDENT Expression OUTDENT',                  -> Assign Value($1), $4, 'object', operatorToken: Literal($2)
    o 'SimpleObjAssignable = Expression',                           -> Assign Value($1), $3, null    , operatorToken: Literal($2)
    o 'SimpleObjAssignable = INDENT Expression OUTDENT',            -> Assign Value($1), $4, null    , operatorToken: Literal($2)
  ]

  SimpleObjAssignable: [
    o 'Identifier'
    o 'Property'
    o 'ThisProperty'
  ]

  ObjAssignable: [
    o 'SimpleObjAssignable'
    o '[ Expression ]',                                             -> Value ComputedPropertyName($2)
    o '@ [ Expression ]',                                           -> Value ThisLiteral($1), [ComputedPropertyName($3)], 'this'
    o 'AlphaNumeric'
  ]

  ObjRestValue: [
    o 'SimpleObjAssignable ...',                                    -> Splat Value($1)
    o '... SimpleObjAssignable',                                    -> Splat Value($2), postfix: no
    o 'ObjSpreadExpr ...',                                          -> Splat $1
    o '... ObjSpreadExpr',                                          -> Splat $2       , postfix: no
  ]

  ObjSpreadExpr: [
    o 'ObjSpreadIdentifier'
    o 'Object'
    o 'Parenthetical'
    o 'Super'
    o 'This'
    o 'SUPER OptFuncExist Arguments',                               -> SuperCall Super(), $3, $2.soak, $1
    o 'DYNAMIC_IMPORT Arguments',                                   -> DynamicImportCall DynamicImport(), $2
    o 'SimpleObjAssignable OptFuncExist Arguments',                 -> Call Value($1), $3, $2.soak
    o 'ObjSpreadExpr OptFuncExist Arguments',                       -> Call $1, $3, $2.soak
  ]

  ObjSpreadIdentifier: [
    o 'SimpleObjAssignable Accessor',                               -> Value($1).add $2
    o 'ObjSpreadExpr Accessor',                                     -> Value($1).add $2
  ]

  Return: [
    o 'RETURN Expression',                                          -> Return $2
    o 'RETURN INDENT Object OUTDENT',                               -> Return Value($3)
    o 'RETURN',                                                     -> Return()
  ]

  YieldReturn: [
    o 'YIELD RETURN Expression',                                    -> YieldReturn $3, returnKeyword: Literal($2)
    o 'YIELD RETURN',                                               -> YieldReturn null, returnKeyword: Literal($2)
  ]

  AwaitReturn: [
    o 'AWAIT RETURN Expression',                                    -> AwaitReturn $3, returnKeyword: Literal($2)
    o 'AWAIT RETURN',                                               -> AwaitReturn null, returnKeyword: Literal($2)
  ]

  # Functions
  Code: [
    o 'PARAM_START ParamList PARAM_END FuncGlyph Block',            -> Code $2, $5, $4, Literal($1)
    o 'FuncGlyph Block',                                            -> Code [], $2, $1
  ]

  CodeLine: [
    o 'PARAM_START ParamList PARAM_END FuncGlyph Line',             -> Code $2, BlockWrap([$5]), $4, Literal($1)
    o 'FuncGlyph Line',                                             -> Code [], BlockWrap([$2]), $1
  ]

  FuncGlyph: [
    o '->',                                                         -> FuncGlyph $1
    o '=>',                                                         -> FuncGlyph $1
  ]

  OptComma: [
    o ''
    o ','
  ]

  ParamList: [
    o '',                                                           -> []
    o 'Param',                                                      -> [$1]
    o 'ParamList , Param',                                          -> $1.concat $3
    o 'ParamList OptComma TERMINATOR Param',                        -> $1.concat $4
    o 'ParamList OptComma INDENT ParamList OptComma OUTDENT',       -> $1.concat $4
  ]

  Param: [
    o 'ParamVar',                                                   -> Param $1
    o 'ParamVar ...',                                               -> Param $1, null, on
    o '... ParamVar',                                               -> Param $2, null, postfix: no
    o 'ParamVar = Expression',                                      -> Param $1, $3
    o '...',                                                        -> Expansion()
  ]

  ParamVar: [
    o 'Identifier'
    o 'ThisProperty'
    o 'Array'
    o 'Object'
  ]

  Splat: [
    o 'Expression ...',                                             -> Splat $1
    o '... Expression',                                             -> Splat $2, postfix: no
  ]

  # Assignables
  SimpleAssignable: [
    o 'Identifier',                                                 -> Value $1
    o 'Value Accessor',                                             -> $1.add $2
    o 'Code Accessor',                                              -> Value($1).add $2
    o 'ThisProperty'
  ]

  Assignable: [
    o 'SimpleAssignable'
    o 'Array',                                                      -> Value $1
    o 'Object',                                                     -> Value $1
  ]

  Value: [
    o 'Assignable'
    o 'Literal',                                                    -> Value $1
    o 'Parenthetical',                                              -> Value $1
    o 'Range',                                                      -> Value $1
    o 'Invocation',                                                 -> Value $1
    o 'DoIife',                                                     -> Value $1
    o 'This'
    o 'Super',                                                      -> Value $1
    o 'MetaProperty',                                               -> Value $1
  ]

  Super: [
    o 'SUPER . Property',                                           -> Super Access($3), Literal($1)
    o 'SUPER INDEX_START Expression INDEX_END',                     -> Super Index($3), Literal($1)
    o 'SUPER INDEX_START INDENT Expression OUTDENT INDEX_END',      -> Super Index($4), Literal($1)
  ]

  MetaProperty: [
    o 'NEW_TARGET . Property',                                      -> MetaProperty IdentifierLiteral($1), Access($3)
    o 'IMPORT_META . Property',                                     -> MetaProperty IdentifierLiteral($1), Access($3)
  ]

  Accessor: [
    o '. Property',                                                 -> Access $2
    o '?. Property',                                                -> Access $2, soak: yes
    o ':: Property',                                                -> [Access(PropertyName('prototype'), shorthand: yes           ), Access($2)]
    o '?:: Property',                                               -> [Access(PropertyName('prototype'), shorthand: yes, soak: yes), Access($2)]
    o '::',                                                         -> Access  PropertyName('prototype'), shorthand: yes
    o '?::',                                                        -> Access  PropertyName('prototype'), shorthand: yes, soak: yes
    o 'Index'
  ]

  Index: [
    o 'INDEX_START IndexValue INDEX_END',                           -> $2
    o 'INDEX_START INDENT IndexValue OUTDENT INDEX_END',            -> $3
    o 'INDEX_SOAK Index',                                           -> extend $2, soak: yes
  ]

  IndexValue: [
    o 'Expression',                                                 -> Index $1
    o 'Slice',                                                      -> Slice $1
  ]

  Object: [
    o '{ AssignList OptComma }',                                    -> Obj $2, $1.generated
  ]

  AssignList: [
    o '',                                                           -> []
    o 'AssignObj',                                                  -> [$1]
    o 'AssignList , AssignObj',                                     -> $1.concat $3
    o 'AssignList OptComma TERMINATOR AssignObj',                   -> $1.concat $4
    o 'AssignList OptComma INDENT AssignList OptComma OUTDENT',     -> $1.concat $4
  ]

  Class: [
    o 'CLASS',                                                      -> Class()
    o 'CLASS Block',                                                -> Class null, null, $2
    o 'CLASS EXTENDS Expression',                                   -> Class null, $3
    o 'CLASS EXTENDS Expression Block',                             -> Class null, $3, $4
    o 'CLASS SimpleAssignable',                                     -> Class $2
    o 'CLASS SimpleAssignable Block',                               -> Class $2, null, $3
    o 'CLASS SimpleAssignable EXTENDS Expression',                  -> Class $2, $4
    o 'CLASS SimpleAssignable EXTENDS Expression Block',            -> Class $2, $4, $5
  ]

  Import: [
    o 'IMPORT String',                                              -> ImportDeclaration null, $2
    o 'IMPORT String ASSERT Object',                                -> ImportDeclaration null, $2, $4
    o 'IMPORT ImportDefaultSpecifier FROM String',                  -> ImportDeclaration ImportClause($2, null), $4
    o 'IMPORT ImportDefaultSpecifier FROM String ASSERT Object',    -> ImportDeclaration ImportClause($2, null), $4, $6
    o 'IMPORT ImportNamespaceSpecifier FROM String',                -> ImportDeclaration ImportClause(null, $2), $4
    o 'IMPORT ImportNamespaceSpecifier FROM String ASSERT Object',  -> ImportDeclaration ImportClause(null, $2), $4, $6
    o 'IMPORT { } FROM String',                                     -> ImportDeclaration ImportClause(null, ImportSpecifierList([])), $5
    o 'IMPORT { } FROM String ASSERT Object',                       -> ImportDeclaration ImportClause(null, ImportSpecifierList([])), $5, $7
    o 'IMPORT { ImportSpecifierList OptComma } FROM String',        -> ImportDeclaration ImportClause(null, ImportSpecifierList($3)), $7
    o 'IMPORT { ImportSpecifierList OptComma } FROM String ASSERT Object', -> ImportDeclaration ImportClause(null, ImportSpecifierList($3)), $7, $9
    o 'IMPORT ImportDefaultSpecifier , ImportNamespaceSpecifier FROM String', -> ImportDeclaration ImportClause($2, $4), $6
    o 'IMPORT ImportDefaultSpecifier , ImportNamespaceSpecifier FROM String ASSERT Object', -> ImportDeclaration ImportClause($2, $4), $6, $8
    o 'IMPORT ImportDefaultSpecifier , { ImportSpecifierList OptComma } FROM String', -> ImportDeclaration ImportClause($2, ImportSpecifierList($5)), $9
    o 'IMPORT ImportDefaultSpecifier , { ImportSpecifierList OptComma } FROM String ASSERT Object', -> ImportDeclaration ImportClause($2, ImportSpecifierList($5)), $9, $11
  ]

  ImportSpecifierList: [
    o 'ImportSpecifier',                                            -> [$1]
    o 'ImportSpecifierList , ImportSpecifier',                      -> $1.concat $3
    o 'ImportSpecifierList OptComma TERMINATOR ImportSpecifier',    -> $1.concat $4
    o 'INDENT ImportSpecifierList OptComma OUTDENT',                -> $2
    o 'ImportSpecifierList OptComma INDENT ImportSpecifierList OptComma OUTDENT', -> $1.concat $4
  ]

  ImportSpecifier: [
    o 'Identifier',                                                 -> ImportSpecifier $1
    o 'Identifier AS Identifier',                                   -> ImportSpecifier $1, $3
    o 'DEFAULT',                                                    -> ImportSpecifier DefaultLiteral($1)
    o 'DEFAULT AS Identifier',                                      -> ImportSpecifier DefaultLiteral($1), $3
  ]

  ImportDefaultSpecifier: [
    o 'Identifier',                                                 -> ImportDefaultSpecifier $1
  ]

  ImportNamespaceSpecifier: [
    o 'IMPORT_ALL AS Identifier',                                   -> ImportNamespaceSpecifier Literal($1), $3
  ]

  Export: [
    o 'EXPORT { }',                                                 -> ExportNamedDeclaration ExportSpecifierList([])
    o 'EXPORT { ExportSpecifierList OptComma }',                    -> ExportNamedDeclaration ExportSpecifierList($3)
    o 'EXPORT Class',                                               -> ExportNamedDeclaration $2
    o 'EXPORT Identifier = Expression',                             -> ExportNamedDeclaration Assign($2, $4, null, moduleDeclaration: 'export')
    o 'EXPORT Identifier = TERMINATOR Expression',                  -> ExportNamedDeclaration Assign($2, $5, null, moduleDeclaration: 'export')
    o 'EXPORT Identifier = INDENT Expression OUTDENT',              -> ExportNamedDeclaration Assign($2, $5, null, moduleDeclaration: 'export')
    o 'EXPORT DEFAULT Expression',                                  -> ExportDefaultDeclaration $3
    o 'EXPORT DEFAULT INDENT Object OUTDENT',                       -> ExportDefaultDeclaration Value($4)
    o 'EXPORT EXPORT_ALL FROM String',                              -> ExportAllDeclaration Literal($2), $4
    o 'EXPORT EXPORT_ALL FROM String ASSERT Object',                -> ExportAllDeclaration Literal($2), $4, $6
    o 'EXPORT { } FROM String',                                     -> ExportNamedDeclaration ExportSpecifierList([]), $5
    o 'EXPORT { } FROM String ASSERT Object',                       -> ExportNamedDeclaration ExportSpecifierList([]), $5, $7
    o 'EXPORT { ExportSpecifierList OptComma } FROM String',        -> ExportNamedDeclaration ExportSpecifierList($3), $7
    o 'EXPORT { ExportSpecifierList OptComma } FROM String ASSERT Object', -> ExportNamedDeclaration ExportSpecifierList($3), $7, $9
  ]

  ExportSpecifierList: [
    o 'ExportSpecifier',                                            -> [$1]
    o 'ExportSpecifierList , ExportSpecifier',                      -> $1.concat $3
    o 'ExportSpecifierList OptComma TERMINATOR ExportSpecifier',    -> $1.concat $4
    o 'INDENT ExportSpecifierList OptComma OUTDENT',                -> $2
    o 'ExportSpecifierList OptComma INDENT ExportSpecifierList OptComma OUTDENT', -> $1.concat $4
  ]

  ExportSpecifier: [
    o 'Identifier',                                                 -> ExportSpecifier $1
    o 'Identifier AS Identifier',                                   -> ExportSpecifier $1, $3
    o 'Identifier AS DEFAULT',                                      -> ExportSpecifier $1, DefaultLiteral($3)
    o 'DEFAULT',                                                    -> ExportSpecifier DefaultLiteral($1)
    o 'DEFAULT AS Identifier',                                      -> ExportSpecifier DefaultLiteral($1), $3
  ]

  Invocation: [
    o 'Value OptFuncExist String',                                  -> TaggedTemplateCall $1, $3, $2.soak
    o 'Value OptFuncExist Arguments',                               -> Call $1, $3, $2.soak
    o 'SUPER OptFuncExist Arguments',                               -> SuperCall Super(), $3, $2.soak, $1
    o 'DYNAMIC_IMPORT Arguments',                                   -> DynamicImportCall DynamicImport(), $2
  ]

  OptFuncExist: [
    o '',                                                           -> soak: no
    o 'FUNC_EXIST',                                                 -> soak: yes
  ]

  Arguments: [
    o 'CALL_START CALL_END',                                        -> []
    o 'CALL_START ArgList OptComma CALL_END',                       -> $2.implicit = $1.generated; $2
  ]

  This: [
    o 'THIS',                                                       -> Value ThisLiteral($1)
    o '@',                                                          -> Value ThisLiteral($1)
  ]

  ThisProperty: [
    o '@ Property',                                                 -> Value ThisLiteral($1), [Access($2)], 'this'
  ]

  Array: [
    o '[ ]',                                                        -> Arr []
    o '[ Elisions ]',                                               -> Arr $2
    o '[ ArgElisionList OptElisions ]',                             -> Arr [].concat($2, $3)
  ]

  RangeDots: [
    o '..',                                                         -> exclusive: no
    o '...',                                                        -> exclusive: yes
  ]

  Range: [
    o '[ Expression RangeDots Expression ]',                        -> Range $2, $4, if $3.exclusive then 'exclusive' else 'inclusive'
    o '[ ExpressionLine RangeDots Expression ]',                    -> Range $2, $4, if $3.exclusive then 'exclusive' else 'inclusive'
  ]

  Slice: [
    o 'Expression RangeDots Expression',                            -> Range $1  , $3  , if $2.exclusive then 'exclusive' else 'inclusive'
    o 'Expression RangeDots',                                       -> Range $1  , null, if $2.exclusive then 'exclusive' else 'inclusive'
    o 'ExpressionLine RangeDots Expression',                        -> Range $1  , $3  , if $2.exclusive then 'exclusive' else 'inclusive'
    o 'ExpressionLine RangeDots',                                   -> Range $1  , null, if $2.exclusive then 'exclusive' else 'inclusive'
    o 'RangeDots Expression',                                       -> Range null, $2  , if $1.exclusive then 'exclusive' else 'inclusive'
    o 'RangeDots',                                                  -> Range null, null, if $1.exclusive then 'exclusive' else 'inclusive'
  ]

  ArgList: [
    o 'Arg',                                                        -> [$1]
    o 'ArgList , Arg',                                              -> $1.concat $3
    o 'ArgList OptComma TERMINATOR Arg',                            -> $1.concat $4
    o 'INDENT ArgList OptComma OUTDENT',                            -> $2
    o 'ArgList OptComma INDENT ArgList OptComma OUTDENT',           -> $1.concat $4
  ]

  Arg: [
    o 'Expression'
    o 'ExpressionLine'
    o 'Splat'
    o '...',                                                        -> Expansion()
  ]

  ArgElisionList: [
    o 'ArgElision'
    o 'ArgElisionList , ArgElision',                                -> $1.concat $3
    o 'ArgElisionList OptComma TERMINATOR ArgElision',              -> $1.concat $4
    o 'INDENT ArgElisionList OptElisions OUTDENT',                  -> $2.concat $3
    o 'ArgElisionList OptElisions INDENT ArgElisionList OptElisons OUTDENT', -> $1.concat($2, $4, $5)
  ]

  ArgElision: [
    o 'Arg',                                                        -> [$1]
    o 'Elisions Arg',                                               -> $1.concat $2
  ]

  OptElisions: [
    o 'OptComma',                                                   -> []
    o ', Elisions',                                                 -> [].concat $2
  ]

  Elisions: [
    o 'Elision',                                                    -> [$1]
    o 'Elisions Elision',                                           -> $1.concat $2
  ]

  Elision: [
    o ',',                                                          -> Elision()
    o 'Elision TERMINATOR',                                         -> $1
  ]

  SimpleArgs: [
    o 'Expression'
    o 'ExpressionLine'
    o 'SimpleArgs , Expression',                                    -> [].concat $1, $3
    o 'SimpleArgs , ExpressionLine',                                -> [].concat $1, $3
  ]

  Try: [
    o 'TRY Block',                                                  -> Try $2
    o 'TRY Block Catch',                                            -> Try $2, $3
    o 'TRY Block FINALLY Block',                                    -> Try $2, null, $4, Literal($3)
    o 'TRY Block Catch FINALLY Block',                              -> Try $2, $3  , $5, Literal($4)
  ]

  Catch: [
    o 'CATCH Identifier Block',                                     -> Catch $3, $2
    o 'CATCH Object Block',                                         -> Catch $3, Value($2)
    o 'CATCH Block',                                                -> Catch $2
  ]

  Throw: [
    o 'THROW Expression',                                           -> Throw $2
    o 'THROW INDENT Object OUTDENT',                                -> Throw Value($3)
  ]

  # Parenthetical
  Parenthetical: [
    o '( Body )',                                                   -> Parens $2
    o '( INDENT Body OUTDENT )',                                    -> Parens $3
  ]

  WhileLineSource: [
    o 'WHILE ExpressionLine',                                       -> While $2
    o 'WHILE ExpressionLine WHEN ExpressionLine',                   -> While $2, guard: $4
    o 'UNTIL ExpressionLine',                                       -> While $2, invert: true
    o 'UNTIL ExpressionLine WHEN ExpressionLine',                   -> While $2, invert: true, guard: $4
  ]

  WhileSource: [
    o 'WHILE Expression',                                           -> While $2
    o 'WHILE Expression WHEN Expression',                           -> While $2, guard: $4
    o 'WHILE ExpressionLine WHEN Expression',                       -> While $2, guard: $4
    o 'UNTIL Expression',                                           -> While $2, invert: true
    o 'UNTIL Expression WHEN Expression',                           -> While $2, invert: true, guard: $4
    o 'UNTIL ExpressionLine WHEN Expression',                       -> While $2, invert: true, guard: $4
  ]

  While: [
    o 'WhileSource Block',                                          -> $1.addBody $2
    o 'WhileLineSource Block',                                      -> $1.addBody $2
    o 'Statement WhileSource',                                      -> (Object.assign $2, postfix: yes).addBody BlockWrap([$1])
    o 'Expression WhileSource',                                     -> (Object.assign $2, postfix: yes).addBody BlockWrap([$1])
    o 'Loop',                                                       -> $1
  ]

  Loop: [
    o 'LOOP Block',                                                 -> While(BooleanLiteral('true'), isLoop: yes).addBody $2
    o 'LOOP Expression',                                            -> While(BooleanLiteral('true'), isLoop: yes).addBody BlockWrap([$2])
  ]

  For: [
    o 'Statement ForBody',                                          -> $2.postfix = yes; $2.addBody $1
    o 'Expression ForBody',                                         -> $2.postfix = yes; $2.addBody $1
    o 'ForBody Block',                                              -> $1.addBody $2
    o 'ForLineBody Block',                                          -> $1.addBody $2
  ]

  ForBody: [
    o 'FOR Range',                                                  -> For [], source: Value($2)
    o 'FOR Range BY Expression',                                    -> For [], source: Value($2), step: $4
    o 'ForStart ForSource',                                         -> $1.addSource $2
  ]

  ForLineBody: [
    o 'FOR Range BY ExpressionLine',                                -> For [], source: Value($2), step: $4
    o 'ForStart ForLineSource',                                     -> $1.addSource $2
  ]

  ForStart: [
    o 'FOR ForVariables',                                           -> For [], name: $2[0], index: $2[1]
    o 'FOR AWAIT ForVariables',                                     -> [name, index] = $3; For [], name: name, index: index, await: yes, awaitTag: Literal($2)
    o 'FOR OWN ForVariables',                                       -> [name, index] = $3; For [], name: name, index: index, own: yes, ownTag: Literal($2)
  ]

  ForValue: [
    o 'Identifier'
    o 'ThisProperty'
    o 'Array',                                                      -> Value $1
    o 'Object',                                                     -> Value $1
  ]

  ForVariables: [
    o 'ForValue',                                                   -> [$1]
    o 'ForValue , ForValue',                                        -> [$1, $3]
  ]

  ForSource: [
    o 'FORIN Expression',                                           -> source: $2
    o 'FOROF Expression',                                           -> source: $2,             object: yes
    o 'FORIN Expression WHEN Expression',                           -> source: $2, guard:  $4
    o 'FORIN ExpressionLine WHEN Expression',                       -> source: $2, guard:  $4
    o 'FOROF Expression WHEN Expression',                           -> source: $2, guard:  $4, object: yes
    o 'FOROF ExpressionLine WHEN Expression',                       -> source: $2, guard:  $4, object: yes
    o 'FORIN Expression BY Expression',                             -> source: $2, step:   $4
    o 'FORIN ExpressionLine BY Expression',                         -> source: $2, step:   $4
    o 'FORIN Expression WHEN Expression BY Expression',             -> source: $2, guard:  $4, step:   $6
    o 'FORIN ExpressionLine WHEN Expression BY Expression',         -> source: $2, guard:  $4, step:   $6
    o 'FORIN Expression WHEN ExpressionLine BY Expression',         -> source: $2, guard:  $4, step:   $6
    o 'FORIN ExpressionLine WHEN ExpressionLine BY Expression',     -> source: $2, guard:  $4, step:   $6
    o 'FORIN Expression BY Expression WHEN Expression',             -> source: $2, step:   $4, guard:  $6
    o 'FORIN ExpressionLine BY Expression WHEN Expression',         -> source: $2, step:   $4, guard:  $6
    o 'FORIN Expression BY ExpressionLine WHEN Expression',         -> source: $2, step:   $4, guard:  $6
    o 'FORIN ExpressionLine BY ExpressionLine WHEN Expression',     -> source: $2, step:   $4, guard:  $6
    o 'FORFROM Expression',                                         -> source: $2,             from:   yes
    o 'FORFROM Expression WHEN Expression',                         -> source: $2, guard:  $4, from:   yes
    o 'FORFROM ExpressionLine WHEN Expression',                     -> source: $2, guard:  $4, from:   yes
  ]

  ForLineSource: [
    o 'FORIN ExpressionLine',                                       -> source: $2
    o 'FOROF ExpressionLine',                                       -> source: $2, object: yes
    o 'FORIN Expression WHEN ExpressionLine',                       -> source: $2, guard:  $4
    o 'FORIN ExpressionLine WHEN ExpressionLine',                   -> source: $2, guard:  $4
    o 'FOROF Expression WHEN ExpressionLine',                       -> source: $2, guard:  $4, object: yes
    o 'FOROF ExpressionLine WHEN ExpressionLine',                   -> source: $2, guard:  $4, object: yes
    o 'FORIN Expression BY ExpressionLine',                         -> source: $2, step:   $4
    o 'FORIN ExpressionLine BY ExpressionLine',                     -> source: $2, step:   $4
    o 'FORIN Expression WHEN Expression BY ExpressionLine',         -> source: $2, guard:  $4, step:  $6
    o 'FORIN ExpressionLine WHEN Expression BY ExpressionLine',     -> source: $2, guard:  $4, step:  $6
    o 'FORIN Expression WHEN ExpressionLine BY ExpressionLine',     -> source: $2, guard:  $4, step:  $6
    o 'FORIN ExpressionLine WHEN ExpressionLine BY ExpressionLine', -> source: $2, guard:  $4, step:  $6
    o 'FORIN Expression BY Expression WHEN ExpressionLine',         -> source: $2, step:   $4, guard: $6
    o 'FORIN ExpressionLine BY Expression WHEN ExpressionLine',     -> source: $2, step:   $4, guard: $6
    o 'FORIN Expression BY ExpressionLine WHEN ExpressionLine',     -> source: $2, step:   $4, guard: $6
    o 'FORIN ExpressionLine BY ExpressionLine WHEN ExpressionLine', -> source: $2, step:   $4, guard: $6
    o 'FORFROM ExpressionLine',                                     -> source: $2, from:   yes
    o 'FORFROM Expression WHEN ExpressionLine',                     -> source: $2, guard:  $4, from: yes
    o 'FORFROM ExpressionLine WHEN ExpressionLine',                 -> source: $2, guard:  $4, from: yes
  ]

  Switch: [
    o 'SWITCH Expression INDENT Whens OUTDENT',                     -> Switch $2, $4
    o 'SWITCH ExpressionLine INDENT Whens OUTDENT',                 -> Switch $2, $4
    o 'SWITCH Expression INDENT Whens ELSE Block OUTDENT',          -> Switch $2, $4, $6
    o 'SWITCH ExpressionLine INDENT Whens ELSE Block OUTDENT',      -> Switch $2, $4, $6
    o 'SWITCH INDENT Whens OUTDENT',                                -> Switch null, $3
    o 'SWITCH INDENT Whens ELSE Block OUTDENT',                     -> Switch null, $3, $5
  ]

  Whens: [
    o 'When',                                                       -> [$1]
    o 'Whens When',                                                 -> $1.concat $2
  ]

  When: [
    o 'LEADING_WHEN SimpleArgs Block',                              -> SwitchWhen $2, $3
    o 'LEADING_WHEN SimpleArgs Block TERMINATOR',                   -> SwitchWhen $2, $3
  ]

  IfBlock: [
    o 'IF Expression Block',                                        -> If $2, $3, type: $1
    o 'IfBlock ELSE IF Expression Block',                           -> $1.addElse If($4, $5, type: $3)
  ]

  If: [
    o 'IfBlock'
    o 'IfBlock ELSE Block',                                         -> $1.addElse $3
    o 'Statement POST_IF Expression',                               -> If $3, BlockWrap([$1]), type: $2, postfix: true
    o 'Expression POST_IF Expression',                              -> If $3, BlockWrap([$1]), type: $2, postfix: true
  ]

  IfBlockLine: [
    o 'IF ExpressionLine Block',                                    -> If $2, $3, type: $1
    o 'IfBlockLine ELSE IF ExpressionLine Block',                   -> $1.addElse If($4, $5, type: $3)
  ]

  IfLine: [
    o 'IfBlockLine'
    o 'IfBlockLine ELSE Block',                                     -> $1.addElse $3
    o 'Statement POST_IF ExpressionLine',                           -> If $3, BlockWrap([$1]), type: $2, postfix: true
    o 'Expression POST_IF ExpressionLine',                          -> If $3, BlockWrap([$1]), type: $2, postfix: true
  ]

  OperationLine: [
    o 'UNARY ExpressionLine',                                       -> Op $1, $2
    o 'DO ExpressionLine',                                          -> Op $1, $2
    o 'DO_IIFE CodeLine',                                           -> Op $1, $2
  ]

  Operation: [
    o 'UNARY Expression',                                           -> Op $1.toString(), $2, undefined, undefined, originalOperator: $1.original
    o 'DO Expression',                                              -> Op $1, $2
    o 'UNARY_MATH Expression',                                      -> Op $1, $2
    o '- Expression',                                               -> Op '-', $2
    o '+ Expression',                                               -> Op '+', $2
    o 'AWAIT Expression',                                           -> Op $1, $2
    o 'AWAIT INDENT Object OUTDENT',                                -> Op $1, $3
    o '-- SimpleAssignable',                                        -> Op '--', $2
    o '++ SimpleAssignable',                                        -> Op '++', $2
    o 'SimpleAssignable --',                                        -> Op '--', $1, null, true
    o 'SimpleAssignable ++',                                        -> Op '++', $1, null, true
    o 'Expression ?',                                               -> Existence $1
    o 'Expression + Expression',                                    -> Op '+', $1, $3
    o 'Expression - Expression',                                    -> Op '-', $1, $3
    o 'Expression MATH Expression',                                 -> Op $2, $1, $3
    o 'Expression ** Expression',                                   -> Op $2, $1, $3
    o 'Expression SHIFT Expression',                                -> Op $2, $1, $3
    o 'Expression COMPARE Expression',                              -> Op $2.toString(), $1, $3, undefined, originalOperator: $2.original
    o 'Expression & Expression',                                    -> Op $2, $1, $3
    o 'Expression ^ Expression',                                    -> Op $2, $1, $3
    o 'Expression | Expression',                                    -> Op $2, $1, $3
    o 'Expression && Expression',                                   -> Op $2.toString(), $1, $3, undefined, originalOperator: $2.original
    o 'Expression || Expression',                                   -> Op $2.toString(), $1, $3, undefined, originalOperator: $2.original
    o 'Expression BIN? Expression',                                 -> Op $2, $1, $3
    o 'Expression RELATION Expression',                             -> Op $2.toString(), $1, $3, undefined, invertOperator: $2.invert?.original ? $2.invert
    o 'SimpleAssignable COMPOUND_ASSIGN Expression',                -> Assign $1, $3, $2.toString(), originalContext: $2.original
    o 'SimpleAssignable COMPOUND_ASSIGN INDENT Expression OUTDENT', -> Assign $1, $4, $2.toString(), originalContext: $2.original
    o 'SimpleAssignable COMPOUND_ASSIGN TERMINATOR Expression',     -> Assign $1, $4, $2.toString(), originalContext: $2.original
  ]

  DoIife: [
    o 'DO_IIFE Code',                                               -> Op $1, $2
  ]

# ============================================================================
# COMPLETE OPERATOR PRECEDENCE
# ============================================================================

o = (assoc, ops...) -> [assoc].concat ops.join(' ').trim().split(/\s+/)

operators = [
  o 'right',     'DO_IIFE'
  o 'left',      '. ?. :: ?::'
  o 'left',      'CALL_START CALL_END'
  o 'nonassoc',  '++ --'
  o 'left',      '?'
  o 'right',     'UNARY DO'
  o 'right',     'AWAIT'
  o 'right',     '**'
  o 'right',     'UNARY_MATH'
  o 'left',      'MATH'
  o 'left',      '+ -'
  o 'left',      'SHIFT'
  o 'left',      'RELATION'
  o 'left',      'COMPARE'
  o 'left',      '&'
  o 'left',      '^'
  o 'left',      '|'
  o 'left',      '&&'
  o 'left',      '||'
  o 'left',      'BIN?'
  o 'nonassoc',  'INDENT OUTDENT'
  o 'right',     'YIELD'
  o 'right',     '= : COMPOUND_ASSIGN RETURN THROW EXTENDS'
  o 'right',     'FORIN FOROF FORFROM BY WHEN'
  o 'right',     'IF ELSE FOR WHILE UNTIL LOOP SUPER CLASS IMPORT EXPORT DYNAMIC_IMPORT'
  o 'left',      'POST_IF'
]

# ============================================================================
# LANGUAGE PACK EXPORT
# ============================================================================

language =
  info:      languageInfo
  grammar:   grammar
  operators: operators.reverse()

# ============================================================================
# COMMONJS MODULE EXPORT ONLY
# ============================================================================

module.exports = language
