  // Rip Grammar - Converted from CoffeeScript's battle-tested grammar

  // This grammar uses a clean data-driven approach:
  // - Simple rules use data objects with '$1', '$2', ... placeholders
  // - Complex rules use 'code:' property for computation
  // - All nodes are pure data (no methods), following modern compiler design

  // Parser Pipeline: Lexer -> Rewriter -> Parser (this grammar) -> Compiler -> JS

// Helper function for grammar rules
var alt, alternatives, grammar, name, o, operators,
  hasProp = {}.hasOwnProperty;

o = function(...args) {
  return args;
};

// binOp = (op, prec) -> o "Expression #{op} Expression", type: 'BinaryExpression', op: op, left: '$1', right: '$3', prec
// unOp  = (op, prec) -> o            "#{op} Expression", type: 'UnaryExpression' , op: op, arg: '$2', prec

// ================================================================================
// GRAMMAR RULES
// ================================================================================
grammar = {
  // Start with the a basic example: "console.log 42", which needs the following:

  // Program
  //   Body
  //     Line
  //       Expression
  //         Value
  //           Invocation (CallExpression)
  //             callee: Value (MemberExpression: console.log)
  //             args: [Value (Literal: 42)]

  // The top-level node in the syntax tree
  Program: [
    o(''),
    o('Body',
    {
      body: '$1'
    })
  ],
  // Any list of statements and expressions, separated by line breaks or semicolons
  Body: [
    o('Line',
    {
      wrap: '$1'
    }),
    o('Body TERMINATOR Line',
    {
      push: '$3'
    }),
    o('Body TERMINATOR')
  ],
  // Statements and expressions that make up a line in a body
  Line: [o('Expression')],
  // All the different types of expressions in our language
  // o 'ExpressionLine'
  // o 'Statement'
  // o 'FuncDirective'
  Expression: [o('Value')],
  // Values - things that can be assigned to, invoked, indexed, etc.
  // o 'Code'
  // o 'Operation'
  // o 'Assign'
  // o 'If'
  // o 'Try'
  // o 'While'
  // o 'For'
  // o 'Switch'
  // o 'Class'
  // o 'Throw'
  // o 'Yield'
  Value: [
    o('Assignable'),
    o('Literal'),
    // o 'Parenthetical'
    // o 'Range'
    o('Invocation')
  ],
  // Everything that can be assigned to
  // o 'DoIife'
  // o 'This'
  // o 'Super'
  // o 'MetaProperty'
  Assignable: [o('SimpleAssignable')],
  // Simple assignables
  // o 'Array'
  // o 'Object'
  SimpleAssignable: [
    o('Identifier'),
    o('Value Accessor',
    {
      type: 'MemberExpression',
      object: '$1',
      property: '$2'
    })
  ],
  // Identifier
  // o 'Code Accessor'                        , type: 'MemberExpression', object: '$1', property: '$2'
  // o 'ThisProperty'
  Identifier: [
    o('IDENTIFIER',
    {
      type: 'Identifier',
      name: '$1'
    })
  ],
  // Accessors into objects
  Accessor: [
    o('.  Property',
    {
      type: 'MemberExpression',
      computed: false,
      property: '$2'
    }),
    o('?. Property',
    {
      type: 'OptionalMemberExpression',
      property: '$2'
    }),
    o(':: Property',
    {
      type: 'PrototypeAccess',
      property: '$2'
    }),
    o('?:: Property',
    {
      type: 'OptionalPrototypeAccess',
      property: '$2'
    }),
    o('::',
    {
      type: 'PrototypeAccess'
    }),
    o('?::',
    {
      type: 'OptionalPrototypeAccess'
    })
  ],
  // Property name (different from identifier)
  // o 'Index'
  Property: [
    o('PROPERTY',
    {
      type: 'Property',
      name: '$1'
    })
  ],
  // Function invocaåtion
  Invocation: [
    o('Value OptFuncExist String',
    {
      type: 'TaggedTemplateExpression',
      tag: '$1',
      quasi: '$3',
      optional: '$2'
    }),
    o('Value OptFuncExist Arguments',
    {
      type: 'CallExpression',
      callee: '$1',
      args: '$3',
      optional: '$2'
    }),
    o('SUPER OptFuncExist Arguments',
    {
      type: 'SuperCall',
      args: '$3',
      optional: '$2'
    }),
    o('DYNAMIC_IMPORT Arguments',
    {
      type: 'Import',
      args: '$2',
      dynamic: true
    })
  ],
  // Optional function existence check
  OptFuncExist: [o('', false), o('FUNC_EXIST', true)],
  // Function arguments
  Arguments: [
    o('CALL_START CALL_END',
    []),
    o('CALL_START ArgList OptComma CALL_END',
    {
      code: function() {
        $2.implicit = $1.generated;
        return $2;
      }
    })
  ],
  // Argument list (comma-separated expressions)
  ArgList: [
    o('Arg',
    ['$1']),
    o('ArgList , Arg',
    {
      code: function() {
        return $1.concat($3);
      }
    }),
    o('ArgList OptComma TERMINATOR Arg',
    {
      code: function() {
        return $1.concat($4);
      }
    })
  ],
  // Optional comma
  // o 'INDENT ArgList OptComma OUTDENT'
  // o 'ArgList OptComma INDENT ArgList OptComma OUTDENT', code: -> $1.concat $4
  OptComma: [o('', null), o(',', null)],
  // Arguments (expressions or splats)
  Arg: [o('Expression')],
  // All immediate literal values
  // o 'ExpressionLine'
  // o 'Splat'
  // o '...'                                  , type: 'SpreadElement'
  Literal: [
    o('AlphaNumeric'),
    o('JS',
    {
      type: 'JSLiteral',
      code: '$1'
    }),
    // o 'Regex'
    o('UNDEFINED',
    {
      type: 'Undefined'
    }),
    o('NULL',
    {
      type: 'NullLiteral'
    }),
    o('BOOL',
    {
      type: 'BooleanLiteral',
      value: '$1'
    }),
    o('INFINITY',
    {
      type: 'Infinity',
      value: '$1'
    }),
    o('NAN',
    {
      type: 'NaN'
    })
  ],
  // Alphanumerics - can serve as keys in object literals
  AlphaNumeric: [
    o('NUMBER',
    {
      type: 'NumericLiteral',
      value: '$1'
    }),
    o('String')
  ],
  // String literals with potential interpolation
  String: [
    o('STRING',
    {
      code: function() {
        return {
          type: 'StringLiteral',
          value: $1.slice(1,
    -1),
          raw: $1
        };
      }
    })
  ]
};

//   # Function directives (yield return, await return)
//   FuncDirective: [
//     o 'YieldReturn'
//     o 'AwaitReturn'
//   ]

//   # Pure statements which cannot be expressions
//   Statement: [
//     o 'Return'
//     o 'STATEMENT'                            , type: 'StatementLiteral', value: '$1'
//     o 'Import'
//     o 'Export'
//   ]

//   # Single-line expressions that would otherwise require braces
//   ExpressionLine: [
//     o 'CodeLine'
//     o 'IfLine'
//     o 'OperationLine'
//   ]

//   # Yield expressions
//   Yield: [
//     o 'YIELD'                                , type: 'YieldExpression', arg: null
//     o 'YIELD Expression'                     , type: 'YieldExpression', arg: '$2'
//     o 'YIELD INDENT Object OUTDENT'          , type: 'YieldExpression', arg: '$3'
//     o 'YIELD FROM Expression'                , type: 'YieldExpression', arg: '$3', delegate: true
//   ]

//   # An indented block of expressions
//   Block: [
//     o 'INDENT OUTDENT'                       , type: 'BlockStatement', body: []
//     o 'INDENT Body OUTDENT'                  , type: 'BlockStatement', body: '$2'
//   ]

//   # String interpolation parts
//   Interpolations: [
//     o 'InterpolationChunk'                   , ['$1']
//     o 'Interpolations InterpolationChunk'    , code: -> $1.concat $2
//   ]

//   # Individual interpolation chunk
//   InterpolationChunk: [
//     o 'INTERPOLATION_START Body INTERPOLATION_END'               , type: 'Interpolation', expr: '$2'
//     o 'INTERPOLATION_START INDENT Body OUTDENT INTERPOLATION_END', type: 'Interpolation', expr: '$3'
//     o 'INTERPOLATION_START INTERPOLATION_END'                    , type: 'Interpolation', expr: null
//     o 'String'
//   ]

//   # Regular expressions
//   Regex: [
//     o 'REGEX'                                , type: 'RegExpLiteral', pattern: '$1'
//     o 'REGEX_START Invocation REGEX_END'     , type: 'RegExpWithInterpolation', body: '$2'
//   ]

//   # Assignment of a variable, property, or index to a value
//   Assign: [
//     o 'Assignable = Expression'               , type: 'AssignmentExpression', left: '$1', right: '$3'
//     o 'Assignable = TERMINATOR Expression'    , type: 'AssignmentExpression', left: '$1', right: '$4'
//     o 'Assignable = INDENT Expression OUTDENT', type: 'AssignmentExpression', left: '$1', right: '$4'
//   ]

//   # Assignment within object literals
//   AssignObj: [
//     o 'ObjAssignable'
//     o 'ObjRestValue'
//     o 'ObjAssignable : Expression'                     , type: 'ObjectProperty', key: '$1', value: '$3'
//     o 'ObjAssignable : INDENT Expression OUTDENT'      , type: 'ObjectProperty', key: '$1', value: '$4'
//     o 'SimpleObjAssignable = Expression'               , type: 'ObjectProperty', key: '$1', value: '$3', shorthand: true
//     o 'SimpleObjAssignable = INDENT Expression OUTDENT', type: 'ObjectProperty', key: '$1', value: '$4', shorthand: true
//   ]

//   # Simple object assignables
//   SimpleObjAssignable: [
//     o 'Identifier'
//     o 'Property'
//     o 'ThisProperty'
//   ]

//   # Object assignables (including computed properties)
//   ObjAssignable: [
//     o 'SimpleObjAssignable'
//     o '[ Expression ]'                       , type: 'ComputedProperty', expr: '$2'
//     o '@ [ Expression ]'                     , type: 'ComputedThisProperty', expr: '$3'
//     o 'AlphaNumeric'
//   ]

//   # Object spread/rest properties
//   ObjRestValue: [
//     o 'SimpleObjAssignable ...'              , type: 'RestElement', arg: '$1'
//     o '... SimpleObjAssignable'              , type: 'SpreadElement', arg: '$2'
//     o 'ObjSpreadExpr ...'                    , type: 'RestElement', arg: '$1'
//     o '... ObjSpreadExpr'                    , type: 'SpreadElement', arg: '$2'
//   ]

//   # Object spread expressions
//   ObjSpreadExpr: [
//     o 'ObjSpreadIdentifier'
//     o 'Object'
//     o 'Parenthetical'
//     o 'Super'
//     o 'This'
//     o 'SUPER OptFuncExist Arguments'              ,      type: 'SuperCall', args: '$3', optional: '$2'
//     o 'DYNAMIC_IMPORT Arguments'                  ,      type: 'Import', args: '$2', dynamic: true
//     o 'SimpleObjAssignable OptFuncExist Arguments', type: 'CallExpression', callee: '$1', args: '$3', optional: '$2'
//     o 'ObjSpreadExpr OptFuncExist Arguments'      , type: 'CallExpression', callee: '$1', args: '$3', optional: '$2'
//   ]

//   # Object spread with accessor
//   ObjSpreadIdentifier: [
//     o 'SimpleObjAssignable Accessor'         , type: 'MemberExpression', object: '$1', property: '$2'
//     o 'ObjSpreadExpr Accessor'               , type: 'MemberExpression', object: '$1', property: '$2'
//   ]

//   # Return statements
//   Return: [
//     o 'RETURN Expression'                    , type: 'ReturnStatement', arg: '$2'
//     o 'RETURN INDENT Object OUTDENT'         , type: 'ReturnStatement', arg: '$3'
//     o 'RETURN'                               , type: 'ReturnStatement', arg: null
//   ]

//   # Yield return
//   YieldReturn: [
//     o 'YIELD RETURN Expression'              , type: 'YieldReturn', arg: '$3'
//     o 'YIELD RETURN'                         , type: 'YieldReturn', arg: null
//   ]

//   # Await return
//   AwaitReturn: [
//     o 'AWAIT RETURN Expression'              , type: 'AwaitReturn', arg: '$3'
//     o 'AWAIT RETURN'                         , type: 'AwaitReturn', arg: null
//   ]

//   # Function literals
//   Code: [
//     o 'PARAM_START ParamList PARAM_END FuncGlyph Block', type: 'FunctionExpression', params: '$2', body: '$5', bound: '$4'
//     o 'FuncGlyph Block'                                , type: 'FunctionExpression', params: [], body: '$2', bound: '$1'
//   ]

//   # Single-line functions
//   CodeLine: [
//     o 'PARAM_START ParamList PARAM_END FuncGlyph Line', type: 'FunctionExpression', params: '$2', body: '$5', bound: '$4'
//     o 'FuncGlyph Line'                                , type: 'FunctionExpression', params: [], body: '$2', bound: '$1'
//   ]

//   # Function arrows (-> vs =>)
//   FuncGlyph: [
//     o '->'                                   , false  # Not bound
//     o '=>'                                   , true   # Bound to this
//   ]

//   # Parameter list
//   ParamList: [
//     o ''                                     , []
//     o 'Param'                                , ['$1']
//     o 'ParamList , Param'                    , code: -> $1.concat $3
//     o 'ParamList OptComma TERMINATOR Param'  , code: -> $1.concat $4
//     o 'ParamList OptComma INDENT ParamList OptComma OUTDENT', code: -> $1.concat $4
//   ]

//   # Function parameters
//   Param: [
//     o 'ParamVar'                             , type: 'Param', name: '$1'
//     o 'ParamVar ...'                         , type: 'RestParam', name: '$1'
//     o '... ParamVar'                         , type: 'RestParam', name: '$2'
//     o 'ParamVar = Expression'                , type: 'DefaultParam', name: '$1', default: '$3'
//     o '...'                                  , type: 'RestParam'
//   ]

//   # Parameter variables
//   ParamVar: [
//     o 'Identifier'
//     o 'ThisProperty'
//     o 'Array'
//     o 'Object'
//   ]

//   # Splat operator
//   Splat: [
//     o 'Expression ...'                       , type: 'SpreadElement', arg: '$1'
//     o '... Expression'                       , type: 'SpreadElement', arg: '$2'
//   ]

//   # Super expressions
//   Super: [
//     o 'SUPER . Property'                                     , type: 'Super', property: '$3'
//     o 'SUPER INDEX_START Expression INDEX_END'               , type: 'Super', computed: '$3'
//     o 'SUPER INDEX_START INDENT Expression OUTDENT INDEX_END', type: 'Super', computed: '$4'
//   ]

//   # Meta properties (new.target, import.meta)
//   MetaProperty: [
//     o 'NEW_TARGET . Property'                , type: 'MetaProperty', meta: 'new', property: 'target'
//     o 'IMPORT_META . Property'               , type: 'MetaProperty', meta: 'import', property: 'meta'
//   ]

//   # Array/object indexing
//   Index: [
//     o 'INDEX_START IndexValue INDEX_END'
//     o 'INDEX_START INDENT IndexValue OUTDENT INDEX_END'
//     o 'INDEX_SOAK Index'                     , code: -> $2.optional = true; $2
//   ]

//   # Index values
//   IndexValue: [
//     o 'Expression'                           , type: 'Index', expr: '$1'
//     o 'Slice'
//     o 'Regex'                                , type: 'RegexIndex', pattern: '$1'
//     o 'RegexWithIndex'
//   ]

//   # Regex with index
//   RegexWithIndex: [
//     o 'Regex , Expression'                   , type: 'RegexIndex', pattern: '$1', index: '$3'
//   ]

//   # Object literals
//   Object: [
//     o '{ AssignList OptComma }'              , type: 'ObjectExpression', properties: '$2'
//   ]

//   # Object property list
//   AssignList: [
//     o ''                                     , []
//     o 'AssignObj'                            , ['$1']
//     o 'AssignList , AssignObj'               , code: -> $1.concat $3
//     o 'AssignList OptComma TERMINATOR AssignObj', code: -> $1.concat $4
//     o 'AssignList OptComma INDENT AssignList OptComma OUTDENT', code: -> $1.concat $4
//   ]

//   # Class definitions
//   Class: [
//     o 'CLASS'                                          , type: 'ClassExpression'
//     o 'CLASS Block'                                    , type: 'ClassExpression', body: '$2'
//     o 'CLASS EXTENDS Expression'                       , type: 'ClassExpression', superClass: '$3'
//     o 'CLASS EXTENDS Expression Block'                 , type: 'ClassExpression', superClass: '$3', body: '$4'
//     o 'CLASS SimpleAssignable'                         , type: 'ClassExpression', id: '$2'
//     o 'CLASS SimpleAssignable Block'                   , type: 'ClassExpression', id: '$2', body: '$3'
//     o 'CLASS SimpleAssignable EXTENDS Expression'      , type: 'ClassExpression', id: '$2', superClass: '$4'
//     o 'CLASS SimpleAssignable EXTENDS Expression Block', type: 'ClassExpression', id: '$2', superClass: '$4', body: '$5'
//   ]

//   # Import statements
//   Import: [
//     o 'IMPORT String'                                                       , type: 'ImportDeclaration', source: '$2'
//     o 'IMPORT String ASSERT Object'                                         , type: 'ImportDeclaration', source: '$2', assertions: '$4'
//     o 'IMPORT ImportDefaultSpecifier FROM String'                           , type: 'ImportDeclaration', specifiers: ['$2'], source: '$4'
//     o 'IMPORT ImportDefaultSpecifier FROM String ASSERT Object'             , type: 'ImportDeclaration', specifiers: ['$2'], source: '$4', assertions: '$6'
//     o 'IMPORT ImportNamespaceSpecifier FROM String'                         , type: 'ImportDeclaration', specifiers: ['$2'], source: '$4'
//     o 'IMPORT ImportNamespaceSpecifier FROM String ASSERT Object'           , type: 'ImportDeclaration', specifiers: ['$2'], source: '$4', assertions: '$6'
//     o 'IMPORT { } FROM String'                                              , type: 'ImportDeclaration', specifiers: [], source: '$5'
//     o 'IMPORT { } FROM String ASSERT Object'                                , type: 'ImportDeclaration', specifiers: [], source: '$5', assertions: '$7'
//     o 'IMPORT { ImportSpecifierList OptComma } FROM String'                 , type: 'ImportDeclaration', specifiers: '$3', source: '$7'
//     o 'IMPORT { ImportSpecifierList OptComma } FROM String ASSERT Object'   , type: 'ImportDe claration', specifiers: '$3', source: '$7', assertions: '$9'
//     o 'IMPORT ImportDefaultSpecifier , ImportNamespaceSpecifier FROM String', type: 'ImportDeclaration', specifiers: ['$2', '$4'], source: '$6'
//     o 'IMPORT ImportDefaultSpecifier , ImportNamespaceSpecifier FROM String ASSERT Object'        , type: 'ImportDeclaration', specifiers: ['$2', '$4'], source: '$6', assertions: '$8'
//     o 'IMPORT ImportDefaultSpecifier , { ImportSpecifierList OptComma } FROM String'              , code: -> type: 'ImportDeclaration', specifiers: [$2].concat($5), source: $9
//     o 'IMPORT ImportDefaultSpecifier , { ImportSpecifierList OptComma } FROM String ASSERT Object', code: -> type: 'ImportDeclaration', specifiers: [$2].concat($5), source: $9, assertions: $11
//   ]

//   # Import specifier list
//   ImportSpecifierList: [
//     o 'ImportSpecifier'                      , ['$1']
//     o 'ImportSpecifierList , ImportSpecifier', code: -> $1.concat $3
//     o 'ImportSpecifierList OptComma TERMINATOR ImportSpecifier', code: -> $1.concat $4
//     o 'INDENT ImportSpecifierList OptComma OUTDENT'
//     o 'ImportSpecifierList OptComma INDENT ImportSpecifierList OptComma OUTDENT', code: -> $1.concat $4
//   ]

//   # Import specifiers
//   ImportSpecifier: [
//     o 'Identifier'                           , type: 'ImportSpecifier', imported: '$1', local: '$1'
//     o 'Identifier AS Identifier'             , type: 'ImportSpecifier', imported: '$1', local: '$3'
//     o 'DEFAULT'                              , type: 'ImportSpecifier', imported: type: 'Identifier', name: 'default'
//     o 'DEFAULT AS Identifier'                , type: 'ImportSpecifier', imported: type: 'Identifier', name: 'default', local: '$3'
//   ]

//   # Default import
//   ImportDefaultSpecifier: [
//     o 'Identifier'                           , type: 'ImportDefaultSpecifier', local: '$1'
//   ]

//   # Namespace import
//   ImportNamespaceSpecifier: [
//     o 'IMPORT_ALL AS Identifier'             , type: 'ImportNamespaceSpecifier', local: '$3'
//   ]

//   # Export statements
//   Export: [
//     o 'EXPORT { }'                           , type: 'ExportNamedDeclaration', specifiers: []
//     o 'EXPORT { ExportSpecifierList OptComma }', type: 'ExportNamedDeclaration', specifiers: '$3'
//     o 'EXPORT Class'                         , type: 'ExportNamedDeclaration', declaration: '$2'
//     o 'EXPORT Identifier = Expression'       , type: 'ExportNamedDeclaration', declaration: type: 'AssignmentExpression', left: '$2', right: '$4'
//     o 'EXPORT Identifier = TERMINATOR Expression', type: 'ExportNamedDeclaration', declaration: type: 'AssignmentExpression', left: '$2', right: '$5'
//     o 'EXPORT Identifier = INDENT Expression OUTDENT', type: 'ExportNamedDeclaration', declaration: type: 'AssignmentExpression', left: '$2', right: '$5'
//     o 'EXPORT DEFAULT Expression'            , type: 'ExportDefaultDeclaration', declaration: '$3'
//     o 'EXPORT DEFAULT INDENT Object OUTDENT' , type: 'ExportDefaultDeclaration', declaration: '$4'
//     o 'EXPORT EXPORT_ALL FROM String'        , type: 'ExportAllDeclaration', source: '$4'
//     o 'EXPORT EXPORT_ALL FROM String ASSERT Object', type: 'ExportAllDeclaration', source: '$4', assertions: '$6'
//     o 'EXPORT { } FROM String'               , type: 'ExportNamedDeclaration', specifiers: [], source: '$5'
//     o 'EXPORT { } FROM String ASSERT Object' , type: 'ExportNamedDeclaration', specifiers: [], source: '$5', assertions: '$7'
//     o 'EXPORT { ExportSpecifierList OptComma } FROM String', type: 'ExportNamedDeclaration', specifiers: '$3', source: '$7'
//     o 'EXPORT { ExportSpecifierList OptComma } FROM String ASSERT Object', type: 'ExportNamedDeclaration', specifiers: '$3', source: '$7', assertions: '$9'
//   ]

//   # Export specifier list
//   ExportSpecifierList: [
//     o 'ExportSpecifier'                      , ['$1']
//     o 'ExportSpecifierList , ExportSpecifier', code: -> $1.concat $3
//     o 'ExportSpecifierList OptComma TERMINATOR ExportSpecifier', code: -> $1.concat $4
//     o 'INDENT ExportSpecifierList OptComma OUTDENT'
//     o 'ExportSpecifierList OptComma INDENT ExportSpecifierList OptComma OUTDENT', code: -> $1.concat $4
//   ]

//   # Export specifiers
//   ExportSpecifier: [
//     o 'Identifier'                           , type: 'ExportSpecifier', local: '$1', exported: '$1'
//     o 'Identifier AS Identifier'             , type: 'ExportSpecifier', local: '$1', exported: '$3'
//     o 'Identifier AS DEFAULT'                , type: 'ExportSpecifier', local: '$1', exported: type: 'Identifier', name: 'default'
//     o 'DEFAULT'                              , type: 'ExportSpecifier', local: type: 'Identifier', name: 'default'
//     o 'DEFAULT AS Identifier'                , type: 'ExportSpecifier', local: type: 'Identifier', name: 'default', exported: '$3'
//   ]

//   # This reference
//   This: [
//     o 'THIS'                                 , type: 'ThisExpression'
//     o '@'                                    , type: 'ThisExpression'
//   ]

//   # This property reference
//   ThisProperty: [
//     o '@ Property'                           , type: 'MemberExpression', object: type: 'ThisExpression', property: '$2'
//   ]

//   # Array literals
//   Array: [
//     o '[ ]'                                  , type: 'ArrayExpression', elements: []
//     o '[ Elisions ]'                         , type: 'ArrayExpression', elements: '$2'
//     o '[ ArgElisionList OptElisions ]'       , code: -> type: 'ArrayExpression', elements: $2.concat $3
//   ]

//   # Range dots (inclusive vs exclusive)
//   RangeDots: [
//     o '..'                                   , exclusive: false
//     o '...'                                  , exclusive: true
//   ]

//   # Range literals
//   Range: [
//     o '[ Expression RangeDots Expression ]'  , code: -> type: 'Range', from: $2, to: $4, exclusive: $3.exclusive
//     o '[ ExpressionLine RangeDots Expression ]', code: -> type: 'Range', from: $2, to: $4, exclusive: $3.exclusive
//   ]

//   # Array slices
//   Slice: [
//     o 'Expression RangeDots Expression'      , code: -> type: 'Slice', from: $1, to: $3, exclusive: $2.exclusive
//     o 'Expression RangeDots'                 , code: -> type: 'Slice', from: $1, to: null, exclusive: $2.exclusive
//     o 'ExpressionLine RangeDots Expression'  , code: -> type: 'Slice', from: $1, to: $3, exclusive: $2.exclusive
//     o 'ExpressionLine RangeDots'             , code: -> type: 'Slice', from: $1, to: null, exclusive: $2.exclusive
//     o 'RangeDots Expression'                 , code: -> type: 'Slice', from: null, to: $2, exclusive: $1.exclusive
//     o 'RangeDots'                            , code: -> type: 'Slice', from: null, to: null, exclusive: $1.exclusive
//   ]

//   # Array elements with elisions (holes)
//   ArgElisionList: [
//     o 'ArgElision'
//     o 'ArgElisionList , ArgElision'          , code: -> $1.concat $3
//     o 'ArgElisionList OptComma TERMINATOR ArgElision', code: -> $1.concat $4
//     o 'INDENT ArgElisionList OptElisions OUTDENT', code: -> $2.concat $3
//     o 'ArgElisionList OptElisions INDENT ArgElisionList OptElisions OUTDENT', code: -> $1.concat $2, $4, $5
//   ]

//   # Array element or elision
//   ArgElision: [
//     o 'Arg'                                  , ['$1']
//     o 'Elisions Arg'                         , code: -> $1.concat $2
//   ]

//   # Optional elisions
//   OptElisions: [
//     o 'OptComma'                             , []
//     o ', Elisions'
//   ]

//   # Elisions (array holes)
//   Elisions: [
//     o 'Elision'                              , ['$1']
//     o 'Elisions Elision'                     , code: -> $1.concat $2
//   ]

//   # Single elision
//   Elision: [
//     o ','                                    , type: 'Elision'
//     o 'Elision TERMINATOR'
//   ]

//   # Simple arguments (no newlines)
//   SimpleArgs: [
//     o 'Expression'                           , ['$1']
//     o 'ExpressionLine'                       , ['$1']
//     o 'SimpleArgs , Expression'              , code: -> $1.concat $3
//     o 'SimpleArgs , ExpressionLine'          , code: -> $1.concat $3
//   ]

//   # Try/catch/finally
//   Try: [
//     o 'TRY Block'                            , type: 'TryStatement', block: '$2'
//     o 'TRY Block Catch'                      , type: 'TryStatement', block: '$2', handler: '$3'
//     o 'TRY Block FINALLY Block'              , type: 'TryStatement', block: '$2', finalizer: '$4'
//     o 'TRY Block Catch FINALLY Block'        , type: 'TryStatement', block: '$2', handler: '$3', finalizer: '$5'
//   ]

//   # Catch clause
//   Catch: [
//     o 'CATCH Identifier Block'               , type: 'CatchClause', param: '$2', body: '$3'
//     o 'CATCH Object Block'                   , type: 'CatchClause', param: '$2', body: '$3'
//     o 'CATCH Block'                          , type: 'CatchClause', body: '$2'
//   ]

//   # Throw statement
//   Throw: [
//     o 'THROW Expression'                     , type: 'ThrowStatement', arg: '$2'
//     o 'THROW INDENT Object OUTDENT'          , type: 'ThrowStatement', arg: '$3'
//   ]

//   # Parenthetical expressions
//   Parenthetical: [
//     o '( Body )'                             , type: 'ParenthesizedExpression', expr: '$2'
//     o '( INDENT Body OUTDENT )'              , type: 'ParenthesizedExpression', expr: '$3'
//   ]

//   # While loop sources
//   WhileLineSource: [
//     o 'WHILE ExpressionLine'                 , type: 'While', test: '$2'
//     o 'WHILE ExpressionLine WHEN ExpressionLine', type: 'While', test: '$2', guard: '$4'
//     o 'UNTIL ExpressionLine'                 , type: 'While', test: '$2', invert: true
//     o 'UNTIL ExpressionLine WHEN ExpressionLine', type: 'While', test: '$2', guard: '$4', invert: true
//   ]

//   WhileSource: [
//     o 'WHILE Expression'                     , type: 'While', test: '$2'
//     o 'WHILE Expression WHEN Expression'     , type: 'While', test: '$2', guard: '$4'
//     o 'WHILE ExpressionLine WHEN Expression' , type: 'While', test: '$2', guard: '$4'
//     o 'UNTIL Expression'                     , type: 'While', test: '$2', invert: true
//     o 'UNTIL Expression WHEN Expression'     , type: 'While', test: '$2', guard: '$4', invert: true
//     o 'UNTIL ExpressionLine WHEN Expression' , type: 'While', test: '$2', guard: '$4', invert: true
//   ]

//   # While loops
//   While: [
//     o 'WhileSource Block'                    , code: -> $1.body = $2; $1
//     o 'WhileLineSource Block'                , code: -> $1.body = $2; $1
//     o 'Statement WhileSource'                , code: -> $2.body = $1; $2.postfix = true; $2
//     o 'Expression WhileSource'               , code: -> $2.body = $1; $2.postfix = true; $2
//     o 'Loop'
//   ]

//   # Loop construct
//   Loop: [
//     o 'LOOP Block'                           , type: 'Loop', body: '$2'
//     o 'LOOP Expression'                      , type: 'Loop', body: '$2'
//   ]

//   # For loops
//   For: [
//     o 'Statement ForBody'                    , code: -> $2.body = $1; $2.postfix = true; $2
//     o 'Expression ForBody'                   , code: -> $2.body = $1; $2.postfix = true; $2
//     o 'ForBody Block'                        , code: -> $1.body = $2; $1
//     o 'ForLineBody Block'                    , code: -> $1.body = $2; $1
//   ]

//   # For loop body
//   ForBody: [
//     o 'FOR Range'                            , type: 'ForRange', source: '$2'
//     o 'FOR Range BY Expression'              , type: 'ForRange', source: '$2', step: '$4'
//     o 'ForStart ForSource'                   , code: -> Object.assign $1, $2
//   ]

//   # For loop line body
//   ForLineBody: [
//     o 'FOR Range BY ExpressionLine'          , type: 'ForRange', source: '$2', step: '$4'
//     o 'ForStart ForLineSource'               , code: -> Object.assign $1, $2
//   ]

//   # For loop initialization
//   ForStart: [
//     o 'FOR ForVariables'                     , code: -> type: 'For', variables: $2
//     o 'FOR AWAIT ForVariables'               , code: -> type: 'For', variables: $3, await: true
//     o 'FOR OWN ForVariables'                 , code: -> type: 'For', variables: $3, own: true
//   ]

//   # For loop values
//   ForValue: [
//     o 'Identifier'
//     o 'ThisProperty'
//     o 'Array'
//     o 'Object'
//   ]

//   # For loop variables
//   ForVariables: [
//     o 'ForValue'                             , ['$1']
//     o 'ForValue , ForValue'                  , ['$1', '$3']
//   ]

//   # For loop sources (complex - handles all variations)
//   ForSource: [
//     o 'FORIN Expression'                     , source: '$2'
//     o 'FOROF Expression'                     , source: '$2', object: true
//     o 'FORIN Expression WHEN Expression'     , source: '$2', guard: '$4'
//     o 'FORIN ExpressionLine WHEN Expression' , source: '$2', guard: '$4'
//     o 'FOROF Expression WHEN Expression'     , source: '$2', guard: '$4', object: true
//     o 'FOROF ExpressionLine WHEN Expression' , source: '$2', guard: '$4', object: true
//     o 'FORIN Expression BY Expression'       , source: '$2', step: '$4'
//     o 'FORIN ExpressionLine BY Expression'   , source: '$2', step: '$4'
//     o 'FORIN Expression WHEN Expression BY Expression', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN ExpressionLine WHEN Expression BY Expression', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN Expression WHEN ExpressionLine BY Expression', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN ExpressionLine WHEN ExpressionLine BY Expression', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN Expression BY Expression WHEN Expression', source: '$2', step: '$4', guard: '$6'
//     o 'FORIN ExpressionLine BY Expression WHEN Expression', source: '$2', step: '$4', guard: '$6'
//     o 'FORIN Expression BY ExpressionLine WHEN Expression', source: '$2', step: '$4', guard: '$6'
//     o 'FORIN ExpressionLine BY ExpressionLine WHEN Expression', source: '$2', step: '$4', guard: '$6'
//     o 'FORFROM Expression'                   , source: '$2', from: true
//     o 'FORFROM Expression WHEN Expression'   , source: '$2', guard: '$4', from: true
//     o 'FORFROM ExpressionLine WHEN Expression', source: '$2', guard: '$4', from: true
//   ]

//   # For loop line sources
//   ForLineSource: [
//     o 'FORIN ExpressionLine'                 , source: '$2'
//     o 'FOROF ExpressionLine'                 , source: '$2', object: true
//     o 'FORIN Expression WHEN ExpressionLine' , source: '$2', guard: '$4'
//     o 'FORIN ExpressionLine WHEN ExpressionLine', source: '$2', guard: '$4'
//     o 'FOROF Expression WHEN ExpressionLine' , source: '$2', guard: '$4', object: true
//     o 'FOROF ExpressionLine WHEN ExpressionLine', source: '$2', guard: '$4', object: true
//     o 'FORIN Expression BY ExpressionLine'   , source: '$2', step: '$4'
//     o 'FORIN ExpressionLine BY ExpressionLine', source: '$2', step: '$4'
//     o 'FORIN Expression WHEN Expression BY ExpressionLine', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN ExpressionLine WHEN Expression BY ExpressionLine', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN Expression WHEN ExpressionLine BY ExpressionLine', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN ExpressionLine WHEN ExpressionLine BY ExpressionLine', source: '$2', guard: '$4', step: '$6'
//     o 'FORIN Expression BY Expression WHEN ExpressionLine', source: '$2', step: '$4', guard: '$6'
//     o 'FORIN ExpressionLine BY Expression WHEN ExpressionLine', source: '$2', step: '$4', guard: '$6'
//     o 'FORIN Expression BY ExpressionLine WHEN ExpressionLine', source: '$2', step: '$4', guard: '$6'
//     o 'FORIN ExpressionLine BY ExpressionLine WHEN ExpressionLine', source: '$2', step: '$4', guard: '$6'
//     o 'FORFROM ExpressionLine'               , source: '$2', from: true
//     o 'FORFROM Expression WHEN ExpressionLine', source: '$2', guard: '$4', from: true
//     o 'FORFROM ExpressionLine WHEN ExpressionLine', source: '$2', guard: '$4', from: true
//   ]

//   # Switch statements
//   Switch: [
//     o 'SWITCH Expression INDENT Whens OUTDENT', type: 'SwitchStatement', discriminant: '$2', cases: '$4'
//     o 'SWITCH ExpressionLine INDENT Whens OUTDENT', type: 'SwitchStatement', discriminant: '$2', cases: '$4'
//     o 'SWITCH Expression INDENT Whens ELSE Block OUTDENT', type: 'SwitchStatement', discriminant: '$2', cases: '$4', default: '$6'
//     o 'SWITCH ExpressionLine INDENT Whens ELSE Block OUTDENT', type: 'SwitchStatement', discriminant: '$2', cases: '$4', default: '$6'
//     o 'SWITCH INDENT Whens OUTDENT'          , type: 'SwitchStatement', cases: '$3'
//     o 'SWITCH INDENT Whens ELSE Block OUTDENT', type: 'SwitchStatement', cases: '$3', default: '$5'
//   ]

//   # Switch cases
//   Whens: [
//     o 'When'                                 , ['$1']
//     o 'Whens When'                           , code: -> $1.concat $2
//   ]

//   # Individual switch case
//   When: [
//     o 'LEADING_WHEN SimpleArgs Block'        , type: 'SwitchCase', tests: '$2', consequent: '$3'
//     o 'LEADING_WHEN SimpleArgs Block TERMINATOR', type: 'SwitchCase', tests: '$2', consequent: '$3'
//   ]

//   # If blocks
//   IfBlock: [
//     o 'IF Expression Block'                  , type: 'IfStatement', test: '$2', consequent: '$3'
//     o 'IfBlock ELSE IF Expression Block'     , code: -> $1.alternate = type: 'IfStatement', test: $4, consequent: $5; $1
//   ]

//   # If statements
//   If: [
//     o 'IfBlock'
//     o 'IfBlock ELSE Block'                   , code: -> $1.alternate = $3; $1
//     o 'Statement POST_IF Expression'         , type: 'IfStatement', test: '$3', consequent: '$1', postfix: true
//     o 'Expression POST_IF Expression'        , type: 'IfStatement', test: '$3', consequent: '$1', postfix: true
//   ]

//   # If line blocks
//   IfBlockLine: [
//     o 'IF ExpressionLine Block'              , type: 'IfStatement', test: '$2', consequent: '$3'
//     o 'IfBlockLine ELSE IF ExpressionLine Block', code: -> $1.alternate = type: 'IfStatement', test: $4, consequent: $5; $1
//   ]

//   # If line statements
//   IfLine: [
//     o 'IfBlockLine'
//     o 'IfBlockLine ELSE Block'               , code: -> $1.alternate = $3; $1
//     o 'Statement POST_IF ExpressionLine'     , type: 'IfStatement', test: '$3', consequent: '$1', postfix: true
//     o 'Expression POST_IF ExpressionLine'    , type: 'IfStatement', test: '$3', consequent: '$1', postfix: true
//   ]

//   # Operation lines
//   OperationLine: [
//     o 'UNARY ExpressionLine'                 , type: 'UnaryExpression', op: '$1', arg: '$2'
//     o 'DO ExpressionLine'                    , type: 'DoExpression', body: '$2'
//     o 'DO_IIFE CodeLine'                     , type: 'DoIife', body: '$2'
//   ]

//   # Operations (complex - includes all operators)
//   Operation: [
//     o 'UNARY Expression'                     , type: 'UnaryExpression', op: '$1', arg: '$2'
//     o 'DO Expression'                        , type: 'DoExpression', body: '$2'
//     o 'UNARY_MATH Expression'                , type: 'UnaryExpression', op: '$1', arg: '$2'
//     o '- Expression'                         , type: 'UnaryExpression', op: '-', arg: '$2', prec: 'UNARY_MATH'
//     o '+ Expression'                         , type: 'UnaryExpression', op: '+', arg: '$2', prec: 'UNARY_MATH'

//     o 'AWAIT Expression'                     , type: 'AwaitExpression', arg: '$2'
//     o 'AWAIT INDENT Object OUTDENT'          , type: 'AwaitExpression', arg: '$3'

//     o '-- SimpleAssignable'                  , type: 'UpdateExpression', op: '--', arg: '$2', prefix: true
//     o '++ SimpleAssignable'                  , type: 'UpdateExpression', op: '++', arg: '$2', prefix: true
//     o 'SimpleAssignable --'                  , type: 'UpdateExpression', op: '--', arg: '$1', prefix: false
//     o 'SimpleAssignable ++'                  , type: 'UpdateExpression', op: '++', arg: '$1', prefix: false

//     # Existence operator
//     o 'Expression ?'                         , type: 'ExistenceCheck', arg: '$1'

//     # Binary operations
//     o 'Expression + Expression'              , type: 'BinaryExpression', op: '+', left: '$1', right: '$3'
//     o 'Expression - Expression'              , type: 'BinaryExpression', op: '-', left: '$1', right: '$3'
//     o 'Expression MATH Expression'           , type: 'BinaryExpression', op: '$2', left: '$1', right: '$3'
//     o 'Expression ** Expression'             , type: 'BinaryExpression', op: '**', left: '$1', right: '$3'
//     o 'Expression SHIFT Expression'          , type: 'BinaryExpression', op: '$2', left: '$1', right: '$3'
//     o 'Expression COMPARE Expression'        , type: 'BinaryExpression', op: '$2', left: '$1', right: '$3'
//     o 'Expression & Expression'              , type: 'BinaryExpression', op: '&', left: '$1', right: '$3'
//     o 'Expression ^ Expression'              , type: 'BinaryExpression', op: '^', left: '$1', right: '$3'
//     o 'Expression | Expression'              , type: 'BinaryExpression', op: '|', left: '$1', right: '$3'
//     o 'Expression && Expression'             , type: 'LogicalExpression', op: '&&', left: '$1', right: '$3'
//     o 'Expression || Expression'             , type: 'LogicalExpression', op: '||', left: '$1', right: '$3'
//     o 'Expression BIN? Expression'           , type: 'BinaryExpression', op: '$2', left: '$1', right: '$3'
//     o 'Expression RELATION Expression'       , type: 'BinaryExpression', op: '$2', left: '$1', right: '$3'

//     # Compound assignment
//     o 'SimpleAssignable COMPOUND_ASSIGN Expression', type: 'AssignmentExpression', op: '$2', left: '$1', right: '$3'
//     o 'SimpleAssignable COMPOUND_ASSIGN INDENT Expression OUTDENT', type: 'AssignmentExpression', op: '$2', left: '$1', right: '$4'
//     o 'SimpleAssignable COMPOUND_ASSIGN TERMINATOR Expression', type: 'AssignmentExpression', op: '$2', left: '$1', right: '$4'
//   ]

//   # Do IIFE
//   DoIife: [
//     o 'DO_IIFE Code'                         , type: 'DoIife', body: '$2'
//   ]

// ================================================================================
// OPERATOR PRECEDENCE
// ================================================================================

// Operators at the top have higher precedence
// o 'STRING_START Interpolations STRING_END', type: 'TemplateLiteral', parts: '$2'
operators = [];

for (name in grammar) {
  if (!hasProp.call(grammar, name)) continue;
  alternatives = grammar[name];
  grammar[name] = (function() {
    var i, len, results;
    results = [];
    for (i = 0, len = alternatives.length; i < len; i++) {
      alt = alternatives[i];
      if (name === 'Program') {
        // For Program rules, add return statement
        alt[1] = `return ${alt[1]}`;
      }
      results.push(alt);
    }
    return results;
  })();
}

export default {
  bnf: grammar,
  operators: operators.reverse() // Parser generator needs low to high
};
