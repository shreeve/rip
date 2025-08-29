#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# Test simple expressions to understand the issue
tests = [
  "S X=1\n",        # NUMBER
  "S X=Y\n",        # NAME
  "S X=(Y)\n",      # Parenthesized NAME
  "S X=Y+1\n",      # Binary op
  "S X='1\n",       # NOT NUMBER
  "S X='Y\n",       # NOT NAME
]

for src in tests
  console.log "\n=== Testing: #{JSON.stringify(src.trim())} ==="

  try
    lexer = new BumpsLexer()
    tokens = lexer.tokenize src

    # Show tokens compactly
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
        # Debug: show what token is being consumed
        # console.log "  Lex: #{tok}"
        tok
      showPosition: -> ''

    ast = parserMod.parse src
    console.log "✓ Parsed!"

  catch error
    errLine = error.message.split('\n')[0]
    if errLine.includes('Expecting')
      expecting = errLine.match(/Expecting (.+?), got/)?[1]?.split(', ')?.slice(0, 3)?.join(', ') or 'unknown'
      got = errLine.match(/got '([^']+)'/)?[1] or 'unknown'
      console.log "✗ Error: Expecting #{expecting}... got '#{got}'"
    else
      console.log "✗ Error: #{errLine}"
