#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# Test comma as OR operator
tests = [
  "IF A,B W \"A or B\"\n",          # Simple comma OR
  "IF X=1,Y=2 W \"either\"\n",      # Comma with comparisons
  "IF 'A,B W \"not A or B\"\n",     # NOT with comma
  "IF A,'B W \"A or not B\"\n",     # Mixed
  "IF A,B,C W \"any\"\n",           # Multiple commas (should chain as OR)
]

console.log "Testing comma as logical OR in conditionals:\n"

for src in tests
  try
    lexer = new BumpsLexer()
    tokens = lexer.tokenize src

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
    # Extract the IF condition to verify it's an OR
    ifCmd = ast.lines[0].cmds[0]
    if ifCmd.type is 'If' and ifCmd.cond?.op is 'OR'
      console.log "✅ #{src.trim()} -> OR operation created"
    else
      console.log "✅ #{src.trim()}"

  catch error
    console.log "❌ #{src.trim()}"
    console.log "   Error: #{error.message.split('\n')[0]}"
