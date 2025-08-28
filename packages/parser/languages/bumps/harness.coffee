#!/usr/bin/env coffee

# npx coffee test-bumps.coffee

###
Minimal harness for bumps.coffee using your solar.coffee driver
- Loads CoffeeScript files via require hook
- Builds the parser from the grammar object
- Parses a small corpus from `exports.samples` (or a fallback list)
- Prints AST roots as JSON
###

try
  require 'coffeescript/register'
catch e then null

path = require 'path'

safeRequire = (p) ->
  try
    require p
  catch err
    null

# Load driver and grammar
solar   = safeRequire('./solar.coffee') or safeRequire('./solar') or {}
grammar = require './bumps.coffee'

makeParser = (g) ->
  return solar g                  if typeof solar is 'function'
  return solar.compile g          if solar?.compile?
  return solar.buildParser g      if solar?.buildParser?
  return solar.makeParser g       if solar?.makeParser?
  return new solar.Parser g       if typeof solar?.Parser is 'function'
  throw new Error 'Unrecognized solar driver API: expected function, compile(), buildParser(), makeParser(), or Parser class'

parser = makeParser grammar

samples = grammar.samples ? [
  'SET SET=1'
  'IF A=1  WRITE "ok"  ELSE  WRITE "no"'
  'SET X=$PIECE(S,":",1,3)'
  'WRITE ?10,"hi",!,"bye"'
]

ok = true
for src, i in samples
  try
    ast = parser.parse src
    console.log "\n### Sample #{i + 1} ###"
    console.log src
    console.log JSON.stringify ast, null, 2
  catch err
    ok = false
    console.error "\nParse error in sample #{i + 1}: #{src}"
    console.error err?.stack or err?.message or String err
    console.error JSON.stringify(err.hash, null, 2) if err?.hash?

process.exitCode = if ok then 0 else 1
