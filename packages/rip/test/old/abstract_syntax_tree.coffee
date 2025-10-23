# Abstract Syntax Tree Tests
# --------------------------

# Test that AST generation is working for basic node types

# Helper to check AST structure
testAST = (code, nodeType) ->
  ast = CoffeeScript.compile code, ast: yes
  ast.program.body[0].type is nodeType or
    ast.program.body[0].expression?.type is nodeType

# Number literals

test "AST for number literal", """
  ast = CoffeeScript.compile '42', ast: yes
  ast.program.body[0].expression.type
""", 'NumericLiteral'

test "AST number value", """
  ast = CoffeeScript.compile '42', ast: yes
  ast.program.body[0].expression.value
""", 42

test "AST for hex number", """
  ast = CoffeeScript.compile '0xFF', ast: yes
  ast.program.body[0].expression.value
""", 255

# String literals

test "AST for string literal", """
  ast = CoffeeScript.compile '"hello"', ast: yes
  ast.program.body[0].expression.type
""", 'StringLiteral'

test "AST string value", """
  ast = CoffeeScript.compile '"hello"', ast: yes
  ast.program.body[0].expression.value
""", 'hello'

# Boolean literals

test "AST for boolean true", """
  ast = CoffeeScript.compile 'true', ast: yes
  ast.program.body[0].expression.type
""", 'BooleanLiteral'

test "AST boolean value", """
  ast = CoffeeScript.compile 'false', ast: yes
  ast.program.body[0].expression.value
""", false

# Null literal

test "AST for null", """
  ast = CoffeeScript.compile 'null', ast: yes
  ast.program.body[0].expression.type
""", 'NullLiteral'

# Undefined

test "AST for undefined", """
  ast = CoffeeScript.compile 'undefined', ast: yes
  ast.program.body[0].expression.type
""", 'Identifier'

test "AST undefined name", """
  ast = CoffeeScript.compile 'undefined', ast: yes
  ast.program.body[0].expression.name
""", 'undefined'

# Identifiers

test "AST for identifier", """
  ast = CoffeeScript.compile 'variable', ast: yes
  ast.program.body[0].expression.type
""", 'Identifier'

test "AST identifier name", """
  ast = CoffeeScript.compile 'myVar', ast: yes
  ast.program.body[0].expression.name
""", 'myVar'

# Arrays

test "AST for array", """
  ast = CoffeeScript.compile '[1, 2, 3]', ast: yes
  ast.program.body[0].expression.type
""", 'ArrayExpression'

test "AST array length", """
  ast = CoffeeScript.compile '[1, 2, 3]', ast: yes
  ast.program.body[0].expression.elements.length
""", 3

# Objects

test "AST for object", """
  ast = CoffeeScript.compile '{a: 1}', ast: yes
  ast.program.body[0].expression.type
""", 'ObjectExpression'

test "AST object property", """
  ast = CoffeeScript.compile '{a: 1}', ast: yes
  ast.program.body[0].expression.properties[0].type
""", 'ObjectProperty'

# Functions

test "AST for function", """
  ast = CoffeeScript.compile '-> 5', ast: yes
  ast.program.body[0].expression.type
""", 'ArrowFunctionExpression'

test "AST function params", """
  ast = CoffeeScript.compile '(x) -> x', ast: yes
  ast.program.body[0].expression.params.length
""", 1

test "AST function body", """
  ast = CoffeeScript.compile '-> 5', ast: yes
  ast.program.body[0].expression.body.type
""", 'BlockStatement'

# Binary operations

test "AST for addition", """
  ast = CoffeeScript.compile '1 + 2', ast: yes
  ast.program.body[0].expression.type
""", 'BinaryExpression'

test "AST addition operator", """
  ast = CoffeeScript.compile '1 + 2', ast: yes
  ast.program.body[0].expression.operator
""", '+'

# Unary operations

test "AST for negation", """
  ast = CoffeeScript.compile '-5', ast: yes
  ast.program.body[0].expression.type
""", 'UnaryExpression'

test "AST negation operator", """
  ast = CoffeeScript.compile '-5', ast: yes
  ast.program.body[0].expression.operator
""", '-'

test "AST not operator", """
  ast = CoffeeScript.compile 'not true', ast: yes
  ast.program.body[0].expression.operator
""", '!'

# Assignment

test "AST for assignment", """
  ast = CoffeeScript.compile 'a = 5', ast: yes
  ast.program.body[0].expression.type
""", 'AssignmentExpression'

test "AST assignment operator", """
  ast = CoffeeScript.compile 'a = 5', ast: yes
  ast.program.body[0].expression.operator
""", '='

# Conditionals

test "AST for if statement", """
  ast = CoffeeScript.compile 'if true then 1', ast: yes
  ast.program.body[0].type
""", 'IfStatement'

test "AST for ternary", """
  ast = CoffeeScript.compile 'if true then 1 else 2', ast: yes
  ast.program.body[0].type
""", 'ExpressionStatement'

# Loops

test "AST for while loop", """
  ast = CoffeeScript.compile 'while true\\n  break', ast: yes
  ast.program.body[0].type
""", 'WhileStatement'

test "AST for for loop", """
  ast = CoffeeScript.compile 'for x in [1,2,3]\\n  x', ast: yes
  ast.program.body[0].type
""", 'ForStatement'

# Classes

test "AST for class", """
  ast = CoffeeScript.compile 'class Foo', ast: yes
  ast.program.body[0].type
""", 'ClassDeclaration'

test "AST class name", """
  ast = CoffeeScript.compile 'class MyClass', ast: yes
  ast.program.body[0].id.name
""", 'MyClass'

# Comments

test "AST preserves comments", """
  ast = CoffeeScript.compile '# comment\\n42', ast: yes
  ast.comments.length
""", 1

test "AST comment type", """
  ast = CoffeeScript.compile '# hello', ast: yes
  ast.comments[0].type
""", 'CommentLine'

test "AST comment value", """
  ast = CoffeeScript.compile '# hello', ast: yes
  ast.comments[0].value
""", ' hello'

# Template literals

test "AST for template literal", """
  ast = CoffeeScript.compile '"hello #{name}"', ast: yes
  ast.program.body[0].expression.type
""", 'TemplateLiteral'

# Regular expressions

test "AST for regex", """
  ast = CoffeeScript.compile '/pattern/', ast: yes
  ast.program.body[0].expression.type
""", 'RegExpLiteral'

test "AST regex pattern", """
  ast = CoffeeScript.compile '/abc/', ast: yes
  ast.program.body[0].expression.pattern
""", 'abc'

# Try/Catch

test "AST for try statement", """
  ast = CoffeeScript.compile 'try\\n  1\\ncatch\\n  2', ast: yes
  ast.program.body[0].type
""", 'TryStatement'

# Switch

test "AST for switch", """
  ast = CoffeeScript.compile 'switch x\\n  when 1 then 2', ast: yes
  ast.program.body[0].type
""", 'SwitchStatement'

# Return

test "AST for return", """
  ast = CoffeeScript.compile 'return 5', ast: yes
  ast.program.body[0].type
""", 'ReturnStatement'

# Throw

test "AST for throw", """
  ast = CoffeeScript.compile 'throw new Error', ast: yes
  ast.program.body[0].type
""", 'ThrowStatement'

# Member access

test "AST for member access", """
  ast = CoffeeScript.compile 'obj.prop', ast: yes
  ast.program.body[0].expression.type
""", 'MemberExpression'

test "AST computed member access", """
  ast = CoffeeScript.compile 'obj[0]', ast: yes
  ast.program.body[0].expression.computed
""", true

# Call expressions

test "AST for function call", """
  ast = CoffeeScript.compile 'fn()', ast: yes
  ast.program.body[0].expression.type
""", 'CallExpression'

test "AST call arguments", """
  ast = CoffeeScript.compile 'fn(1, 2)', ast: yes
  ast.program.body[0].expression.arguments.length
""", 2

# New expression

test "AST for new", """
  ast = CoffeeScript.compile 'new Foo', ast: yes
  ast.program.body[0].expression.type
""", 'NewExpression'

# Spread

test "AST for spread", """
  ast = CoffeeScript.compile '[...arr]', ast: yes
  ast.program.body[0].expression.elements[0].type
""", 'SpreadElement'

# Async/Await

test "AST for await", """
  ast = CoffeeScript.compile 'await promise', ast: yes
  ast.program.body[0].expression.type
""", 'AwaitExpression'

test "AST async function", """
  ast = CoffeeScript.compile '-> await 1', ast: yes
  ast.program.body[0].expression.async
""", true


