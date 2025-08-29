#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'

# Test what tokens are generated
tests = [
  "I X W \"yes\"",       # IF X WRITE - works
  "I 'X W \"no\"",       # IF NOT X WRITE - fails
  "I X=1 W \"eq\"",      # IF X=1 WRITE - works
  "I 'X=1 W \"noteq\"",  # IF NOT(X=1) WRITE - fails
]

for src in tests
  console.log "\n=== #{src} ==="
  lexer = new BumpsLexer()
  tokens = lexer.tokenize src + "\n"

  # Show tokens compactly
  tokStr = tokens[...-2].map((t) ->
    if t[1]? and t[1] != t[0]
      "#{t[0]}(#{JSON.stringify(t[1])})"
    else
      t[0]
  ).join(' ')

  console.log "Tokens: #{tokStr}"

  # Highlight the issue
  csCount = tokens.filter((t) -> t[0] == 'CS').length
  console.log "CS tokens: #{csCount}"
  if csCount > 2
    console.log "⚠️  Too many CS tokens - likely causing parse error"
