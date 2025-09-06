
var BOM, BOOL, CALLABLE, CODE, COFFEE_ALIASES, COFFEE_ALIAS_MAP, COFFEE_KEYWORDS, COMMENT, COMPARABLE_LEFT_SIDE, COMPARE, COMPOUND_ASSIGN, HERECOMMENT_ILLEGAL, HEREDOC_DOUBLE, HEREDOC_INDENT, HEREDOC_SINGLE, HEREGEX, HEREGEX_COMMENT, HERE_JSTOKEN, IDENTIFIER, INDENTABLE_CLOSERS, INDEXABLE, JSTOKEN, JS_KEYWORDS, LINE_BREAK, LINE_CONTINUER, MATH, MULTI_DENT, NOT_REGEX, NUMBER, OPERATOR, POSSIBLY_DIVISION, REGEX, REGEX_FLAGS, REGEX_ILLEGAL, REGEX_INVALID_ESCAPE, RELATION, RESERVED, SHIFT, STRICT_PROSCRIBED, STRING_DOUBLE, STRING_INVALID_ESCAPE, STRING_SINGLE, STRING_START, TRAILING_SPACES, UNARY, UNARY_MATH, VALID_FLAGS, WHITESPACE, addTokenData, isForFrom, isUnassignable, key,
  indexOf = [].indexOf,
  slice = [].slice;

import {
  Rewriter,
  INVERSES,
  UNFINISHED
} from './rewriter.js';

import {
  count,
  starts,
  compact,
  repeat,
  merge,
  attachCommentsToNode,
  locationDataToString,
  throwSyntaxError,
  replaceUnicodeCodePointEscapes,
  flatten,
  parseNumber
} from './helpers.js';

export var Lexer = class Lexer {
  constructor() {
    this.error = this.error.bind(this);
  }

  tokenize(code, opts = {}) {
    var consumed, end, i, ref;
    this.indent = 0;
    this.baseIndent = 0;
    this.continuationLineAdditionalIndent = 0;
    this.outdebt = 0;
    this.indents = [];
    this.indentLiteral = '';
    this.ends = [];
    this.tokens = [];
    this.seenFor = false;
    this.seenImport = false;
    this.seenExport = false;
    this.importSpecifierList = false;
    this.exportSpecifierList = false;
    this.chunkLine = opts.line || 0;
    this.chunkColumn = opts.column || 0;
    this.chunkOffset = opts.offset || 0;
    this.locationDataCompensations = opts.locationDataCompensations || {};
    code = this.clean(code);
    i = 0;
    while (this.chunk = code.slice(i)) {
      consumed = this.identifierToken() || this.commentToken() || this.whitespaceToken() || this.lineToken() || this.stringToken() || this.numberToken() || this.regexToken() || this.jsToken() || this.literalToken();
      [this.chunkLine, this.chunkColumn, this.chunkOffset] = this.getLineAndColumnFromChunk(consumed);
      i += consumed;
      if (opts.untilBalanced && this.ends.length === 0) {
        return {
          tokens: this.tokens,
          index: i
        };
      }
    }
    this.closeIndentation();
    if (end = this.ends.pop()) {
      this.error(`missing ${end.tag}`, ((ref = end.origin) != null ? ref : end)[2]);
    }
    if (opts.rewrite === false) {
      return this.tokens;
    }
    return (new Rewriter()).rewrite(this.tokens);
  }

  clean(code) {
    var base, thusFar;
    thusFar = 0;
    if (code.charCodeAt(0) === BOM) {
      code = code.slice(1);
      this.locationDataCompensations[0] = 1;
      thusFar += 1;
    }
    if (WHITESPACE.test(code)) {
      code = `\n${code}`;
      this.chunkLine--;
      if ((base = this.locationDataCompensations)[0] == null) {
        base[0] = 0;
      }
      this.locationDataCompensations[0] -= 1;
    }
    code = code.replace(/\r/g, (match, offset) => {
      this.locationDataCompensations[thusFar + offset] = 1;
      return '';
    }).replace(TRAILING_SPACES, '');
    return code;
  }

  identifierToken() {
    var afterNot, alias, colon, colonOffset, colonToken, id, idLength, input, match, poppedToken, prev, prevprev, ref, ref1, ref10, ref11, ref12, ref2, ref3, ref4, ref5, ref6, ref7, ref8, ref9, regExSuper, sup, tag, tagToken, tokenData;
    if (!(match = IDENTIFIER.exec(this.chunk))) {
      return 0;
    }
    [input, id, colon] = match;
    idLength = id.length;
    poppedToken = void 0;
    if (id === 'own' && this.tag() === 'FOR') {
      this.token('OWN', id);
      return id.length;
    }
    if (id === 'from' && this.tag() === 'YIELD') {
      this.token('FROM', id);
      return id.length;
    }
    if (id === 'as' && this.seenImport) {
      if (this.value() === '*') {
        this.tokens[this.tokens.length - 1][0] = 'IMPORT_ALL';
      } else if (ref = this.value(true), indexOf.call(COFFEE_KEYWORDS, ref) >= 0) {
        prev = this.prev();
        [prev[0], prev[1]] = ['IDENTIFIER', this.value(true)];
      }
      if ((ref1 = this.tag()) === 'DEFAULT' || ref1 === 'IMPORT_ALL' || ref1 === 'IDENTIFIER') {
        this.token('AS', id);
        return id.length;
      }
    }
    if (id === 'as' && this.seenExport) {
      if ((ref2 = this.tag()) === 'IDENTIFIER' || ref2 === 'DEFAULT') {
        this.token('AS', id);
        return id.length;
      }
      if (ref3 = this.value(true), indexOf.call(COFFEE_KEYWORDS, ref3) >= 0) {
        prev = this.prev();
        [prev[0], prev[1]] = ['IDENTIFIER', this.value(true)];
        this.token('AS', id);
        return id.length;
      }
    }
    if (id === 'default' && this.seenExport && ((ref4 = this.tag()) === 'EXPORT' || ref4 === 'AS')) {
      this.token('DEFAULT', id);
      return id.length;
    }
    if (id === 'assert' && (this.seenImport || this.seenExport) && this.tag() === 'STRING') {
      this.token('ASSERT', id);
      return id.length;
    }
    if (id === 'do' && (regExSuper = /^(\s*super)(?!\(\))/.exec(this.chunk.slice(3)))) {
      this.token('SUPER', 'super');
      this.token('CALL_START', '(');
      this.token('CALL_END', ')');
      [input, sup] = regExSuper;
      return sup.length + 3;
    }
    prev = this.prev();
    tag = colon || (prev != null) && (((ref5 = prev[0]) === '.' || ref5 === '?.' || ref5 === '::' || ref5 === '?::') || !prev.spaced && prev[0] === '@') ? 'PROPERTY' : 'IDENTIFIER';
    tokenData = {};
    if (tag === 'IDENTIFIER' && (indexOf.call(JS_KEYWORDS, id) >= 0 || indexOf.call(COFFEE_KEYWORDS, id) >= 0) && !(this.exportSpecifierList && indexOf.call(COFFEE_KEYWORDS, id) >= 0)) {
      tag = id.toUpperCase();
      if (tag === 'WHEN' && (ref6 = this.tag(), indexOf.call(LINE_BREAK, ref6) >= 0)) {
        tag = 'LEADING_WHEN';
      } else if (tag === 'FOR') {
        this.seenFor = {
          endsLength: this.ends.length
        };
      } else if (tag === 'UNLESS') {
        tag = 'IF';
      } else if (tag === 'IMPORT') {
        this.seenImport = true;
      } else if (tag === 'EXPORT') {
        this.seenExport = true;
      } else if (indexOf.call(UNARY, tag) >= 0) {
        tag = 'UNARY';
      } else if (indexOf.call(RELATION, tag) >= 0) {
        if (tag !== 'INSTANCEOF' && this.seenFor) {
          tag = 'FOR' + tag;
          this.seenFor = false;
        } else {
          tag = 'RELATION';
          if (this.value() === '!') {
            poppedToken = this.tokens.pop();
            tokenData.invert = (ref7 = (ref8 = poppedToken.data) != null ? ref8.original : void 0) != null ? ref7 : poppedToken[1];
          }
        }
      }
    } else if (tag === 'IDENTIFIER' && this.seenFor && id === 'from' && isForFrom(prev)) {
      tag = 'FORFROM';
      this.seenFor = false;
    } else if (tag === 'PROPERTY' && prev) {
      if (prev.spaced && (ref9 = prev[0], indexOf.call(CALLABLE, ref9) >= 0) && /^[gs]et$/.test(prev[1]) && this.tokens.length > 1 && ((ref10 = this.tokens[this.tokens.length - 2][0]) !== '.' && ref10 !== '?.' && ref10 !== '@')) {
        this.error(`'${prev[1]}' cannot be used as a keyword, or as a function call without parentheses`, prev[2]);
      } else if (prev[0] === '.' && this.tokens.length > 1 && (prevprev = this.tokens[this.tokens.length - 2])[0] === 'UNARY' && prevprev[1] === 'new') {
        prevprev[0] = 'NEW_TARGET';
      } else if (prev[0] === '.' && this.tokens.length > 1 && (prevprev = this.tokens[this.tokens.length - 2])[0] === 'IMPORT' && prevprev[1] === 'import') {
        this.seenImport = false;
        prevprev[0] = 'IMPORT_META';
      } else if (this.tokens.length > 2) {
        prevprev = this.tokens[this.tokens.length - 2];
        if (((ref11 = prev[0]) === '@' || ref11 === 'THIS') && prevprev && prevprev.spaced && /^[gs]et$/.test(prevprev[1]) && ((ref12 = this.tokens[this.tokens.length - 3][0]) !== '.' && ref12 !== '?.' && ref12 !== '@')) {
          this.error(`'${prevprev[1]}' cannot be used as a keyword, or as a function call without parentheses`, prevprev[2]);
        }
      }
    }
    if (tag === 'IDENTIFIER' && indexOf.call(RESERVED, id) >= 0) {
      this.error(`reserved word '${id}'`, {
        length: id.length
      });
    }
    if (!(tag === 'PROPERTY' || this.exportSpecifierList || this.importSpecifierList)) {
      if (id === 'is' && this.chunk.slice(idLength, idLength + 4) === ' not') {
        afterNot = this.chunk.slice(idLength + 4).trim();
        if (!afterNot.match(/^(false|true)\s+(is|isnt|==|!=)/)) {
          id = 'isnt';
          idLength += 4;
        }
      }
      if (indexOf.call(COFFEE_ALIASES, id) >= 0) {
        alias = id;
        id = COFFEE_ALIAS_MAP[id];
        tokenData.original = alias;
      }
      tag = (function() {
        switch (id) {
          case '!':
            return 'UNARY';
          case '==':
          case '!=':
            return 'COMPARE';
          case 'true':
          case 'false':
            return 'BOOL';
          case 'break':
          case 'continue':
          case 'debugger':
            return 'STATEMENT';
          case '&&':
          case '||':
            return id;
          default:
            return tag;
        }
      })();
    }
    tagToken = this.token(tag, id, {
      length: idLength,
      data: tokenData
    });
    if (alias) {
      tagToken.origin = [tag, alias, tagToken[2]];
    }
    if (poppedToken) {
      [tagToken[2].first_line, tagToken[2].first_column, tagToken[2].range[0]] = [poppedToken[2].first_line, poppedToken[2].first_column, poppedToken[2].range[0]];
    }
    if (colon) {
      colonOffset = input.lastIndexOf(':');
      colonToken = this.token(':', ':', {
        offset: colonOffset
      });
    }
    if (colon) {
      return idLength + colon.length;
    } else {
      return idLength;
    }
  }

  numberToken() {
    var lexedLength, match, number, parsedValue, tag, tokenData;
    if (!(match = NUMBER.exec(this.chunk))) {
      return 0;
    }
    number = match[0];
    lexedLength = number.length;
    switch (false) {
      case !/^0[BOX]/.test(number):
        this.error(`radix prefix in '${number}' must be lowercase`, {
          offset: 1
        });
        break;
      case !/^0\d*[89]/.test(number):
        this.error(`decimal literal '${number}' must not be prefixed with '0'`, {
          length: lexedLength
        });
        break;
      case !/^0\d+/.test(number):
        this.error(`octal literal '${number}' must be prefixed with '0o'`, {
          length: lexedLength
        });
    }
    parsedValue = parseNumber(number);
    tokenData = {parsedValue};
    tag = parsedValue === 2e308 ? 'INFINITY' : 'NUMBER';
    if (tag === 'INFINITY') {
      tokenData.original = number;
    }
    this.token(tag, number, {
      length: lexedLength,
      data: tokenData
    });
    return lexedLength;
  }

  stringToken() {
    var attempt, delimiter, doc, end, heredoc, i, indent, match, prev, quote, ref, regex, token, tokens;
    [quote] = STRING_START.exec(this.chunk) || [];
    if (!quote) {
      return 0;
    }
    prev = this.prev();
    if (prev && this.value() === 'from' && (this.seenImport || this.seenExport)) {
      prev[0] = 'FROM';
    }
    regex = (function() {
      switch (quote) {
        case "'":
          return STRING_SINGLE;
        case '"':
          return STRING_DOUBLE;
        case "'''":
          return HEREDOC_SINGLE;
        case '"""':
          return HEREDOC_DOUBLE;
      }
    })();
    ({
      tokens,
      index: end
    } = this.matchWithInterpolations(regex, quote));
    heredoc = quote.length === 3;
    if (heredoc) {
      indent = null;
      doc = ((function() {
        var j, len, results;
        results = [];
        for (i = j = 0, len = tokens.length; j < len; i = ++j) {
          token = tokens[i];
          if (token[0] === 'NEOSTRING') {
            results.push(token[1]);
          }
        }
        return results;
      })()).join('#{}');
      while (match = HEREDOC_INDENT.exec(doc)) {
        attempt = match[1];
        if (indent === null || (0 < (ref = attempt.length) && ref < indent.length)) {
          indent = attempt;
        }
      }
    }
    delimiter = quote.charAt(0);
    this.mergeInterpolationTokens(tokens, {
      quote,
      indent,
      endOffset: end
    }, (value) => {
      return this.validateUnicodeCodePointEscapes(value, {
        delimiter: quote
      });
    });
    return end;
  }

  commentToken(chunk = this.chunk, {heregex, returnCommentTokens = false, offsetInChunk = 0} = {}) {
    var commentAttachment, commentAttachments, commentWithSurroundingWhitespace, content, contents, getIndentSize, hasSeenFirstCommentLine, hereComment, hereLeadingWhitespace, hereTrailingWhitespace, i, indentSize, leadingNewline, leadingNewlineOffset, leadingNewlines, leadingWhitespace, length, lineComment, match, matchIllegal, noIndent, nonInitial, placeholderToken, precededByBlankLine, precedingNonCommentLines, prev;
    if (!(match = chunk.match(COMMENT))) {
      return 0;
    }
    [commentWithSurroundingWhitespace, hereLeadingWhitespace, hereComment, hereTrailingWhitespace, lineComment] = match;
    contents = null;
    leadingNewline = /^\s*\n+\s*#/.test(commentWithSurroundingWhitespace);
    if (hereComment) {
      matchIllegal = HERECOMMENT_ILLEGAL.exec(hereComment);
      if (matchIllegal) {
        this.error(`block comments cannot contain ${matchIllegal[0]}`, {
          offset: '###'.length + matchIllegal.index,
          length: matchIllegal[0].length
        });
      }
      chunk = chunk.replace(`###${hereComment}###`, '');
      chunk = chunk.replace(/^\n+/, '');
      this.lineToken({chunk});
      content = hereComment;
      contents = [
        {
          content,
          length: commentWithSurroundingWhitespace.length - hereLeadingWhitespace.length - hereTrailingWhitespace.length,
          leadingWhitespace: hereLeadingWhitespace
        }
      ];
    } else {
      leadingNewlines = '';
      content = lineComment.replace(/^(\n*)/, function(leading) {
        leadingNewlines = leading;
        return '';
      });
      precedingNonCommentLines = '';
      hasSeenFirstCommentLine = false;
      contents = content.split('\n').map(function(line, index) {
        var comment, leadingWhitespace;
        if (!(line.indexOf('#') > -1)) {
          precedingNonCommentLines += `\n${line}`;
          return;
        }
        leadingWhitespace = '';
        content = line.replace(/^([ |\t]*)#/, function(_, whitespace) {
          leadingWhitespace = whitespace;
          return '';
        });
        comment = {
          content,
          length: '#'.length + content.length,
          leadingWhitespace: `${!hasSeenFirstCommentLine ? leadingNewlines : ''}${precedingNonCommentLines}${leadingWhitespace}`,
          precededByBlankLine: !!precedingNonCommentLines
        };
        hasSeenFirstCommentLine = true;
        precedingNonCommentLines = '';
        return comment;
      }).filter(function(comment) {
        return comment;
      });
    }
    getIndentSize = function({leadingWhitespace, nonInitial}) {
      var lastNewlineIndex;
      lastNewlineIndex = leadingWhitespace.lastIndexOf('\n');
      if ((hereComment != null) || !nonInitial) {
        if (!(lastNewlineIndex > -1)) {
          return null;
        }
      } else {
        if (lastNewlineIndex == null) {
          lastNewlineIndex = -1;
        }
      }
      return leadingWhitespace.length - 1 - lastNewlineIndex;
    };
    commentAttachments = (function() {
      var j, len, results;
      results = [];
      for (i = j = 0, len = contents.length; j < len; i = ++j) {
        ({content, length, leadingWhitespace, precededByBlankLine} = contents[i]);
        nonInitial = i !== 0;
        leadingNewlineOffset = nonInitial ? 1 : 0;
        offsetInChunk += leadingNewlineOffset + leadingWhitespace.length;
        indentSize = getIndentSize({leadingWhitespace, nonInitial});
        noIndent = (indentSize == null) || indentSize === -1;
        commentAttachment = {
          content,
          here: hereComment != null,
          newLine: leadingNewline || nonInitial,
          locationData: this.makeLocationData({offsetInChunk, length}),
          precededByBlankLine,
          indentSize,
          indented: !noIndent && indentSize > this.indent,
          outdented: !noIndent && indentSize < this.indent
        };
        if (heregex) {
          commentAttachment.heregex = true;
        }
        offsetInChunk += length;
        results.push(commentAttachment);
      }
      return results;
    }).call(this);
    prev = this.prev();
    if (!prev) {
      commentAttachments[0].newLine = true;
      this.lineToken({
        chunk: this.chunk.slice(commentWithSurroundingWhitespace.length),
        offset: commentWithSurroundingWhitespace.length
      });
      placeholderToken = this.makeToken('JS', '', {
        offset: commentWithSurroundingWhitespace.length,
        generated: true
      });
      placeholderToken.comments = commentAttachments;
      this.tokens.push(placeholderToken);
      this.newlineToken(commentWithSurroundingWhitespace.length);
    } else {
      attachCommentsToNode(commentAttachments, prev);
    }
    if (returnCommentTokens) {
      return commentAttachments;
    }
    return commentWithSurroundingWhitespace.length;
  }

  jsToken() {
    var length, match, matchedHere, script;
    if (!(this.chunk.charAt(0) === '`' && (match = (matchedHere = HERE_JSTOKEN.exec(this.chunk)) || JSTOKEN.exec(this.chunk)))) {
      return 0;
    }
    script = match[1];
    ({length} = match[0]);
    this.token('JS', script, {
      length,
      data: {
        here: !!matchedHere
      }
    });
    return length;
  }

  regexToken() {
    var body, closed, comment, commentIndex, commentOpts, commentTokens, comments, delimiter, end, flags, fullMatch, index, leadingWhitespace, match, matchedComment, origin, prev, ref, ref1, regex, tokens;
    switch (false) {
      case !(match = REGEX_ILLEGAL.exec(this.chunk)):
        this.error(`regular expressions cannot begin with ${match[2]}`, {
          offset: match.index + match[1].length
        });
        break;
      case !(match = this.matchWithInterpolations(HEREGEX, '///')):
        ({tokens, index} = match);
        comments = [];
        while (matchedComment = HEREGEX_COMMENT.exec(this.chunk.slice(0, index))) {
          ({
            index: commentIndex
          } = matchedComment);
          [fullMatch, leadingWhitespace, comment] = matchedComment;
          comments.push({
            comment,
            offsetInChunk: commentIndex + leadingWhitespace.length
          });
        }
        commentTokens = flatten((function() {
          var j, len, results;
          results = [];
          for (j = 0, len = comments.length; j < len; j++) {
            commentOpts = comments[j];
            results.push(this.commentToken(commentOpts.comment, Object.assign(commentOpts, {
              heregex: true,
              returnCommentTokens: true
            })));
          }
          return results;
        }).call(this));
        break;
      case !(match = REGEX.exec(this.chunk)):
        [regex, body, closed] = match;
        this.validateEscapes(body, {
          isRegex: true,
          offsetInChunk: 1
        });
        index = regex.length;
        prev = this.prev();
        if (prev) {
          if (prev.spaced && (ref = prev[0], indexOf.call(CALLABLE, ref) >= 0)) {
            if (!closed || POSSIBLY_DIVISION.test(regex)) {
              return 0;
            }
          } else if (ref1 = prev[0], indexOf.call(NOT_REGEX, ref1) >= 0) {
            return 0;
          }
        }
        if (!closed) {
          this.error('missing / (unclosed regex)');
        }
        break;
      default:
        return 0;
    }
    [flags] = REGEX_FLAGS.exec(this.chunk.slice(index));
    end = index + flags.length;
    origin = this.makeToken('REGEX', null, {
      length: end
    });
    switch (false) {
      case !!VALID_FLAGS.test(flags):
        this.error(`invalid regular expression flags ${flags}`, {
          offset: index,
          length: flags.length
        });
        break;
      case !(regex || tokens.length === 1):
        delimiter = body ? '/' : '///';
        if (body == null) {
          body = tokens[0][1];
        }
        this.validateUnicodeCodePointEscapes(body, {delimiter});
        this.token('REGEX', `/${body}/${flags}`, {
          length: end,
          origin,
          data: {delimiter}
        });
        break;
      default:
        this.token('REGEX_START', '(', {
          length: 0,
          origin,
          generated: true
        });
        this.token('IDENTIFIER', 'RegExp', {
          length: 0,
          generated: true
        });
        this.token('CALL_START', '(', {
          length: 0,
          generated: true
        });
        this.mergeInterpolationTokens(tokens, {
          double: true,
          heregex: {flags},
          endOffset: end - flags.length,
          quote: '///'
        }, (str) => {
          return this.validateUnicodeCodePointEscapes(str, {delimiter});
        });
        if (flags) {
          this.token(',', ',', {
            offset: index - 1,
            length: 0,
            generated: true
          });
          this.token('STRING', '"' + flags + '"', {
            offset: index,
            length: flags.length
          });
        }
        this.token(')', ')', {
          offset: end,
          length: 0,
          generated: true
        });
        this.token('REGEX_END', ')', {
          offset: end,
          length: 0,
          generated: true
        });
    }
    if (commentTokens != null ? commentTokens.length : void 0) {
      addTokenData(this.tokens[this.tokens.length - 1], {
        heregexCommentTokens: commentTokens
      });
    }
    return end;
  }

  lineToken({chunk = this.chunk, offset = 0} = {}) {
    var backslash, diff, endsContinuationLineIndentation, indent, match, minLiteralLength, newIndentLiteral, noNewlines, prev, ref, size;
    if (!(match = MULTI_DENT.exec(chunk))) {
      return 0;
    }
    indent = match[0];
    prev = this.prev();
    backslash = (prev != null ? prev[0] : void 0) === '\\';
    if (!((backslash || ((ref = this.seenFor) != null ? ref.endsLength : void 0) < this.ends.length) && this.seenFor)) {
      this.seenFor = false;
    }
    if (!((backslash && this.seenImport) || this.importSpecifierList)) {
      this.seenImport = false;
    }
    if (!((backslash && this.seenExport) || this.exportSpecifierList)) {
      this.seenExport = false;
    }
    size = indent.length - 1 - indent.lastIndexOf('\n');
    noNewlines = this.unfinished();
    newIndentLiteral = size > 0 ? indent.slice(-size) : '';
    if (!/^(.?)\1*$/.exec(newIndentLiteral)) {
      this.error('mixed indentation', {
        offset: indent.length
      });
      return indent.length;
    }
    minLiteralLength = Math.min(newIndentLiteral.length, this.indentLiteral.length);
    if (newIndentLiteral.slice(0, minLiteralLength) !== this.indentLiteral.slice(0, minLiteralLength)) {
      this.error('indentation mismatch', {
        offset: indent.length
      });
      return indent.length;
    }
    if (size - this.continuationLineAdditionalIndent === this.indent) {
      if (noNewlines) {
        this.suppressNewlines();
      } else {
        this.newlineToken(offset);
      }
      return indent.length;
    }
    if (size > this.indent) {
      if (noNewlines) {
        if (!backslash) {
          this.continuationLineAdditionalIndent = size - this.indent;
        }
        if (this.continuationLineAdditionalIndent) {
          prev.continuationLineIndent = this.indent + this.continuationLineAdditionalIndent;
        }
        this.suppressNewlines();
        return indent.length;
      }
      if (!this.tokens.length) {
        this.baseIndent = this.indent = size;
        this.indentLiteral = newIndentLiteral;
        return indent.length;
      }
      diff = size - this.indent + this.outdebt;
      this.token('INDENT', diff, {
        offset: offset + indent.length - size,
        length: size
      });
      this.indents.push(diff);
      this.ends.push({
        tag: 'OUTDENT'
      });
      this.outdebt = this.continuationLineAdditionalIndent = 0;
      this.indent = size;
      this.indentLiteral = newIndentLiteral;
    } else if (size < this.baseIndent) {
      this.error('missing indentation', {
        offset: offset + indent.length
      });
    } else {
      endsContinuationLineIndentation = this.continuationLineAdditionalIndent > 0;
      this.continuationLineAdditionalIndent = 0;
      this.outdentToken({
        moveOut: this.indent - size,
        noNewlines,
        outdentLength: indent.length,
        offset,
        indentSize: size,
        endsContinuationLineIndentation
      });
    }
    return indent.length;
  }

  outdentToken({moveOut, noNewlines, outdentLength = 0, offset = 0, indentSize, endsContinuationLineIndentation}) {
    var decreasedIndent, dent, lastIndent, ref, terminatorToken;
    decreasedIndent = this.indent - moveOut;
    while (moveOut > 0) {
      lastIndent = this.indents[this.indents.length - 1];
      if (!lastIndent) {
        this.outdebt = moveOut = 0;
      } else if (this.outdebt && moveOut <= this.outdebt) {
        this.outdebt -= moveOut;
        moveOut = 0;
      } else {
        dent = this.indents.pop() + this.outdebt;
        if (outdentLength && (ref = this.chunk[outdentLength], indexOf.call(INDENTABLE_CLOSERS, ref) >= 0)) {
          decreasedIndent -= dent - moveOut;
          moveOut = dent;
        }
        this.outdebt = 0;
        this.pair('OUTDENT');
        this.token('OUTDENT', moveOut, {
          length: outdentLength,
          indentSize: indentSize + moveOut - dent
        });
        moveOut -= dent;
      }
    }
    if (dent) {
      this.outdebt -= moveOut;
    }
    this.suppressSemicolons();
    if (!(this.tag() === 'TERMINATOR' || noNewlines)) {
      terminatorToken = this.token('TERMINATOR', '\n', {
        offset: offset + outdentLength,
        length: 0
      });
      if (endsContinuationLineIndentation) {
        terminatorToken.endsContinuationLineIndentation = {
          preContinuationLineIndent: this.indent
        };
      }
    }
    this.indent = decreasedIndent;
    this.indentLiteral = this.indentLiteral.slice(0, decreasedIndent);
    return this;
  }

  whitespaceToken() {
    var match, nline, prev;
    if (!((match = WHITESPACE.exec(this.chunk)) || (nline = this.chunk.charAt(0) === '\n'))) {
      return 0;
    }
    prev = this.prev();
    if (prev) {
      prev[match ? 'spaced' : 'newLine'] = true;
    }
    if (match) {
      return match[0].length;
    } else {
      return 0;
    }
  }

  newlineToken(offset) {
    this.suppressSemicolons();
    if (this.tag() !== 'TERMINATOR') {
      this.token('TERMINATOR', '\n', {
        offset,
        length: 0
      });
    }
    return this;
  }

  suppressNewlines() {
    var prev;
    prev = this.prev();
    if (prev[1] === '\\') {
      if (prev.comments && this.tokens.length > 1) {
        attachCommentsToNode(prev.comments, this.tokens[this.tokens.length - 2]);
      }
      this.tokens.pop();
    }
    return this;
  }

  literalToken() {
    var match, message, origin, prev, ref, ref1, ref2, ref3, ref4, ref5, skipToken, tag, token, value;
    if (match = OPERATOR.exec(this.chunk)) {
      [value] = match;
      if (CODE.test(value)) {
        this.tagParameters();
      }
    } else {
      value = this.chunk.charAt(0);
    }
    tag = value;
    prev = this.prev();
    if (prev && indexOf.call(['=', ...COMPOUND_ASSIGN], value) >= 0) {
      skipToken = false;
      if (value === '=' && ((ref = prev[1]) === '||' || ref === '&&') && !prev.spaced) {
        prev[0] = 'COMPOUND_ASSIGN';
        prev[1] += '=';
        if ((ref1 = prev.data) != null ? ref1.original : void 0) {
          prev.data.original += '=';
        }
        prev[2].range = [prev[2].range[0], prev[2].range[1] + 1];
        prev[2].last_column += 1;
        prev[2].last_column_exclusive += 1;
        prev = this.tokens[this.tokens.length - 2];
        skipToken = true;
      }
      if (prev && prev[0] !== 'PROPERTY') {
        origin = (ref2 = prev.origin) != null ? ref2 : prev;
        message = isUnassignable(prev[1], origin[1]);
        if (message) {
          this.error(message, origin[2]);
        }
      }
      if (skipToken) {
        return value.length;
      }
    }
    if (value === '(' && (prev != null ? prev[0] : void 0) === 'IMPORT') {
      prev[0] = 'DYNAMIC_IMPORT';
    }
    if (value === '{' && this.seenImport) {
      this.importSpecifierList = true;
    } else if (this.importSpecifierList && value === '}') {
      this.importSpecifierList = false;
    } else if (value === '{' && (prev != null ? prev[0] : void 0) === 'EXPORT') {
      this.exportSpecifierList = true;
    } else if (this.exportSpecifierList && value === '}') {
      this.exportSpecifierList = false;
    }
    if (value === ';') {
      if (ref3 = prev != null ? prev[0] : void 0, indexOf.call(['=', ...UNFINISHED], ref3) >= 0) {
        this.error('unexpected ;');
      }
      this.seenFor = this.seenImport = this.seenExport = false;
      tag = 'TERMINATOR';
    } else if (value === '*' && (prev != null ? prev[0] : void 0) === 'EXPORT') {
      tag = 'EXPORT_ALL';
    } else if (indexOf.call(MATH, value) >= 0) {
      tag = 'MATH';
    } else if (indexOf.call(COMPARE, value) >= 0) {
      tag = 'COMPARE';
    } else if (indexOf.call(COMPOUND_ASSIGN, value) >= 0) {
      tag = 'COMPOUND_ASSIGN';
    } else if (indexOf.call(UNARY, value) >= 0) {
      tag = 'UNARY';
    } else if (indexOf.call(UNARY_MATH, value) >= 0) {
      tag = 'UNARY_MATH';
    } else if (indexOf.call(SHIFT, value) >= 0) {
      tag = 'SHIFT';
    } else if (value === '?' && (prev != null ? prev.spaced : void 0)) {
      tag = 'BIN?';
    } else if (prev) {
      if (value === '(' && !prev.spaced && (ref4 = prev[0], indexOf.call(CALLABLE, ref4) >= 0)) {
        if (prev[0] === '?') {
          prev[0] = 'FUNC_EXIST';
        }
        tag = 'CALL_START';
      } else if (value === '[' && (((ref5 = prev[0], indexOf.call(INDEXABLE, ref5) >= 0) && !prev.spaced) || (prev[0] === '::'))) {
        tag = 'INDEX_START';
        switch (prev[0]) {
          case '?':
            prev[0] = 'INDEX_SOAK';
        }
      }
    }
    token = this.makeToken(tag, value);
    switch (value) {
      case '(':
      case '{':
      case '[':
        this.ends.push({
          tag: INVERSES[value],
          origin: token
        });
        break;
      case ')':
      case '}':
      case ']':
        this.pair(value);
    }
    this.tokens.push(this.makeToken(tag, value));
    return value.length;
  }

  tagParameters() {
    var i, paramEndToken, stack, tok, tokens;
    if (this.tag() !== ')') {
      return this.tagDoIife();
    }
    stack = [];
    ({tokens} = this);
    i = tokens.length;
    paramEndToken = tokens[--i];
    paramEndToken[0] = 'PARAM_END';
    while (tok = tokens[--i]) {
      switch (tok[0]) {
        case ')':
          stack.push(tok);
          break;
        case '(':
        case 'CALL_START':
          if (stack.length) {
            stack.pop();
          } else if (tok[0] === '(') {
            tok[0] = 'PARAM_START';
            return this.tagDoIife(i - 1);
          } else {
            paramEndToken[0] = 'CALL_END';
            return this;
          }
      }
    }
    return this;
  }

  tagDoIife(tokenIndex) {
    var tok;
    tok = this.tokens[tokenIndex != null ? tokenIndex : this.tokens.length - 1];
    if ((tok != null ? tok[0] : void 0) !== 'DO') {
      return this;
    }
    tok[0] = 'DO_IIFE';
    return this;
  }

  closeIndentation() {
    return this.outdentToken({
      moveOut: this.indent,
      indentSize: 0
    });
  }

  matchWithInterpolations(regex, delimiter, closingDelimiter = delimiter, interpolators = /^#\{/) {
    var braceInterpolator, close, column, index, interpolationOffset, interpolator, line, match, nested, offset, offsetInChunk, open, ref, ref1, rest, str, strPart, tokens;
    tokens = [];
    offsetInChunk = delimiter.length;
    if (this.chunk.slice(0, offsetInChunk) !== delimiter) {
      return null;
    }
    str = this.chunk.slice(offsetInChunk);
    while (true) {
      [strPart] = regex.exec(str);
      this.validateEscapes(strPart, {
        isRegex: delimiter.charAt(0) === '/',
        offsetInChunk
      });
      tokens.push(this.makeToken('NEOSTRING', strPart, {
        offset: offsetInChunk
      }));
      str = str.slice(strPart.length);
      offsetInChunk += strPart.length;
      if (!(match = interpolators.exec(str))) {
        break;
      }
      [interpolator] = match;
      interpolationOffset = interpolator.length - 1;
      [line, column, offset] = this.getLineAndColumnFromChunk(offsetInChunk + interpolationOffset);
      rest = str.slice(interpolationOffset);
      ({
        tokens: nested,
        index
      } = new Lexer().tokenize(rest, {
        line,
        column,
        offset,
        untilBalanced: true,
        locationDataCompensations: this.locationDataCompensations
      }));
      index += interpolationOffset;
      braceInterpolator = str[index - 1] === '}';
      if (braceInterpolator) {
        [open] = nested, [close] = slice.call(nested, -1);
        open[0] = 'INTERPOLATION_START';
        open[1] = '(';
        open[2].first_column -= interpolationOffset;
        open[2].range = [open[2].range[0] - interpolationOffset, open[2].range[1]];
        close[0] = 'INTERPOLATION_END';
        close[1] = ')';
        close.origin = ['', 'end of interpolation', close[2]];
      }
      if (((ref = nested[1]) != null ? ref[0] : void 0) === 'TERMINATOR') {
        nested.splice(1, 1);
      }
      if (((ref1 = nested[nested.length - 3]) != null ? ref1[0] : void 0) === 'INDENT' && nested[nested.length - 2][0] === 'OUTDENT') {
        nested.splice(-3, 2);
      }
      if (!braceInterpolator) {
        open = this.makeToken('INTERPOLATION_START', '(', {
          offset: offsetInChunk,
          length: 0,
          generated: true
        });
        close = this.makeToken('INTERPOLATION_END', ')', {
          offset: offsetInChunk + index,
          length: 0,
          generated: true
        });
        nested = [open, ...nested, close];
      }
      tokens.push(['TOKENS', nested]);
      str = str.slice(index);
      offsetInChunk += index;
    }
    if (str.slice(0, closingDelimiter.length) !== closingDelimiter) {
      this.error(`missing ${closingDelimiter}`, {
        length: delimiter.length
      });
    }
    return {
      tokens,
      index: offsetInChunk + closingDelimiter.length
    };
  }

  mergeInterpolationTokens(tokens, options, fn) {
    var $, converted, double, endOffset, firstIndex, heregex, i, indent, j, k, lastToken, len, len1, locationToken, lparen, placeholderToken, quote, ref, ref1, rparen, tag, token, tokensToPush, val, value;
    ({quote, indent, double, heregex, endOffset} = options);
    if (tokens.length > 1) {
      lparen = this.token('STRING_START', '(', {
        length: (ref = quote != null ? quote.length : void 0) != null ? ref : 0,
        data: {quote},
        generated: !(quote != null ? quote.length : void 0)
      });
    }
    firstIndex = this.tokens.length;
    $ = tokens.length - 1;
    for (i = j = 0, len = tokens.length; j < len; i = ++j) {
      token = tokens[i];
      [tag, value] = token;
      switch (tag) {
        case 'TOKENS':
          if (value.length === 2 && (value[0].comments || value[1].comments)) {
            placeholderToken = this.makeToken('JS', '', {
              generated: true
            });
            placeholderToken[2] = value[0][2];
            for (k = 0, len1 = value.length; k < len1; k++) {
              val = value[k];
              if (!val.comments) {
                continue;
              }
              if (placeholderToken.comments == null) {
                placeholderToken.comments = [];
              }
              placeholderToken.comments.push(...val.comments);
            }
            value.splice(1, 0, placeholderToken);
          }
          locationToken = value[0];
          tokensToPush = value;
          break;
        case 'NEOSTRING':
          converted = fn.call(this, token[1], i);
          if (i === 0) {
            addTokenData(token, {
              initialChunk: true
            });
          }
          if (i === $) {
            addTokenData(token, {
              finalChunk: true
            });
          }
          addTokenData(token, {indent, quote, double});
          if (heregex) {
            addTokenData(token, {heregex});
          }
          token[0] = 'STRING';
          token[1] = '"' + converted + '"';
          if (tokens.length === 1 && (quote != null)) {
            token[2].first_column -= quote.length;
            if (token[1].substr(-2, 1) === '\n') {
              token[2].last_line += 1;
              token[2].last_column = quote.length - 1;
            } else {
              token[2].last_column += quote.length;
              if (token[1].length === 2) {
                token[2].last_column -= 1;
              }
            }
            token[2].last_column_exclusive += quote.length;
            token[2].range = [token[2].range[0] - quote.length, token[2].range[1] + quote.length];
          }
          locationToken = token;
          tokensToPush = [token];
      }
      this.tokens.push(...tokensToPush);
    }
    if (lparen) {
      [lastToken] = slice.call(tokens, -1);
      lparen.origin = [
        'STRING',
        null,
        {
          first_line: lparen[2].first_line,
          first_column: lparen[2].first_column,
          last_line: lastToken[2].last_line,
          last_column: lastToken[2].last_column,
          last_line_exclusive: lastToken[2].last_line_exclusive,
          last_column_exclusive: lastToken[2].last_column_exclusive,
          range: [lparen[2].range[0],
        lastToken[2].range[1]]
        }
      ];
      if (!(quote != null ? quote.length : void 0)) {
        lparen[2] = lparen.origin[2];
      }
      return rparen = this.token('STRING_END', ')', {
        offset: endOffset - (quote != null ? quote : '').length,
        length: (ref1 = quote != null ? quote.length : void 0) != null ? ref1 : 0,
        generated: !(quote != null ? quote.length : void 0)
      });
    }
  }

  pair(tag) {
    var lastIndent, prev, ref, ref1, wanted;
    ref = this.ends, [prev] = slice.call(ref, -1);
    if (tag !== (wanted = prev != null ? prev.tag : void 0)) {
      if ('OUTDENT' !== wanted) {
        this.error(`unmatched ${tag}`);
      }
      ref1 = this.indents, [lastIndent] = slice.call(ref1, -1);
      this.outdentToken({
        moveOut: lastIndent,
        noNewlines: true
      });
      return this.pair(tag);
    }
    return this.ends.pop();
  }

  getLocationDataCompensation(start, end) {
    var compensation, current, initialEnd, totalCompensation;
    totalCompensation = 0;
    initialEnd = end;
    current = start;
    while (current <= end) {
      if (current === end && start !== initialEnd) {
        break;
      }
      compensation = this.locationDataCompensations[current];
      if (compensation != null) {
        totalCompensation += compensation;
        end += compensation;
      }
      current++;
    }
    return totalCompensation;
  }

  getLineAndColumnFromChunk(offset) {
    var column, columnCompensation, compensation, lastLine, lineCount, previousLinesCompensation, ref, string;
    compensation = this.getLocationDataCompensation(this.chunkOffset, this.chunkOffset + offset);
    if (offset === 0) {
      return [this.chunkLine, this.chunkColumn + compensation, this.chunkOffset + compensation];
    }
    if (offset >= this.chunk.length) {
      string = this.chunk;
    } else {
      string = this.chunk.slice(0, +(offset - 1) + 1 || 9e9);
    }
    lineCount = count(string, '\n');
    column = this.chunkColumn;
    if (lineCount > 0) {
      ref = string.split('\n'), [lastLine] = slice.call(ref, -1);
      column = lastLine.length;
      previousLinesCompensation = this.getLocationDataCompensation(this.chunkOffset, this.chunkOffset + offset - column);
      if (previousLinesCompensation < 0) {
        previousLinesCompensation = 0;
      }
      columnCompensation = this.getLocationDataCompensation(this.chunkOffset + offset + previousLinesCompensation - column, this.chunkOffset + offset + previousLinesCompensation);
    } else {
      column += string.length;
      columnCompensation = compensation;
    }
    return [this.chunkLine + lineCount, column + columnCompensation, this.chunkOffset + offset + compensation];
  }

  makeLocationData({offsetInChunk, length}) {
    var endOffset, lastCharacter, locationData;
    locationData = {
      range: []
    };
    [locationData.first_line, locationData.first_column, locationData.range[0]] = this.getLineAndColumnFromChunk(offsetInChunk);
    lastCharacter = length > 0 ? length - 1 : 0;
    [locationData.last_line, locationData.last_column, endOffset] = this.getLineAndColumnFromChunk(offsetInChunk + lastCharacter);
    [locationData.last_line_exclusive, locationData.last_column_exclusive] = this.getLineAndColumnFromChunk(offsetInChunk + lastCharacter + (length > 0 ? 1 : 0));
    locationData.range[1] = length > 0 ? endOffset + 1 : endOffset;
    return locationData;
  }

  makeToken(tag, value, {
      offset: offsetInChunk = 0,
      length = value.length,
      origin,
      generated,
      indentSize
    } = {}) {
    var token;
    token = [tag, value, this.makeLocationData({offsetInChunk, length})];
    if (origin) {
      token.origin = origin;
    }
    if (generated) {
      token.generated = true;
    }
    if (indentSize != null) {
      token.indentSize = indentSize;
    }
    return token;
  }

  token(tag, value, {offset, length, origin, data, generated, indentSize} = {}) {
    var token;
    token = this.makeToken(tag, value, {offset, length, origin, generated, indentSize});
    if (data) {
      addTokenData(token, data);
    }
    this.tokens.push(token);
    return token;
  }

  tag() {
    var ref, token;
    ref = this.tokens, [token] = slice.call(ref, -1);
    return token != null ? token[0] : void 0;
  }

  value(useOrigin = false) {
    var ref, token;
    ref = this.tokens, [token] = slice.call(ref, -1);
    if (useOrigin && ((token != null ? token.origin : void 0) != null)) {
      return token.origin[1];
    } else {
      return token != null ? token[1] : void 0;
    }
  }

  prev() {
    return this.tokens[this.tokens.length - 1];
  }

  unfinished() {
    var ref;
    return LINE_CONTINUER.test(this.chunk) || (ref = this.tag(), indexOf.call(UNFINISHED, ref) >= 0);
  }

  validateUnicodeCodePointEscapes(str, options) {
    return replaceUnicodeCodePointEscapes(str, merge(options, {error: this.error}));
  }

  validateEscapes(str, options = {}) {
    var before, hex, invalidEscape, invalidEscapeRegex, match, message, octal, ref, unicode, unicodeCodePoint;
    invalidEscapeRegex = options.isRegex ? REGEX_INVALID_ESCAPE : STRING_INVALID_ESCAPE;
    match = invalidEscapeRegex.exec(str);
    if (!match) {
      return;
    }
    match[0], before = match[1], octal = match[2], hex = match[3], unicodeCodePoint = match[4], unicode = match[5];
    message = octal ? "octal escape sequences are not allowed" : "invalid escape sequence";
    invalidEscape = `\\${octal || hex || unicodeCodePoint || unicode}`;
    return this.error(`${message} ${invalidEscape}`, {
      offset: ((ref = options.offsetInChunk) != null ? ref : 0) + match.index + before.length,
      length: invalidEscape.length
    });
  }

  suppressSemicolons() {
    var ref, ref1, results;
    results = [];
    while (this.value() === ';') {
      this.tokens.pop();
      if (ref = (ref1 = this.prev()) != null ? ref1[0] : void 0, indexOf.call(['=', ...UNFINISHED], ref) >= 0) {
        results.push(this.error('unexpected ;'));
      } else {
        results.push(void 0);
      }
    }
    return results;
  }

  error(message, options = {}) {
    var first_column, first_line, location, ref, ref1;
    location = 'first_line' in options ? options : ([first_line, first_column] = this.getLineAndColumnFromChunk((ref = options.offset) != null ? ref : 0), {
      first_line,
      first_column,
      last_column: first_column + ((ref1 = options.length) != null ? ref1 : 1) - 1
    });
    return throwSyntaxError(message, location);
  }

};

isUnassignable = function(name, displayName = name) {
  switch (false) {
    case indexOf.call([...JS_KEYWORDS, ...COFFEE_KEYWORDS], name) < 0:
      return `keyword '${displayName}' can't be assigned`;
    case indexOf.call(STRICT_PROSCRIBED, name) < 0:
      return `'${displayName}' can't be assigned`;
    case indexOf.call(RESERVED, name) < 0:
      return `reserved word '${displayName}' can't be assigned`;
    default:
      return false;
  }
};

export {
  isUnassignable
};

isForFrom = function(prev) {
  var ref;
  if (prev[0] === 'IDENTIFIER') {
    return true;
  } else if (prev[0] === 'FOR') {
    return false;
  } else if ((ref = prev[1]) === '{' || ref === '[' || ref === ',' || ref === ':') {
    return false;
  } else {
    return true;
  }
};

addTokenData = function(token, data) {
  return Object.assign((token.data != null ? token.data : token.data = {}), data);
};

JS_KEYWORDS = ['true', 'false', 'null', 'this', 'new', 'delete', 'typeof', 'in', 'instanceof', 'return', 'throw', 'break', 'continue', 'debugger', 'yield', 'await', 'if', 'else', 'switch', 'for', 'while', 'do', 'try', 'catch', 'finally', 'class', 'extends', 'super', 'import', 'export', 'default'];

COFFEE_KEYWORDS = ['undefined', 'Infinity', 'NaN', 'then', 'unless', 'until', 'loop', 'of', 'by', 'when'];

COFFEE_ALIAS_MAP = {
  and: '&&',
  or: '||',
  is: '==',
  isnt: '!=',
  not: '!',
  yes: 'true',
  no: 'false',
  on: 'true',
  off: 'false'
};

COFFEE_ALIASES = (function() {
  var results;
  results = [];
  for (key in COFFEE_ALIAS_MAP) {
    results.push(key);
  }
  return results;
})();

COFFEE_KEYWORDS = COFFEE_KEYWORDS.concat(COFFEE_ALIASES);

RESERVED = ['case', 'function', 'var', 'void', 'with', 'const', 'let', 'enum', 'native', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'static'];

STRICT_PROSCRIBED = ['arguments', 'eval'];

export var JS_FORBIDDEN = JS_KEYWORDS.concat(RESERVED).concat(STRICT_PROSCRIBED);

BOM = 65279;

IDENTIFIER = /^(?!\d)((?:(?!\s)[$\w\x7f-\uffff])+!?)([^\n\S]*:(?!:))?/;

NUMBER = /^0b[01](?:_?[01])*n?|^0o[0-7](?:_?[0-7])*n?|^0x[\da-f](?:_?[\da-f])*n?|^\d+(?:_\d+)*n|^(?:\d+(?:_\d+)*)?\.?\d+(?:_\d+)*(?:e[+-]?\d+(?:_\d+)*)?/i;

OPERATOR = /^(?:[-=]>|=~|[-+*\/%<>&|^!?=]=|>>>=?|([-+:])\1|([&|<>*\/%])\2=?|\?(\.|::)|\.{2,3})/;

WHITESPACE = /^[^\n\S]+/;

COMMENT = /^(\s*)###([^#][\s\S]*?)(?:###([^\n\S]*)|###$)|^((?:\s*#(?!##[^#]).*)+)/;

CODE = /^[-=]>/;

MULTI_DENT = /^(?:\n[^\n\S]*)+/;

JSTOKEN = /^`(?!``)((?:[^`\\]|\\[\s\S])*)`/;

HERE_JSTOKEN = /^```((?:[^`\\]|\\[\s\S]|`(?!``))*)```/;

STRING_START = /^(?:'''|"""|'|")/;

STRING_SINGLE = /^(?:[^\\']|\\[\s\S])*/;

STRING_DOUBLE = /^(?:[^\\"#]|\\[\s\S]|\#(?!\{))*/;

HEREDOC_SINGLE = /^(?:[^\\']|\\[\s\S]|'(?!''))*/;

HEREDOC_DOUBLE = /^(?:[^\\"#]|\\[\s\S]|"(?!"")|\#(?!\{))*/;

HEREDOC_INDENT = /\n+([^\n\S]*)(?=\S)/g;

REGEX = /^\/(?!\/)((?:[^[\/\n\\]|\\[^\n]|\[(?:\\[^\n]|[^\]\n\\])*\])*)(\/)?/;

REGEX_FLAGS = /^\w*/;

VALID_FLAGS = /^(?!.*(.).*\1)[gimsuy]*$/;

HEREGEX = /^(?:[^\\\/#\s]|\\[\s\S]|\/(?!\/\/)|\#(?!\{)|\s+(?:#(?!\{).*)?)*/;

HEREGEX_COMMENT = /(\s+)(#(?!{).*)/gm;

REGEX_ILLEGAL = /^(\/|\/{3}\s*)(\*)/;

POSSIBLY_DIVISION = /^\/=?\s/;

HERECOMMENT_ILLEGAL = /\*\//;

LINE_CONTINUER = /^\s*(?:,|\??\.(?![.\d])|\??::)/;

STRING_INVALID_ESCAPE = /((?:^|[^\\])(?:\\\\)*)\\(?:(0\d|[1-7])|(x(?![\da-fA-F]{2}).{0,2})|(u\{(?![\da-fA-F]{1,}\})[^}]*\}?)|(u(?!\{|[\da-fA-F]{4}).{0,4}))/;

REGEX_INVALID_ESCAPE = /((?:^|[^\\])(?:\\\\)*)\\(?:(0\d)|(x(?![\da-fA-F]{2}).{0,2})|(u\{(?![\da-fA-F]{1,}\})[^}]*\}?)|(u(?!\{|[\da-fA-F]{4}).{0,4}))/;

TRAILING_SPACES = /\s+$/;

COMPOUND_ASSIGN = ['-=', '+=', '/=', '*=', '%=', '||=', '&&=', '?=', '<<=', '>>=', '>>>=', '&=', '^=', '|=', '**=', '//=', '%%='];

UNARY = ['NEW', 'TYPEOF', 'DELETE'];

UNARY_MATH = ['!', '~'];

SHIFT = ['<<', '>>', '>>>'];

COMPARE = ['==', '!=', '<', '>', '<=', '>=', '=~'];

MATH = ['*', '/', '%', '//', '%%'];

RELATION = ['IN', 'OF', 'INSTANCEOF'];

BOOL = ['TRUE', 'FALSE'];

CALLABLE = ['IDENTIFIER', 'PROPERTY', ')', ']', '?', '@', 'THIS', 'SUPER', 'DYNAMIC_IMPORT'];

INDEXABLE = CALLABLE.concat(['NUMBER', 'INFINITY', 'NAN', 'STRING', 'STRING_END', 'REGEX', 'REGEX_END', 'BOOL', 'NULL', 'UNDEFINED', '}', '::']);

COMPARABLE_LEFT_SIDE = ['IDENTIFIER', ')', ']', 'NUMBER'];

NOT_REGEX = INDEXABLE.concat(['++', '--']);

LINE_BREAK = ['INDENT', 'OUTDENT', 'TERMINATOR'];

INDENTABLE_CLOSERS = [')', '}', ']'];
