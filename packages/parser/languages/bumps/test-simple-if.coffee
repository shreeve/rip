#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# Test just the simplest problematic case
tests = [
  "I 'X\n",          # Just IF NOT X (should work)
  "I 'X W \"no\"\n", # IF NOT X then WRITE (fails)
]

for src in tests
  console.log "\n=== Testing: #{JSON.stringify(src.trim())} ==="

  try
    lexer = new BumpsLexer()
    tokens = lexer.tokenize src

    console.log "Tokens:"
    for tok in tokens[...-1]  # Skip final newlines
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
    console.log "✓ Parsed successfully!"

  catch error
    errMsg = error.message?.split('\n')[0]
    # Extract just the key part of the error
    if errMsg?.includes 'Expecting'
      expecting = errMsg.match(/Expecting ([^,]+)/)?[1] or 'unknown'
      got = errMsg.match(/got '([^']+)'/)?[1] or 'unknown'
      console.log "✗ Parse error: Expecting #{expecting}, got '#{got}'"
    else
      console.log "✗ Parse error: #{errMsg}"
