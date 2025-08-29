#!/usr/bin/env coffee

fs = require 'fs'
path = require 'path'
parserMod = require './parser.js'
{ attachBlocks } = require './blocks.coffee'
require '../../../../coffeescript/register.js'

readSource = (argv) ->
  if argv.length > 2
    p = path.resolve argv[2]
    return fs.readFileSync p, 'utf8'
  'SET X=1,Y=2\nWRITE "A", 1, X\nREAD X:5\nDO ^ROUT\n'

class Adapter
  constructor: (tokens) ->
    @all = tokens or []
    @i = 0
    @yytext = ''
    @yyleng = 0
    @yylloc = {}
    @yylineno = 0
  setInput: (input, yy) ->
    @yy = yy or {}
    @i = 0
    @yytext = ''
    @yyleng = 0
    @yylloc = {}
    @yylineno = 0
    this
  lex: ->
    return 1 if @i >= @all.length
    [tag, val, loc] = @all[@i++]
    @yytext = String(val ? tag)
    @yyleng = @yytext.length
    @yylloc = loc or {}
    @yylineno = @yylloc.first_line or 0
    tag
  showPosition: -> ''

main = ->
  { BumpsLexer } = require './lexer.coffee'
  src = readSource process.argv
  lex = new BumpsLexer()
  toks = lex.tokenize src

  p = parserMod.parser
  p.tokens = toks
  p.yy = p.yy or {}
  p.yy.node = p.yy.node or ((type, props) -> Object.assign { type }, props or {})
  p.lexer = new Adapter p.tokens

  try
    ast = parserMod.parse src
    if ast?.type is 'Program' then attachBlocks ast
    console.log if ast is true then 'accepted' else 'ok'
    if process.env.BUMPS_DEBUG
      console.log JSON.stringify toks.map(([t,v])->[t,v]), null, 2
      console.log JSON.stringify ast, null, 2
  catch e
    console.error 'Parse error:', e.message
    process.exit 1

main() if require.main is module
