  // The Rip language has a good deal of optional syntax, implicit syntax,
  // and shorthand syntax. This can greatly complicate a grammar and bloat
  // the resulting parse table. Instead of making the parser handle it all, we take
  // a series of passes over the token stream, using this **Rewriter** to convert
  // shorthand into the unambiguous long form, add implicit indentation and
  // parentheses, and generally clean things up.
let k;
let left;
let len;
let right;

import {
  throwSyntaxError,
  extractAllCommentTokens
} from './helpers.js';

// Move attached comments from one token to another.
const moveComments = (fromToken, toToken) => {
  let comment, k, len, ref, unshiftedComments;
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

// Create a generated token: one that exists due to a use of implicit syntax.
// Optionally have this new token take the attached comments from another token.
const generate = (tag, value, origin, commentsToken) => {
  let token;
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

// The **Rewriter** class is used by the [Lexer](lexer.html), directly against
// its internal array of tokens.
export class Rewriter {
    // Rewrite the token stream in multiple passes, one logical filter at
    // a time. This could certainly be changed into a single pass through the
    // stream, with a big ol' efficient switch, but it's much nicer to work with
    // like this. The order of these passes matters—indentation must be
    // corrected before implicit parentheses can be wrapped around blocks of code.
    rewrite(tokens1) {
      let ref, ref1, t;
      this.tokens = tokens1;
      // Set environment variable `DEBUG_TOKEN_STREAM` to `true` to output token
      // debugging info. Also set `DEBUG_REWRITTEN_TOKEN_STREAM` to `true` to
      // output the token stream after it has been rewritten by this file.
      if (typeof process !== "undefined" && process !== null && process.env?.DEBUG_TOKEN_STREAM) {
        if (process.env.DEBUG_REWRITTEN_TOKEN_STREAM) {
          console.log('Initial token stream:');
        }
        console.log(((function() {
          let k, len, ref1, results;
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
      if (typeof process !== "undefined" && process !== null && process.env?.DEBUG_REWRITTEN_TOKEN_STREAM) {
        if (process.env.DEBUG_TOKEN_STREAM) {
          console.log('Rewritten token stream:');
        }
        console.log(((function() {
          let k, len, ref2, results;
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

    // Rewrite the token stream, looking one token ahead and behind.
    // Allow the return value of the block to tell us how many tokens to move
    // forwards (or backwards) in the stream, to make sure we don't miss anything
    // as tokens are inserted and removed, and the stream changes length under
    // our feet.
    scanTokens(block) {
      let i, token, tokens;
      ({tokens} = this);
      i = 0;
      while (token = tokens[i]) {
        i += block.call(this, token, i, tokens);
      }
      return true;
    }

    detectEnd(i, condition, action, opts = {}) {
      let levels, ref, ref1, token, tokens;
      ({tokens} = this);
      levels = 0;
      while (token = tokens[i]) {
        if (levels === 0 && condition.call(this, token, i)) {
          return action.call(this, token, i);
        }
        if (ref = token[0], EXPRESSION_START.includes(ref)) {
          levels += 1;
        } else if (ref1 = token[0], EXPRESSION_END.includes(ref1)) {
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

    // Leading newlines would introduce an ambiguity in the grammar, so we
    // dispatch them here.
    removeLeadingNewlines() {
      let i, k, l, leadingNewlineToken, len, len1, ref, ref1, tag;
      ref = this.tokens;
      for (i = k = 0, len = ref.length; k < len; i = ++k) {
        [tag] = ref[i];
        if (tag !== 'TERMINATOR') {
          // Find the index of the first non-`TERMINATOR` token.
          break;
        }
      }
      if (i === 0) {
        return;
      }
      ref1 = this.tokens.slice(0, i);
      // If there are any comments attached to the tokens we're about to discard,
      // shift them forward to what will become the new first token.
      for (l = 0, len1 = ref1.length; l < len1; l++) {
        leadingNewlineToken = ref1[l];
        moveComments(leadingNewlineToken, this.tokens[i]);
      }
      // Discard all the leading newline tokens.
      return this.tokens.splice(0, i);
    }

    // The lexer has tagged the opening parenthesis of a method call. Match it with
    // its paired close.
    closeOpenCalls() {
      let action, condition;
      condition = (token, i) => {
        let ref;
        return (ref = token[0]) === ')' || ref === 'CALL_END';
      };
      action = (token, i) => {
        return token[0] = 'CALL_END';
      };
      return this.scanTokens(function(token, i) {
        if (token[0] === 'CALL_START') {
          this.detectEnd(i + 1, condition, action);
        }
        return 1;
      });
    }

    // The lexer has tagged the opening bracket of an indexing operation call.
    // Match it with its paired close.
    closeOpenIndexes() {
      let action, condition, startToken;
      startToken = null;
      condition = (token, i) => {
        let ref;
        return (ref = token[0]) === ']' || ref === 'INDEX_END';
      };
      action = (token, i) => {
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

    // Match tags in token stream starting at `i` with `pattern`.
    // `pattern` may consist of strings (equality), an array of strings (one of)
    // or null (wildcard). Returns the index of the match or -1 if no match.
    indexOfTag(i, ...pattern) {
      let fuzz, j, k, ref, ref1;
      fuzz = 0;
      for (j = k = 0, ref = pattern.length; (0 <= ref ? k < ref : k > ref); j = 0 <= ref ? ++k : --k) {
        if (pattern[j] == null) {
          continue;
        }
        if (typeof pattern[j] === 'string') {
          pattern[j] = [pattern[j]];
        }
        if (ref1 = this.tag(i + j + fuzz), !pattern[j].includes(ref1)) {
          return -1;
        }
      }
      return i + j + fuzz - 1;
    }

    // Returns `yes` if standing in front of something looking like
    // `@<x>:`, `<x>:` or `<EXPRESSION_START><x>...<EXPRESSION_END>:`.
    looksObjectish(j) {
      let end, index;
      if (this.indexOfTag(j, '@', null, ':') !== -1 || this.indexOfTag(j, null, ':') !== -1) {
        return true;
      }
      index = this.indexOfTag(j, EXPRESSION_START);
      if (index !== -1) {
        end = null;
        this.detectEnd(index + 1, (function(token) {
          let ref;
          return ref = token[0], EXPRESSION_END.includes(ref);
        }), (function(token, i) {
          return end = i;
        }));
        if (this.tag(end + 1) === ':') {
          return true;
        }
      }
      return false;
    }

    // Returns `yes` if current line of tokens contain an element of tags on same
    // expression level. Stop searching at `LINEBREAKS` or explicit start of
    // containing balanced expression.
    findTagsBackwards(i, tags) {
      let backStack, ref, ref1, ref2, ref3, ref4, ref5;
      backStack = [];
      while (i >= 0 && (backStack.length || (ref2 = this.tag(i), !tags.includes(ref2)) && ((ref3 = this.tag(i), !EXPRESSION_START.includes(ref3)) || this.tokens[i].generated) && (ref4 = this.tag(i), !LINEBREAKS.includes(ref4)))) {
        if (ref = this.tag(i), EXPRESSION_END.includes(ref)) {
          backStack.push(this.tag(i));
        }
        if ((ref1 = this.tag(i), EXPRESSION_START.includes(ref1)) && backStack.length) {
          backStack.pop();
        }
        i -= 1;
      }
      return ref5 = this.tag(i), tags.includes(ref5);
    }

    // Look for signs of implicit calls and objects in the token stream and
    // add them.
    addImplicitBracesAndParens() {
      let stack, start;
      // Track current balancing depth (both implicit and explicit) on stack.
      stack = [];
      start = null;
      return this.scanTokens(function(token, i, tokens) {
        let endImplicitCall, endImplicitObject, forward, implicitObjectContinues, implicitObjectIndent, inControlFlow, inImplicit, inImplicitCall, inImplicitControl, inImplicitObject, isImplicit, isImplicitCall, isImplicitObject, k, newLine, nextTag, nextToken, offset, preContinuationLineIndent, preObjectToken, prevTag, prevToken, ref, ref1, ref2, ref3, ref4, ref5, s, sameLine, stackIdx, stackItem, stackNext, stackTag, stackTop, startIdx, startImplicitCall, startImplicitObject, startIndex, startTag, startsLine, tag;
        [tag] = token;
        [prevTag] = prevToken = i > 0 ? tokens[i - 1] : [];
        [nextTag] = nextToken = i < tokens.length - 1 ? tokens[i + 1] : [];
        stackTop = () => {
          return stack[stack.length - 1];
        };
        startIdx = i;
        // Helper function, used for keeping track of the number of tokens consumed
        // and spliced, when returning for getting a new token.
        forward = (n) => {
          return i - startIdx + n;
        };
        // Helper functions
        isImplicit = (stackItem) => {
          let ref;
          return stackItem != null ? (stackItem[2] != null) ? ref.ours : void 0 : void 0;
        };
        isImplicitObject = (stackItem) => {
          return isImplicit(stackItem) && (stackItem != null ? stackItem[0] : void 0) === '{';
        };
        isImplicitCall = (stackItem) => {
          return isImplicit(stackItem) && (stackItem != null ? stackItem[0] : void 0) === '(';
        };
        inImplicit = () => {
          return isImplicit(stackTop());
        };
        inImplicitCall = () => {
          return isImplicitCall(stackTop());
        };
        inImplicitObject = () => {
          return isImplicitObject(stackTop());
        };
        // Unclosed control statement inside implicit parens (like
        // class declaration or if-conditionals).
        inImplicitControl = () => {
          let ref;
          return inImplicit() && ((ref = stackTop()) != null ? ref[0] : void 0) === 'CONTROL';
        };
        startImplicitCall = (idx) => {
          stack.push([
            '(',
            idx,
            {
              ours: true
            }
          ]);
          return tokens.splice(idx, 0, generate('CALL_START', '(', ['', 'implicit function call', token[2]], prevToken));
        };
        endImplicitCall = () => {
          stack.pop();
          tokens.splice(i, 0, generate('CALL_END', ')', ['', 'end of input', token[2]], prevToken));
          return i += 1;
        };
        startImplicitObject = (idx, {startsLine = true, continuationLineIndent} = {}) => {
          let val;
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
        endImplicitObject = (j) => {
          j = j != null ? j : i;
          stack.pop();
          tokens.splice(j, 0, generate('}', '}', token, prevToken));
          return i += 1;
        };
        implicitObjectContinues = (j) => {
          let nextTerminatorIdx;
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
        // Don't end an implicit call/object on next indent if any of these are in an argument/value.
        if ((inImplicitCall() || inImplicitObject()) && CONTROL_IN_IMPLICIT.includes(tag) || inImplicitObject() && prevTag === ':' && tag === 'FOR') {
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
          // An `INDENT` closes an implicit call unless

          //  1. We have seen a `CONTROL` argument on the line.
          //  2. The last token before the indent is part of the list below.
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
        // Straightforward start of explicit expression.
        if (EXPRESSION_START.includes(tag)) {
          stack.push([tag, i]);
          return forward(1);
        }
        // Close all implicit expressions inside of explicitly closed expressions.
        if (EXPRESSION_END.includes(tag)) {
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
          let controlFlow, isFunc, seenFor, tagCurrentLine;
          seenFor = this.findTagsBackwards(i, ['FOR']) && this.findTagsBackwards(i, ['FORIN', 'FOROF', 'FORFROM']);
          controlFlow = seenFor || this.findTagsBackwards(i, ['WHILE', 'UNTIL', 'LOOP', 'LEADING_WHEN']);
          if (!controlFlow) {
            return false;
          }
          isFunc = false;
          tagCurrentLine = token[2].first_line;
          this.detectEnd(i, function(token, i) {
            let ref;
            return ref = token[0], LINEBREAKS.includes(ref);
          }, function(token, i) {
            let first_line;
            [prevTag, , {first_line}] = tokens[i - 1] || [];
            return isFunc = tagCurrentLine === first_line && (prevTag === '->' || prevTag === '=>');
          }, {
            returnOnNegativeLevel: true
          });
          return isFunc;
        };
        // Recognize standard implicit calls like
        // f a, f() b, f? c, h[0] d etc.
        // Added support for spread dots on the left side: f ...a
        if ((IMPLICIT_FUNC.includes(tag) && token.spaced || tag === '?' && i > 0 && !tokens[i - 1].spaced) && (IMPLICIT_CALL.includes(nextTag) || (nextTag === '...' && (ref = this.tag(i + 2), IMPLICIT_CALL.includes(ref)) && !this.findTagsBackwards(i, ['INDEX_START', '['])) || IMPLICIT_UNSPACED_CALL.includes(nextTag) && !nextToken.spaced && !nextToken.newLine) && !inControlFlow()) {
          if (tag === '?') {
            tag = token[0] = 'FUNC_EXIST';
          }
          startImplicitCall(i + 1);
          return forward(2);
        }
        // Implicit call taking an implicit indented object as first argument.

        //     f
        //       a: b
        //       c: d

        // Don't accept implicit calls of this type, when on the same line
        // as the control structures below as that may misinterpret constructs like:

        //     if f
        //        a: 1
        // as

        //     if f(a: 1)

        // which is probably always unintended.
        // Furthermore don't allow this in the first line of a literal array
        // or explicit object, as that creates grammatical ambiguities (#5368).
        if (IMPLICIT_FUNC.includes(tag) && this.indexOfTag(i + 1, 'INDENT') > -1 && this.looksObjectish(i + 2) && !this.findTagsBackwards(i, ['CLASS', 'EXTENDS', 'IF', 'CATCH', 'SWITCH', 'LEADING_WHEN', 'FOR', 'WHILE', 'UNTIL']) && !(((ref1 = (s = (ref2 = stackTop()) != null ? ref2[0] : void 0)) === '{' || ref1 === '[') && !isImplicit(stackTop()) && this.findTagsBackwards(i, s))) {
          startImplicitCall(i + 1);
          stack.push(['INDENT', i + 2]);
          return forward(3);
        }
        // Implicit objects start here.
        if (tag === ':') {
          // Go back to the (implicit) start of the object.
          s = (function() {
            let ref3;
            switch (false) {
              case ref3 = this.tag(i - 1), !EXPRESSION_END.includes(ref3):
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
          startsLine = s <= 0 || (ref3 = this.tag(s - 1), LINEBREAKS.includes(ref3)) || tokens[s - 1].newLine;
          // Are we just continuing an already declared object?
          // Including the case where we indent on the line after an explicit '{'.
          if (stackTop()) {
            [stackTag, stackIdx] = stackTop();
            stackNext = stack[stack.length - 2];
            if ((stackTag === '{' || stackTag === 'INDENT' && (stackNext != null ? stackNext[0] : void 0) === '{' && !isImplicit(stackNext) && this.findTagsBackwards(stackIdx - 1, ['{'])) && (startsLine || this.tag(s - 1) === ',' || this.tag(s - 1) === '{') && (ref4 = this.tag(s - 1), !UNFINISHED.includes(ref4))) {
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
        // End implicit calls when chaining method calls
        // like e.g.:

        //     f ->
        //       a
        //     .g b, ->
        //       c
        //     .h a

        // and also

        //     f a
        //     .g b
        //     .h a

        // Mark all enclosing objects as not sameLine
        if (LINEBREAKS.includes(tag)) {
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
        // End indented-continuation-line implicit objects once that indentation is over.
        if (tag === 'TERMINATOR' && token.endsContinuationLineIndentation) {
          ({preContinuationLineIndent} = token.endsContinuationLineIndentation);
          while (inImplicitObject() && ((implicitObjectIndent = stackTop()[2].continuationLineIndent) != null) && implicitObjectIndent > preContinuationLineIndent) {
            endImplicitObject();
          }
        }
        newLine = prevTag === 'OUTDENT' || prevToken.newLine;
        if (IMPLICIT_END.includes(tag) || (CALL_CLOSERS.includes(tag) && newLine) || ((tag === '..' || tag === '...') && this.findTagsBackwards(i, ["INDEX_START"]))) {
          while (inImplicit()) {
            [stackTag, stackIdx, {sameLine, startsLine}] = stackTop();
            // Close implicit calls when reached end of argument list
            if (inImplicitCall() && prevTag !== ',' || (prevTag === ',' && tag === 'TERMINATOR' && (nextTag == null))) {
              endImplicitCall();
            // Close implicit objects such as:
            // return a: 1, b: 2 unless true
            } else if (inImplicitObject() && sameLine && tag !== 'TERMINATOR' && prevTag !== ':' && !((tag === 'POST_IF' || tag === 'FOR' || tag === 'WHILE' || tag === 'UNTIL') && startsLine && implicitObjectContinues(i + 1))) {
              endImplicitObject();
            // Close implicit objects when at end of line, line didn't end with a comma
            // and the implicit object didn't start the line or the next line doesn't look like
            // the continuation of an object.
            } else if (inImplicitObject() && tag === 'TERMINATOR' && prevTag !== ',' && !(startsLine && this.looksObjectish(i + 1))) {
              endImplicitObject();
            } else if (inImplicitControl() && tokens[stackTop()[1]][0] === 'CLASS' && tag === 'TERMINATOR') {
              stack.pop();
            } else {
              break;
            }
          }
        }
        // Close implicit object if comma is the last character
        // and what comes after doesn't look like it belongs.
        // This is used for trailing commas and calls, like:

        //     x =
        //         a: b,
        //         c: d,
        //     e = 2

        // and

        //     f a, b: c, d: e, f, g: h: i, j

        if (tag === ',' && !this.looksObjectish(i + 1) && inImplicitObject() && !((ref5 = this.tag(i + 2)) === 'FOROF' || ref5 === 'FORIN') && (nextTag !== 'TERMINATOR' || !this.looksObjectish(i + 2))) {
          // When nextTag is OUTDENT the comma is insignificant and
          // should just be ignored so embed it in the implicit object.

          // When it isn't the comma go on to play a role in a call or
          // array further up the stack, so give it a chance.
          offset = nextTag === 'OUTDENT' ? 1 : 0;
          while (inImplicitObject()) {
            endImplicitObject(i + offset);
          }
        }
        return forward(1);
      });
    }

    // Not all tokens survive processing by the parser. To avoid comments getting
    // lost into the ether, find comments attached to doomed tokens and move them
    // to a token that will make it to the other side.
    rescueStowawayComments() {
      let dontShiftForward, insertPlaceholder, shiftCommentsBackward, shiftCommentsForward;
      insertPlaceholder = (token, j, tokens, method) => {
        if (tokens[j][0] !== 'TERMINATOR') {
          tokens[method](generate('TERMINATOR', '\n', tokens[j]));
        }
        return tokens[method](generate('JS', '', tokens[j], token));
      };
      dontShiftForward = (i, tokens) => {
        let j, ref;
        j = i + 1;
        while (j !== tokens.length && (ref = tokens[j][0], DISCARDED.includes(ref))) {
          if (tokens[j][0] === 'INTERPOLATION_END') {
            return true;
          }
          j++;
        }
        return false;
      };
      shiftCommentsForward = (token, i, tokens) => {
        let comment, j, k, len, ref, ref1, ref2;
        // Find the next surviving token and attach this token's comments to it,
        // with a flag that we know to output such comments *before* that
        // token's own compilation. (Otherwise comments are output following
        // the token they're attached to.)
        j = i;
        while (j !== tokens.length && (ref = tokens[j][0], DISCARDED.includes(ref))) {
          j++;
        }
        if (!(j === tokens.length || (ref1 = tokens[j][0], DISCARDED.includes(ref1)))) {
          ref2 = token.comments;
          for (k = 0, len = ref2.length; k < len; k++) {
            comment = ref2[k];
            comment.unshift = true;
          }
          moveComments(token, tokens[j]);
          return 1; // All following tokens are doomed!
        } else {
          j = tokens.length - 1;
          insertPlaceholder(token, j, tokens, 'push');
          // The generated tokens were added to the end, not inline, so we don't skip.
          return 1;
        }
      };
      shiftCommentsBackward = (token, i, tokens) => {
        let j, ref, ref1;
        // Find the last surviving token and attach this token's comments to it.
        j = i;
        while (j !== -1 && (ref = tokens[j][0], DISCARDED.includes(ref))) {
          j--;
        }
        if (!(j === -1 || (ref1 = tokens[j][0], DISCARDED.includes(ref1)))) {
          moveComments(token, tokens[j]);
          return 1; // All previous tokens are doomed!
        } else {
          insertPlaceholder(token, 0, tokens, 'unshift');
          // We added two tokens, so shift forward to account for the insertion.
          return 3;
        }
      };
      return this.scanTokens(function(token, i, tokens) {
        let dummyToken, j, ref, ref1, ret;
        if (!token.comments) {
          return 1;
        }
        ret = 1;
        if (ref = token[0], DISCARDED.includes(ref)) {
          // This token won't survive passage through the parser, so we need to
          // rescue its attached tokens and redistribute them to nearby tokens.
          // Comments that don't start a new line can shift backwards to the last
          // safe token, while other tokens should shift forward.
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
          // If any of this token's comments start a line—there's only
          // whitespace between the preceding newline and the start of the
          // comment—and this isn't one of the special `JS` tokens, then
          // shift this comment forward to precede the next valid token.
          // `Block.compileComments` also has logic to make sure that
          // "starting new line" comments follow or precede the nearest
          // newline relative to the token that the comment is attached to,
          // but that newline might be inside a `}` or `)` or other generated
          // token that we really want this comment to output after. Therefore
          // we need to shift the comments here, avoiding such generated and
          // discarded tokens.
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
        if (((token.comments != null) ? ref1.length : void 0) === 0) {
          delete token.comments;
        }
        return ret;
      });
    }

    // Add location data to all tokens generated by the rewriter.
    addLocationDataToGeneratedTokens() {
      return this.scanTokens(function(token, i, tokens) {
        let column, line, nextLocation, prevLocation, rangeIndex, ref, ref1;
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
        if (token[0] === '{' && (nextLocation = (tokens[i + 1] != null) ? ref[2] : void 0)) {
          ({
            first_line: line,
            first_column: column,
            range: [rangeIndex]
          } = nextLocation);
        } else if (prevLocation = (tokens[i - 1] != null) ? ref1[2] : void 0) {
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

    // `OUTDENT` tokens should always be positioned at the last character of the
    // previous token, so that AST nodes ending in an `OUTDENT` token end up with a
    // location corresponding to the last "real" token under the node.
    fixIndentationLocationData() {
      let findPrecedingComment;
      if (this.allComments == null) {
        this.allComments = extractAllCommentTokens(this.tokens);
      }
      findPrecedingComment = (token, {afterPosition, indentSize, first, indented}) => {
        let comment, k, l, lastMatching, matches, ref, ref1, tokenStart;
        tokenStart = token[2].range[0];
        matches = (comment) => {
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
        let isIndent, nextToken, nextTokenIndex, precedingComment, prevLocationData, prevToken, ref, ref1, ref2, useNextToken;
        if (!(((ref = token[0]) === 'INDENT' || ref === 'OUTDENT') || (token.generated && token[0] === 'CALL_END' && !((token.data != null) ? ref1.closingTagNameToken : void 0)) || (token.generated && token[0] === '}'))) {
          return 1;
        }
        isIndent = token[0] === 'INDENT';
        prevToken = token.prevToken ?? tokens[i - 1];
        prevLocationData = prevToken[2];
        // addLocationDataToGeneratedTokens()) set the outdent's location data
        // to the preceding token's, but in order to detect comments inside an
        // empty "block" we want to look for comments preceding the next token.
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
          // We don't want e.g. an implicit call at the end of an `if` condition to
          // include a following indented comment.
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

    // Because our grammar is LALR(1), it can't handle some single-line
    // expressions that lack ending delimiters. The **Rewriter** adds the implicit
    // blocks, so it doesn't need to. To keep the grammar clean and tidy, trailing
    // newlines within expressions are removed and the indentation tokens of empty
    // blocks are added.
    normalizeLines() {
      let action, closeElseTag, condition, ifThens, indent, leading_if_then, leading_switch_when, outdent, starter;
      starter = indent = outdent = null;
      leading_switch_when = null;
      leading_if_then = null;
      // Count `THEN` tags
      ifThens = [];
      condition = (token, i) => {
        let ref, ref1, ref2, ref3;
        return token[1] !== ';' && (ref = token[0], SINGLE_CLOSERS.includes(ref)) && !(token[0] === 'TERMINATOR' && (ref1 = this.tag(i + 1), EXPRESSION_CLOSE.includes(ref1))) && !(token[0] === 'ELSE' && (starter !== 'THEN' || (leading_if_then || leading_switch_when))) && !(((ref2 = token[0]) === 'CATCH' || ref2 === 'FINALLY') && (starter === '->' || starter === '=>')) || (ref3 = token[0], CALL_CLOSERS.includes(ref3)) && (this.tokens[i - 1].newLine || this.tokens[i - 1][0] === 'OUTDENT');
      };
      action = (token, i) => {
        if (token[0] === 'ELSE' && starter === 'THEN') {
          ifThens.pop();
        }
        return this.tokens.splice((this.tag(i - 1) === ',' ? i - 1 : i), 0, outdent);
      };
      closeElseTag = (tokens, i) => {
        let lastThen, outdentElse, tlen;
        tlen = ifThens.length;
        if (!(tlen > 0)) {
          return i;
        }
        lastThen = ifThens.pop();
        [, outdentElse] = this.indentation(tokens[lastThen]);
        // Insert `OUTDENT` to close inner `IF`.
        outdentElse[1] = tlen * 2;
        tokens.splice(i, 0, outdentElse);
        // Insert `OUTDENT` to close outer `IF`.
        outdentElse[1] = 2;
        tokens.splice(i + 1, 0, outdentElse);
        // Remove outdents from the end.
        this.detectEnd(i + 2, function(token, i) {
          let ref;
          return (ref = token[0]) === 'OUTDENT' || ref === 'TERMINATOR';
        }, function(token, i) {
          if (this.tag(i) === 'OUTDENT' && this.tag(i + 1) === 'OUTDENT') {
            return tokens.splice(i, 2);
          }
        });
        return i + 2;
      };
      return this.scanTokens(function(token, i, tokens) {
        let conditionTag, j, k, ref, ref1, ref2, tag;
        [tag] = token;
        conditionTag = (tag === '->' || tag === '=>') && this.findTagsBackwards(i, ['IF', 'WHILE', 'FOR', 'UNTIL', 'SWITCH', 'WHEN', 'LEADING_WHEN', '[', 'INDEX_START']) && !(this.findTagsBackwards(i, ['THEN', '..', '...']));
        if (tag === 'TERMINATOR') {
          if (this.tag(i + 1) === 'ELSE' && this.tag(i - 1) !== 'OUTDENT') {
            tokens.splice(i, 1, ...this.indentation());
            return 1;
          }
          if (ref = this.tag(i + 1), EXPRESSION_CLOSE.includes(ref)) {
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
        if (SINGLE_LINERS.includes(tag) && this.tag(i + 1) !== 'INDENT' && !(tag === 'ELSE' && this.tag(i + 1) === 'IF') && !conditionTag) {
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
          // `ELSE` tag is not closed.
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

    // Tag postfix conditionals as such, so that we can parse them with a
    // different precedence.
    tagPostfixConditionals() {
      let action, condition, original;
      original = null;
      condition = (token, i) => {
        let prevTag, tag;
        [tag] = token;
        [prevTag] = this.tokens[i - 1];
        return tag === 'TERMINATOR' || (tag === 'INDENT' && !SINGLE_LINERS.includes(prevTag));
      };
      action = (token, i) => {
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

    // For tokens with extra data, we want to make that data visible to the grammar
    // by wrapping the token value as a String() object and setting the data as
    // properties of that object. The grammar should then be responsible for
    // cleaning this up for the node constructor: unwrapping the token value to a
    // primitive string and separately passing any expected token data properties
    exposeTokenDataToGrammar() {
      return this.scanTokens(function(token, i) {
        let key, ref, ref1, val;
        if (token.generated || (token.data && Object.keys(token.data).length !== 0)) {
          token[1] = new String(token[1]);
          ref1 = token.data ?? {};
          for (key in ref1) {
            if (!Object.prototype.hasOwnProperty.call(ref1, key)) continue;
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

    // Generate the indentation tokens, based on another token on the same line.
    indentation(origin) {
      let indent, outdent;
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

    // Look up a tag by token index.
    tag(i) {
      return (this.tokens[i] != null) ? this.tokens[i][0] : void 0;
    }
}

// Constants
// ---------

// List of the token pairs that must be balanced.
const BALANCED_PAIRS = [['(', ')'], ['[', ']'], ['{', '}'], ['INDENT', 'OUTDENT'], ['CALL_START', 'CALL_END'], ['PARAM_START', 'PARAM_END'], ['INDEX_START', 'INDEX_END'], ['STRING_START', 'STRING_END'], ['INTERPOLATION_START', 'INTERPOLATION_END'], ['REGEX_START', 'REGEX_END']];

// The inverse mappings of `BALANCED_PAIRS` we're trying to fix up, so we can
// look things up from either end.
export let INVERSES = {};

// The tokens that signal the start/end of a balanced pair.
const EXPRESSION_START = [];

const EXPRESSION_END = [];

for (k = 0, len = BALANCED_PAIRS.length; k < len; k++) {
  [left, right] = BALANCED_PAIRS[k];
  EXPRESSION_START.push(INVERSES[right] = left);
  EXPRESSION_END.push(INVERSES[left] = right);
}

// Tokens that indicate the close of a clause of an expression.
const EXPRESSION_CLOSE = ['CATCH', 'THEN', 'ELSE', 'FINALLY'].concat(EXPRESSION_END);

// Tokens that, if followed by an `IMPLICIT_CALL`, indicate a function invocation.
const IMPLICIT_FUNC = ['IDENTIFIER', 'PROPERTY', 'SUPER', ')', 'CALL_END', ']', 'INDEX_END', '@', 'THIS'];

// If preceded by an `IMPLICIT_FUNC`, indicates a function invocation.
const IMPLICIT_CALL = ['IDENTIFIER', 'PROPERTY', 'NUMBER', 'INFINITY', 'NAN', 'STRING', 'STRING_START', 'REGEX', 'REGEX_START', 'JS', 'NEW', 'PARAM_START', 'CLASS', 'IF', 'TRY', 'SWITCH', 'THIS', 'DYNAMIC_IMPORT', 'IMPORT_META', 'NEW_TARGET', 'UNDEFINED', 'NULL', 'BOOL', 'UNARY', 'DO', 'DO_IIFE', 'YIELD', 'AWAIT', 'UNARY_MATH', 'SUPER', 'THROW', '@', '->', '=>', '[', '(', '{', '--', '++'];

const IMPLICIT_UNSPACED_CALL = ['+', '-'];

// Tokens that always mark the end of an implicit call for single-liners.
const IMPLICIT_END = ['POST_IF', 'FOR', 'WHILE', 'UNTIL', 'WHEN', 'BY', 'LOOP', 'TERMINATOR'];

// Single-line flavors of block expressions that have unclosed endings.
// The grammar can't disambiguate them, so we insert the implicit indentation.
const SINGLE_LINERS = ['ELSE', '->', '=>', 'TRY', 'FINALLY', 'THEN'];

const SINGLE_CLOSERS = ['TERMINATOR', 'CATCH', 'FINALLY', 'ELSE', 'OUTDENT', 'LEADING_WHEN'];

// Tokens that end a line.
const LINEBREAKS = ['TERMINATOR', 'INDENT', 'OUTDENT'];

// Tokens that close open calls when they follow a newline.
const CALL_CLOSERS = ['.', '?.', '::', '?::'];

// Tokens that prevent a subsequent indent from ending implicit calls/objects
const CONTROL_IN_IMPLICIT = ['IF', 'TRY', 'FINALLY', 'CATCH', 'CLASS', 'SWITCH'];

// Tokens that are swallowed up by the parser, never leading to code generation.
const DISCARDED = ['(', ')', '[', ']', '{', '}', ':', '.', '..', '...', ',', '=', '++', '--', '?', 'AS', 'AWAIT', 'CALL_START', 'CALL_END', 'DEFAULT', 'DO', 'DO_IIFE', 'ELSE', 'EXTENDS', 'EXPORT', 'FORIN', 'FOROF', 'FORFROM', 'IMPORT', 'INDENT', 'INDEX_SOAK', 'INTERPOLATION_START', 'INTERPOLATION_END', 'LEADING_WHEN', 'OUTDENT', 'PARAM_END', 'REGEX_START', 'REGEX_END', 'RETURN', 'STRING_END', 'THROW', 'UNARY', 'YIELD'].concat(IMPLICIT_UNSPACED_CALL.concat(IMPLICIT_END.concat(CALL_CLOSERS.concat(CONTROL_IN_IMPLICIT))));

// Tokens that, when appearing at the end of a line, suppress a following TERMINATOR/INDENT token
export let UNFINISHED = ['\\', '.', '?.', '?::', 'UNARY', 'DO', 'DO_IIFE', 'MATH', 'UNARY_MATH', '+', '-', '**', 'SHIFT', 'RELATION', 'COMPARE', '&', '^', '|', '&&', '||', 'BIN?', 'EXTENDS'];
