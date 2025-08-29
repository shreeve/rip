#!/usr/bin/env coffee

{ BumpsLexer } = require './lexer.coffee'

# Test problematic IF expression
src = "I 'X W \"not X\"\n"

console.log "Testing: #{src.trim()}"
console.log "---"

lexer = new BumpsLexer()

# Monkey-patch the tokenize method to add tracing
origTokenize = lexer.tokenize
lexer.tokenize = (input) ->
  console.log "Initial state:"
  console.log "  inIfExpr: #{@inIfExpr}"
  console.log "  afterCommand: false"
  console.log "  afterCmdSep: false"
  console.log ""

  # Patch internal processing
  tokens = []
  lines = input.split '\n'

  for line, li in lines
    pos = 0
    afterCommand = false
    afterCmdSep = false

    console.log "Line #{li}: '#{line}'"

    while line.length > 0
      # Try to identify what we're about to process
      if m = line.match /^[A-Za-z%][A-Za-z0-9]*/
        word = m[0]
        cmd = @commandToken word
        if afterCmdSep and cmd
          console.log "  [#{pos}] Found chained command: #{word}"
          console.log "    Setting inIfExpr = #{cmd is 'IF'}"
          @inIfExpr = (cmd is 'IF')
        else if not afterCmdSep and cmd and pos == 0
          console.log "  [#{pos}] Found initial command: #{word}"
          console.log "    Setting inIfExpr = #{cmd is 'IF'}"
          @inIfExpr = (cmd is 'IF')
        else
          console.log "  [#{pos}] Found name: #{word}"
      else if line.match /^[ \t]+/
        ws = line.match(/^[ \t]+/)[0]
        after = line[ws.length..]
        nextWord = after.match(/^[A-Za-z%][A-Za-z0-9]*/)?[0]
        nextCmd = if nextWord then @commandToken(nextWord) else null
        console.log "  [#{pos}] Found space, afterCommand=#{afterCommand}, inIfExpr=#{@inIfExpr}, nextWord=#{nextWord}, nextCmd=#{nextCmd}"
      else if line[0] == "'"
        console.log "  [#{pos}] Found NOT operator"
      else
        console.log "  [#{pos}] Found other: #{line[0]}"

      # Advance (simplified - just for tracing)
      if line[0] == ' '
        line = line[1..]
        pos += 1
      else if m = line.match /^[A-Za-z%][A-Za-z0-9]*/
        line = line[m[0].length..]
        pos += m[0].length
      else
        line = line[1..]
        pos += 1

  # Call original with tracing
  origTokenize.call(this, input)

tokens = lexer.tokenize src

console.log "\nFinal tokens:"
for tok in tokens
  type = tok[0]
  val = tok[1]
  display = if val? and val != type then "#{type}(#{JSON.stringify(val)})" else type
  console.log "  #{display}"
