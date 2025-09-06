
var UNICODE_CODE_POINT_ESCAPE, buildLocationData, buildLocationHash, invertLiterate, isLiterate, ref, syntaxErrorToString, toUnicodeEscape,
  indexOf = [].indexOf;

export var starts = function(string, literal, start) {
  return literal === string.substr(start, literal.length);
};

export var ends = function(string, literal, back) {
  var len;
  len = literal.length;
  return literal === string.substr(string.length - len - (back || 0), len);
};

export var repeat = function(str, n) {
  var res;
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

export var merge = function(options, overrides) {
  return extend(extend({}, options), overrides);
};

export var extend = function(object, properties) {
  var key, val;
  for (key in properties) {
    val = properties[key];
    object[key] = val;
  }
  return object;
};

export var flatten = function(array) {
  return array.flat(2e308);
};

export var del = function(obj, key) {
  var val;
  val = obj[key];
  delete obj[key];
  return val;
};

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

invertLiterate = function(code) {
  var blankLine, i, indented, insideComment, len1, line, listItemStart, out, ref1;
  out = [];
  blankLine = /^\s*$/;
  indented = /^[\t ]/;
  listItemStart = /^(?:\t?| {0,3})(?:[*\-+]|\d{1,9}\.|\d{1,9}\))[ \t]/;
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

buildLocationHash = function(loc) {
  return `${loc.range[0]}-${loc.range[1]}`;
};

export var buildTokenDataDictionary = function(tokens) {
  var i, len1, token, tokenData, tokenHash;
  tokenData = {};
  for (i = 0, len1 = tokens.length; i < len1; i++) {
    token = tokens[i];
    if (!(token.comments || token.csx)) {
      continue;
    }
    tokenHash = buildLocationHash(token[2]);
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

export var anonymousFileName = (function() {
  var n;
  n = 0;
  return function() {
    return `<anonymous-${n++}>`;
  };
})();

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

export var isCoffee = function(file) {
  return /\.coffee$/.test(file);
};

isLiterate = function(file) {
  return /\.(litcoffee|coffee\.md)$/.test(file);
};

export var throwSyntaxError = function(message, location) {
  var error;
  error = new SyntaxError(message);
  error.location = location;
  error.toString = syntaxErrorToString;
  error.stack = error.toString();
  throw error;
};

export var updateSyntaxError = function(error, code, filename) {
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
  end = first_line === last_line ? last_column + 1 : codeLine.length;
  marker = codeLine.slice(0, start).replace(/[^\s]/g, ' ') + repeat('^', end - start);
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
    if (codePointDecimal <= 0xffff) {
      return toUnicodeEscape(codePointDecimal);
    } else {
      high = Math.floor((codePointDecimal - 0x10000) / 0x400) + 0xd800;
      low = (codePointDecimal - 0x10000) % 0x400 + 0xdc00;
      return `${toUnicodeEscape(high)}${toUnicodeEscape(low)}`;
    }
  });
};

UNICODE_CODE_POINT_ESCAPE = /(\\\\)|\\u\{([\da-fA-F]+)\}/g;

toUnicodeEscape = function(val) {
  var str;
  str = val.toString(16);
  return `\\u${repeat('0', 4 - str.length)}${str}`;
};
