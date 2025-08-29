# BUMPS runtime lexer (CoffeeScript)
# Jison-style interface: setInput(input, yy), lex(), showPosition()

class BumpsLexer
  constructor: ->
    @yy = {}
    @tokens = []
    @cursor = 0
    @_afterElse = false
    @_afterWrite = false
    @wItemStart = false
    @exprDepth = 0
    @patDepth = 0
    @inPostcond = false

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

  tokenize: (src) ->
    out = []
    lines = src.split /\r?\n/
    for originalLine, li in lines
      line = originalLine
      pos = 0
      afterCommand = false
      afterCmdSep = false
      @wItemStart = false

      # DOTS at start
      if mDots = line.match /^\.+/
        dots = mDots[0]
        out.push ['DOTS', dots, @loc(li, pos, li, pos + dots.length)]
        pos += dots.length
        line = line[dots.length..]
        if mwsDots = line.match /^[ \t]+/
          pos += mwsDots[0].length
          line = line[mwsDots[0].length..]

      # LABEL or COMMAND at start
      if m = line.match /^[A-Za-z%][A-Za-z0-9]*/
        word = m[0]
        cmd = @commandToken word
        if cmd
          out.push [cmd, word, @loc(li, pos, li, pos + word.length)]
          afterCommand = true
          @_afterElse = (cmd is 'ELSE')
          @_afterWrite = (cmd is 'WRITE')
        else
          out.push ['LABEL', word, @loc(li, pos, li, pos + word.length)]
        pos += word.length
        line = line[word.length..]

      # Spacing after command
      if (mws = line.match /^[ \t]+/) and afterCommand
        ws = mws[0]
        out.push ['CS', ws, @loc(li, pos, li, pos + ws.length)]
        pos += ws.length
        line = line[ws.length..]
        if @_afterElse
          # Enforce two or more spaces after ELSE for chaining (lint only):
          if ws.length < 2 and @yy?.lints?
            @yy.lints.push { kind:'ELSE_SPACE', line: li+1, column: pos-ws.length, message: 'ELSE should be followed by two or more spaces before next command' }
          afterCmdSep = true
          @_afterElse = false
        else if @_afterWrite
          @wItemStart = true
          @_afterWrite = false
        afterCommand = false

      # Arguments / rest of line
      while line and line.length > 0
        # comments
        if mm = line.match /^;[^\n]*/
          c = mm[0]
          out.push ['COMMENT', c, @loc(li, pos, li, pos + c.length)]
          pos += c.length
          line = ''
          continue

        # punctuation & spacing
        if mm = line.match /^\(/
          @exprDepth += 1
          out.push ['LPAREN', '(', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^\)/
          @exprDepth = Math.max(0, @exprDepth - 1)
          out.push ['RPAREN', ')', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^:/
          out.push ['COLON', ':', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^,/
          out.push ['COMMA', ',', @loc(li, pos, li, pos + 1)]
          pos += 1
          line = line[1..]
          # optional spaces after comma
          if msp = line.match /^[ \t]+/
            pos += msp[0].length
            line = line[msp[0].length..]
          @wItemStart = true
          afterCmdSep = false
          continue

        # strings
        if mm = line.match /^"(?:""|[^\"])*"/
          s = mm[0]
          out.push ['STRING', s, @loc(li, pos, li, pos + s.length)]
          pos += s.length; line = line[s.length..]; @wItemStart = false; continue

        # numbers (int/dec/leading-dot with optional exponent)
        if mm = line.match ///^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?///
          n = mm[0]
          out.push ['NUMBER', n, @loc(li, pos, li, pos + n.length)]
          pos += n.length; line = line[n.length..]; @wItemStart = false; continue

        # equality
        if mm = line.match /^=/
          out.push ['EQ', '=', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue

        # arithmetic & logical
        if mm = line.match /^\*\*/
          out.push ['EXP', '**', @loc(li, pos, li, pos + 2)]
          pos += 2; line = line[2..]; continue
        if mm = line.match /^\*/
          if @wItemStart and @exprDepth is 0 then out.push ['WSTAR', '*', @loc(li, pos, li, pos + 1)] else out.push ['MUL', '*', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^\\/
          out.push ['IDIV', '\\', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^#/
          if @wItemStart and @exprDepth is 0 then out.push ['WPOUND', '#', @loc(li, pos, li, pos + 1)] else out.push ['MOD', '#', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^\//
          if @wItemStart and @exprDepth is 0 then out.push ['WSLASH', '/', @loc(li, pos, li, pos + 1)] else out.push ['DIV', '/', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^&/
          out.push ['AND', '&', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^!/
          if @wItemStart and @exprDepth is 0 then out.push ['WBANG', '!', @loc(li, pos, li, pos + 1)] else out.push ['OR', '!', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^_/
          out.push ['CONCAT', '_', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^>=/
          out.push ['GE', '>=', @loc(li, pos, li, pos + 2)]
          pos += 2; line = line[2..]; continue
        if mm = line.match /^<=/
          out.push ['LE', '<=', @loc(li, pos, li, pos + 2)]
          pos += 2; line = line[2..]; continue
        if mm = line.match /^>/
          out.push ['GT', '>', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^</
          out.push ['LT', '<', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^'=/
          out.push ['NE', "'=", @loc(li, pos, li, pos + 2)]
          pos += 2; line = line[2..]; continue

        # caret and pattern/relations
        if mm = line.match /^\^/
          out.push ['CARET', '^', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^\|/
          out.push ['VBAR', '|', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^'\]\]/
          out.push ['NSORTAFTER', "']]", @loc(li, pos, li, pos + 3)]
          pos += 3; line = line[3..]; continue
        if mm = line.match /^'\]/
          out.push ['NFOLLOWS', "']", @loc(li, pos, li, pos + 2)]
          pos += 2; line = line[2..]; continue
        if mm = line.match /^'\[/
          out.push ['NCONTAINS', "'[", @loc(li, pos, li, pos + 2)]
          pos += 2; line = line[2..]; continue
        if mm = line.match /^\]\]/
          out.push ['SORTAFTER', ']]', @loc(li, pos, li, pos + 2)]
          pos += 2; line = line[2..]; continue
        if mm = line.match /^\]/
          out.push ['FOLLOWS', ']', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^\[/
          out.push ['CONTAINS', '[', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue
        if mm = line.match /^\?/
          if @wItemStart and @exprDepth is 0
            out.push ['WTAB', '?', @loc(li, pos, li, pos + 1)]
            pos += 1; line = line[1..]; @wItemStart = false; continue
          # pattern operator: produce PMATCH then PATTERN body until whitespace/comma/newline at depth 0
          rest = line[1..]
          i = 0; depth = 0
          while i < rest.length
            ch = rest[i]
            if ch is '(' then depth++; i++; continue
            if ch is ')'
              if depth is 0 then break
              depth--; i++; continue
            if depth is 0 and (ch is ' ' or ch is '\t' or ch is '\r' or ch is '\n' or ch is ';' or ch is ',') then break
            i++
          s = rest[0...i]
          out.push ['PMATCH', '?', @loc(li, pos, li, pos + 1)]
          if s.length > 0
            out.push ['PATTERN', s, @loc(li, pos + 1, li, pos + 1 + s.length)]
          pos += 1 + s.length; line = line[1 + s.length..]; continue

        if mm = line.match /^@/
          out.push ['AT', '@', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue

        # $-functions and $Z- functions / variables
        if mm = line.match /^\$(?:z|Z)[A-Za-z][A-Za-z0-9]*/
          t = mm[0]
          name = t.slice(2).toUpperCase()
          out.push ['ZDOLFN', name, @loc(li, pos, li, pos + t.length)]
          pos += t.length; line = line[t.length..]; continue
        if mm = line.match /^\$[A-Za-z][A-Za-z0-9]*/
          t = mm[0]
          nm = t.slice(1).toUpperCase()
          nextCh = line.charAt(t.length) or ''
          if nextCh is '('
            out.push ['DOLFN', nm, @loc(li, pos, li, pos + t.length)]
          else
            # writable subset gating
            opts = (@yy and @yy.options) or {}
            allow = false
            if nm in ['X','Y','ECODE','ETRAP'] then allow = true
            else if nm in ['IO','DEVICE'] then allow = !!opts.allowWritableDeviceVars
            else if nm is 'SYSTEM' then allow = !!opts.allowWritableSystemVar
            if allow then out.push ['DOLSPECVAR', nm, @loc(li, pos, li, pos + t.length)] else out.push ['DOLFN', nm, @loc(li, pos, li, pos + t.length)]
          pos += t.length; line = line[t.length..]; continue

        # NAMEs and potential chained commands
        if mm = line.match /^[A-Za-z%][A-Za-z0-9]*/
          name = mm[0]
          if afterCmdSep
            chained = @commandToken name
            if chained
              out.push [chained, name, @loc(li, pos, li, pos + name.length)]
              afterCommand = true
              @_afterElse = (chained is 'ELSE')
              @_afterWrite = (chained is 'WRITE')
              afterCmdSep = false
              pos += name.length; line = line[name.length..]; continue
          out.push ['NAME', name, @loc(li, pos, li, pos + name.length)]
          pos += name.length; line = line[name.length..]; @wItemStart = false; continue

        # PLUS/MINUS/NOT
        if mm = line.match /^\+/
          out.push ['PLUS', '+', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^-+/
          out.push ['MINUS', '-', @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; @wItemStart = false; continue
        if mm = line.match /^'/
          out.push ['NOT', "'", @loc(li, pos, li, pos + 1)]
          pos += 1; line = line[1..]; continue

        # spaces: determine command chaining opportunity
        if mm = line.match /^[ \t]+/
          ws = mm[0]
          after = line[ws.length..]
          if afterCommand
            out.push ['CS', ws, @loc(li, pos, li, pos + ws.length)]
            pos += ws.length; line = after; afterCmdSep = false; afterCommand = false; continue
          else if mWord = after.match /^[A-Za-z%][A-Za-z0-9]*/
            nextCmd = @commandToken mWord[0]
            nextChar = after.charAt(mWord[0].length) or ''
            if nextCmd and (nextChar in ['', ' ', '\t', '\r', '\n', ';'])
              out.push ['CS', ws, @loc(li, pos, li, pos + ws.length)]
              pos += ws.length; line = after; afterCmdSep = true; continue
          pos += ws.length; line = after; continue

        # Fallback: consume one char
        out.push ['UNKNOWN', line[0], @loc(li, pos, li, pos + 1)]
        pos += 1; line = line[1..]

      # newline end
      out.push ['NEWLINE', '\n', @loc(li, pos, li, pos)]
      @_afterElse = false
      @_afterWrite = false
      @wItemStart = false
      @exprDepth = 0
      @patDepth = 0
      @inPostcond = false

    out

  commandToken: (word) ->
    w = word.toLowerCase()
    return 'SET' if w in ['s','set']
    return 'WRITE' if w in ['w','write']
    return 'READ' if w in ['r','read']
    return 'DO' if w in ['d','do']
    return 'KILL' if w in ['k','kill']
    return 'NEW' if w in ['n','new']
    return 'GOTO' if w in ['g','goto']
    return 'IF' if w in ['i','if']
    return 'ELSE' if w in ['e','else']
    return 'LOCK' if w in ['l','lock']
    return 'MERGE' if w in ['m','merge']
    return 'BREAK' if w in ['b','break']
    return 'CLOSE' if w in ['c','close']
    return 'FOR' if w in ['f','for']
    return 'HALT' if w in ['h','halt']
    return 'HANG' if w is 'hang'
    return 'JOB' if w in ['j','job']
    return 'OPEN' if w in ['o','open']
    return 'QUIT' if w in ['q','quit']
    return 'USE' if w in ['u','use']
    return 'VIEW' if w in ['v','view']
    return 'XECUTE' if w in ['x','xecute']
    # Transaction commands with official multi-letter abbrevs
    return 'TSTART' if w in ['tstart','ts']
    return 'TCOMMIT' if w in ['tcommit','tc']
    return 'TROLLBACK' if w in ['trollback','tro']
    return 'TRESTART' if w in ['trestart','tre']
    return 'ZCOMMAND' if /^z[a-z][a-z0-9]*$/.test w
    null

  loc: (fl, fc, ll, lc) ->
    first_line: fl
    first_column: fc
    last_line: ll
    last_column: lc
    range: [0, 0]

module.exports = { BumpsLexer }
