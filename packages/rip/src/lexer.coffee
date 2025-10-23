# The CoffeeScript Lexer. Uses a series of token-matching regexes to attempt
# matches against the beginning of the source code. When a match is found,
# a token is produced, we consume the match, and start again. Tokens are in the
# form:
#
#     [tag, value, locationData]
#
# where locationData is {first_line, first_column, last_line, last_column, last_line_exclusive, last_column_exclusive}.
# These are read by the parser in the `parser.lexer` function defined in coffeescript.coffee.

# Import the helpers we need.
import {
  count, starts, compact, repeat, merge, extractAllCommentTokens,
  attachCommentsToNode, locationDataToString, throwSyntaxError,
  replaceUnicodeCodePointEscapes, flatten, parseNumber
} from './helpers'

# The Lexer Class
# ---------------

# The Lexer class reads a stream of CoffeeScript and divvies it up into tagged
# tokens. Some potential ambiguity in the grammar has been avoided by
# pushing some extra smarts into the Lexer.
export class Lexer

  # **tokenize** is the Lexer's main method. Scan by attempting to match tokens
  # one at a time, using a regular expression anchored at the start of the
  # remaining code, or a custom recursive token-matching method
  # (for interpolations). When the next token has been recorded, we move forward
  # within the code past the token, and begin again.
  #
  # Each tokenizing method is responsible for returning the number of characters
  # it has consumed.
  #
  # Before returning the token stream, run it through the [Rewriter](rewriter.html).
  tokenize: (code, opts = {}) ->
    @indent     = 0              # The current indentation level.
    @baseIndent = 0              # The overall minimum indentation level.
    @continuationLineAdditionalIndent = 0 # The over-indentation at the current level.
    @outdebt    = 0              # The under-outdentation at the current level.
    @indents    = []             # The stack of all current indentation levels.
    @indentLiteral = ''          # The indentation.
    @ends       = []             # The stack for pairing up tokens.
    @tokens     = []             # Stream of parsed tokens in the form `['TYPE', value, location data]`.
    @seenFor    = no             # Used to recognize `FORIN`, `FOROF` and `FORFROM` tokens.
    @seenImport = no             # Used to recognize `IMPORT FROM? AS?` tokens.
    @seenExport = no             # Used to recognize `EXPORT FROM? AS?` tokens.
    @importSpecifierList = no    # Used to identify when in an `IMPORT {...} FROM? ...`.
    @exportSpecifierList = no    # Used to identify when in an `EXPORT {...} FROM? ...`.

    @chunkLine =
      opts.line or 0             # The start line for the current @chunk.
    @chunkColumn =
      opts.column or 0           # The start column of the current @chunk.
    @chunkOffset =
      opts.offset or 0           # The start offset for the current @chunk.
    @locationDataCompensations =
      opts.locationDataCompensations or {} # The location data compensations for the current @chunk.
    code = @clean code           # The stripped, cleaned original source code.

    # At every position, run through this list of attempted matches,
    # short-circuiting if any of them succeed. Their order determines precedence:
    # `@literalToken` is the fallback catch-all.
    i = 0
    while @chunk = code[i..]
      consumed = \
           @identifierToken() or
           @commentToken()    or
           @whitespaceToken() or
           @lineToken()       or
           @stringToken()     or
           @numberToken()     or
           @regexToken()      or
           @jsToken()         or
           @literalToken()

      # Update position.
      [@chunkLine, @chunkColumn, @chunkOffset] = @getLineAndColumnFromChunk consumed

      i += consumed

      return {@tokens, index: i} if opts.untilBalanced and @ends.length is 0

    @closeIndentation()
    @error "missing #{end.tag}", (end.origin ? end)[2] if end = @ends.pop()
    return @tokens if opts.rewrite is off
    (new Rewriter).rewrite @tokens

  # Preprocess the code to remove leading and trailing whitespace, carriage
  # returns, etc.
  clean: (code) ->
    thusFar = 0
    if code.charCodeAt(0) is BOM
      code = code.slice 1
      @locationDataCompensations[0] = 1
      thusFar += 1
    if WHITESPACE.test code
      code = "\n#{code}"
      @chunkLine--
      @locationDataCompensations[0] ?= 0
      @locationDataCompensations[0] -= 1
    code
      .replace /\r/g, (match, offset) =>
        @locationDataCompensations[thusFar + offset] = 1
        ''
      .replace TRAILING_SPACES, ''

  # Tokenizers
  # ----------

  # Matches identifying literals: variables, keywords, method names, etc.
  # Check to ensure that JavaScript reserved words aren't being used as
  # identifiers. Because CoffeeScript reserves a handful of keywords that are
  # allowed in JavaScript, we're careful not to tag them as keywords when
  # referenced as property names here, so you can still do `jQuery.is()` even
  # though `is` means `===` otherwise.
  identifierToken: ->
    return 0 unless match = IDENTIFIER.exec @chunk
    [input, id, colon] = match

    # Preserve length of id for location data
    idLength = id.length
    poppedToken = undefined
    if id is 'own' and @tag() is 'FOR'
      @token 'OWN', id
      return id.length
    if id is 'from' and @tag() is 'YIELD'
      @token 'FROM', id
      return id.length
    if id is 'as' and @seenImport
      if @value() is '*'
        @tokens[@tokens.length - 1][0] = 'IMPORT_ALL'
      else if @value(yes) in COFFEE_KEYWORDS
        prev = @prev()
        [prev[0], prev[1]] = ['IDENTIFIER', @value(yes)]
      if @tag() in ['DEFAULT', 'IMPORT_ALL', 'IDENTIFIER']
        @token 'AS', id
        return id.length
    if id is 'as' and @seenExport
      if @tag() in ['IDENTIFIER', 'DEFAULT']
        @token 'AS', id
        return id.length
      if @value(yes) in COFFEE_KEYWORDS
        prev = @prev()
        [prev[0], prev[1]] = ['IDENTIFIER', @value(yes)]
        @token 'AS', id
        return id.length
    if id is 'default' and @seenExport and @tag() in ['EXPORT', 'AS']
      @token 'DEFAULT', id
      return id.length
    if id is 'assert' and (@seenImport or @seenExport) and @tag() is 'STRING'
      @token 'ASSERT', id
      return id.length
    if id is 'do' and regExSuper = /^(\s*super)(?!\(\))/.exec @chunk[3...]
      @token 'SUPER', 'super'
      @token 'CALL_START', '('
      @token 'CALL_END', ')'
      [input, sup] = regExSuper
      return sup.length + 3

    prev = @prev()

    tag =
      if colon or prev? and
         (prev[0] in ['.', '?.', '::', '?::'] or
         not prev.spaced and prev[0] is '@')
        'PROPERTY'
      else
        'IDENTIFIER'

    tokenData = {}
    if tag is 'IDENTIFIER' and (id in JS_KEYWORDS or id in COFFEE_KEYWORDS) and
       not (@exportSpecifierList and id in COFFEE_KEYWORDS)
      tag = id.toUpperCase()
      if tag is 'WHEN' and @tag() in LINE_BREAK
        tag = 'LEADING_WHEN'
      else if tag is 'FOR'
        @seenFor = {endsLength: @ends.length}
      else if tag is 'UNLESS'
        tag = 'IF'
      else if tag is 'IMPORT'
        @seenImport = yes
      else if tag is 'EXPORT'
        @seenExport = yes
      else if tag in UNARY
        tag = 'UNARY'
      else if tag in RELATION
        if tag isnt 'INSTANCEOF' and @seenFor
          tag = 'FOR' + tag
          @seenFor = no
        else
          tag = 'RELATION'
          if @value() is '!'
            poppedToken = @tokens.pop()
            tokenData.invert = poppedToken.data?.original ? poppedToken[1]
    else if tag is 'IDENTIFIER' and @seenFor and id is 'from' and
       isForFrom(prev)
      tag = 'FORFROM'
      @seenFor = no
    # Throw an error on attempts to use `get` or `set` as keywords, or
    # what CoffeeScript would normally interpret as calls to functions named
    # `get` or `set`, i.e. `get({foo: function () {}})`.
    else if tag is 'PROPERTY' and prev
      if prev.spaced and prev[0] in CALLABLE and /^[gs]et$/.test(prev[1]) and
         @tokens.length > 1 and @tokens[@tokens.length - 2][0] not in ['.', '?.', '@']
        @error "'#{prev[1]}' cannot be used as a keyword, or as a function call
        without parentheses", prev[2]
      else if prev[0] is '.' and @tokens.length > 1 and (prevprev = @tokens[@tokens.length - 2])[0] is 'UNARY' and prevprev[1] is 'new'
        prevprev[0] = 'NEW_TARGET'
      else if prev[0] is '.' and @tokens.length > 1 and (prevprev = @tokens[@tokens.length - 2])[0] is 'IMPORT' and prevprev[1] is 'import'
        @seenImport = no
        prevprev[0] = 'IMPORT_META'
      else if @tokens.length > 2
        prevprev = @tokens[@tokens.length - 2]
        if prev[0] in ['@', 'THIS'] and prevprev and prevprev.spaced and
           /^[gs]et$/.test(prevprev[1]) and
           @tokens[@tokens.length - 3][0] not in ['.', '?.', '@']
          @error "'#{prevprev[1]}' cannot be used as a keyword, or as a
          function call without parentheses", prevprev[2]

    if tag is 'IDENTIFIER' and id in RESERVED
      @error "reserved word '#{id}'", length: id.length

    unless tag is 'PROPERTY' or @exportSpecifierList or @importSpecifierList
      # Transform 'is not' → 'isnt' for cleaner syntax (before alias processing)
      # Only transform when 'not' is followed by a non-boolean value to avoid breaking chains
      if id is 'is' and @chunk[idLength...idLength+4] is ' not'
        # Look ahead to see what comes after ' not '
        afterNot = @chunk[idLength + 4...].trim()
        # Only transform if NOT followed by 'false', 'true' (which could be part of chains)
        unless afterNot.match(/^(false|true)\s+(is|isnt|==|!=)/)
          id = 'isnt'
          idLength += 4  # Consume ' not' as well

      if id in COFFEE_ALIASES
        alias = id
        id = COFFEE_ALIAS_MAP[id]
        tokenData.original = alias

      tag = switch id
        when '!'                 then 'UNARY'
        when '==', '!='          then 'COMPARE'
        when 'true', 'false'     then 'BOOL'
        when 'break', 'continue', \
             'debugger'          then 'STATEMENT'
        when '&&', '||'          then id
        else  tag

    tagToken = @token tag, id, length: idLength, data: tokenData
    tagToken.origin = [tag, alias, tagToken[2]] if alias
    if poppedToken
      [tagToken[2].first_line, tagToken[2].first_column, tagToken[2].range[0]] =
        [poppedToken[2].first_line, poppedToken[2].first_column, poppedToken[2].range[0]]
    if colon
      colonOffset = input.lastIndexOf ':'
      colonToken = @token ':', ':', offset: colonOffset

    # Return the actual consumed length (accounts for 'is not' → 'isnt' transformation)
    if colon then idLength + colon.length else idLength

  # Matches numbers, including decimals, hex, and exponential notation.
  # Be careful not to interfere with ranges in progress.
  numberToken: ->
    return 0 unless match = NUMBER.exec @chunk

    number = match[0]
    lexedLength = number.length

    switch
      when /^0[BOX]/.test number
        @error "radix prefix in '#{number}' must be lowercase", offset: 1
      when /^0\d*[89]/.test number
        @error "decimal literal '#{number}' must not be prefixed with '0'", length: lexedLength
      when /^0\d+/.test number
        @error "octal literal '#{number}' must be prefixed with '0o'", length: lexedLength

    parsedValue = parseNumber number
    tokenData = {parsedValue}

    tag = if parsedValue is Infinity then 'INFINITY' else 'NUMBER'
    if tag is 'INFINITY'
      tokenData.original = number
    @token tag, number,
      length: lexedLength
      data: tokenData
    lexedLength

  # Matches strings, including multiline strings, as well as heredocs, with or without
  # interpolation.
  stringToken: ->
    [quote] = STRING_START.exec(@chunk) || []
    return 0 unless quote

    # If the preceding token is `from` and this is an import or export statement,
    # properly tag the `from`.
    prev = @prev()
    if prev and @value() is 'from' and (@seenImport or @seenExport)
      prev[0] = 'FROM'

    regex = switch quote
      when "'"   then STRING_SINGLE
      when '"'   then STRING_DOUBLE
      when "'''" then HEREDOC_SINGLE
      when '"""' then HEREDOC_DOUBLE

    {tokens, index: end} = @matchWithInterpolations regex, quote

    heredoc = quote.length is 3
    if heredoc
      # Find the smallest indentation. It will be removed from all lines later.
      indent = null
      doc = (token[1] for token, i in tokens when token[0] is 'NEOSTRING').join '#{}'
      while match = HEREDOC_INDENT.exec doc
        attempt = match[1]
        indent = attempt if indent is null or 0 < attempt.length < indent.length

    delimiter = quote.charAt(0)
    @mergeInterpolationTokens tokens, {quote, indent, endOffset: end}, (value) =>
      @validateUnicodeCodePointEscapes value, delimiter: quote

    end

  # Matches and consumes comments. The comments are taken out of the token
  # stream and saved for later, to be reinserted into the output after
  # everything has been parsed and the JavaScript code generated.
  commentToken: (chunk = @chunk, {heregex, returnCommentTokens = no, offsetInChunk = 0} = {}) ->
    return 0 unless match = chunk.match COMMENT
    [commentWithSurroundingWhitespace, hereLeadingWhitespace, hereComment, hereTrailingWhitespace, lineComment] = match
    contents = null
    # Does this comment follow code on the same line?
    leadingNewline = /^\s*\n+\s*#/.test commentWithSurroundingWhitespace
    if hereComment
      matchIllegal = HERECOMMENT_ILLEGAL.exec hereComment
      if matchIllegal
        @error "block comments cannot contain #{matchIllegal[0]}",
          offset: '###'.length + matchIllegal.index, length: matchIllegal[0].length

      # Parse indentation or outdentation as if this block comment didn't exist.
      chunk = chunk.replace "####{hereComment}###", ''
      # Remove leading newlines, like `Rewriter::removeLeadingNewlines`, to
      # avoid the creation of unwanted `TERMINATOR` tokens.
      chunk = chunk.replace /^\n+/, ''
      @lineToken {chunk}

      # Pull out the ###-style comment's content, and format it.
      content = hereComment
      contents = [{
        content
        length: commentWithSurroundingWhitespace.length - hereLeadingWhitespace.length - hereTrailingWhitespace.length
        leadingWhitespace: hereLeadingWhitespace
      }]
    else
      # The `COMMENT` regex captures successive line comments as one token.
      # Remove any leading newlines before the first comment, but preserve
      # blank lines between line comments.
      leadingNewlines = ''
      content = lineComment.replace /^(\n*)/, (leading) ->
        leadingNewlines = leading
        ''
      precedingNonCommentLines = ''
      hasSeenFirstCommentLine = no
      contents =
        content.split '\n'
        .map (line, index) ->
          unless line.indexOf('#') > -1
            precedingNonCommentLines += "\n#{line}"
            return
          leadingWhitespace = ''
          content = line.replace /^([ |\t]*)#/, (_, whitespace) ->
            leadingWhitespace = whitespace
            ''
          comment = {
            content
            length: '#'.length + content.length
            leadingWhitespace: "#{unless hasSeenFirstCommentLine then leadingNewlines else ''}#{precedingNonCommentLines}#{leadingWhitespace}"
            precededByBlankLine: !!precedingNonCommentLines
          }
          hasSeenFirstCommentLine = yes
          precedingNonCommentLines = ''
          comment
        .filter (comment) -> comment

    getIndentSize = ({leadingWhitespace, nonInitial}) ->
      lastNewlineIndex = leadingWhitespace.lastIndexOf '\n'
      if hereComment? or not nonInitial
        return null unless lastNewlineIndex > -1
      else
        lastNewlineIndex ?= -1
      leadingWhitespace.length - 1 - lastNewlineIndex
    commentAttachments = for {content, length, leadingWhitespace, precededByBlankLine}, i in contents
      nonInitial = i isnt 0
      leadingNewlineOffset = if nonInitial then 1 else 0
      offsetInChunk += leadingNewlineOffset + leadingWhitespace.length
      indentSize = getIndentSize {leadingWhitespace, nonInitial}
      noIndent = not indentSize? or indentSize is -1
      commentAttachment = {
        content
        here: hereComment?
        newLine: leadingNewline or nonInitial # Line comments after the first one start new lines, by definition.
        locationData: @makeLocationData {offsetInChunk, length}
        precededByBlankLine
        indentSize
        indented:  not noIndent and indentSize > @indent
        outdented: not noIndent and indentSize < @indent
      }
      commentAttachment.heregex = yes if heregex
      offsetInChunk += length
      commentAttachment

    prev = @prev()
    unless prev
      # If there's no previous token, create a placeholder token to attach
      # this comment to; and follow with a newline.
      commentAttachments[0].newLine = yes
      @lineToken chunk: @chunk[commentWithSurroundingWhitespace.length..], offset: commentWithSurroundingWhitespace.length # Set the indent.
      placeholderToken = @makeToken 'JS', '', offset: commentWithSurroundingWhitespace.length, generated: yes
      placeholderToken.comments = commentAttachments
      @tokens.push placeholderToken
      @newlineToken commentWithSurroundingWhitespace.length
    else
      attachCommentsToNode commentAttachments, prev

    return commentAttachments if returnCommentTokens
    commentWithSurroundingWhitespace.length

  # Matches JavaScript interpolated directly into the source via backticks.
  jsToken: ->
    return 0 unless @chunk.charAt(0) is '`' and
      (match = (matchedHere = HERE_JSTOKEN.exec(@chunk)) or JSTOKEN.exec(@chunk))
    # Convert escaped backticks to backticks, and escaped backslashes
    # just before escaped backticks to backslashes
    script = match[1]
    {length} = match[0]
    @token 'JS', script, {length, data: {here: !!matchedHere}}
    length

  # Matches regular expression literals, as well as multiline extended ones.
  # Lexing regular expressions is difficult to distinguish from division, so we
  # borrow some basic heuristics from JavaScript and Ruby.
  regexToken: ->
    switch
      when match = REGEX_ILLEGAL.exec @chunk
        @error "regular expressions cannot begin with #{match[2]}",
          offset: match.index + match[1].length
      when match = @matchWithInterpolations HEREGEX, '///'
        {tokens, index} = match
        comments = []
        while matchedComment = HEREGEX_COMMENT.exec @chunk[0...index]
          {index: commentIndex} = matchedComment
          [fullMatch, leadingWhitespace, comment] = matchedComment
          comments.push {comment, offsetInChunk: commentIndex + leadingWhitespace.length}
        commentTokens = flatten(
          for commentOpts in comments
            @commentToken commentOpts.comment, Object.assign commentOpts, heregex: yes, returnCommentTokens: yes
        )
      when match = REGEX.exec @chunk
        [regex, body, closed] = match
        @validateEscapes body, isRegex: yes, offsetInChunk: 1
        index = regex.length
        prev = @prev()
        if prev
          if prev.spaced and prev[0] in CALLABLE
            return 0 if not closed or POSSIBLY_DIVISION.test regex
          else if prev[0] in NOT_REGEX
            return 0
        @error 'missing / (unclosed regex)' unless closed
      else
        return 0

    [flags] = REGEX_FLAGS.exec @chunk[index..]
    end = index + flags.length
    origin = @makeToken 'REGEX', null, length: end
    switch
      when not VALID_FLAGS.test flags
        @error "invalid regular expression flags #{flags}", offset: index, length: flags.length
      when regex or tokens.length is 1
        delimiter = if body then '/' else '///'
        body ?= tokens[0][1]
        @validateUnicodeCodePointEscapes body, {delimiter}
        @token 'REGEX', "/#{body}/#{flags}", {length: end, origin, data: {delimiter}}
      else
        @token 'REGEX_START', '(',    {length: 0, origin, generated: yes}
        @token 'IDENTIFIER', 'RegExp', length: 0, generated: yes
        @token 'CALL_START', '(',      length: 0, generated: yes
        @mergeInterpolationTokens tokens, {double: yes, heregex: {flags}, endOffset: end - flags.length, quote: '///'}, (str) =>
          @validateUnicodeCodePointEscapes str, {delimiter}
        if flags
          @token ',', ',',                    offset: index - 1, length: 0, generated: yes
          @token 'STRING', '"' + flags + '"', offset: index,     length: flags.length
        @token ')', ')',                      offset: end,       length: 0, generated: yes
        @token 'REGEX_END', ')',              offset: end,       length: 0, generated: yes

    # Explicitly attach any heregex comments to the REGEX/REGEX_END token.
    if commentTokens?.length
      addTokenData @tokens[@tokens.length - 1],
        heregexCommentTokens: commentTokens

    end

  # Matches newlines, indents, and outdents, and determines which is which.
  # If we can detect that the current line is continued onto the next line,
  # then the newline is suppressed:
  #
  #     elements
  #       .each( ... )
  #       .map( ... )
  #
  # Keeps track of the level of indentation, because a single outdent token
  # can close multiple indents, so we need to know how far in we happen to be.
  lineToken: ({chunk = @chunk, offset = 0} = {}) ->
    return 0 unless match = MULTI_DENT.exec chunk
    indent = match[0]

    prev = @prev()
    backslash = prev?[0] is '\\'
    @seenFor = no unless (backslash or @seenFor?.endsLength < @ends.length) and @seenFor
    @seenImport = no unless (backslash and @seenImport) or @importSpecifierList
    @seenExport = no unless (backslash and @seenExport) or @exportSpecifierList

    size = indent.length - 1 - indent.lastIndexOf '\n'
    noNewlines = @unfinished()

    newIndentLiteral = if size > 0 then indent[-size..] else ''
    unless /^(.?)\1*$/.exec newIndentLiteral
      @error 'mixed indentation', offset: indent.length
      return indent.length

    minLiteralLength = Math.min newIndentLiteral.length, @indentLiteral.length
    if newIndentLiteral[...minLiteralLength] isnt @indentLiteral[...minLiteralLength]
      @error 'indentation mismatch', offset: indent.length
      return indent.length

    if size - @continuationLineAdditionalIndent is @indent
      if noNewlines then @suppressNewlines() else @newlineToken offset
      return indent.length

    if size > @indent
      if noNewlines
        @continuationLineAdditionalIndent = size - @indent unless backslash
        if @continuationLineAdditionalIndent
          prev.continuationLineIndent = @indent + @continuationLineAdditionalIndent
        @suppressNewlines()
        return indent.length
      unless @tokens.length
        @baseIndent = @indent = size
        @indentLiteral = newIndentLiteral
        return indent.length
      diff = size - @indent + @outdebt
      @token 'INDENT', diff, offset: offset + indent.length - size, length: size
      @indents.push diff
      @ends.push {tag: 'OUTDENT'}
      @outdebt = @continuationLineAdditionalIndent = 0
      @indent = size
      @indentLiteral = newIndentLiteral
    else if size < @baseIndent
      @error 'missing indentation', offset: offset + indent.length
    else
      endsContinuationLineIndentation = @continuationLineAdditionalIndent > 0
      @continuationLineAdditionalIndent = 0
      @outdentToken {moveOut: @indent - size, noNewlines, outdentLength: indent.length, offset, indentSize: size, endsContinuationLineIndentation}
    indent.length

  # Record an outdent token or multiple tokens, if we happen to be moving back
  # inwards past several recorded indents. Sets new @indent value.
  outdentToken: ({moveOut, noNewlines, outdentLength = 0, offset = 0, indentSize, endsContinuationLineIndentation}) ->
    decreasedIndent = @indent - moveOut
    while moveOut > 0
      lastIndent = @indents[@indents.length - 1]
      if not lastIndent
        @outdebt = moveOut = 0
      else if @outdebt and moveOut <= @outdebt
        @outdebt -= moveOut
        moveOut   = 0
      else
        dent = @indents.pop() + @outdebt
        if outdentLength and @chunk[outdentLength] in INDENTABLE_CLOSERS
          decreasedIndent -= dent - moveOut
          moveOut = dent
        @outdebt = 0
        # pair might call outdentToken, so preserve decreasedIndent
        @pair 'OUTDENT'
        @token 'OUTDENT', moveOut, length: outdentLength, indentSize: indentSize + moveOut - dent
        moveOut -= dent
    @outdebt -= moveOut if dent
    @suppressSemicolons()

    unless @tag() is 'TERMINATOR' or noNewlines
      terminatorToken = @token 'TERMINATOR', '\n', offset: offset + outdentLength, length: 0
      terminatorToken.endsContinuationLineIndentation = {preContinuationLineIndent: @indent} if endsContinuationLineIndentation
    @indent = decreasedIndent
    @indentLiteral = @indentLiteral[...decreasedIndent]
    this

  # Matches and consumes non-meaningful whitespace. Tag the previous token
  # as being "spaced", because there are some cases where it makes a difference.
  whitespaceToken: ->
    return 0 unless (match = WHITESPACE.exec @chunk) or
                    (nline = @chunk.charAt(0) is '\n')
    prev = @prev()
    prev[if match then 'spaced' else 'newLine'] = true if prev
    if match then match[0].length else 0

  # Generate a newline token. Consecutive newlines get merged together.
  newlineToken: (offset) ->
    @suppressSemicolons()
    @token 'TERMINATOR', '\n', {offset, length: 0} unless @tag() is 'TERMINATOR'
    this

  # Use a `\` at a line-ending to suppress the newline.
  # The slash is removed here once its job is done.
  suppressNewlines: ->
    prev = @prev()
    if prev[1] is '\\'
      if prev.comments and @tokens.length > 1
        # `@tokens.length` should be at least 2 (some code, then `\`).
        # If something puts a `\` after nothing, they deserve to lose any
        # comments that trail it.
        attachCommentsToNode prev.comments, @tokens[@tokens.length - 2]
      @tokens.pop()
    this

  # We treat all other single characters as a token. E.g.: `( ) , . !`
  # Multi-character operators are also literal tokens, so that the parser can assign
  # the proper order of operations. There are some symbols that we tag specially
  # here. `;` and newlines are both treated as a `TERMINATOR`, we distinguish
  # parentheses that indicate a method call from regular parentheses, and so on.
  literalToken: ->
    if match = OPERATOR.exec @chunk
      [value] = match
      @tagParameters() if CODE.test value
    else
      value = @chunk.charAt 0
    tag  = value
    prev = @prev()

    if prev and value in ['=', COMPOUND_ASSIGN...]
      skipToken = false
      if value is '=' and prev[1] in ['||', '&&'] and not prev.spaced
        prev[0] = 'COMPOUND_ASSIGN'
        prev[1] += '='
        prev.data.original += '=' if prev.data?.original
        prev[2].range = [
          prev[2].range[0]
          prev[2].range[1] + 1
        ]
        prev[2].last_column += 1
        prev[2].last_column_exclusive += 1
        prev = @tokens[@tokens.length - 2]
        skipToken = true
      if prev and prev[0] isnt 'PROPERTY'
        origin = prev.origin ? prev
        message = isUnassignable prev[1], origin[1]
        @error message, origin[2] if message
      return value.length if skipToken

    if value is '(' and prev?[0] is 'IMPORT'
      prev[0] = 'DYNAMIC_IMPORT'

    if value is '{' and @seenImport
      @importSpecifierList = yes
    else if @importSpecifierList and value is '}'
      @importSpecifierList = no
    else if value is '{' and prev?[0] is 'EXPORT'
      @exportSpecifierList = yes
    else if @exportSpecifierList and value is '}'
      @exportSpecifierList = no

    if value is ';'
      @error 'unexpected ;' if prev?[0] in ['=', UNFINISHED...]
      @seenFor = @seenImport = @seenExport = no
      tag = 'TERMINATOR'
    else if value is '*' and prev?[0] is 'EXPORT'
      tag = 'EXPORT_ALL'
    else if value in MATH            then tag = 'MATH'
    else if value in COMPARE         then tag = 'COMPARE'
    else if value in COMPOUND_ASSIGN then tag = 'COMPOUND_ASSIGN'
    else if value in UNARY           then tag = 'UNARY'
    else if value in UNARY_MATH      then tag = 'UNARY_MATH'
    else if value in SHIFT           then tag = 'SHIFT'
    else if value is '?' and prev?.spaced then tag = 'BIN?'
    else if prev
      if value is '(' and not prev.spaced and prev[0] in CALLABLE
        prev[0] = 'FUNC_EXIST' if prev[0] is '?'
        tag = 'CALL_START'
      else if value is '[' and ((prev[0] in INDEXABLE and not prev.spaced) or
         (prev[0] is '::')) # `.prototype` can't be a method you can call.
        tag = 'INDEX_START'
        switch prev[0]
          when '?'  then prev[0] = 'INDEX_SOAK'
    token = @makeToken tag, value
    switch value
      when '(', '{', '[' then @ends.push {tag: INVERSES[value], origin: token}
      when ')', '}', ']' then @pair value
    @tokens.push @makeToken tag, value
    value.length

  # Token Manipulators
  # ------------------

  # A source of ambiguity in our grammar used to be parameter lists in function
  # definitions versus argument lists in function calls. Walk backwards, tagging
  # parameters specially in order to make things easier for the parser.
  tagParameters: ->
    return @tagDoIife() if @tag() isnt ')'
    stack = []
    {tokens} = this
    i = tokens.length
    paramEndToken = tokens[--i]
    paramEndToken[0] = 'PARAM_END'
    while tok = tokens[--i]
      switch tok[0]
        when ')'
          stack.push tok
        when '(', 'CALL_START'
          if stack.length then stack.pop()
          else if tok[0] is '('
            tok[0] = 'PARAM_START'
            return @tagDoIife i - 1
          else
            paramEndToken[0] = 'CALL_END'
            return this
    this

  # Tag `do` followed by a function differently than `do` followed by eg an
  # identifier to allow for different grammar precedence
  tagDoIife: (tokenIndex) ->
    tok = @tokens[tokenIndex ? @tokens.length - 1]
    return this unless tok?[0] is 'DO'
    tok[0] = 'DO_IIFE'
    this

  # Close up all remaining open blocks at the end of the file.
  closeIndentation: ->
    @outdentToken moveOut: @indent, indentSize: 0

  # Match the contents of a delimited token and expand variables and expressions
  # inside it using Ruby-like notation for substitution of arbitrary
  # expressions.
  #
  #     "Hello #{name.capitalize()}."
  #
  # If it encounters an interpolation, this method will recursively create a new
  # Lexer and tokenize until the `{` of `#{` is balanced with a `}`.
  #
  #  - `regex` matches the contents of a token (but not `delimiter`, and not
  #    `#{` if interpolations are desired).
  #  - `delimiter` is the delimiter of the token. Examples are `'`, `"`, `'''`,
  #    `"""` and `///`.
  #  - `closingDelimiter` can be customized
  #  - `interpolators` matches the start of an interpolation
  #
  # This method allows us to have strings within interpolations within strings,
  # ad infinitum.
  matchWithInterpolations: (regex, delimiter, closingDelimiter = delimiter, interpolators = /^#\{/) ->
    tokens = []
    offsetInChunk = delimiter.length
    return null unless @chunk[...offsetInChunk] is delimiter
    str = @chunk[offsetInChunk..]
    loop
      [strPart] = regex.exec str

      @validateEscapes strPart, {isRegex: delimiter.charAt(0) is '/', offsetInChunk}

      # Push a fake `'NEOSTRING'` token, which will get turned into a real string later.
      tokens.push @makeToken 'NEOSTRING', strPart, offset: offsetInChunk

      str = str[strPart.length..]
      offsetInChunk += strPart.length

      break unless match = interpolators.exec str
      [interpolator] = match

      # To remove the `#` in `#{`.
      interpolationOffset = interpolator.length - 1
      [line, column, offset] = @getLineAndColumnFromChunk offsetInChunk + interpolationOffset
      rest = str[interpolationOffset..]
      {tokens: nested, index} =
        new Lexer().tokenize rest, {line, column, offset, untilBalanced: on, @locationDataCompensations}
      # Account for the `#` in `#{`.
      index += interpolationOffset

      braceInterpolator = str[index - 1] is '}'
      if braceInterpolator
        # Turn the leading and trailing `{` and `}` into parentheses. Unnecessary
        # parentheses will be removed later.
        [open, ..., close] = nested
        open[0]  = 'INTERPOLATION_START'
        open[1]  = '('
        open[2].first_column -= interpolationOffset
        open[2].range = [
          open[2].range[0] - interpolationOffset
          open[2].range[1]
        ]
        close[0]  = 'INTERPOLATION_END'
        close[1] = ')'
        close.origin = ['', 'end of interpolation', close[2]]

      # Remove leading `'TERMINATOR'` (if any).
      nested.splice 1, 1 if nested[1]?[0] is 'TERMINATOR'
      # Remove trailing `'INDENT'/'OUTDENT'` pair (if any).
      nested.splice -3, 2 if nested[nested.length - 3]?[0] is 'INDENT' and nested[nested.length - 2][0] is 'OUTDENT'

      unless braceInterpolator
        # We are not using `{` and `}`, so wrap the interpolated tokens instead.
        open = @makeToken 'INTERPOLATION_START', '(', offset: offsetInChunk,         length: 0, generated: yes
        close = @makeToken 'INTERPOLATION_END', ')',  offset: offsetInChunk + index, length: 0, generated: yes
        nested = [open, nested..., close]

      # Push a fake `'TOKENS'` token, which will get turned into real tokens later.
      tokens.push ['TOKENS', nested]

      str = str[index..]
      offsetInChunk += index

    unless str[...closingDelimiter.length] is closingDelimiter
      @error "missing #{closingDelimiter}", length: delimiter.length

    {tokens, index: offsetInChunk + closingDelimiter.length}

  # Merge the array `tokens` of the fake token types `'TOKENS'` and `'NEOSTRING'`
  # (as returned by `matchWithInterpolations`) into the token stream. The value
  # of `'NEOSTRING'`s are converted using `fn` and turned into strings using
  # `options` first.
  mergeInterpolationTokens: (tokens, options, fn) ->
    {quote, indent, double, heregex, endOffset} = options

    if tokens.length > 1
      lparen = @token 'STRING_START', '(', length: quote?.length ? 0, data: {quote}, generated: not quote?.length

    firstIndex = @tokens.length
    $ = tokens.length - 1
    for token, i in tokens
      [tag, value] = token
      switch tag
        when 'TOKENS'
          # There are comments (and nothing else) in this interpolation.
          if value.length is 2 and (value[0].comments or value[1].comments)
            placeholderToken = @makeToken 'JS', '', generated: yes
            # Use the same location data as the first parenthesis.
            placeholderToken[2] = value[0][2]
            for val in value when val.comments
              placeholderToken.comments ?= []
              placeholderToken.comments.push val.comments...
            value.splice 1, 0, placeholderToken
          # Push all the tokens in the fake `'TOKENS'` token. These already have
          # sane location data.
          locationToken = value[0]
          tokensToPush = value
        when 'NEOSTRING'
          # Convert `'NEOSTRING'` into `'STRING'`.
          converted = fn.call this, token[1], i
          addTokenData token, initialChunk: yes if i is 0
          addTokenData token, finalChunk: yes   if i is $
          addTokenData token, {indent, quote, double}
          addTokenData token, {heregex} if heregex
          token[0] = 'STRING'
          token[1] = '"' + converted + '"'
          if tokens.length is 1 and quote?
            token[2].first_column -= quote.length
            if token[1].substr(-2, 1) is '\n'
              token[2].last_line += 1
              token[2].last_column = quote.length - 1
            else
              token[2].last_column += quote.length
              token[2].last_column -= 1 if token[1].length is 2
            token[2].last_column_exclusive += quote.length
            token[2].range = [
              token[2].range[0] - quote.length
              token[2].range[1] + quote.length
            ]
          locationToken = token
          tokensToPush = [token]
      @tokens.push tokensToPush...

    if lparen
      [..., lastToken] = tokens
      lparen.origin = ['STRING', null,
        first_line:            lparen[2].first_line
        first_column:          lparen[2].first_column
        last_line:             lastToken[2].last_line
        last_column:           lastToken[2].last_column
        last_line_exclusive:   lastToken[2].last_line_exclusive
        last_column_exclusive: lastToken[2].last_column_exclusive
        range: [
          lparen[2].range[0]
          lastToken[2].range[1]
        ]
      ]
      lparen[2] = lparen.origin[2] unless quote?.length
      rparen = @token 'STRING_END', ')', offset: endOffset - (quote ? '').length, length: quote?.length ? 0, generated: not quote?.length

  # Pairs up a closing token, ensuring that all listed pairs of tokens are
  # correctly balanced throughout the course of the token stream.
  pair: (tag) ->
    [..., prev] = @ends
    unless tag is wanted = prev?.tag
      @error "unmatched #{tag}" unless 'OUTDENT' is wanted
      # Auto-close `INDENT` to support syntax like this:
      #
      #     el.click((event) ->
      #       el.hide())
      #
      [..., lastIndent] = @indents
      @outdentToken moveOut: lastIndent, noNewlines: true
      return @pair tag
    @ends.pop()

  # Helpers
  # -------

  # Compensate for the things we strip out initially (e.g. carriage returns)
  # so that location data stays accurate with respect to the original source file.
  getLocationDataCompensation: (start, end) ->
    totalCompensation = 0
    initialEnd = end
    current = start
    while current <= end
      break if current is end and start isnt initialEnd
      compensation = @locationDataCompensations[current]
      if compensation?
        totalCompensation += compensation
        end += compensation
      current++
    return totalCompensation

  # Returns the line and column number from an offset into the current chunk.
  #
  # `offset` is a number of characters into `@chunk`.
  getLineAndColumnFromChunk: (offset) ->
    compensation = @getLocationDataCompensation @chunkOffset, @chunkOffset + offset

    if offset is 0
      return [@chunkLine, @chunkColumn + compensation, @chunkOffset + compensation]

    if offset >= @chunk.length
      string = @chunk
    else
      string = @chunk[..offset-1]

    lineCount = count string, '\n'

    column = @chunkColumn
    if lineCount > 0
      [..., lastLine] = string.split '\n'
      column = lastLine.length
      previousLinesCompensation = @getLocationDataCompensation @chunkOffset, @chunkOffset + offset - column
      # Don't recompensate for initially inserted newline.
      previousLinesCompensation = 0 if previousLinesCompensation < 0
      columnCompensation = @getLocationDataCompensation(
        @chunkOffset + offset + previousLinesCompensation - column
        @chunkOffset + offset + previousLinesCompensation
      )
    else
      column += string.length
      columnCompensation = compensation

    [@chunkLine + lineCount, column + columnCompensation, @chunkOffset + offset + compensation]

  makeLocationData: ({ offsetInChunk, length }) ->
    locationData = range: []
    [locationData.first_line, locationData.first_column, locationData.range[0]] =
      @getLineAndColumnFromChunk offsetInChunk

    # Use length - 1 for the final offset - we're supplying the last_line and the last_column,
    # so if last_column == first_column, then we're looking at a character of length 1.
    lastCharacter = if length > 0 then (length - 1) else 0
    [locationData.last_line, locationData.last_column, endOffset] =
      @getLineAndColumnFromChunk offsetInChunk + lastCharacter
    [locationData.last_line_exclusive, locationData.last_column_exclusive] =
      @getLineAndColumnFromChunk offsetInChunk + lastCharacter + (if length > 0 then 1 else 0)
    locationData.range[1] = if length > 0 then endOffset + 1 else endOffset

    locationData

  # Same as `token`, except this just returns the token without adding it
  # to the results.
  makeToken: (tag, value, {offset: offsetInChunk = 0, length = value.length, origin, generated, indentSize} = {}) ->
    token = [tag, value, @makeLocationData {offsetInChunk, length}]
    token.origin = origin if origin
    token.generated = yes if generated
    token.indentSize = indentSize if indentSize?
    token

  # Add a token to the results.
  # `offset` is the offset into the current `@chunk` where the token starts.
  # `length` is the length of the token in the `@chunk`, after the offset.  If
  # not specified, the length of `value` will be used.
  #
  # Returns the new token.
  token: (tag, value, {offset, length, origin, data, generated, indentSize} = {}) ->
    token = @makeToken tag, value, {offset, length, origin, generated, indentSize}
    addTokenData token, data if data
    @tokens.push token
    token

  # Peek at the last tag in the token stream.
  tag: ->
    [..., token] = @tokens
    token?[0]

  # Peek at the last value in the token stream.
  value: (useOrigin = no) ->
    [..., token] = @tokens
    if useOrigin and token?.origin?
      token.origin[1]
    else
      token?[1]

  # Get the previous token in the token stream.
  prev: ->
    @tokens[@tokens.length - 1]

  # Are we in the midst of an unfinished expression?
  unfinished: ->
    LINE_CONTINUER.test(@chunk) or
    @tag() in UNFINISHED

  validateUnicodeCodePointEscapes: (str, options) ->
    replaceUnicodeCodePointEscapes str, merge options, {@error}

  # Validates escapes in strings and regexes.
  validateEscapes: (str, options = {}) ->
    invalidEscapeRegex =
      if options.isRegex
        REGEX_INVALID_ESCAPE
      else
        STRING_INVALID_ESCAPE
    match = invalidEscapeRegex.exec str
    return unless match
    [[], before, octal, hex, unicodeCodePoint, unicode] = match
    message =
      if octal
        "octal escape sequences are not allowed"
      else
        "invalid escape sequence"
    invalidEscape = "\\#{octal or hex or unicodeCodePoint or unicode}"
    @error "#{message} #{invalidEscape}",
      offset: (options.offsetInChunk ? 0) + match.index + before.length
      length: invalidEscape.length

  suppressSemicolons: ->
    while @value() is ';'
      @tokens.pop()
      @error 'unexpected ;' if @prev()?[0] in ['=', UNFINISHED...]

  # Throws an error at either a given offset from the current chunk or at the
  # location of a token (`token[2]`).
  error: (message, options = {}) =>
    location =
      if 'first_line' of options
        options
      else
        [first_line, first_column] = @getLineAndColumnFromChunk options.offset ? 0
        {first_line, first_column, last_column: first_column + (options.length ? 1) - 1}
    throwSyntaxError message, location

# Helper functions
# ----------------

export isUnassignable = (name, displayName = name) -> switch
  when name in [JS_KEYWORDS..., COFFEE_KEYWORDS...]
    "keyword '#{displayName}' can't be assigned"
  when name in STRICT_PROSCRIBED
    "'#{displayName}' can't be assigned"
  when name in RESERVED
    "reserved word '#{displayName}' can't be assigned"
  else
    false

# `from` isn't a CoffeeScript keyword, but it behaves like one in `import` and
# `export` statements (handled above) and in the declaration line of a `for`
# loop. Try to detect when `from` is a variable identifier and when it is this
# "sometimes" keyword.
isForFrom = (prev) ->
  # `for i from iterable`
  if prev[0] is 'IDENTIFIER'
    yes
  # `for from…`
  else if prev[0] is 'FOR'
    no
  # `for {from}…`, `for [from]…`, `for {a, from}…`, `for {a: from}…`
  else if prev[1] in ['{', '[', ',', ':']
    no
  else
    yes

addTokenData = (token, data) ->
  Object.assign (token.data ?= {}), data

# Constants
# ---------

# Keywords that CoffeeScript shares in common with JavaScript.
JS_KEYWORDS = [
  'true', 'false', 'null', 'this'
  'new', 'delete', 'typeof', 'in', 'instanceof'
  'return', 'throw', 'break', 'continue', 'debugger', 'yield', 'await'
  'if', 'else', 'switch', 'for', 'while', 'do', 'try', 'catch', 'finally'
  'class', 'extends', 'super'
  'import', 'export', 'default'
]

# CoffeeScript-only keywords.
COFFEE_KEYWORDS = [
  'undefined', 'Infinity', 'NaN'
  'then', 'unless', 'until', 'loop', 'of', 'by', 'when'
]

COFFEE_ALIAS_MAP =
  and  : '&&'
  or   : '||'
  is   : '=='
  isnt : '!='
  not  : '!'
  yes  : 'true'
  no   : 'false'
  on   : 'true'
  off  : 'false'

COFFEE_ALIASES  = (key for key of COFFEE_ALIAS_MAP)
COFFEE_KEYWORDS = COFFEE_KEYWORDS.concat COFFEE_ALIASES

# The list of keywords that are reserved by JavaScript, but not used, or are
# used by CoffeeScript internally. We throw an error when these are encountered,
# to avoid having a JavaScript error at runtime.
RESERVED = [
  'case', 'function', 'var', 'void', 'with', 'const', 'let', 'enum'
  'native', 'implements', 'interface', 'package', 'private'
  'protected', 'public', 'static'
]

STRICT_PROSCRIBED = ['arguments', 'eval']

# The superset of both JavaScript keywords and reserved words, none of which may
# be used as identifiers or properties.
export JS_FORBIDDEN = JS_KEYWORDS.concat(RESERVED).concat(STRICT_PROSCRIBED)

# The character code of the nasty Microsoft madness otherwise known as the BOM.
BOM = 65279

# Token matching regexes.
IDENTIFIER = /// ^
  (?!\d)
  ( (?: (?!\s)[$\w\x7f-\uffff] )+ !? )  # rip: allow optional trailing ! for async calls
  ( [^\n\S]* : (?!:) )?  # Is this a property name?
///

NUMBER     = ///
  ^ 0b[01](?:_?[01])*n?                         | # binary
  ^ 0o[0-7](?:_?[0-7])*n?                       | # octal
  ^ 0x[\da-f](?:_?[\da-f])*n?                   | # hex
  ^ \d+(?:_\d+)*n                               | # decimal bigint
  ^ (?:\d+(?:_\d+)*)?      \.? \d+(?:_\d+)*       # decimal
                     (?:e[+-]? \d+(?:_\d+)* )?
  # decimal without support for numeric literal separators for reference:
  # \d*\.?\d+ (?:e[+-]?\d+)?
///i

OPERATOR   = /// ^ (
  ?: [-=]>             # function
   | =~                # regex match operator
   | [-+*/%<>&|^!?=]=  # compound assign / compare
   | >>>=?             # zero-fill right shift
   | ([-+:])\1         # doubles
   | ([&|<>*/%])\2=?   # logic / shift / power / floor division / modulo
   | \?(\.|::)         # soak access
   | \.{2,3}           # range or splat
) ///

WHITESPACE = /^[^\n\S]+/

COMMENT    = /^(\s*)###([^#][\s\S]*?)(?:###([^\n\S]*)|###$)|^((?:\s*#(?!##[^#]).*)+)/

CODE       = /^[-=]>/

MULTI_DENT = /^(?:\n[^\n\S]*)+/

JSTOKEN      = ///^ `(?!``) ((?: [^`\\] | \\[\s\S]           )*) `   ///
HERE_JSTOKEN = ///^ ```     ((?: [^`\\] | \\[\s\S] | `(?!``) )*) ``` ///

# String-matching-regexes.
STRING_START   = /^(?:'''|"""|'|")/

STRING_SINGLE  = /// ^(?: [^\\']  | \\[\s\S]                      )* ///
STRING_DOUBLE  = /// ^(?: [^\\"#] | \\[\s\S] |           \#(?!\{) )* ///
HEREDOC_SINGLE = /// ^(?: [^\\']  | \\[\s\S] | '(?!'')            )* ///
HEREDOC_DOUBLE = /// ^(?: [^\\"#] | \\[\s\S] | "(?!"") | \#(?!\{) )* ///

HEREDOC_INDENT     = /\n+([^\n\S]*)(?=\S)/g

# Regex-matching-regexes.
REGEX = /// ^
  / (?!/) ((
  ?: [^ [ / \n \\ ]  # Every other thing.
   | \\[^\n]         # Anything but newlines escaped.
   | \[              # Character class.
       (?: \\[^\n] | [^ \] \n \\ ] )*
     \]
  )*) (/)?
///

REGEX_FLAGS  = /^\w*/
VALID_FLAGS  = /^(?!.*(.).*\1)[gimsuy]*$/

HEREGEX      = /// ^
  (?:
      # Match any character, except those that need special handling below.
      [^\\/#\s]
      # Match `\` followed by any character.
    | \\[\s\S]
      # Match any `/` except `///`.
    | /(?!//)
      # Match `#` which is not part of interpolation, e.g. `#{}`.
    | \#(?!\{)
      # Comments consume everything until the end of the line, including `///`.
    | \s+(?:#(?!\{).*)?
  )*
///

HEREGEX_COMMENT = /(\s+)(#(?!{).*)/gm

REGEX_ILLEGAL = /// ^ ( / | /{3}\s*) (\*) ///

POSSIBLY_DIVISION   = /// ^ /=?\s ///

# Other regexes.
HERECOMMENT_ILLEGAL = /\*\//

LINE_CONTINUER      = /// ^ \s* (?: , | \??\.(?![.\d]) | \??:: ) ///

STRING_INVALID_ESCAPE = ///
  ( (?:^|[^\\]) (?:\\\\)* )        # Make sure the escape isn't escaped.
  \\ (
     ?: (0\d|[1-7])                # octal escape
      | (x(?![\da-fA-F]{2}).{0,2}) # hex escape
      | (u\{(?![\da-fA-F]{1,}\})[^}]*\}?) # unicode code point escape
      | (u(?!\{|[\da-fA-F]{4}).{0,4}) # unicode escape
  )
///
REGEX_INVALID_ESCAPE = ///
  ( (?:^|[^\\]) (?:\\\\)* )        # Make sure the escape isn't escaped.
  \\ (
     ?: (0\d)                      # octal escape
      | (x(?![\da-fA-F]{2}).{0,2}) # hex escape
      | (u\{(?![\da-fA-F]{1,}\})[^}]*\}?) # unicode code point escape
      | (u(?!\{|[\da-fA-F]{4}).{0,4}) # unicode escape
  )
///

TRAILING_SPACES     = /\s+$/

# Compound assignment tokens.
COMPOUND_ASSIGN = [
  '-=', '+=', '/=', '*=', '%=', '||=', '&&=', '?=', '<<=', '>>=', '>>>='
  '&=', '^=', '|=', '**=', '//=', '%%='
]

# Unary tokens.
UNARY = ['NEW', 'TYPEOF', 'DELETE']

UNARY_MATH = ['!', '~']

# Bit-shifting tokens.
SHIFT = ['<<', '>>', '>>>']

# Comparison tokens.
COMPARE = ['==', '!=', '<', '>', '<=', '>=', '=~']

# Mathematical tokens.
MATH = ['*', '/', '%', '//', '%%']

# Relational tokens that are negatable with `not` prefix.
RELATION = ['IN', 'OF', 'INSTANCEOF']

# Boolean tokens.
BOOL = ['TRUE', 'FALSE']

# Tokens which could legitimately be invoked or indexed. An opening
# parentheses or bracket following these tokens will be recorded as the start
# of a function invocation or indexing operation.
CALLABLE  = ['IDENTIFIER', 'PROPERTY', ')', ']', '?', '@', 'THIS', 'SUPER', 'DYNAMIC_IMPORT']
INDEXABLE = CALLABLE.concat [
  'NUMBER', 'INFINITY', 'NAN', 'STRING', 'STRING_END', 'REGEX', 'REGEX_END'
  'BOOL', 'NULL', 'UNDEFINED', '}', '::'
]

# Tokens which can be the left-hand side of a less-than comparison, i.e. `a<b`.
COMPARABLE_LEFT_SIDE = ['IDENTIFIER', ')', ']', 'NUMBER']

# Tokens which a regular expression will never immediately follow (except spaced
# CALLABLEs in some cases), but which a division operator can.
#
# See: http://www-archive.mozilla.org/js/language/js20-2002-04/rationale/syntax.html#regular-expressions
NOT_REGEX = INDEXABLE.concat ['++', '--']

# Tokens that, when immediately preceding a `WHEN`, indicate that the `WHEN`
# occurs at the start of a line. We disambiguate these from trailing whens to
# avoid an ambiguity in the grammar.
LINE_BREAK = ['INDENT', 'OUTDENT', 'TERMINATOR']

# Additional indent in front of these is ignored.
INDENTABLE_CLOSERS = [')', '}', ']']

# ==============================================================================
# Rewriter
# ==============================================================================

# The CoffeeScript language has a good deal of optional syntax, implicit syntax,
# and shorthand syntax. This can greatly complicate a grammar and bloat
# the resulting parse table. Instead of making the parser handle it all, we take
# a series of passes over the token stream, using this **Rewriter** to convert
# shorthand into the unambiguous long form, add implicit indentation and
# parentheses, and generally clean things up.

# Move attached comments from one token to another.
moveComments = (fromToken, toToken) ->
  return unless fromToken.comments
  if toToken.comments and toToken.comments.length isnt 0
    unshiftedComments = []
    for comment in fromToken.comments
      if comment.unshift
        unshiftedComments.push comment
      else
        toToken.comments.push comment
    toToken.comments = unshiftedComments.concat toToken.comments
  else
    toToken.comments = fromToken.comments
  delete fromToken.comments

# Create a generated token: one that exists due to a use of implicit syntax.
# Optionally have this new token take the attached comments from another token.
generate = (tag, value, origin, commentsToken) ->
  token = [tag, value]
  token.generated = yes
  token.origin = origin if origin
  moveComments commentsToken, token if commentsToken
  token

# The **Rewriter** class is used by the [Lexer](lexer.html), directly against
# its internal array of tokens.
class Rewriter

  # Rewrite the token stream in multiple passes, one logical filter at
  # a time. This could certainly be changed into a single pass through the
  # stream, with a big ol' efficient switch, but it's much nicer to work with
  # like this. The order of these passes matters—indentation must be
  # corrected before implicit parentheses can be wrapped around blocks of code.
  rewrite: (@tokens) ->
    # Set environment variable `DEBUG_TOKEN_STREAM` to `true` to output token
    # debugging info. Also set `DEBUG_REWRITTEN_TOKEN_STREAM` to `true` to
    # output the token stream after it has been rewritten by this file.
    if process?.env?.DEBUG_TOKEN_STREAM
      console.log 'Initial token stream:' if process.env.DEBUG_REWRITTEN_TOKEN_STREAM
      console.log (t[0] + '/' + t[1] + (if t.comments then '*' else '') for t in @tokens).join ' '
    @removeLeadingNewlines()
    @closeOpenCalls()
    @closeOpenIndexes()
    @normalizeLines()
    @tagPostfixConditionals()
    @addImplicitBracesAndParens()
    @rescueStowawayComments()
    @addLocationDataToGeneratedTokens()
    @fixIndentationLocationData()
    @exposeTokenDataToGrammar()
    if process?.env?.DEBUG_REWRITTEN_TOKEN_STREAM
      console.log 'Rewritten token stream:' if process.env.DEBUG_TOKEN_STREAM
      console.log (t[0] + '/' + t[1] + (if t.comments then '*' else '') for t in @tokens).join ' '
    @tokens

  # Rewrite the token stream, looking one token ahead and behind.
  # Allow the return value of the block to tell us how many tokens to move
  # forwards (or backwards) in the stream, to make sure we don't miss anything
  # as tokens are inserted and removed, and the stream changes length under
  # our feet.
  scanTokens: (block) ->
    {tokens} = this
    i = 0
    i += block.call this, token, i, tokens while token = tokens[i]
    true

  detectEnd: (i, condition, action, opts = {}) ->
    {tokens} = this
    levels = 0
    while token = tokens[i]
      return action.call this, token, i if levels is 0 and condition.call this, token, i
      if token[0] in EXPRESSION_START
        levels += 1
      else if token[0] in EXPRESSION_END
        levels -= 1
      if levels < 0
        return if opts.returnOnNegativeLevel
        return action.call this, token, i
      i += 1
    i - 1

  # Leading newlines would introduce an ambiguity in the grammar, so we
  # dispatch them here.
  removeLeadingNewlines: ->
    # Find the index of the first non-`TERMINATOR` token.
    break for [tag], i in @tokens when tag isnt 'TERMINATOR'
    return if i is 0
    # If there are any comments attached to the tokens we're about to discard,
    # shift them forward to what will become the new first token.
    for leadingNewlineToken in @tokens[0...i]
      moveComments leadingNewlineToken, @tokens[i]
    # Discard all the leading newline tokens.
    @tokens.splice 0, i

  # The lexer has tagged the opening parenthesis of a method call. Match it with
  # its paired close.
  closeOpenCalls: ->
    condition = (token, i) ->
      token[0] in [')', 'CALL_END']

    action = (token, i) ->
      token[0] = 'CALL_END'

    @scanTokens (token, i) ->
      @detectEnd i + 1, condition, action if token[0] is 'CALL_START'
      1

  # The lexer has tagged the opening bracket of an indexing operation call.
  # Match it with its paired close.
  closeOpenIndexes: ->
    startToken = null
    condition = (token, i) ->
      token[0] in [']', 'INDEX_END']

    action = (token, i) ->
      if @tokens.length >= i and @tokens[i + 1][0] is ':'
        startToken[0] = '['
        token[0] = ']'
      else
        token[0] = 'INDEX_END'

    @scanTokens (token, i) ->
      if token[0] is 'INDEX_START'
        startToken = token
        @detectEnd i + 1, condition, action
      1

  # Match tags in token stream starting at `i` with `pattern`.
  # `pattern` may consist of strings (equality), an array of strings (one of)
  # or null (wildcard). Returns the index of the match or -1 if no match.
  indexOfTag: (i, pattern...) ->
    fuzz = 0
    for j in [0 ... pattern.length]
      continue if not pattern[j]?
      pattern[j] = [pattern[j]] if typeof pattern[j] is 'string'
      return -1 if @tag(i + j + fuzz) not in pattern[j]
    i + j + fuzz - 1

  # Returns `yes` if standing in front of something looking like
  # `@<x>:`, `<x>:` or `<EXPRESSION_START><x>...<EXPRESSION_END>:`.
  looksObjectish: (j) ->
    return yes if @indexOfTag(j, '@', null, ':') isnt -1 or @indexOfTag(j, null, ':') isnt -1
    index = @indexOfTag j, EXPRESSION_START
    if index isnt -1
      end = null
      @detectEnd index + 1, ((token) -> token[0] in EXPRESSION_END), ((token, i) -> end = i)
      return yes if @tag(end + 1) is ':'
    no

  # Returns `yes` if current line of tokens contain an element of tags on same
  # expression level. Stop searching at `LINEBREAKS` or explicit start of
  # containing balanced expression.
  findTagsBackwards: (i, tags) ->
    backStack = []
    while i >= 0 and (backStack.length or
          @tag(i) not in tags and
          (@tag(i) not in EXPRESSION_START or @tokens[i].generated) and
          @tag(i) not in LINEBREAKS)
      backStack.push @tag(i) if @tag(i) in EXPRESSION_END
      backStack.pop() if @tag(i) in EXPRESSION_START and backStack.length
      i -= 1
    @tag(i) in tags

  # Look for signs of implicit calls and objects in the token stream and
  # add them.
  addImplicitBracesAndParens: ->
    # Track current balancing depth (both implicit and explicit) on stack.
    stack = []
    start = null

    @scanTokens (token, i, tokens) ->
      [tag]     = token
      [prevTag] = prevToken = if i > 0 then tokens[i - 1] else []
      [nextTag] = nextToken = if i < tokens.length - 1 then tokens[i + 1] else []
      stackTop  = -> stack[stack.length - 1]
      startIdx  = i

      # Helper function, used for keeping track of the number of tokens consumed
      # and spliced, when returning for getting a new token.
      forward   = (n) -> i - startIdx + n

      # Helper functions
      isImplicit        = (stackItem) -> stackItem?[2]?.ours
      isImplicitObject  = (stackItem) -> isImplicit(stackItem) and stackItem?[0] is '{'
      isImplicitCall    = (stackItem) -> isImplicit(stackItem) and stackItem?[0] is '('
      inImplicit        = -> isImplicit stackTop()
      inImplicitCall    = -> isImplicitCall stackTop()
      inImplicitObject  = -> isImplicitObject stackTop()
      # Unclosed control statement inside implicit parens (like
      # class declaration or if-conditionals).
      inImplicitControl = -> inImplicit() and stackTop()?[0] is 'CONTROL'

      startImplicitCall = (idx) ->
        stack.push ['(', idx, ours: yes]
        tokens.splice idx, 0, generate 'CALL_START', '(', ['', 'implicit function call', token[2]], prevToken

      endImplicitCall = ->
        stack.pop()
        tokens.splice i, 0, generate 'CALL_END', ')', ['', 'end of input', token[2]], prevToken
        i += 1

      startImplicitObject = (idx, {startsLine = yes, continuationLineIndent} = {}) ->
        stack.push ['{', idx, sameLine: yes, startsLine: startsLine, ours: yes, continuationLineIndent: continuationLineIndent]
        val = new String '{'
        val.generated = yes
        tokens.splice idx, 0, generate '{', val, token, prevToken

      endImplicitObject = (j) ->
        j = j ? i
        stack.pop()
        tokens.splice j, 0, generate '}', '}', token, prevToken
        i += 1

      implicitObjectContinues = (j) =>
        nextTerminatorIdx = null
        @detectEnd j,
          (token) -> token[0] is 'TERMINATOR'
          (token, i) -> nextTerminatorIdx = i
          returnOnNegativeLevel: yes
        return no unless nextTerminatorIdx?
        @looksObjectish nextTerminatorIdx + 1

      # Don't end an implicit call/object on next indent if any of these are in an argument/value.
      if (
        (inImplicitCall() or inImplicitObject()) and tag in CONTROL_IN_IMPLICIT or
        inImplicitObject() and prevTag is ':' and tag is 'FOR'
      )
        stack.push ['CONTROL', i, ours: yes]
        return forward(1)

      if tag is 'INDENT' and inImplicit()

        # An `INDENT` closes an implicit call unless
        #
        #  1. We have seen a `CONTROL` argument on the line.
        #  2. The last token before the indent is part of the list below.
        if prevTag not in ['=>', '->', '[', '(', ',', '{', 'ELSE', '=']
          while inImplicitCall() or inImplicitObject() and prevTag isnt ':'
            if inImplicitCall()
              endImplicitCall()
            else
              endImplicitObject()
        stack.pop() if inImplicitControl()
        stack.push [tag, i]
        return forward(1)

      # Straightforward start of explicit expression.
      if tag in EXPRESSION_START
        stack.push [tag, i]
        return forward(1)

      # Close all implicit expressions inside of explicitly closed expressions.
      if tag in EXPRESSION_END
        while inImplicit()
          if inImplicitCall()
            endImplicitCall()
          else if inImplicitObject()
            endImplicitObject()
          else
            stack.pop()
        start = stack.pop()

      inControlFlow = =>
        seenFor = @findTagsBackwards(i, ['FOR']) and @findTagsBackwards(i, ['FORIN', 'FOROF', 'FORFROM'])
        controlFlow = seenFor or @findTagsBackwards i, ['WHILE', 'UNTIL', 'LOOP', 'LEADING_WHEN']
        return no unless controlFlow
        isFunc = no
        tagCurrentLine = token[2].first_line
        @detectEnd i,
          (token, i) -> token[0] in LINEBREAKS
          (token, i) ->
            [prevTag, ,{first_line}] = tokens[i - 1] || []
            isFunc = tagCurrentLine is first_line and prevTag in ['->', '=>']
          returnOnNegativeLevel: yes
        isFunc

      # Recognize standard implicit calls like
      # f a, f() b, f? c, h[0] d etc.
      # Added support for spread dots on the left side: f ...a
      if (tag in IMPLICIT_FUNC and token.spaced or
          tag is '?' and i > 0 and not tokens[i - 1].spaced) and
         (nextTag in IMPLICIT_CALL or
         (nextTag is '...' and @tag(i + 2) in IMPLICIT_CALL and not @findTagsBackwards(i, ['INDEX_START', '['])) or
          nextTag in IMPLICIT_UNSPACED_CALL and
          not nextToken.spaced and not nextToken.newLine) and
          not inControlFlow()
        tag = token[0] = 'FUNC_EXIST' if tag is '?'
        startImplicitCall i + 1
        return forward(2)

      # Implicit call taking an implicit indented object as first argument.
      #
      #     f
      #       a: b
      #       c: d
      #
      # Don't accept implicit calls of this type, when on the same line
      # as the control structures below as that may misinterpret constructs like:
      #
      #     if f
      #        a: 1
      # as
      #
      #     if f(a: 1)
      #
      # which is probably always unintended.
      # Furthermore don't allow this in the first line of a literal array
      # or explicit object, as that creates grammatical ambiguities (#5368).
      if tag in IMPLICIT_FUNC and
         @indexOfTag(i + 1, 'INDENT') > -1 and @looksObjectish(i + 2) and
         not @findTagsBackwards(i, ['CLASS', 'EXTENDS', 'IF', 'CATCH',
          'SWITCH', 'LEADING_WHEN', 'FOR', 'WHILE', 'UNTIL']) and
         not ((s = stackTop()?[0]) in ['{', '['] and
              not isImplicit(stackTop()) and
              @findTagsBackwards(i, s))
        startImplicitCall i + 1
        stack.push ['INDENT', i + 2]
        return forward(3)

      # Implicit objects start here.
      if tag is ':'
        # Go back to the (implicit) start of the object.
        s = switch
          when @tag(i - 1) in EXPRESSION_END
            [startTag, startIndex] = start
            if startTag is '[' and startIndex > 0 and @tag(startIndex - 1) is '@' and not tokens[startIndex - 1].spaced
              startIndex - 1
            else
              startIndex
          when @tag(i - 2) is '@' then i - 2
          else i - 1

        startsLine = s <= 0 or @tag(s - 1) in LINEBREAKS or tokens[s - 1].newLine
        # Are we just continuing an already declared object?
        # Including the case where we indent on the line after an explicit '{'.
        if stackTop()
          [stackTag, stackIdx] = stackTop()
          stackNext = stack[stack.length - 2]
          if (stackTag is '{' or
              stackTag is 'INDENT' and stackNext?[0] is '{' and
              not isImplicit(stackNext) and
              @findTagsBackwards(stackIdx-1, ['{'])) and
             (startsLine or @tag(s - 1) is ',' or @tag(s - 1) is '{') and
             @tag(s - 1) not in UNFINISHED
            return forward(1)

        preObjectToken = if i > 1 then tokens[i - 2] else []
        startImplicitObject(s, {startsLine: !!startsLine, continuationLineIndent: preObjectToken.continuationLineIndent})
        return forward(2)

      # End implicit calls when chaining method calls
      # like e.g.:
      #
      #     f ->
      #       a
      #     .g b, ->
      #       c
      #     .h a
      #
      # and also
      #
      #     f a
      #     .g b
      #     .h a

      # Mark all enclosing objects as not sameLine
      if tag in LINEBREAKS
        for stackItem in stack by -1
          break unless isImplicit stackItem
          stackItem[2].sameLine = no if isImplicitObject stackItem

      # End indented-continuation-line implicit objects once that indentation is over.
      if tag is 'TERMINATOR' and token.endsContinuationLineIndentation
        {preContinuationLineIndent} = token.endsContinuationLineIndentation
        while inImplicitObject() and (implicitObjectIndent = stackTop()[2].continuationLineIndent)? and implicitObjectIndent > preContinuationLineIndent
          endImplicitObject()

      newLine = prevTag is 'OUTDENT' or prevToken.newLine
      if tag in IMPLICIT_END or
          (tag in CALL_CLOSERS and newLine) or
          (tag in ['..', '...'] and @findTagsBackwards(i, ["INDEX_START"]))
        while inImplicit()
          [stackTag, stackIdx, {sameLine, startsLine}] = stackTop()
          # Close implicit calls when reached end of argument list
          if inImplicitCall() and prevTag isnt ',' or
              (prevTag is ',' and tag is 'TERMINATOR' and not nextTag?)
            endImplicitCall()
          # Close implicit objects such as:
          # return a: 1, b: 2 unless true
          else if inImplicitObject() and sameLine and
                  tag isnt 'TERMINATOR' and prevTag isnt ':' and
                  not (tag in ['POST_IF', 'FOR', 'WHILE', 'UNTIL'] and startsLine and implicitObjectContinues(i + 1))
            endImplicitObject()
          # Close implicit objects when at end of line, line didn't end with a comma
          # and the implicit object didn't start the line or the next line doesn't look like
          # the continuation of an object.
          else if inImplicitObject() and tag is 'TERMINATOR' and prevTag isnt ',' and
                  not (startsLine and @looksObjectish(i + 1))
            endImplicitObject()
          else if inImplicitControl() and tokens[stackTop()[1]][0] is 'CLASS' and tag is 'TERMINATOR'
            stack.pop()
          else
            break

      # Close implicit object if comma is the last character
      # and what comes after doesn't look like it belongs.
      # This is used for trailing commas and calls, like:
      #
      #     x =
      #         a: b,
      #         c: d,
      #     e = 2
      #
      # and
      #
      #     f a, b: c, d: e, f, g: h: i, j
      #
      if tag is ',' and not @looksObjectish(i + 1) and inImplicitObject() and not (@tag(i + 2) in ['FOROF', 'FORIN']) and
         (nextTag isnt 'TERMINATOR' or not @looksObjectish(i + 2))
        # When nextTag is OUTDENT the comma is insignificant and
        # should just be ignored so embed it in the implicit object.
        #
        # When it isn't the comma go on to play a role in a call or
        # array further up the stack, so give it a chance.
        offset = if nextTag is 'OUTDENT' then 1 else 0
        while inImplicitObject()
          endImplicitObject i + offset
      return forward(1)

  # Not all tokens survive processing by the parser. To avoid comments getting
  # lost into the ether, find comments attached to doomed tokens and move them
  # to a token that will make it to the other side.
  rescueStowawayComments: ->
    insertPlaceholder = (token, j, tokens, method) ->
      tokens[method] generate 'TERMINATOR', '\n', tokens[j] unless tokens[j][0] is 'TERMINATOR'
      tokens[method] generate 'JS', '', tokens[j], token

    dontShiftForward = (i, tokens) ->
      j = i + 1
      while j isnt tokens.length and tokens[j][0] in DISCARDED
        return yes if tokens[j][0] is 'INTERPOLATION_END'
        j++
      no

    shiftCommentsForward = (token, i, tokens) ->
      # Find the next surviving token and attach this token's comments to it,
      # with a flag that we know to output such comments *before* that
      # token's own compilation. (Otherwise comments are output following
      # the token they're attached to.)
      j = i
      j++ while j isnt tokens.length and tokens[j][0] in DISCARDED
      unless j is tokens.length or tokens[j][0] in DISCARDED
        comment.unshift = yes for comment in token.comments
        moveComments token, tokens[j]
        return 1
      else # All following tokens are doomed!
        j = tokens.length - 1
        insertPlaceholder token, j, tokens, 'push'
        # The generated tokens were added to the end, not inline, so we don't skip.
        return 1

    shiftCommentsBackward = (token, i, tokens) ->
      # Find the last surviving token and attach this token's comments to it.
      j = i
      j-- while j isnt -1 and tokens[j][0] in DISCARDED
      unless j is -1 or tokens[j][0] in DISCARDED
        moveComments token, tokens[j]
        return 1
      else # All previous tokens are doomed!
        insertPlaceholder token, 0, tokens, 'unshift'
        # We added two tokens, so shift forward to account for the insertion.
        return 3

    @scanTokens (token, i, tokens) ->
      return 1 unless token.comments
      ret = 1
      if token[0] in DISCARDED
        # This token won't survive passage through the parser, so we need to
        # rescue its attached tokens and redistribute them to nearby tokens.
        # Comments that don't start a new line can shift backwards to the last
        # safe token, while other tokens should shift forward.
        dummyToken = comments: []
        j = token.comments.length - 1
        until j is -1
          if token.comments[j].newLine is no and token.comments[j].here is no
            dummyToken.comments.unshift token.comments[j]
            token.comments.splice j, 1
          j--
        if dummyToken.comments.length isnt 0
          ret = shiftCommentsBackward dummyToken, i - 1, tokens
        if token.comments.length isnt 0
          shiftCommentsForward token, i, tokens
      else unless dontShiftForward i, tokens
        # If any of this token's comments start a line—there's only
        # whitespace between the preceding newline and the start of the
        # comment—and this isn't one of the special `JS` tokens, then
        # shift this comment forward to precede the next valid token.
        # `Block.compileComments` also has logic to make sure that
        # "starting new line" comments follow or precede the nearest
        # newline relative to the token that the comment is attached to,
        # but that newline might be inside a `}` or `)` or other generated
        # token that we really want this comment to output after. Therefore
        # we need to shift the comments here, avoiding such generated and
        # discarded tokens.
        dummyToken = comments: []
        j = token.comments.length - 1
        until j is -1
          if token.comments[j].newLine and not token.comments[j].unshift and
             not (token[0] is 'JS' and token.generated)
            dummyToken.comments.unshift token.comments[j]
            token.comments.splice j, 1
          j--
        if dummyToken.comments.length isnt 0
          ret = shiftCommentsForward dummyToken, i + 1, tokens
      delete token.comments if token.comments?.length is 0
      ret

  # Add location data to all tokens generated by the rewriter.
  addLocationDataToGeneratedTokens: ->
    @scanTokens (token, i, tokens) ->
      return 1 if     token[2]
      return 1 unless token.generated or token.explicit
      if token.fromThen and token[0] is 'INDENT'
        token[2] = token.origin[2]
        return 1
      if token[0] is '{' and nextLocation=tokens[i + 1]?[2]
        {first_line: line, first_column: column, range: [rangeIndex]} = nextLocation
      else if prevLocation = tokens[i - 1]?[2]
        {last_line: line, last_column: column, range: [, rangeIndex]} = prevLocation
        column += 1
      else
        line = column = 0
        rangeIndex = 0
      token[2] = {
        first_line:            line
        first_column:          column
        last_line:             line
        last_column:           column
        last_line_exclusive:   line
        last_column_exclusive: column
        range: [rangeIndex, rangeIndex]
      }
      return 1

  # `OUTDENT` tokens should always be positioned at the last character of the
  # previous token, so that AST nodes ending in an `OUTDENT` token end up with a
  # location corresponding to the last "real" token under the node.
  fixIndentationLocationData: ->
    @allComments ?= extractAllCommentTokens @tokens
    findPrecedingComment = (token, {afterPosition, indentSize, first, indented}) =>
      tokenStart = token[2].range[0]
      matches = (comment) ->
        if comment.outdented
          return no unless indentSize? and comment.indentSize > indentSize
        return no if indented and not comment.indented
        return no unless comment.locationData.range[0] < tokenStart
        return no unless comment.locationData.range[0] > afterPosition
        yes
      if first
        lastMatching = null
        for comment in @allComments by -1
          if matches comment
            lastMatching = comment
          else if lastMatching
            return lastMatching
        return lastMatching
      for comment in @allComments when matches comment by -1
        return comment
      null

    @scanTokens (token, i, tokens) ->
      return 1 unless token[0] in ['INDENT', 'OUTDENT'] or
        (token.generated and token[0] is 'CALL_END' and not token.data?.closingTagNameToken) or
        (token.generated and token[0] is '}')
      isIndent = token[0] is 'INDENT'
      prevToken = token.prevToken ? tokens[i - 1]
      prevLocationData = prevToken[2]
      # addLocationDataToGeneratedTokens() set the outdent's location data
      # to the preceding token's, but in order to detect comments inside an
      # empty "block" we want to look for comments preceding the next token.
      useNextToken = token.explicit or token.generated
      if useNextToken
        nextToken = token
        nextTokenIndex = i
        nextToken = tokens[nextTokenIndex++] while (nextToken.explicit or nextToken.generated) and nextTokenIndex isnt tokens.length - 1
      precedingComment = findPrecedingComment(
        if useNextToken
          nextToken
        else
          token
        afterPosition: prevLocationData.range[0]
        indentSize: token.indentSize
        first: isIndent
        indented: useNextToken
      )
      if isIndent
        return 1 unless precedingComment?.newLine
      # We don't want e.g. an implicit call at the end of an `if` condition to
      # include a following indented comment.
      return 1 if token.generated and token[0] is 'CALL_END' and precedingComment?.indented
      prevLocationData = precedingComment.locationData if precedingComment?
      token[2] =
        first_line:
          if precedingComment?
            prevLocationData.first_line
          else
            prevLocationData.last_line
        first_column:
          if precedingComment?
            if isIndent
              0
            else
              prevLocationData.first_column
          else
            prevLocationData.last_column
        last_line:              prevLocationData.last_line
        last_column:            prevLocationData.last_column
        last_line_exclusive:    prevLocationData.last_line_exclusive
        last_column_exclusive:  prevLocationData.last_column_exclusive
        range:
          if isIndent and precedingComment?
            [
              prevLocationData.range[0] - precedingComment.indentSize
              prevLocationData.range[1]
            ]
          else
            prevLocationData.range
      return 1

  # Because our grammar is LALR(1), it can't handle some single-line
  # expressions that lack ending delimiters. The **Rewriter** adds the implicit
  # blocks, so it doesn't need to. To keep the grammar clean and tidy, trailing
  # newlines within expressions are removed and the indentation tokens of empty
  # blocks are added.
  normalizeLines: ->
    starter = indent = outdent = null
    leading_switch_when = null
    leading_if_then = null
    # Count `THEN` tags
    ifThens = []

    condition = (token, i) ->
      token[1] isnt ';' and token[0] in SINGLE_CLOSERS and
      not (token[0] is 'TERMINATOR' and @tag(i + 1) in EXPRESSION_CLOSE) and
      not (token[0] is 'ELSE' and
           (starter isnt 'THEN' or (leading_if_then or leading_switch_when))) and
      not (token[0] in ['CATCH', 'FINALLY'] and starter in ['->', '=>']) or
      token[0] in CALL_CLOSERS and
      (@tokens[i - 1].newLine or @tokens[i - 1][0] is 'OUTDENT')

    action = (token, i) ->
      ifThens.pop() if token[0] is 'ELSE' and starter is 'THEN'
      @tokens.splice (if @tag(i - 1) is ',' then i - 1 else i), 0, outdent

    closeElseTag = (tokens, i) =>
      tlen = ifThens.length
      return i unless tlen > 0
      lastThen = ifThens.pop()
      [, outdentElse] = @indentation tokens[lastThen]
      # Insert `OUTDENT` to close inner `IF`.
      outdentElse[1] = tlen*2
      tokens.splice(i, 0, outdentElse)
      # Insert `OUTDENT` to close outer `IF`.
      outdentElse[1] = 2
      tokens.splice(i + 1, 0, outdentElse)
      # Remove outdents from the end.
      @detectEnd i + 2,
        (token, i) -> token[0] in ['OUTDENT', 'TERMINATOR']
        (token, i) ->
            if @tag(i) is 'OUTDENT' and @tag(i + 1) is 'OUTDENT'
              tokens.splice i, 2
      i + 2

    @scanTokens (token, i, tokens) ->
      [tag] = token
      conditionTag = tag in ['->', '=>'] and
        @findTagsBackwards(i, ['IF', 'WHILE', 'FOR', 'UNTIL', 'SWITCH', 'WHEN', 'LEADING_WHEN', '[', 'INDEX_START']) and
        not (@findTagsBackwards i, ['THEN', '..', '...'])

      if tag is 'TERMINATOR'
        if @tag(i + 1) is 'ELSE' and @tag(i - 1) isnt 'OUTDENT'
          tokens.splice i, 1, @indentation()...
          return 1
        if @tag(i + 1) in EXPRESSION_CLOSE
          if token[1] is ';' and @tag(i + 1) is 'OUTDENT'
            tokens[i + 1].prevToken = token
            moveComments token, tokens[i + 1]
          tokens.splice i, 1
          return 0
      if tag is 'CATCH'
        for j in [1..2] when @tag(i + j) in ['OUTDENT', 'TERMINATOR', 'FINALLY']
          tokens.splice i + j, 0, @indentation()...
          return 2 + j
      if tag in ['->', '=>'] and (@tag(i + 1) in [',', ']'] or @tag(i + 1) is '.' and token.newLine)
        [indent, outdent] = @indentation tokens[i]
        tokens.splice i + 1, 0, indent, outdent
        return 1
      if tag in SINGLE_LINERS and @tag(i + 1) isnt 'INDENT' and
         not (tag is 'ELSE' and @tag(i + 1) is 'IF') and
         not conditionTag
        starter = tag
        [indent, outdent] = @indentation tokens[i]
        indent.fromThen   = true if starter is 'THEN'
        if tag is 'THEN'
          leading_switch_when = @findTagsBackwards(i, ['LEADING_WHEN']) and @tag(i + 1) is 'IF'
          leading_if_then = @findTagsBackwards(i, ['IF']) and @tag(i + 1) is 'IF'
        ifThens.push i if tag is 'THEN' and @findTagsBackwards(i, ['IF'])
        # `ELSE` tag is not closed.
        if tag is 'ELSE' and @tag(i - 1) isnt 'OUTDENT'
          i = closeElseTag tokens, i
        tokens.splice i + 1, 0, indent
        @detectEnd i + 2, condition, action
        tokens.splice i, 1 if tag is 'THEN'
        return 1
      return 1

  # Tag postfix conditionals as such, so that we can parse them with a
  # different precedence.
  tagPostfixConditionals: ->
    original = null

    condition = (token, i) ->
      [tag] = token
      [prevTag] = @tokens[i - 1]
      tag is 'TERMINATOR' or (tag is 'INDENT' and prevTag not in SINGLE_LINERS)

    action = (token, i) ->
      if token[0] isnt 'INDENT' or (token.generated and not token.fromThen)
        original[0] = 'POST_' + original[0]

    @scanTokens (token, i) ->
      return 1 unless token[0] is 'IF'
      original = token
      @detectEnd i + 1, condition, action
      return 1

  # For tokens with extra data, we want to make that data visible to the grammar
  # by wrapping the token value as a String() object and setting the data as
  # properties of that object. The grammar should then be responsible for
  # cleaning this up for the node constructor: unwrapping the token value to a
  # primitive string and separately passing any expected token data properties
  exposeTokenDataToGrammar: ->
    @scanTokens (token, i) ->
      if token.generated or (token.data and Object.keys(token.data).length isnt 0)
        token[1] = new String token[1]
        token[1][key] = val for own key, val of (token.data ? {})
        token[1].generated = yes if token.generated
      1

  # Generate the indentation tokens, based on another token on the same line.
  indentation: (origin) ->
    indent  = ['INDENT', 2]
    outdent = ['OUTDENT', 2]
    if origin
      indent.generated = outdent.generated = yes
      indent.origin = outdent.origin = origin
    else
      indent.explicit = outdent.explicit = yes
    [indent, outdent]

  generate: generate

  # Look up a tag by token index.
  tag: (i) -> @tokens[i]?[0]

# Constants
# ---------

# List of the token pairs that must be balanced.
BALANCED_PAIRS = [
  ['(', ')']
  ['[', ']']
  ['{', '}']
  ['INDENT', 'OUTDENT'],
  ['CALL_START', 'CALL_END']
  ['PARAM_START', 'PARAM_END']
  ['INDEX_START', 'INDEX_END']
  ['STRING_START', 'STRING_END']
  ['INTERPOLATION_START', 'INTERPOLATION_END']
  ['REGEX_START', 'REGEX_END']
]

# The inverse mappings of `BALANCED_PAIRS` we're trying to fix up, so we can
# look things up from either end.
INVERSES = {}

# The tokens that signal the start/end of a balanced pair.
EXPRESSION_START = []
EXPRESSION_END   = []

for [left, right] in BALANCED_PAIRS
  EXPRESSION_START.push INVERSES[right] = left
  EXPRESSION_END  .push INVERSES[left] = right

# Tokens that indicate the close of a clause of an expression.
EXPRESSION_CLOSE = ['CATCH', 'THEN', 'ELSE', 'FINALLY'].concat EXPRESSION_END

# Tokens that, if followed by an `IMPLICIT_CALL`, indicate a function invocation.
IMPLICIT_FUNC    = ['IDENTIFIER', 'PROPERTY', 'SUPER', ')', 'CALL_END', ']', 'INDEX_END', '@', 'THIS']

# If preceded by an `IMPLICIT_FUNC`, indicates a function invocation.
IMPLICIT_CALL    = [
  'IDENTIFIER', 'PROPERTY', 'NUMBER', 'INFINITY', 'NAN'
  'STRING', 'STRING_START', 'REGEX', 'REGEX_START', 'JS'
  'NEW', 'PARAM_START', 'CLASS', 'IF', 'TRY', 'SWITCH', 'THIS'
  'DYNAMIC_IMPORT', 'IMPORT_META', 'NEW_TARGET'
  'UNDEFINED', 'NULL', 'BOOL'
  'UNARY', 'DO', 'DO_IIFE', 'YIELD', 'AWAIT', 'UNARY_MATH', 'SUPER', 'THROW'
  '@', '->', '=>', '[', '(', '{', '--', '++'
]

IMPLICIT_UNSPACED_CALL = ['+', '-']

# Tokens that always mark the end of an implicit call for single-liners.
IMPLICIT_END     = ['POST_IF', 'FOR', 'WHILE', 'UNTIL', 'WHEN', 'BY',
  'LOOP', 'TERMINATOR']

# Single-line flavors of block expressions that have unclosed endings.
# The grammar can't disambiguate them, so we insert the implicit indentation.
SINGLE_LINERS    = ['ELSE', '->', '=>', 'TRY', 'FINALLY', 'THEN']
SINGLE_CLOSERS   = ['TERMINATOR', 'CATCH', 'FINALLY', 'ELSE', 'OUTDENT', 'LEADING_WHEN']

# Tokens that end a line.
LINEBREAKS       = ['TERMINATOR', 'INDENT', 'OUTDENT']

# Tokens that close open calls when they follow a newline.
CALL_CLOSERS     = ['.', '?.', '::', '?::']

# Tokens that prevent a subsequent indent from ending implicit calls/objects
CONTROL_IN_IMPLICIT = ['IF', 'TRY', 'FINALLY', 'CATCH', 'CLASS', 'SWITCH']

# Tokens that are swallowed up by the parser, never leading to code generation.
# You can spot these in `grammar.coffee` because the `o` function second
# argument doesn't contain a `new` call for these tokens.
# `STRING_START` isn't on this list because its `locationData` matches that of
# the node that becomes `StringWithInterpolations`, and therefore
# `addDataToNode` attaches `STRING_START`'s tokens to that node.
DISCARDED = ['(', ')', '[', ']', '{', '}', ':', '.', '..', '...', ',', '=', '++', '--', '?',
  'AS', 'AWAIT', 'CALL_START', 'CALL_END', 'DEFAULT', 'DO', 'DO_IIFE', 'ELSE',
  'EXTENDS', 'EXPORT', 'FORIN', 'FOROF', 'FORFROM', 'IMPORT', 'INDENT', 'INDEX_SOAK',
  'INTERPOLATION_START', 'INTERPOLATION_END', 'LEADING_WHEN', 'OUTDENT', 'PARAM_END',
  'REGEX_START', 'REGEX_END', 'RETURN', 'STRING_END', 'THROW', 'UNARY', 'YIELD'
].concat IMPLICIT_UNSPACED_CALL.concat IMPLICIT_END.concat CALL_CLOSERS.concat CONTROL_IN_IMPLICIT

# Tokens that, when appearing at the end of a line, suppress a following TERMINATOR/INDENT token
UNFINISHED = [
  '\\', '.', '?.', '?::', 'UNARY', 'DO', 'DO_IIFE', 'MATH', 'UNARY_MATH', '+', '-',
  '**', 'SHIFT', 'RELATION', 'COMPARE', '&', '^', '|', '&&', '||', 'BIN?', 'EXTENDS'
]
