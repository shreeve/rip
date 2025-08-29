#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# Test unary minus (should work if unary operators work)
tests = [
  "S X=-Y\n",      # Unary minus
  "S X=+Y\n",      # Unary plus
  "S X='Y\n",      # Unary NOT (for comparison)
]

for src in tests
  console.log "\n=== Testing: #{JSON.stringify(src.trim())} ==="

  try
    lexer = new BumpsLexer()
    tokens = lexer.tokenize src

    # Show tokens
    tokStr = tokens[...-2].map((t) ->
      if t[1]? and t[1] != t[0]
        "#{t[0]}(#{JSON.stringify(t[1])})"
      else
        t[0]
    ).join(' ')
    console.log "Tokens: #{tokStr}"

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
