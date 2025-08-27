# Minimal BUMPS lexer (CoffeeScript)
# Provides Jison-style interface: setInput(input, yy), lex(), showPosition()

class BumpsLexer
  constructor: ->
    @yy = {}
    @tokens = []
    @cursor = 0

  setInput: (input, yy) ->
    @yy = yy or {}
    @tokens = @tokenize String(input or '')
    @cursor = 0
    this

  lex: ->
    return 1 if @cursor >= @tokens.length # $end
    [tag, value, loc] = @tokens[@cursor++]
    @yytext = value
    @yyleng = if value? then String(value).length else 0
    @yylloc = loc or {}
    @yylineno = @yylloc.first_line or 0
    tag

  showPosition: -> ''

  # Very simple tokenizer to bootstrap parsing of basic lines like:
  #   SET X=1
  #   WRITE "Hi"
  tokenize: (src) ->
    out = []
    lines = src.split /\r?\n/
    for line, li in lines
      pos = 0

      # DOTS at start
      if m = line.match /^\.+/
        dots = m[0]
        out.push ['DOTS', dots, @loc(li, pos, li, pos + dots.length)]
        pos += dots.length
        line = line[dots.length..]

      # LABEL or COMMAND at start
      if m = line.match /^[A-Za-z%][A-Za-z0-9]*/
        word = m[0]
        cmd = @commandToken word
        if cmd
          out.push [cmd, word, @loc(li, pos, li, pos + word.length)]
        else
          out.push ['LABEL', word, @loc(li, pos, li, pos + word.length)]
        pos += word.length
        line = line[word.length..]

      # CS after any command or label spacing
      if m = line.match /^[ \t]+/
        ws = m[0]
        out.push ['CS', ws, @loc(li, pos, li, pos + ws.length)]
        pos += ws.length
        line = line[ws.length..]

      # Arguments / rest of line
      while line and line.length > 0
        if m = line.match /^"(?:[^"\\]|\\.)*"/
          s = m[0]
          out.push ['STRING', s, @loc(li, pos, li, pos + s.length)]
          pos += s.length
          line = line[s.length..]
          continue
        if m = line.match /^[0-9]+(?:\.[0-9]+)?/
          n = m[0]
          out.push ['NUMBER', n, @loc(li, pos, li, pos + n.length)]
          pos += n.length
          line = line[n.length..]
          continue
        if m = line.match /^,/
          out.push ['COMMA', ',', @loc(li, pos, li, pos + 1)]
          pos += 1
          line = line[1..]
          continue
        if m = line.match /^=/
          out.push ['EQ', '=', @loc(li, pos, li, pos + 1)]
          pos += 1
          line = line[1..]
          continue
        if m = line.match /^\^/
          out.push ['CARET', '^', @loc(li, pos, li, pos + 1)]
          pos += 1
          line = line[1..]
          continue
        if m = line.match /^@/
          out.push ['AT', '@', @loc(li, pos, li, pos + 1)]
          pos += 1
          line = line[1..]
          continue
        if m = line.match /^[A-Za-z%][A-Za-z0-9]*/
          name = m[0]
          out.push ['NAME', name, @loc(li, pos, li, pos + name.length)]
          pos += name.length
          line = line[name.length..]
          continue
        if m = line.match /^[ \t]+/
          pos += m[0].length
          line = line[m[0].length..]
          continue
        # Fallback: consume one char to avoid infinite loop
        out.push ['UNKNOWN', line[0], @loc(li, pos, li, pos + 1)]
        pos += 1
        line = line[1..]

      out.push ['NEWLINE', '\n', @loc(li, pos, li, pos)]

    out

  commandToken: (word) ->
    w = word.toLowerCase()
    return 'SET' if w is 'set' or w is 's'
    return 'WRITE' if w is 'write' or w is 'w'
    return 'READ' if w is 'read' or w is 'r'
    return 'DO' if w is 'do' or w is 'd'
    return 'KILL' if w is 'kill' or w is 'k'
    return 'NEW' if w is 'new' or w is 'n'
    null

  loc: (fl, fc, ll, lc) ->
    first_line: fl
    first_column: fc
    last_line: ll
    last_column: lc
    range: [0, 0]

module.exports = { BumpsLexer }
