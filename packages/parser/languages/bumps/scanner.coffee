#!/usr/bin/env coffee

# BUMPS Scanner - Parse all .m files in a directory tree
# Usage: coffee scanner.coffee /path/to/vista/routines

fs = require 'fs'
path = require 'path'
{ BumpsLexer } = require './lexer.coffee'
parserMod = require './parser.js'
{ parsePattern } = require './patterns.coffee'

# ANSI color codes
GREEN = '\x1b[32m'
RED = '\x1b[31m'
YELLOW = '\x1b[33m'
BLUE = '\x1b[34m'
RESET = '\x1b[0m'
BOLD = '\x1b[1m'

# String helpers
padLeft = (str, width) ->
  str = String(str)
  spaces = Math.max(0, width - str.length)
  ' '.repeat(spaces) + str

padRight = (str, width) ->
  str = String(str)
  str + ' '.repeat(Math.max(0, width - str.length))

# Stats tracking
stats =
  totalFiles: 0
  successFiles: 0
  errorFiles: 0
  totalLines: 0
  totalTime: 0
  errors: []

# Format time in ms with color
formatTime = (ms) ->
  color = if ms < 10 then GREEN else if ms < 50 then YELLOW else RED
  "#{color}#{ms.toFixed(3)}ms#{RESET}"

# Format status with color
formatStatus = (ok, error = null) ->
  if ok
    "#{GREEN}✓ OK#{RESET}"
  else
    "#{RED}✗ FAIL#{RESET}"

# Count lines in content
countLines = (content) ->
  content.split('\n').length

# Find all .m files recursively
findMumpsFiles = (dir, files = []) ->
  try
    items = fs.readdirSync dir
    for item in items
      fullPath = path.join dir, item
      try
        stat = fs.statSync fullPath
        if stat.isDirectory()
          # Skip node_modules and hidden directories
          unless item.startsWith('.') or item is 'node_modules'
            findMumpsFiles fullPath, files
        else if item.match /\.(m|M|int|INT|mac|MAC|rou|ROU)$/
          files.push fullPath
      catch e
        # Skip files we can't access
        continue
  catch e
    console.error "#{RED}Cannot read directory: #{dir}#{RESET}"
  files

# Parse a single file
parseFile = (filePath) ->
  try
    content = fs.readFileSync filePath, 'utf8'
    lineCount = countLines content
    stats.totalLines += lineCount

    # Preprocessing for common VistA patterns
    # Split into lines and process each
    contentLines = content.split('\n')
    contentLines = contentLines.map (line) ->
      # Remove trailing whitespace
      line = line.trimEnd()

      # Handle lines that start with a single space (common in VistA)
      # These are command lines, not dot-indent blocks
      if line.match /^ [^ ]/
        # Remove the leading space - the command will be recognized
        line = line.slice(1)

      # Add spaces after label-only lines to help parser
      # (VistA often has label-only lines with comments)
      if line.match(/^[A-Z%][A-Z0-9]* *;/) and not line.match(/^[A-Z%][A-Z0-9]*.*  /)
        line + '  '  # Add two spaces to indicate no commands
      else
        line

    content = contentLines.join('\n')

    # Add newline if missing (MUMPS files should end with newline)
    content += '\n' unless content.endsWith '\n'

    startTime = process.hrtime.bigint()

    # Tokenize
    lexer = new BumpsLexer()
    tokens = lexer.tokenize content

    # Parse
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

    ast = parserMod.parse content

    endTime = process.hrtime.bigint()
    parseTime = Number(endTime - startTime) / 1_000_000  # Convert to ms

    stats.totalTime += parseTime
    stats.successFiles++

    { success: true, lines: lineCount, parseTime }

  catch error
    stats.errorFiles++
    errorMsg = error.message?.split('\n')?[0] or String(error)
    stats.errors.push { file: filePath, error: errorMsg }
    { success: false, lines: lineCount or 0, parseTime: 0, error: errorMsg }

# Format filename for display
formatFilename = (filePath, baseDir, maxLen = 50) ->
  relative = path.relative baseDir, filePath
  if relative.length > maxLen
    '...' + relative.slice -(maxLen - 3)
  else
    relative

# Main scanner
scan = (targetDir, opts = {}) ->
  targetDir = path.resolve targetDir

  console.log "#{BOLD}Scanning for MUMPS files in: #{targetDir}#{RESET}\n"

  # Find all MUMPS files
  files = findMumpsFiles targetDir
  foundCount = files.length

  if foundCount is 0
    console.log "#{YELLOW}No MUMPS files found.#{RESET}"
    return

  console.log "Found #{BLUE}#{foundCount}#{RESET} MUMPS file(s)\n"

  # Optional: limit number of files to process
  if opts?.maxFiles?
    maxN = Math.max 0, Math.floor(+opts.maxFiles or 0)
    if maxN > 0 and maxN < files.length
      files = files.slice 0, maxN

  # Track number of files we will actually process
  stats.totalFiles = files.length

  # Table header
  header = [
    padRight('File', 52)
    padLeft('Lines', 8)
    padLeft('Parse Time', 12)
    'Status'
  ].join ' '
  console.log "#{BOLD}#{header}#{RESET}"
  console.log '-'.repeat 80

  # Process each file
  for filePath in files
    result = parseFile filePath
    displayName = formatFilename filePath, targetDir, 50

    statusText = formatStatus result.success, result.error
    timeText = if result.success then formatTime(result.parseTime) else '     -     '

    row = [
      padRight(displayName, 52)
      padLeft(String(result.lines), 8)
      padLeft(timeText, 12)
      statusText
    ].join ' '
    console.log row

  # Summary
  console.log '-'.repeat 80
  console.log "\n#{BOLD}Summary:#{RESET}"
  console.log "  Total Files:  #{stats.totalFiles}"
  console.log "  #{GREEN}Successful:   #{stats.successFiles}#{RESET}"
  console.log "  #{RED}Failed:       #{stats.errorFiles}#{RESET}"
  console.log "  Total Lines:  #{stats.totalLines.toLocaleString()}"

  if stats.successFiles > 0
    avgTime = stats.totalTime / stats.successFiles
    console.log "  Avg Parse:    #{formatTime avgTime}"
    console.log "  Total Time:   #{formatTime stats.totalTime}"

  if stats.errorFiles > 0
    successRate = (stats.successFiles / stats.totalFiles * 100).toFixed(1)
    console.log "\n  Success Rate: #{successRate}%"
  else
    console.log "\n  #{GREEN}Success Rate: 100%#{RESET} 🎉"

  # Show first few errors if any
  if stats.errors.length > 0
    console.log "\n#{RED}First few errors:#{RESET}"
    for err, i in stats.errors[...5]
      shortFile = formatFilename err.file, targetDir, 40
      console.log "  #{shortFile}: #{err.error}"
    if stats.errors.length > 5
      console.log "  ... and #{stats.errors.length - 5} more"

# Command line interface
main = ->
  args = process.argv[2..]

  if args.length is 0
    console.log """
      #{BOLD}BUMPS Scanner - Parse all MUMPS files in a directory#{RESET}

      Usage:
        coffee scanner.coffee <directory> [-n N]

      Options:
        -n N     Stop after processing N files

      Example:
        coffee scanner.coffee /usr/local/vista/r
        coffee scanner.coffee ./test-routines -n 100

      This will:
        - Recursively find all .m files
        - Parse each file with the BUMPS parser
        - Show parse time and status
        - Provide summary statistics
    """
    process.exit 1

  # Simple flag parsing for -n N
  targetDir = null
  maxFiles = null
  i = 0
  while i < args.length
    a = args[i]
    if a is '-n'
      i++
      maxFiles = parseInt(args[i] or '0', 10)
    else if not targetDir
      targetDir = a
    i++

  unless targetDir?
    console.error "#{RED}Error: Directory not specified#{RESET}"
    process.exit 1

  unless fs.existsSync targetDir
    console.error "#{RED}Error: Directory not found: #{targetDir}#{RESET}"
    process.exit 1

  unless fs.statSync(targetDir).isDirectory()
    console.error "#{RED}Error: Not a directory: #{targetDir}#{RESET}"
    process.exit 1

  scan targetDir, { maxFiles }

# Run if called directly
main() if require.main is module

module.exports = { scan, parseFile, findMumpsFiles }
