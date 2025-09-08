#!/usr/bin/env coffee

###
Rip Language CLI
================

Main command-line interface for the Rip language compiler.
Processes source code through lexer → rewriter → parser → AST.

Usage:
  rip [options] [file]
  echo "code" | rip [options]

Options:
  -h, --help     Show help information
  -v, --version  Show version information
  -t, --tokens   Show token stream
  -a, --ast      Show AST nodes
###

# Dependencies
fs = require 'fs'
path = require 'path'
{ Lexer } = require '../src/lexer'
{ Rewriter } = require '../src/rewriter'
{ createParser } = require '../src/parser'
{ version } = require '../package.json'
grammar = require '../src/grammar'

# Parse command-line arguments
parseArgs = ->
  args = process.argv[2..]
  options =
    help: false
    version: false
    tokens: false
    ast: false
    file: null
    code: null

  i = 0
  while i < args.length
    arg = args[i]
    switch arg
      when '-h', '--help'
        options.help = true
      when '-v', '--version'
        options.version = true
      when '-t', '--tokens'
        options.tokens = true
      when '-a', '--ast'
        options.ast = true
      else
        if arg.startsWith '-'
          console.error "Unknown option: #{arg}"
          process.exit 1
        else
          options.file = arg
    i++

  options

# Show help information
showHelp = ->
  console.log """
    Rip Language Compiler v#{version}

    Usage:
      rip [options] [file]
      echo "code" | rip [options]

    Options:
      -h, --help     Show this help message
      -v, --version  Show version information
      -t, --tokens   Display token stream
      -a, --ast      Display AST nodes

    Examples:
      rip test.coffee             # Process a file
      rip -t test.coffee          # Show tokens
      rip -a test.coffee          # Show AST
      echo "x = 42" | rip -t      # Process stdin with tokens
  """

# Show version
showVersion = ->
  console.log "Rip v#{version}"

# Format tokens for display
formatTokens = (tokens) ->
  output = []
  for token, i in tokens
    [type, value, location] = token
    # Skip TERMINATOR tokens for cleaner output unless in verbose mode
    continue if type is 'TERMINATOR' and value is '\n'

    loc = if location
      "[#{location.first_line}:#{location.first_column}]"
    else
      ""

    output.push "#{String(i).padStart(3)} #{loc.padEnd(8)} #{type.padEnd(15)} #{JSON.stringify(value)}"

  output.join '\n'

# Format AST for display (simplified for now)
formatAST = (ast, indent = 0) ->
  return 'null' unless ast

  spaces = '  '.repeat(indent)

  if typeof ast is 'string'
    return "#{spaces}#{JSON.stringify(ast)}"
  else if typeof ast is 'number'
    return "#{spaces}#{ast}"
  else if Array.isArray ast
    if ast.length is 0
      return "#{spaces}[]"
    lines = ["#{spaces}["]
    for item in ast
      lines.push formatAST(item, indent + 1)
    lines.push "#{spaces}]"
    return lines.join('\n')
  else if typeof ast is 'object'
    # Extract type if present for cleaner display
    type = ast.type or ast.$node or 'Object'
    lines = ["#{spaces}#{type} {"]

    for own key, value of ast when key not in ['type', '$node']
      if value is null or value is undefined
        lines.push "#{spaces}  #{key}: null"
      else if typeof value in ['string', 'number', 'boolean']
        lines.push "#{spaces}  #{key}: #{JSON.stringify(value)}"
      else
        lines.push "#{spaces}  #{key}:"
        lines.push formatAST(value, indent + 2)

    lines.push "#{spaces}}"
    return lines.join('\n')
  else
    return "#{spaces}#{ast}"

# Read source code
getSourceCode = (options) ->
  if options.file
    # Read from file
    unless fs.existsSync options.file
      console.error "File not found: #{options.file}"
      process.exit 1
    fs.readFileSync options.file, 'utf8'
  else if not process.stdin.isTTY
    # Read from stdin synchronously
    fs.readFileSync(0, 'utf8')  # fd 0 is stdin
  else
    # No input provided
    null

# Main processing pipeline
processCode = (code, options) ->
  console.log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" if options.tokens or options.ast
  console.log "Processing: #{JSON.stringify(code.slice(0, 50) + if code.length > 50 then '...' else '')}"
  console.log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  console.log ''

  try
    # Step 1: Lexer
    lexer = new Lexer()
    lexer.tokenize code

    # Step 2: Rewriter
    rewriter = new Rewriter()
    tokens = rewriter.rewrite lexer.tokens

    if options.tokens
      console.log "📝 Token Stream:"
      console.log "─────────────────"
      console.log formatTokens(tokens)
      console.log ''

    # Step 3: Parser
    if options.ast
      console.log "🌳 Abstract Syntax Tree:"
      console.log "────────────────────────"

      # Create parser and set up lexer interface
      parser = createParser grammar

      # Create a lexer interface for the parser
      tokenIndex = 0
      parserLexer =
        lex: ->
          return 1 if tokenIndex >= tokens.length  # EOF
          token = tokens[tokenIndex++]
          @yytext = token[1]
          @yylloc = token[2] or {}
          @yylineno = @yylloc.first_line or 0
          token[0]  # Return token type
        setInput: ->
          tokenIndex = 0
        yylloc: {}
        options: {}

      parser.lexer = parserLexer

      # Parse!
      try
        ast = parser.parse()
        console.log formatAST(ast)
      catch parseError
        console.error "Parse error: #{parseError.message or parseError}"
        if parseError.hash
          console.error "  at line #{parseError.hash.line}, expected: #{parseError.hash.expected?.join(', ') or 'unknown'}"
          console.error "  got: #{parseError.hash.token or 'unknown'}"
        process.exit 1

      console.log ''

    console.log "✅ Processing complete!"

  catch error
    console.error "❌ Error: #{error.message}"
    console.error error.stack if process.env.DEBUG
    process.exit 1

# Main entry point
main = ->
  options = parseArgs()

  # Handle help and version
  if options.help
    showHelp()
    process.exit 0

  if options.version
    showVersion()
    process.exit 0

  # Get source code
  code = getSourceCode(options)

  unless code?
    # If no options specified, show help
    if not options.tokens and not options.ast
      showHelp()
    else
      console.error "No input provided. Use a file argument or pipe code to stdin."
    process.exit 1

  # Process the code
  processCode code, options

# Run if executed directly
main() if require.main is module
