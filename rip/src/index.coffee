# Rip Language - Main entry point
# Multi-runtime support: Bun (primary), Deno, Node.js, Browser

{ Lexer } = require './lexer'
{ Rewriter } = require './rewriter'
{ version } = require '../package.json'

# Platform detection helper
getPlatform = ->
  if typeof Bun isnt 'undefined'
    { runtime: 'bun', version: Bun.version }
  else if typeof Deno isnt 'undefined'
    { runtime: 'deno', version: Deno.version.deno }
  else if typeof process isnt 'undefined'
    { runtime: 'node', version: process.version }
  else if typeof window isnt 'undefined'
    { runtime: 'browser', version: navigator.userAgent }
  else
    { runtime: 'unknown', version: 'unknown' }


# Export all components
module.exports = { Lexer, Rewriter, version, getPlatform }
