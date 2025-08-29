#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# Test the exact case the user mentioned
src = 'I \'X W "false"' + "\n"

console.log "Testing user's case: #{JSON.stringify(src.trim())}"
console.log "---"

try
  lexer = new BumpsLexer()
  tokens = lexer.tokenize src

  console.log "Tokens:"
  for tok in tokens[...-1]
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
  console.log "\n✅ SUCCESS! The problematic case now parses correctly!"
  console.log "AST:", JSON.stringify(ast, null, 2).split('\n').slice(0, 10).join('\n')

catch error
  console.log "\n✗ Error: #{error.message.split('\n')[0]}"
