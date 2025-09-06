  // This file contains the common helper functions that we'd like to share among
  // the **Lexer**, **Rewriter**, and the **Nodes**. Merge objects, flatten
  // arrays, count characters, that sort of thing.

// Peek at the beginning of a given string to see if it matches a sequence.
var UNICODE_CODE_POINT_ESCAPE, buildLocationData, buildLocationHash, invertLiterate, isLiterate, ref, syntaxErrorToString, toUnicodeEscape,
  indexOf = [].indexOf;

export var starts = function(string, literal, start) {
  return literal === string.substr(start, literal.length);
};

// Peek at the end of a given string to see if it matches a sequence.
export var ends = function(string, literal, back) {
  var len;
  len = literal.length;
  return literal === string.substr(string.length - len - (back || 0), len);
};

// Repeat a string `n` times.
export var repeat = function(str, n) {
  var res;
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
export var compact = function(array) {
  var i, item, len1, results;
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
export var count = function(string, substr) {
  var num, pos;
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
export var merge = function(options, overrides) {
  return extend(extend({}, options), overrides);
};

// Extend a source object with the properties of another object (shallow copy).
export var extend = function(object, properties) {
  var key, val;
  for (key in properties) {
    val = properties[key];
    object[key] = val;
  }
  return object;
};

// Return a flattened version of an array.
// Handy for getting a list of `children` from the nodes.
export var flatten = function(array) {
  return array.flat(2e308);
};

// Delete a key from an object, returning the value. Useful when a node is
// looking for a particular method in an options hash.
export var del = function(obj, key) {
  var val;
  val = obj[key];
  delete obj[key];
  return val;
};

// Typical Array::some
export var some = (ref = Array.prototype.some) != null ? ref : function(fn) {
  var e, i, len1, ref1;
  ref1 = this;
  for (i = 0, len1 = ref1.length; i < len1; i++) {
    e = ref1[i];
    if (fn(e)) {
      return true;
    }
  }
  return false;
};

// Helper function for extracting code from Literate CoffeeScript by stripping
// out all non-code blocks, producing a string of CoffeeScript code that can
// be compiled "normally."
invertLiterate = function(code) {
  var blankLine, i, indented, insideComment, len1, line, listItemStart, out, ref1;
  out = [];
  blankLine = /^\s*$/;
  indented = /^[\t ]/;
  listItemStart = /^(?:\t?| {0,3})(?:[*\-+]|\d{1,9}\.|\d{1,9}\))[ \t]/; // Up to one tab, or up to three spaces, or neither;
  // followed by `*`, `-` or `+`;
  // or by an integer up to 9 digits long, followed by a period;
  // or by an integer up to 9 digits long, followed by a closing parenthesis.
  // followed by a space or a tab.
  insideComment = false;
  ref1 = code.split('\n');
  for (i = 0, len1 = ref1.length; i < len1; i++) {
    line = ref1[i];
    if (blankLine.test(line)) {
      insideComment = false;
      out.push(line);
    } else if (insideComment || listItemStart.test(line) || !indented.test(line)) {
      insideComment = true;
      out.push(`# ${line}`);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
};

// Build a list of all comments attached to tokens.
export var extractAllCommentTokens = function(tokens) {
  var allComments, allCommentsObj, comment, commentKey, i, j, k, len1, len2, ref1, token;
  allCommentsObj = {};
  for (i = 0, len1 = tokens.length; i < len1; i++) {
    token = tokens[i];
    if (token.comments) {
      ref1 = token.comments;
      for (j = 0, len2 = ref1.length; j < len2; j++) {
        comment = ref1[j];
        commentKey = `${comment.locationData.first_line}-${comment.locationData.first_column}`;
        allCommentsObj[commentKey] = comment;
      }
    }
  }
  allComments = [];
  for (k in allCommentsObj) {
    comment = allCommentsObj[k];
    allComments.push(comment);
  }
  return allComments;
};

// Get a lookup hash for a token based on its location data.
// Multiple tokens might have the same location hash, but using exclusive
// location data distinguishes e.g. zero-length generated tokens from
// actual source tokens.
buildLocationHash = function(loc) {
  return `${loc.range[0]}-${loc.range[1]}`;
};

// Build a dictionary of extra token properties organized by tokens' locations
// used as lookup hashes.
export var buildTokenDataDictionary = function(tokens) {
  var i, len1, token, tokenData, tokenHash;
  tokenData = {};
  for (i = 0, len1 = tokens.length; i < len1; i++) {
    token = tokens[i];
    if (!(token.comments || token.csx)) {
      continue;
    }
    tokenHash = buildLocationHash(token[2]);
    // Multiple tokens might have the same location hash, such as the generated
    // `JS` tokens added at the start/end of CSX fragments.
    if (tokenData[tokenHash] == null) {
      tokenData[tokenHash] = {};
    }
    if (token.comments) {
      tokenData[tokenHash].comments = token.comments;
    }
    if (token.csx) {
      tokenData[tokenHash].csx = token.csx;
    }
  }
  return tokenData;
};

// This returns a function which takes an object as a parameter, and if that
// object is an AST node, updates that object's locationData.
// The object is returned either way.
export var addDataToNode = function(parserState, firstLocationData, firstValue, lastLocationData, lastValue, forceUpdateLocation = true) {
  return function(obj) {
    var objHash, ref1, ref2;
    objHash = buildLocationHash(obj.locationData);
    if ((obj.locationData != null) && (forceUpdateLocation || (parserState.tokenData[objHash] == null))) {
      obj.locationData = buildLocationData(firstLocationData, lastLocationData);
    }
    if (((ref1 = parserState.tokenData[objHash]) != null ? ref1.comments : void 0) != null) {
      attachCommentsToNode(parserState.tokenData[objHash].comments, obj);
    }
    if (((ref2 = parserState.tokenData[objHash]) != null ? ref2.csx : void 0) != null) {
      obj.csx = true;
    }
    return obj;
  };
};

export var attachCommentsToNode = function(comments, node) {
  if ((comments == null) || comments.length === 0) {
    return;
  }
  if (node.comments == null) {
    node.comments = [];
  }
  return node.comments.push(...comments);
};

// Convert jison location data to our style.
// `obj` can be a token, or a locationData.
export var locationDataToString = function(obj) {
  var locationData;
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

// Generate a unique anonymous file name so we can distinguish source map
// entries for any number of anonymous scripts.
export var anonymousFileName = (function() {
  var n;
  n = 0;
  return function() {
    return `<anonymous-${n++}>`;
  };
})();

// A `.coffee.md` compatible version of `basename`, that returns the file sans-extension.
// A version of `basename` that returns the file sans-extension.
export var baseFileName = function(file, stripExt = false, useWinPathSep = false) {
  var parts, pathSep;
  pathSep = useWinPathSep ? /\\|\// : /\//;
  parts = file.split(pathSep);
  file = parts[parts.length - 1];
  if (!(stripExt && file.indexOf('.') >= 0)) {
    return file;
  }
  parts = file.split('.');
  parts.pop();
  if (parts[parts.length - 1] === 'coffee' && parts.length > 1) {
    parts.pop();
  }
  return parts.join('.');
};

// Determine if a filename represents a CoffeeScript file.
export var isCoffee = function(file) {
  return /\.coffee$/.test(file);
};

// Determine if a filename represents a Literate CoffeeScript file.
isLiterate = function(file) {
  return /\.(litcoffee|coffee\.md)$/.test(file);
};

// Throws a SyntaxError from a given location.
// The error's `toString` will return an error message following the "standard"
// format <filename>:<line>:<col>: <message> plus the line with the error and a
// marker showing where the error is.
export var throwSyntaxError = function(message, location) {
  var error;
  error = new SyntaxError(message);
  error.location = location;
  error.toString = syntaxErrorToString;
  // Instead of showing the compiler's stacktrace, show our custom error message
  // (this is useful when the error bubbles up in Node.js applications that
  // compile CoffeeScript for example).
  error.stack = error.toString();
  throw error;
};

// Update a compiler SyntaxError with source code information if it didn't have
// it already.
export var updateSyntaxError = function(error, code, filename) {
  // Avoid screwing up the `stack` property of other errors (i.e. possible bugs).
  if (error.toString === syntaxErrorToString) {
    error.code || (error.code = code);
    error.filename || (error.filename = filename);
    error.stack = error.toString();
  }
  return error;
};

syntaxErrorToString = function() {
  var codeLine, colorize, colorsEnabled, end, filename, first_column, first_line, last_column, last_line, marker, ref1, ref2, ref3, start;
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
  filename = this.filename || '[stdin]';
  codeLine = this.code.split('\n')[first_line];
  start = first_column;
  // Show only the first line on multi-line errors.
  end = first_line === last_line ? last_column + 1 : codeLine.length;
  marker = codeLine.slice(0, start).replace(/[^\s]/g, ' ') + repeat('^', end - start);
  // Check to see if we're running on a color-enabled TTY.
  if (typeof process !== "undefined" && process !== null) {
    colorsEnabled = ((ref1 = process.stdout) != null ? ref1.isTTY : void 0) && !((ref2 = process.env) != null ? ref2.NODE_DISABLE_COLORS : void 0);
  }
  if ((ref3 = this.colorful) != null ? ref3 : colorsEnabled) {
    colorize = function(str) {
      return `\x1B[1;31m${str}\x1B[0m`;
    };
    codeLine = codeLine.slice(0, start) + colorize(codeLine.slice(start, end)) + codeLine.slice(end);
    marker = colorize(marker);
  }
  return `${filename}:${first_line + 1}:${first_column + 1}: error: ${this.message}
${codeLine}
${marker}`;
};

export var nameWhitespaceCharacter = function(string) {
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

export var parseNumber = function(string) {
  var base;
  if (string == null) {
    return 0/0;
  }
  base = (function() {
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

export var isFunction = function(obj) {
  return Object.prototype.toString.call(obj) === '[object Function]';
};

export var isNumber = function(obj) {
  return Object.prototype.toString.call(obj) === '[object Number]';
};

export var isString = function(obj) {
  return Object.prototype.toString.call(obj) === '[object String]';
};

export var isBoolean = function(obj) {
  return obj === true || obj === false || Object.prototype.toString.call(obj) === '[object Boolean]';
};

export var isPlainObject = function(obj) {
  return typeof obj === 'object' && !!obj && !Array.isArray(obj) && !isNumber(obj) && !isString(obj) && !isBoolean(obj);
};

// Private function for location data
buildLocationData = function(first, last) {
  return {
    first_line: first.first_line,
    first_column: first.first_column,
    last_line: last.last_line,
    last_column: last.last_column,
    last_line_exclusive: last.last_line_exclusive,
    last_column_exclusive: last.last_column_exclusive,
    range: [first.range[0], last.range[1]]
  };
};

// Replace `\u{...}` with `\uxxxx[\uxxxx]` in regexes without `u` flag
export var replaceUnicodeCodePointEscapes = function(str, {flags, error, delimiter = ''} = {}) {
  var shouldReplace;
  shouldReplace = (flags != null) && indexOf.call(flags, 'u') < 0;
  return str.replace(UNICODE_CODE_POINT_ESCAPE, function(match, escapedBackslash, codePointHex, offset) {
    var codePointDecimal, high, low;
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
    // Convert surrogate pairs. See:
    // http://mathiasbynens.be/notes/javascript-encoding#surrogate-pairs
    if (codePointDecimal <= 0xffff) {
      return toUnicodeEscape(codePointDecimal);
    } else {
      high = Math.floor((codePointDecimal - 0x10000) / 0x400) + 0xd800;
      low = (codePointDecimal - 0x10000) % 0x400 + 0xdc00;
      return `${toUnicodeEscape(high)}${toUnicodeEscape(low)}`;
    }
  });
};

UNICODE_CODE_POINT_ESCAPE = /(\\\\)|\\u\{([\da-fA-F]+)\}/g; // Escaped backslash.
// Unicode code point escape.

toUnicodeEscape = function(val) {
  var str;
  str = val.toString(16);
  return `\\u${repeat('0', 4 - str.length)}${str}`;
};
