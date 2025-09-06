
var BALANCED_PAIRS, CALL_CLOSERS, CONTROL_IN_IMPLICIT, DISCARDED, EXPRESSION_CLOSE, EXPRESSION_END, EXPRESSION_START, IMPLICIT_CALL, IMPLICIT_END, IMPLICIT_FUNC, IMPLICIT_UNSPACED_CALL, LINEBREAKS, SINGLE_CLOSERS, SINGLE_LINERS, generate, k, left, len, moveComments, right,
  indexOf = [].indexOf,
  hasProp = {}.hasOwnProperty;

import {
  throwSyntaxError,
  extractAllCommentTokens
} from './helpers.js';

moveComments = function(fromToken, toToken) {
  var comment, k, len, ref, unshiftedComments;
  if (!fromToken.comments) {
    return;
  }
  if (toToken.comments && toToken.comments.length !== 0) {
    unshiftedComments = [];
    ref = fromToken.comments;
    for (k = 0, len = ref.length; k < len; k++) {
      comment = ref[k];
      if (comment.unshift) {
        unshiftedComments.push(comment);
      } else {
        toToken.comments.push(comment);
      }
    }
    toToken.comments = unshiftedComments.concat(toToken.comments);
  } else {
    toToken.comments = fromToken.comments;
  }
  return delete fromToken.comments;
};

generate = function(tag, value, origin, commentsToken) {
  var token;
  token = [tag, value];
  token.generated = true;
  if (origin) {
    token.origin = origin;
  }
  if (commentsToken) {
    moveComments(commentsToken, token);
  }
  return token;
};

export var Rewriter = (function() {
  class Rewriter {
    rewrite(tokens1) {
      var ref, ref1, t;
      this.tokens = tokens1;
      if (typeof process !== "undefined" && process !== null ? (ref = process.env) != null ? ref.DEBUG_TOKEN_STREAM : void 0 : void 0) {
        if (process.env.DEBUG_REWRITTEN_TOKEN_STREAM) {
          console.log('Initial token stream:');
        }
        console.log(((function() {
          var k, len, ref1, results;
          ref1 = this.tokens;
          results = [];
          for (k = 0, len = ref1.length; k < len; k++) {
            t = ref1[k];
            results.push(t[0] + '/' + t[1] + (t.comments ? '*' : ''));
          }
          return results;
        }).call(this)).join(' '));
      }
      this.removeLeadingNewlines();
      this.closeOpenCalls();
      this.closeOpenIndexes();
      this.normalizeLines();
      this.tagPostfixConditionals();
      this.addImplicitBracesAndParens();
      this.rescueStowawayComments();
      this.addLocationDataToGeneratedTokens();
      this.fixIndentationLocationData();
      this.exposeTokenDataToGrammar();
      if (typeof process !== "undefined" && process !== null ? (ref1 = process.env) != null ? ref1.DEBUG_REWRITTEN_TOKEN_STREAM : void 0 : void 0) {
        if (process.env.DEBUG_TOKEN_STREAM) {
          console.log('Rewritten token stream:');
        }
        console.log(((function() {
          var k, len, ref2, results;
          ref2 = this.tokens;
          results = [];
          for (k = 0, len = ref2.length; k < len; k++) {
            t = ref2[k];
            results.push(t[0] + '/' + t[1] + (t.comments ? '*' : ''));
          }
          return results;
        }).call(this)).join(' '));
      }
      return this.tokens;
    }

    scanTokens(block) {
      var i, token, tokens;
      ({tokens} = this);
      i = 0;
      while (token = tokens[i]) {
        i += block.call(this, token, i, tokens);
      }
      return true;
    }

    detectEnd(i, condition, action, opts = {}) {
      var levels, ref, ref1, token, tokens;
      ({tokens} = this);
      levels = 0;
      while (token = tokens[i]) {
        if (levels === 0 && condition.call(this, token, i)) {
          return action.call(this, token, i);
        }
        if (ref = token[0], indexOf.call(EXPRESSION_START, ref) >= 0) {
          levels += 1;
        } else if (ref1 = token[0], indexOf.call(EXPRESSION_END, ref1) >= 0) {
          levels -= 1;
        }
        if (levels < 0) {
          if (opts.returnOnNegativeLevel) {
            return;
          }
          return action.call(this, token, i);
        }
        i += 1;
      }
      return i - 1;
    }

    removeLeadingNewlines() {
      var i, k, l, leadingNewlineToken, len, len1, ref, ref1, tag;
      ref = this.tokens;
      for (i = k = 0, len = ref.length; k < len; i = ++k) {
        [tag] = ref[i];
        if (tag !== 'TERMINATOR') {
          break;
        }
      }
      if (i === 0) {
        return;
      }
      ref1 = this.tokens.slice(0, i);
      for (l = 0, len1 = ref1.length; l < len1; l++) {
        leadingNewlineToken = ref1[l];
        moveComments(leadingNewlineToken, this.tokens[i]);
      }
      return this.tokens.splice(0, i);
    }

    closeOpenCalls() {
      var action, condition;
      condition = function(token, i) {
        var ref;
        return (ref = token[0]) === ')' || ref === 'CALL_END';
      };
      action = function(token, i) {
        return token[0] = 'CALL_END';
      };
      return this.scanTokens(function(token, i) {
        if (token[0] === 'CALL_START') {
          this.detectEnd(i + 1, condition, action);
        }
        return 1;
      });
    }

    closeOpenIndexes() {
      var action, condition, startToken;
      startToken = null;
      condition = function(token, i) {
        var ref;
        return (ref = token[0]) === ']' || ref === 'INDEX_END';
      };
      action = function(token, i) {
        if (this.tokens.length >= i && this.tokens[i + 1][0] === ':') {
          startToken[0] = '[';
          return token[0] = ']';
        } else {
          return token[0] = 'INDEX_END';
        }
      };
      return this.scanTokens(function(token, i) {
        if (token[0] === 'INDEX_START') {
          startToken = token;
          this.detectEnd(i + 1, condition, action);
        }
        return 1;
      });
    }

    indexOfTag(i, ...pattern) {
      var fuzz, j, k, ref, ref1;
      fuzz = 0;
      for (j = k = 0, ref = pattern.length; (0 <= ref ? k < ref : k > ref); j = 0 <= ref ? ++k : --k) {
        if (pattern[j] == null) {
          continue;
        }
        if (typeof pattern[j] === 'string') {
          pattern[j] = [pattern[j]];
        }
        if (ref1 = this.tag(i + j + fuzz), indexOf.call(pattern[j], ref1) < 0) {
          return -1;
        }
      }
      return i + j + fuzz - 1;
    }

    looksObjectish(j) {
      var end, index;
      if (this.indexOfTag(j, '@', null, ':') !== -1 || this.indexOfTag(j, null, ':') !== -1) {
        return true;
      }
      index = this.indexOfTag(j, EXPRESSION_START);
      if (index !== -1) {
        end = null;
        this.detectEnd(index + 1, (function(token) {
          var ref;
          return ref = token[0], indexOf.call(EXPRESSION_END, ref) >= 0;
        }), (function(token, i) {
          return end = i;
        }));
        if (this.tag(end + 1) === ':') {
          return true;
        }
      }
      return false;
    }

    findTagsBackwards(i, tags) {
      var backStack, ref, ref1, ref2, ref3, ref4, ref5;
      backStack = [];
      while (i >= 0 && (backStack.length || (ref2 = this.tag(i), indexOf.call(tags, ref2) < 0) && ((ref3 = this.tag(i), indexOf.call(EXPRESSION_START, ref3) < 0) || this.tokens[i].generated) && (ref4 = this.tag(i), indexOf.call(LINEBREAKS, ref4) < 0))) {
        if (ref = this.tag(i), indexOf.call(EXPRESSION_END, ref) >= 0) {
          backStack.push(this.tag(i));
        }
        if ((ref1 = this.tag(i), indexOf.call(EXPRESSION_START, ref1) >= 0) && backStack.length) {
          backStack.pop();
        }
        i -= 1;
      }
      return ref5 = this.tag(i), indexOf.call(tags, ref5) >= 0;
    }

    addImplicitBracesAndParens() {
      var stack, start;
      stack = [];
      start = null;
      return this.scanTokens(function(token, i, tokens) {
        var endImplicitCall, endImplicitObject, forward, implicitObjectContinues, implicitObjectIndent, inControlFlow, inImplicit, inImplicitCall, inImplicitControl, inImplicitObject, isImplicit, isImplicitCall, isImplicitObject, k, newLine, nextTag, nextToken, offset, preContinuationLineIndent, preObjectToken, prevTag, prevToken, ref, ref1, ref2, ref3, ref4, ref5, s, sameLine, stackIdx, stackItem, stackNext, stackTag, stackTop, startIdx, startImplicitCall, startImplicitObject, startIndex, startTag, startsLine, tag;
        [tag] = token;
        [prevTag] = prevToken = i > 0 ? tokens[i - 1] : [];
        [nextTag] = nextToken = i < tokens.length - 1 ? tokens[i + 1] : [];
        stackTop = function() {
          return stack[stack.length - 1];
        };
        startIdx = i;
        forward = function(n) {
          return i - startIdx + n;
        };
        isImplicit = function(stackItem) {
          var ref;
          return stackItem != null ? (ref = stackItem[2]) != null ? ref.ours : void 0 : void 0;
        };
        isImplicitObject = function(stackItem) {
          return isImplicit(stackItem) && (stackItem != null ? stackItem[0] : void 0) === '{';
        };
        isImplicitCall = function(stackItem) {
          return isImplicit(stackItem) && (stackItem != null ? stackItem[0] : void 0) === '(';
        };
        inImplicit = function() {
          return isImplicit(stackTop());
        };
        inImplicitCall = function() {
          return isImplicitCall(stackTop());
        };
        inImplicitObject = function() {
          return isImplicitObject(stackTop());
        };
        inImplicitControl = function() {
          var ref;
          return inImplicit() && ((ref = stackTop()) != null ? ref[0] : void 0) === 'CONTROL';
        };
        startImplicitCall = function(idx) {
          stack.push([
            '(',
            idx,
            {
              ours: true
            }
          ]);
          return tokens.splice(idx, 0, generate('CALL_START', '(', ['', 'implicit function call', token[2]], prevToken));
        };
        endImplicitCall = function() {
          stack.pop();
          tokens.splice(i, 0, generate('CALL_END', ')', ['', 'end of input', token[2]], prevToken));
          return i += 1;
        };
        startImplicitObject = function(idx, {startsLine = true, continuationLineIndent} = {}) {
          var val;
          stack.push([
            '{',
            idx,
            {
              sameLine: true,
              startsLine: startsLine,
              ours: true,
              continuationLineIndent: continuationLineIndent
            }
          ]);
          val = new String('{');
          val.generated = true;
          return tokens.splice(idx, 0, generate('{', val, token, prevToken));
        };
        endImplicitObject = function(j) {
          j = j != null ? j : i;
          stack.pop();
          tokens.splice(j, 0, generate('}', '}', token, prevToken));
          return i += 1;
        };
        implicitObjectContinues = (j) => {
          var nextTerminatorIdx;
          nextTerminatorIdx = null;
          this.detectEnd(j, function(token) {
            return token[0] === 'TERMINATOR';
          }, function(token, i) {
            return nextTerminatorIdx = i;
          }, {
            returnOnNegativeLevel: true
          });
          if (nextTerminatorIdx == null) {
            return false;
          }
          return this.looksObjectish(nextTerminatorIdx + 1);
        };
        if ((inImplicitCall() || inImplicitObject()) && indexOf.call(CONTROL_IN_IMPLICIT, tag) >= 0 || inImplicitObject() && prevTag === ':' && tag === 'FOR') {
          stack.push([
            'CONTROL',
            i,
            {
              ours: true
            }
          ]);
          return forward(1);
        }
        if (tag === 'INDENT' && inImplicit()) {
          if (prevTag !== '=>' && prevTag !== '->' && prevTag !== '[' && prevTag !== '(' && prevTag !== ',' && prevTag !== '{' && prevTag !== 'ELSE' && prevTag !== '=') {
            while (inImplicitCall() || inImplicitObject() && prevTag !== ':') {
              if (inImplicitCall()) {
                endImplicitCall();
              } else {
                endImplicitObject();
              }
            }
          }
          if (inImplicitControl()) {
            stack.pop();
          }
          stack.push([tag, i]);
          return forward(1);
        }
        if (indexOf.call(EXPRESSION_START, tag) >= 0) {
          stack.push([tag, i]);
          return forward(1);
        }
        if (indexOf.call(EXPRESSION_END, tag) >= 0) {
          while (inImplicit()) {
            if (inImplicitCall()) {
              endImplicitCall();
            } else if (inImplicitObject()) {
              endImplicitObject();
            } else {
              stack.pop();
            }
          }
          start = stack.pop();
        }
        inControlFlow = () => {
          var controlFlow, isFunc, seenFor, tagCurrentLine;
          seenFor = this.findTagsBackwards(i, ['FOR']) && this.findTagsBackwards(i, ['FORIN', 'FOROF', 'FORFROM']);
          controlFlow = seenFor || this.findTagsBackwards(i, ['WHILE', 'UNTIL', 'LOOP', 'LEADING_WHEN']);
          if (!controlFlow) {
            return false;
          }
          isFunc = false;
          tagCurrentLine = token[2].first_line;
          this.detectEnd(i, function(token, i) {
            var ref;
            return ref = token[0], indexOf.call(LINEBREAKS, ref) >= 0;
          }, function(token, i) {
            var first_line;
            [prevTag, , {first_line}] = tokens[i - 1] || [];
            return isFunc = tagCurrentLine === first_line && (prevTag === '->' || prevTag === '=>');
          }, {
            returnOnNegativeLevel: true
          });
          return isFunc;
        };
        if ((indexOf.call(IMPLICIT_FUNC, tag) >= 0 && token.spaced || tag === '?' && i > 0 && !tokens[i - 1].spaced) && (indexOf.call(IMPLICIT_CALL, nextTag) >= 0 || (nextTag === '...' && (ref = this.tag(i + 2), indexOf.call(IMPLICIT_CALL, ref) >= 0) && !this.findTagsBackwards(i, ['INDEX_START', '['])) || indexOf.call(IMPLICIT_UNSPACED_CALL, nextTag) >= 0 && !nextToken.spaced && !nextToken.newLine) && !inControlFlow()) {
          if (tag === '?') {
            tag = token[0] = 'FUNC_EXIST';
          }
          startImplicitCall(i + 1);
          return forward(2);
        }
        if (indexOf.call(IMPLICIT_FUNC, tag) >= 0 && this.indexOfTag(i + 1, 'INDENT') > -1 && this.looksObjectish(i + 2) && !this.findTagsBackwards(i, ['CLASS', 'EXTENDS', 'IF', 'CATCH', 'SWITCH', 'LEADING_WHEN', 'FOR', 'WHILE', 'UNTIL']) && !(((ref1 = (s = (ref2 = stackTop()) != null ? ref2[0] : void 0)) === '{' || ref1 === '[') && !isImplicit(stackTop()) && this.findTagsBackwards(i, s))) {
          startImplicitCall(i + 1);
          stack.push(['INDENT', i + 2]);
          return forward(3);
        }
        if (tag === ':') {
          s = (function() {
            var ref3;
            switch (false) {
              case ref3 = this.tag(i - 1), indexOf.call(EXPRESSION_END, ref3) < 0:
                [startTag, startIndex] = start;
                if (startTag === '[' && startIndex > 0 && this.tag(startIndex - 1) === '@' && !tokens[startIndex - 1].spaced) {
                  return startIndex - 1;
                } else {
                  return startIndex;
                }
                break;
              case this.tag(i - 2) !== '@':
                return i - 2;
              default:
                return i - 1;
            }
          }).call(this);
          startsLine = s <= 0 || (ref3 = this.tag(s - 1), indexOf.call(LINEBREAKS, ref3) >= 0) || tokens[s - 1].newLine;
          if (stackTop()) {
            [stackTag, stackIdx] = stackTop();
            stackNext = stack[stack.length - 2];
            if ((stackTag === '{' || stackTag === 'INDENT' && (stackNext != null ? stackNext[0] : void 0) === '{' && !isImplicit(stackNext) && this.findTagsBackwards(stackIdx - 1, ['{'])) && (startsLine || this.tag(s - 1) === ',' || this.tag(s - 1) === '{') && (ref4 = this.tag(s - 1), indexOf.call(UNFINISHED, ref4) < 0)) {
              return forward(1);
            }
          }
          preObjectToken = i > 1 ? tokens[i - 2] : [];
          startImplicitObject(s, {
            startsLine: !!startsLine,
            continuationLineIndent: preObjectToken.continuationLineIndent
          });
          return forward(2);
        }
        if (indexOf.call(LINEBREAKS, tag) >= 0) {
          for (k = stack.length - 1; k >= 0; k += -1) {
            stackItem = stack[k];
            if (!isImplicit(stackItem)) {
              break;
            }
            if (isImplicitObject(stackItem)) {
              stackItem[2].sameLine = false;
            }
          }
        }
        if (tag === 'TERMINATOR' && token.endsContinuationLineIndentation) {
          ({preContinuationLineIndent} = token.endsContinuationLineIndentation);
          while (inImplicitObject() && ((implicitObjectIndent = stackTop()[2].continuationLineIndent) != null) && implicitObjectIndent > preContinuationLineIndent) {
            endImplicitObject();
          }
        }
        newLine = prevTag === 'OUTDENT' || prevToken.newLine;
        if (indexOf.call(IMPLICIT_END, tag) >= 0 || (indexOf.call(CALL_CLOSERS, tag) >= 0 && newLine) || ((tag === '..' || tag === '...') && this.findTagsBackwards(i, ["INDEX_START"]))) {
          while (inImplicit()) {
            [stackTag, stackIdx, {sameLine, startsLine}] = stackTop();
            if (inImplicitCall() && prevTag !== ',' || (prevTag === ',' && tag === 'TERMINATOR' && (nextTag == null))) {
              endImplicitCall();
            } else if (inImplicitObject() && sameLine && tag !== 'TERMINATOR' && prevTag !== ':' && !((tag === 'POST_IF' || tag === 'FOR' || tag === 'WHILE' || tag === 'UNTIL') && startsLine && implicitObjectContinues(i + 1))) {
              endImplicitObject();
            } else if (inImplicitObject() && tag === 'TERMINATOR' && prevTag !== ',' && !(startsLine && this.looksObjectish(i + 1))) {
              endImplicitObject();
            } else if (inImplicitControl() && tokens[stackTop()[1]][0] === 'CLASS' && tag === 'TERMINATOR') {
              stack.pop();
            } else {
              break;
            }
          }
        }
        if (tag === ',' && !this.looksObjectish(i + 1) && inImplicitObject() && !((ref5 = this.tag(i + 2)) === 'FOROF' || ref5 === 'FORIN') && (nextTag !== 'TERMINATOR' || !this.looksObjectish(i + 2))) {
          offset = nextTag === 'OUTDENT' ? 1 : 0;
          while (inImplicitObject()) {
            endImplicitObject(i + offset);
          }
        }
        return forward(1);
      });
    }

    rescueStowawayComments() {
      var dontShiftForward, insertPlaceholder, shiftCommentsBackward, shiftCommentsForward;
      insertPlaceholder = function(token, j, tokens, method) {
        if (tokens[j][0] !== 'TERMINATOR') {
          tokens[method](generate('TERMINATOR', '\n', tokens[j]));
        }
        return tokens[method](generate('JS', '', tokens[j], token));
      };
      dontShiftForward = function(i, tokens) {
        var j, ref;
        j = i + 1;
        while (j !== tokens.length && (ref = tokens[j][0], indexOf.call(DISCARDED, ref) >= 0)) {
          if (tokens[j][0] === 'INTERPOLATION_END') {
            return true;
          }
          j++;
        }
        return false;
      };
      shiftCommentsForward = function(token, i, tokens) {
        var comment, j, k, len, ref, ref1, ref2;
        j = i;
        while (j !== tokens.length && (ref = tokens[j][0], indexOf.call(DISCARDED, ref) >= 0)) {
          j++;
        }
        if (!(j === tokens.length || (ref1 = tokens[j][0], indexOf.call(DISCARDED, ref1) >= 0))) {
          ref2 = token.comments;
          for (k = 0, len = ref2.length; k < len; k++) {
            comment = ref2[k];
            comment.unshift = true;
          }
          moveComments(token, tokens[j]);
          return 1;
        } else {
          j = tokens.length - 1;
          insertPlaceholder(token, j, tokens, 'push');
          return 1;
        }
      };
      shiftCommentsBackward = function(token, i, tokens) {
        var j, ref, ref1;
        j = i;
        while (j !== -1 && (ref = tokens[j][0], indexOf.call(DISCARDED, ref) >= 0)) {
          j--;
        }
        if (!(j === -1 || (ref1 = tokens[j][0], indexOf.call(DISCARDED, ref1) >= 0))) {
          moveComments(token, tokens[j]);
          return 1;
        } else {
          insertPlaceholder(token, 0, tokens, 'unshift');
          return 3;
        }
      };
      return this.scanTokens(function(token, i, tokens) {
        var dummyToken, j, ref, ref1, ret;
        if (!token.comments) {
          return 1;
        }
        ret = 1;
        if (ref = token[0], indexOf.call(DISCARDED, ref) >= 0) {
          dummyToken = {
            comments: []
          };
          j = token.comments.length - 1;
          while (j !== -1) {
            if (token.comments[j].newLine === false && token.comments[j].here === false) {
              dummyToken.comments.unshift(token.comments[j]);
              token.comments.splice(j, 1);
            }
            j--;
          }
          if (dummyToken.comments.length !== 0) {
            ret = shiftCommentsBackward(dummyToken, i - 1, tokens);
          }
          if (token.comments.length !== 0) {
            shiftCommentsForward(token, i, tokens);
          }
        } else if (!dontShiftForward(i, tokens)) {
          dummyToken = {
            comments: []
          };
          j = token.comments.length - 1;
          while (j !== -1) {
            if (token.comments[j].newLine && !token.comments[j].unshift && !(token[0] === 'JS' && token.generated)) {
              dummyToken.comments.unshift(token.comments[j]);
              token.comments.splice(j, 1);
            }
            j--;
          }
          if (dummyToken.comments.length !== 0) {
            ret = shiftCommentsForward(dummyToken, i + 1, tokens);
          }
        }
        if (((ref1 = token.comments) != null ? ref1.length : void 0) === 0) {
          delete token.comments;
        }
        return ret;
      });
    }

    addLocationDataToGeneratedTokens() {
      return this.scanTokens(function(token, i, tokens) {
        var column, line, nextLocation, prevLocation, rangeIndex, ref, ref1;
        if (token[2]) {
          return 1;
        }
        if (!(token.generated || token.explicit)) {
          return 1;
        }
        if (token.fromThen && token[0] === 'INDENT') {
          token[2] = token.origin[2];
          return 1;
        }
        if (token[0] === '{' && (nextLocation = (ref = tokens[i + 1]) != null ? ref[2] : void 0)) {
          ({
            first_line: line,
            first_column: column,
            range: [rangeIndex]
          } = nextLocation);
        } else if (prevLocation = (ref1 = tokens[i - 1]) != null ? ref1[2] : void 0) {
          ({
            last_line: line,
            last_column: column,
            range: [, rangeIndex]
          } = prevLocation);
          column += 1;
        } else {
          line = column = 0;
          rangeIndex = 0;
        }
        token[2] = {
          first_line: line,
          first_column: column,
          last_line: line,
          last_column: column,
          last_line_exclusive: line,
          last_column_exclusive: column,
          range: [rangeIndex, rangeIndex]
        };
        return 1;
      });
    }

    fixIndentationLocationData() {
      var findPrecedingComment;
      if (this.allComments == null) {
        this.allComments = extractAllCommentTokens(this.tokens);
      }
      findPrecedingComment = (token, {afterPosition, indentSize, first, indented}) => {
        var comment, k, l, lastMatching, matches, ref, ref1, tokenStart;
        tokenStart = token[2].range[0];
        matches = function(comment) {
          if (comment.outdented) {
            if (!((indentSize != null) && comment.indentSize > indentSize)) {
              return false;
            }
          }
          if (indented && !comment.indented) {
            return false;
          }
          if (!(comment.locationData.range[0] < tokenStart)) {
            return false;
          }
          if (!(comment.locationData.range[0] > afterPosition)) {
            return false;
          }
          return true;
        };
        if (first) {
          lastMatching = null;
          ref = this.allComments;
          for (k = ref.length - 1; k >= 0; k += -1) {
            comment = ref[k];
            if (matches(comment)) {
              lastMatching = comment;
            } else if (lastMatching) {
              return lastMatching;
            }
          }
          return lastMatching;
        }
        ref1 = this.allComments;
        for (l = ref1.length - 1; l >= 0; l += -1) {
          comment = ref1[l];
          if (matches(comment)) {
            return comment;
          }
        }
        return null;
      };
      return this.scanTokens(function(token, i, tokens) {
        var isIndent, nextToken, nextTokenIndex, precedingComment, prevLocationData, prevToken, ref, ref1, ref2, useNextToken;
        if (!(((ref = token[0]) === 'INDENT' || ref === 'OUTDENT') || (token.generated && token[0] === 'CALL_END' && !((ref1 = token.data) != null ? ref1.closingTagNameToken : void 0)) || (token.generated && token[0] === '}'))) {
          return 1;
        }
        isIndent = token[0] === 'INDENT';
        prevToken = (ref2 = token.prevToken) != null ? ref2 : tokens[i - 1];
        prevLocationData = prevToken[2];
        useNextToken = token.explicit || token.generated;
        if (useNextToken) {
          nextToken = token;
          nextTokenIndex = i;
          while ((nextToken.explicit || nextToken.generated) && nextTokenIndex !== tokens.length - 1) {
            nextToken = tokens[nextTokenIndex++];
          }
        }
        precedingComment = findPrecedingComment(useNextToken ? nextToken : token, {
          afterPosition: prevLocationData.range[0],
          indentSize: token.indentSize,
          first: isIndent,
          indented: useNextToken
        });
        if (isIndent) {
          if (!(precedingComment != null ? precedingComment.newLine : void 0)) {
            return 1;
          }
        }
        if (token.generated && token[0] === 'CALL_END' && (precedingComment != null ? precedingComment.indented : void 0)) {
          return 1;
        }
        if (precedingComment != null) {
          prevLocationData = precedingComment.locationData;
        }
        token[2] = {
          first_line: precedingComment != null ? prevLocationData.first_line : prevLocationData.last_line,
          first_column: precedingComment != null ? isIndent ? 0 : prevLocationData.first_column : prevLocationData.last_column,
          last_line: prevLocationData.last_line,
          last_column: prevLocationData.last_column,
          last_line_exclusive: prevLocationData.last_line_exclusive,
          last_column_exclusive: prevLocationData.last_column_exclusive,
          range: isIndent && (precedingComment != null) ? [prevLocationData.range[0] - precedingComment.indentSize, prevLocationData.range[1]] : prevLocationData.range
        };
        return 1;
      });
    }

    normalizeLines() {
      var action, closeElseTag, condition, ifThens, indent, leading_if_then, leading_switch_when, outdent, starter;
      starter = indent = outdent = null;
      leading_switch_when = null;
      leading_if_then = null;
      ifThens = [];
      condition = function(token, i) {
        var ref, ref1, ref2, ref3;
        return token[1] !== ';' && (ref = token[0], indexOf.call(SINGLE_CLOSERS, ref) >= 0) && !(token[0] === 'TERMINATOR' && (ref1 = this.tag(i + 1), indexOf.call(EXPRESSION_CLOSE, ref1) >= 0)) && !(token[0] === 'ELSE' && (starter !== 'THEN' || (leading_if_then || leading_switch_when))) && !(((ref2 = token[0]) === 'CATCH' || ref2 === 'FINALLY') && (starter === '->' || starter === '=>')) || (ref3 = token[0], indexOf.call(CALL_CLOSERS, ref3) >= 0) && (this.tokens[i - 1].newLine || this.tokens[i - 1][0] === 'OUTDENT');
      };
      action = function(token, i) {
        if (token[0] === 'ELSE' && starter === 'THEN') {
          ifThens.pop();
        }
        return this.tokens.splice((this.tag(i - 1) === ',' ? i - 1 : i), 0, outdent);
      };
      closeElseTag = (tokens, i) => {
        var lastThen, outdentElse, tlen;
        tlen = ifThens.length;
        if (!(tlen > 0)) {
          return i;
        }
        lastThen = ifThens.pop();
        [, outdentElse] = this.indentation(tokens[lastThen]);
        outdentElse[1] = tlen * 2;
        tokens.splice(i, 0, outdentElse);
        outdentElse[1] = 2;
        tokens.splice(i + 1, 0, outdentElse);
        this.detectEnd(i + 2, function(token, i) {
          var ref;
          return (ref = token[0]) === 'OUTDENT' || ref === 'TERMINATOR';
        }, function(token, i) {
          if (this.tag(i) === 'OUTDENT' && this.tag(i + 1) === 'OUTDENT') {
            return tokens.splice(i, 2);
          }
        });
        return i + 2;
      };
      return this.scanTokens(function(token, i, tokens) {
        var conditionTag, j, k, ref, ref1, ref2, tag;
        [tag] = token;
        conditionTag = (tag === '->' || tag === '=>') && this.findTagsBackwards(i, ['IF', 'WHILE', 'FOR', 'UNTIL', 'SWITCH', 'WHEN', 'LEADING_WHEN', '[', 'INDEX_START']) && !(this.findTagsBackwards(i, ['THEN', '..', '...']));
        if (tag === 'TERMINATOR') {
          if (this.tag(i + 1) === 'ELSE' && this.tag(i - 1) !== 'OUTDENT') {
            tokens.splice(i, 1, ...this.indentation());
            return 1;
          }
          if (ref = this.tag(i + 1), indexOf.call(EXPRESSION_CLOSE, ref) >= 0) {
            if (token[1] === ';' && this.tag(i + 1) === 'OUTDENT') {
              tokens[i + 1].prevToken = token;
              moveComments(token, tokens[i + 1]);
            }
            tokens.splice(i, 1);
            return 0;
          }
        }
        if (tag === 'CATCH') {
          for (j = k = 1; k <= 2; j = ++k) {
            if (!((ref1 = this.tag(i + j)) === 'OUTDENT' || ref1 === 'TERMINATOR' || ref1 === 'FINALLY')) {
              continue;
            }
            tokens.splice(i + j, 0, ...this.indentation());
            return 2 + j;
          }
        }
        if ((tag === '->' || tag === '=>') && (((ref2 = this.tag(i + 1)) === ',' || ref2 === ']') || this.tag(i + 1) === '.' && token.newLine)) {
          [indent, outdent] = this.indentation(tokens[i]);
          tokens.splice(i + 1, 0, indent, outdent);
          return 1;
        }
        if (indexOf.call(SINGLE_LINERS, tag) >= 0 && this.tag(i + 1) !== 'INDENT' && !(tag === 'ELSE' && this.tag(i + 1) === 'IF') && !conditionTag) {
          starter = tag;
          [indent, outdent] = this.indentation(tokens[i]);
          if (starter === 'THEN') {
            indent.fromThen = true;
          }
          if (tag === 'THEN') {
            leading_switch_when = this.findTagsBackwards(i, ['LEADING_WHEN']) && this.tag(i + 1) === 'IF';
            leading_if_then = this.findTagsBackwards(i, ['IF']) && this.tag(i + 1) === 'IF';
          }
          if (tag === 'THEN' && this.findTagsBackwards(i, ['IF'])) {
            ifThens.push(i);
          }
          if (tag === 'ELSE' && this.tag(i - 1) !== 'OUTDENT') {
            i = closeElseTag(tokens, i);
          }
          tokens.splice(i + 1, 0, indent);
          this.detectEnd(i + 2, condition, action);
          if (tag === 'THEN') {
            tokens.splice(i, 1);
          }
          return 1;
        }
        return 1;
      });
    }

    tagPostfixConditionals() {
      var action, condition, original;
      original = null;
      condition = function(token, i) {
        var prevTag, tag;
        [tag] = token;
        [prevTag] = this.tokens[i - 1];
        return tag === 'TERMINATOR' || (tag === 'INDENT' && indexOf.call(SINGLE_LINERS, prevTag) < 0);
      };
      action = function(token, i) {
        if (token[0] !== 'INDENT' || (token.generated && !token.fromThen)) {
          return original[0] = 'POST_' + original[0];
        }
      };
      return this.scanTokens(function(token, i) {
        if (token[0] !== 'IF') {
          return 1;
        }
        original = token;
        this.detectEnd(i + 1, condition, action);
        return 1;
      });
    }

    exposeTokenDataToGrammar() {
      return this.scanTokens(function(token, i) {
        var key, ref, ref1, val;
        if (token.generated || (token.data && Object.keys(token.data).length !== 0)) {
          token[1] = new String(token[1]);
          ref1 = (ref = token.data) != null ? ref : {};
          for (key in ref1) {
            if (!hasProp.call(ref1, key)) continue;
            val = ref1[key];
            token[1][key] = val;
          }
          if (token.generated) {
            token[1].generated = true;
          }
        }
        return 1;
      });
    }

    indentation(origin) {
      var indent, outdent;
      indent = ['INDENT', 2];
      outdent = ['OUTDENT', 2];
      if (origin) {
        indent.generated = outdent.generated = true;
        indent.origin = outdent.origin = origin;
      } else {
        indent.explicit = outdent.explicit = true;
      }
      return [indent, outdent];
    }

    tag(i) {
      var ref;
      return (ref = this.tokens[i]) != null ? ref[0] : void 0;
    }

  };

  Rewriter.prototype.generate = generate;

  return Rewriter;

}).call(this);

BALANCED_PAIRS = [['(', ')'], ['[', ']'], ['{', '}'], ['INDENT', 'OUTDENT'], ['CALL_START', 'CALL_END'], ['PARAM_START', 'PARAM_END'], ['INDEX_START', 'INDEX_END'], ['STRING_START', 'STRING_END'], ['INTERPOLATION_START', 'INTERPOLATION_END'], ['REGEX_START', 'REGEX_END']];

export var INVERSES = {};

EXPRESSION_START = [];

EXPRESSION_END = [];

for (k = 0, len = BALANCED_PAIRS.length; k < len; k++) {
  [left, right] = BALANCED_PAIRS[k];
  EXPRESSION_START.push(INVERSES[right] = left);
  EXPRESSION_END.push(INVERSES[left] = right);
}

EXPRESSION_CLOSE = ['CATCH', 'THEN', 'ELSE', 'FINALLY'].concat(EXPRESSION_END);

IMPLICIT_FUNC = ['IDENTIFIER', 'PROPERTY', 'SUPER', ')', 'CALL_END', ']', 'INDEX_END', '@', 'THIS'];

IMPLICIT_CALL = ['IDENTIFIER', 'PROPERTY', 'NUMBER', 'INFINITY', 'NAN', 'STRING', 'STRING_START', 'REGEX', 'REGEX_START', 'JS', 'NEW', 'PARAM_START', 'CLASS', 'IF', 'TRY', 'SWITCH', 'THIS', 'DYNAMIC_IMPORT', 'IMPORT_META', 'NEW_TARGET', 'UNDEFINED', 'NULL', 'BOOL', 'UNARY', 'DO', 'DO_IIFE', 'YIELD', 'AWAIT', 'UNARY_MATH', 'SUPER', 'THROW', '@', '->', '=>', '[', '(', '{', '--', '++'];

IMPLICIT_UNSPACED_CALL = ['+', '-'];

IMPLICIT_END = ['POST_IF', 'FOR', 'WHILE', 'UNTIL', 'WHEN', 'BY', 'LOOP', 'TERMINATOR'];

SINGLE_LINERS = ['ELSE', '->', '=>', 'TRY', 'FINALLY', 'THEN'];

SINGLE_CLOSERS = ['TERMINATOR', 'CATCH', 'FINALLY', 'ELSE', 'OUTDENT', 'LEADING_WHEN'];

LINEBREAKS = ['TERMINATOR', 'INDENT', 'OUTDENT'];

CALL_CLOSERS = ['.', '?.', '::', '?::'];

CONTROL_IN_IMPLICIT = ['IF', 'TRY', 'FINALLY', 'CATCH', 'CLASS', 'SWITCH'];

DISCARDED = ['(', ')', '[', ']', '{', '}', ':', '.', '..', '...', ',', '=', '++', '--', '?', 'AS', 'AWAIT', 'CALL_START', 'CALL_END', 'DEFAULT', 'DO', 'DO_IIFE', 'ELSE', 'EXTENDS', 'EXPORT', 'FORIN', 'FOROF', 'FORFROM', 'IMPORT', 'INDENT', 'INDEX_SOAK', 'INTERPOLATION_START', 'INTERPOLATION_END', 'LEADING_WHEN', 'OUTDENT', 'PARAM_END', 'REGEX_START', 'REGEX_END', 'RETURN', 'STRING_END', 'THROW', 'UNARY', 'YIELD'].concat(IMPLICIT_UNSPACED_CALL.concat(IMPLICIT_END.concat(CALL_CLOSERS.concat(CONTROL_IN_IMPLICIT))));

export var UNFINISHED = ['\\', '.', '?.', '?::', 'UNARY', 'DO', 'DO_IIFE', 'MATH', 'UNARY_MATH', '+', '-', '**', 'SHIFT', 'RELATION', 'COMPARE', '&', '^', '|', '&&', '||', 'BIN?', 'EXTENDS'];
