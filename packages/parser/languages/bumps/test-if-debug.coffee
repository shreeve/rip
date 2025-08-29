#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# Test problematic IF expressions
tests = [
  "I 'X W \"not X\"\n",       # Abbreviated IF with NOT
  "IF 'X W \"not X\"\n",      # Full IF with NOT
  "IF A,B W \"A or B\"\n",    # IF with comma (OR)
  "IF X W \"X is true\"\n",   # Simple IF
  "IF X=1 W \"X=1\"\n",       # IF with comparison
]

for src in tests
  console.log "\n=== Testing: #{src.trim()} ==="

  lexer = new BumpsLexer()
  # Initialize yy object to track IF context
  lexer.yy = { inIfExpr: false }
  tokens = lexer.tokenize src

  console.log "Tokens:"
  for tok in tokens
    type = tok[0]
    val = tok[1]
    display = if val? and val != type then "#{type}(#{JSON.stringify(val)})" else type
    console.log "  #{display}"
    # Show when IF context changes
    if type in ['IF', 'CS']
      console.log "    -> inIfExpr: #{lexer.inIfExpr}"

  try
    parser = parserMod.parser
    parser.tokens = tokens
    parser.yy =
      node: (type, props = {}) -> { type, props... }
      parsePattern: parsePattern

    parser.lexer =
      all: tokens
      i: 0
      yytext: ''
      yyleng: 0
      yylloc: {}
      yylineno: 0
      setInput: -> @i = 0; this
      lex: ->
        return 1 if @i >= @all.length
        [tok, val, loc] = @all[@i++]
        @yytext = String(val ? tok)
        @yyleng = @yytext.length
        @yylloc = loc or {}
        @yylineno = @yylloc.first_line or 0
        tok
      showPosition: -> ''

    ast = parserMod.parse src
    console.log "✓ Parsed successfully!"

  catch error
    console.log "✗ Parse error: #{error.message?.split('\n')[0]}"
