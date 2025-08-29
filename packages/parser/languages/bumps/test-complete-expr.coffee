#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# Test different IF expressions
tests = [
  "I X\n",           # Simple variable - should work
  "I 'X\n",          # NOT variable - fails
  "I X=1\n",         # Comparison - should work
  "I 'X=1\n",        # NOT comparison - ?
  "I ('X)\n",        # NOT in parens - ?
  "S Y='X\n",        # SET with NOT - for comparison
]

for src in tests
  console.log "\n=== Testing: #{JSON.stringify(src.trim())} ==="

  try
    lexer = new BumpsLexer()
    tokens = lexer.tokenize src

    console.log "Tokens:"
    for tok in tokens[...-1]  # Skip final newline
      type = tok[0]
      val = tok[1]
      if val? and val != type
        console.log "  #{type}(#{JSON.stringify(val)})"
      else
        console.log "  #{type}"

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
    console.log "✓ Parsed!"

  catch error
    console.log "✗ Error: #{error.message.split('\n')[0]}"
