  // This file contains the common helper functions that we'd like to share among
  // the **Lexer**, **Rewriter**, and the **Nodes**. Merge objects, flatten
  // arrays, count characters, that sort of thing.

// Peek at the beginning of a given string to see if it matches a sequence.
export const starts = (string, literal, start) => {
  return literal === string.substr(start, literal.length);
};

// Peek at the end of a given string to see if it matches a sequence.
export const ends = (string, literal, back) => {
  let len;
  len = literal.length;
  return literal === string.substr(string.length - len - (back || 0), len);
};

// Repeat a string `n` times.
export const repeat = (str, n) => {
  let res;
  // Use clever algorithm to have O(log(n)) string concatenation operations.
  res = '';
  while (n > 0) {
    if (n & 1) {
      res += str;
    }
    n >>>= 1;
    str += str;
  }
  return res;
};

// Trim out all falsy values from an array.
export const compact = (array) => {
  let i, item, len1, results;
  results = [];
  for (i = 0, len1 = array.length; i < len1; i++) {
    item = array[i];
    if (item) {
      results.push(item);
    }
  }
  return results;
};

// Count the number of occurrences of a string in a string.
export const count = (string, substr) => {
  let num, pos;
  num = pos = 0;
  if (!substr.length) {
    return 1 / 0;
  }
  while (pos = 1 + string.indexOf(substr, pos)) {
    num++;
  }
  return num;
};

// Merge objects, returning a fresh copy with attributes from both sides.
// Used every time `Base#compile` is called, to allow properties in the
// options hash to propagate down the tree without polluting other branches.
export const merge = (options, overrides) => {
  return extend(extend({}, options), overrides);
};

// Extend a source object with the properties of another object (shallow copy).
export const extend = (object, properties) => {
  let key, val;
  for (const key of Object.keys(properties)) {
    val = properties[key];
    object[key] = val;
  }
  return object;
};

// Return a flattened version of an array.
// Handy for getting a list of `children` from the nodes.
export const flatten = (array) => {
  return array.flat(2e308);
};

// Delete a key from an object, returning the value. Useful when a node is
// looking for a particular method in an options hash.
export const del = (obj, key) => {
  let val;
  val = obj[key];
  delete obj[key];
  return val;
};

// Typical Array::some
export const some = Array.prototype.some ?? function(fn) {
  let e, i, len1, ref1;
  ref1 = this;
  for (i = 0, len1 = ref1.length; i < len1; i++) {
    e = ref1[i];
    if (fn(e)) {
      return true;
    }
  }
  return false;
};

// Helper function for extracting code from Literate Rip by stripping
// out all non-code blocks, producing a string of Rip code that can
// be compiled "normally."
export const invertLiterate = (code) => {
  let blankLine, i, indented, insideComment, len1, line, listItemStart, out, ref1;
  out = [];
  blankLine = /^\s*$/;
  indented = /^[\t ]/;
  listItemStart = /^(?:\t?| {0,3})(?:[\*\-\+]|[0-9]{1,9}\.)[ \t]/; // Up to one tab, or up to three spaces, or neither;
  // followed by `*`, `-` or `+`;
  // or by an integer up to 9 digits long, followed by a period;
  // followed by a space or a tab.
  insideComment = false;
  ref1 = code.split('\n');
  for (i = 0, len1 = ref1.length; i < len1; i++) {
    line = ref1[i];
    if (blankLine.test(line)) {
      insideComment = false;
      out.push(line);
    } else if (insideComment || listItemStart.test(line)) {
      insideComment = true;
      out.push(`# ${line}`);
    } else if (!insideComment && indented.test(line)) {
      out.push(line);
    } else {
      insideComment = true;
      out.push(`# ${line}`);
    }
  }
  return out.join('\n');
};

// Merge two jison-style location data objects together.
// If `last` is not provided, this will simply return `first`.
const buildLocationData = (first, last) => {
  if (!last) {
    return first;
  } else {
    return {
      first_line: first.first_line,
      first_column: first.first_column,
      last_line: last.last_line,
      last_column: last.last_column,
      last_line_exclusive: last.last_line_exclusive,
      last_column_exclusive: last.last_column_exclusive,
      range: [first.range[0], last.range[1]]
    };
  }
};

// Build a list of all comments attached to tokens.
export const extractAllCommentTokens = (tokens) => {
  let allCommentsObj, comment, commentKey, i, j, k, key, len1, len2, len3, ref1, results, sortedKeys, token;
  allCommentsObj = {};
  for (i = 0, len1 = tokens.length; i < len1; i++) {
    token = tokens[i];
    if (token.comments) {
      ref1 = token.comments;
      for (j = 0, len2 = ref1.length; j < len2; j++) {
        comment = ref1[j];
        commentKey = comment.locationData.range[0];
        allCommentsObj[commentKey] = comment;
      }
    }
  }
  sortedKeys = Object.keys(allCommentsObj).sort((a, b) => {
    return a - b;
  });
  results = [];
  for (k = 0, len3 = sortedKeys.length; k < len3; k++) {
    key = sortedKeys[k];
    results.push(allCommentsObj[key]);
  }
  return results;
};

// Get a lookup hash for a token based on its location data.
// Multiple tokens might have the same location hash, but using exclusive
// location data distinguishes e.g. zero-length generated tokens from
// actual source tokens.
const buildLocationHash = (loc) => {
  return `${loc.range[0]}-${loc.range[1]}`;
};

// Build a dictionary of extra token properties organized by tokens' locations
// used as lookup hashes.
export const buildTokenDataDictionary = (tokens) => {
  let base1, i, len1, token, tokenData, tokenHash;
  tokenData = {};
  for (i = 0, len1 = tokens.length; i < len1; i++) {
    token = tokens[i];
    if (!token.comments) {
      continue;
    }
    tokenHash = buildLocationHash(token[2]);
    // Multiple tokens might have the same location hash, such as the generated
    // `JS` tokens added at the start or end of the token stream to hold
    // comments that start or end a file.
    if (tokenData[tokenHash] == null) {
      tokenData[tokenHash] = {};
    }
    if (token.comments) { // `comments` is always an array.
      // For "overlapping" tokens, that is tokens with the same location data
      // and therefore matching `tokenHash`es, merge the comments from both/all
      // tokens together into one array, even if there are duplicate comments;
      // they will get sorted out later.
      ((base1 = tokenData[tokenHash]).comments != null ? base1.comments : base1.comments = []).push(...token.comments);
    }
  }
  return tokenData;
};

// This returns a function which takes an object as a parameter, and if that
// object is an AST node, updates that object's locationData.
// The object is returned either way.
export const addDataToNode = (parserState, firstLocationData, firstValue, lastLocationData, lastValue, forceUpdateLocation = true) => {
  return (obj) => {
    let locationData, objHash, ref1, ref2, ref3;
    // Add location data.
    locationData = buildLocationData(firstValue != null ? firstValue.locationData : void 0 ?? firstLocationData, (ref2 = lastValue != null ? lastValue.locationData : void 0) != null ? ref2 : lastLocationData);
    if (((obj != null ? obj.updateLocationDataIfMissing : void 0) != null) && (firstLocationData != null)) {
      obj.updateLocationDataIfMissing(locationData, forceUpdateLocation);
    } else {
      obj.locationData = locationData;
    }
    // Add comments, building the dictionary of token data if it hasn't been
    // built yet.
    if (parserState.tokenData == null) {
      parserState.tokenData = buildTokenDataDictionary(parserState.parser.tokens);
    }
    if (obj.locationData != null) {
      objHash = buildLocationHash(obj.locationData);
      if (((ref3 = parserState.tokenData[objHash]) != null ? ref3.comments : void 0) != null) {
        attachCommentsToNode(parserState.tokenData[objHash].comments, obj);
      }
    }
    return obj;
  };
};

export const attachCommentsToNode = (comments, node) => {
  if ((comments == null) || comments.length === 0) {
    return;
  }
  if (node.comments == null) {
    node.comments = [];
  }
  return node.comments.push(...comments);
};

// Convert jison location data to a string.
// `obj` can be a token, or a locationData.
export const locationDataToString = (obj) => {
  let locationData;
  if (("2" in obj) && ("first_line" in obj[2])) {
    locationData = obj[2];
  } else if ("first_line" in obj) {
    locationData = obj;
  }
  if (locationData) {
    return `${locationData.first_line + 1}:${locationData.first_column + 1}-` + `${locationData.last_line + 1}:${locationData.last_column + 1}`;
  } else {
    return "No location data";
  }
};

// Generate a unique anonymous file name so we can distinguish source map cache
// entries for any number of anonymous scripts.
export var anonymousFileName = (() => {
  let n;
  n = 0;
  return () => {
    return `<anonymous-${n++}>`;
  };
})();

// A `.rip` compatible version of `basename`, that returns the file sans-extension.
export const baseFileName = (file, stripExt = false, useWinPathSep = false) => {
  let parts, pathSep;
  pathSep = useWinPathSep ? /\\|\// : /\//;
  parts = file.split(pathSep);
  file = parts[parts.length - 1];
  if (!(stripExt && file.indexOf('.') >= 0)) {
    return file;
  }
  parts = file.split('.');
  parts.pop();
  if (parts[parts.length - 1] === 'rip' && parts.length > 1) {
    parts.pop();
  }
  return parts.join('.');
};

// Determine if a filename represents a Rip file.
export const isRip = (file) => {
  return /\.rip$/.test(file);
};

// Determine if a filename represents a Literate Rip file.
export const isLiterate = (file) => {
  return /\.litrip$/.test(file);
};

// Throws a SyntaxError from a given location.
// The error's `toString` will return an error message following the "standard"
// format `<filename>:<line>:<col>: <message>` plus the line with the error and a
// marker showing where the error is.
export const throwSyntaxError = (message, location) => {
  let error;
  error = new SyntaxError(message);
  error.location = location;
  error.toString = syntaxErrorToString;
  // Instead of showing the compiler's stacktrace, show our custom error message
  // (this is useful when the error bubbles up in Node.js applications that
  // compile Rip for example).
  error.stack = error.toString();
  throw error;
};

// Update a compiler SyntaxError with source code information if it didn't have
// it already.
export const updateSyntaxError = (error, code, filename) => {
  // Avoid screwing up the `stack` property of other errors (i.e. possible bugs).
  if (error.toString === syntaxErrorToString) {
    error.code || (error.code = code);
    error.filename || (error.filename = filename);
    error.stack = error.toString();
  }
  return error;
};

const syntaxErrorToString = function() {
  let codeLine, colorize, colorsEnabled, end, filename, first_column, first_line, last_column, last_line, marker, ref1, ref2, ref3, ref4, start;
  if (!(this.code && this.location)) {
    return Error.prototype.toString.call(this);
  }
  ({first_line, first_column, last_line, last_column} = this.location);
  if (last_line == null) {
    last_line = first_line;
  }
  if (last_column == null) {
    last_column = first_column;
  }
  if ((ref1 = this.filename) != null ? ref1.startsWith('<anonymous') : void 0) {
    filename = '[stdin]';
  } else {
    filename = this.filename || '[stdin]';
  }
  codeLine = this.code.split('\n')[first_line];
  start = first_column;
  // Show only the first line on multi-line errors.
  end = first_line === last_line ? last_column + 1 : codeLine.length;
  marker = codeLine.slice(0, start).replace(/[^\s]/g, ' ') + repeat('^', end - start);
  // Check to see if we're running on a color-enabled TTY.
  if (process != null) {
    colorsEnabled = ((ref2 = process.stdout) != null ? ref2.isTTY : void 0) && !((ref3 = process.env) != null ? ref3.NODE_DISABLE_COLORS : void 0);
  }
  if (this.colorful ?? colorsEnabled) {
    colorize = (str) => {
      return `\x1B[1;31m${str}\x1B[0m`;
    };
    codeLine = codeLine.slice(0, start) + colorize(codeLine.slice(start, end)) + codeLine.slice(end);
    marker = colorize(marker);
  }
  return `${filename}:${first_line + 1}:${first_column + 1}: error: ${this.message}
${codeLine}
${marker}`;
};

export const nameWhitespaceCharacter = (string) => {
  switch (string) {
    case ' ':
      return 'space';
    case '\n':
      return 'newline';
    case '\r':
      return 'carriage return';
    case '\t':
      return 'tab';
    default:
      return string;
  }
};

export const parseNumber = (string) => {
  let base;
  if (string == null) {
    return 0/0;
  }
  base = (() => {
    switch (string.charAt(1)) {
      case 'b':
        return 2;
      case 'o':
        return 8;
      case 'x':
        return 16;
      default:
        return null;
    }
  })();
  if (base != null) {
    return parseInt(string.slice(2).replace(/_/g, ''), base);
  } else {
    return parseFloat(string.replace(/_/g, ''));
  }
};

export const isFunction = (obj) => {
  return Object.prototype.toString.call(obj) === '[object Function]';
};

export const isNumber = (obj) => {
  return Object.prototype.toString.call(obj) === '[object Number]';
};

export const isString = (obj) => {
  return Object.prototype.toString.call(obj) === '[object String]';
};

export const isBoolean = (obj) => {
  return obj === true || obj === false || Object.prototype.toString.call(obj) === '[object Boolean]';
};

export const isPlainObject = (obj) => {
  return typeof obj === 'object' && !!obj && !Array.isArray(obj) && !isNumber(obj) && !isString(obj) && !isBoolean(obj);
};

const unicodeCodePointToUnicodeEscapes = (codePoint) => {
  let high, low, toUnicodeEscape;
  toUnicodeEscape = (val) => {
    let str;
    str = val.toString(16);
    return `\\u${repeat('0', 4 - str.length)}${str}`;
  };
  if (codePoint < 0x10000) {
    return toUnicodeEscape(codePoint);
  }
  // surrogate pair
  high = Math.floor((codePoint - 0x10000) / 0x400) + 0xD800;
  low = (codePoint - 0x10000) % 0x400 + 0xDC00;
  return `${toUnicodeEscape(high)}${toUnicodeEscape(low)}`;
};

// Replace `\u{...}` with `\uxxxx[\uxxxx]` in regexes without `u` flag
export const replaceUnicodeCodePointEscapes = (str, {flags, error, delimiter = ''} = {}) => {
  let shouldReplace;
  shouldReplace = (flags != null) && indexOf.call(flags, 'u') < 0;
  return str.replace(UNICODE_CODE_POINT_ESCAPE, (match, escapedBackslash, codePointHex, offset) => {
    let codePointDecimal;
    if (escapedBackslash) {
      return escapedBackslash;
    }
    codePointDecimal = parseInt(codePointHex, 16);
    if (codePointDecimal > 0x10ffff) {
      error("unicode code point escapes greater than \\u{10ffff} are not allowed", {
        offset: offset + delimiter.length,
        length: codePointHex.length + 4
      });
    }
    if (!shouldReplace) {
      return match;
    }
    return unicodeCodePointToUnicodeEscapes(codePointDecimal);
  });
};

const UNICODE_CODE_POINT_ESCAPE = /(\\\\)|\\u\{([\da-fA-F]+)\}/g; // Make sure the escape isn't escaped.
