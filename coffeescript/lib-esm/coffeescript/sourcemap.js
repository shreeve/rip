
var LineMap, SourceMap;

LineMap = class LineMap {
  constructor(line1) {
    this.line = line1;
    this.columns = [];
  }

  add(column, [sourceLine, sourceColumn], options = {}) {
    if (this.columns[column] && options.noReplace) {
      return;
    }
    return this.columns[column] = {
      line: this.line,
      column,
      sourceLine,
      sourceColumn
    };
  }

  sourceLocation(column) {
    var mapping;
    while (!((mapping = this.columns[column]) || (column <= 0))) {
      column--;
    }
    return mapping && [mapping.sourceLine, mapping.sourceColumn];
  }

};

SourceMap = (function() {
  var BASE64_CHARS, VLQ_CONTINUATION_BIT, VLQ_SHIFT, VLQ_VALUE_MASK;

  class SourceMap {
    constructor() {
      this.lines = [];
    }

    add(sourceLocation, generatedLocation, options = {}) {
      var base, column, line, lineMap;
      [line, column] = generatedLocation;
      lineMap = ((base = this.lines)[line] || (base[line] = new LineMap(line)));
      return lineMap.add(column, sourceLocation, options);
    }

    sourceLocation([line, column]) {
      var lineMap;
      while (!((lineMap = this.lines[line]) || (line <= 0))) {
        line--;
      }
      return lineMap && lineMap.sourceLocation(column);
    }

    static registerCompiled(filename, source, sourcemap) {
      if (sourcemap != null) {
        return SourceMap.sourceMaps[filename] = sourcemap;
      }
    }

    static getSourceMap(filename) {
      return SourceMap.sourceMaps[filename];
    }

    generate(options = {}, code = null) {
      var buffer, i, j, lastColumn, lastSourceColumn, lastSourceLine, len, len1, lineMap, lineNumber, mapping, needComma, ref, ref1, sources, v3, writingline;
      writingline = 0;
      lastColumn = 0;
      lastSourceLine = 0;
      lastSourceColumn = 0;
      needComma = false;
      buffer = "";
      ref = this.lines;
      for (lineNumber = i = 0, len = ref.length; i < len; lineNumber = ++i) {
        lineMap = ref[lineNumber];
        if (lineMap) {
          ref1 = lineMap.columns;
          for (j = 0, len1 = ref1.length; j < len1; j++) {
            mapping = ref1[j];
            if (!(mapping)) {
              continue;
            }
            while (writingline < mapping.line) {
              lastColumn = 0;
              needComma = false;
              buffer += ";";
              writingline++;
            }
            if (needComma) {
              buffer += ",";
              needComma = false;
            }
            buffer += this.encodeVlq(mapping.column - lastColumn);
            lastColumn = mapping.column;
            buffer += this.encodeVlq(0);
            buffer += this.encodeVlq(mapping.sourceLine - lastSourceLine);
            lastSourceLine = mapping.sourceLine;
            buffer += this.encodeVlq(mapping.sourceColumn - lastSourceColumn);
            lastSourceColumn = mapping.sourceColumn;
            needComma = true;
          }
        }
      }
      sources = options.sourceFiles ? options.sourceFiles : options.filename ? [options.filename] : ['<anonymous>'];
      v3 = {
        version: 3,
        file: options.generatedFile || '',
        sourceRoot: options.sourceRoot || '',
        sources: sources,
        names: [],
        mappings: buffer
      };
      if (options.sourceMap || options.inlineMap) {
        v3.sourcesContent = [code];
      }
      return v3;
    }

    encodeVlq(value) {
      var answer, nextChunk, signBit, valueToEncode;
      answer = '';
      signBit = value < 0 ? 1 : 0;
      valueToEncode = (Math.abs(value) << 1) + signBit;
      while (valueToEncode || !answer) {
        nextChunk = valueToEncode & VLQ_VALUE_MASK;
        valueToEncode = valueToEncode >> VLQ_SHIFT;
        if (valueToEncode) {
          nextChunk |= VLQ_CONTINUATION_BIT;
        }
        answer += this.encodeBase64(nextChunk);
      }
      return answer;
    }

    encodeBase64(value) {
      return BASE64_CHARS[value] || (function() {
        throw new Error(`Cannot Base64 encode value: ${value}`);
      })();
    }

  };

  SourceMap.sourceMaps = Object.create(null);

  VLQ_SHIFT = 5;

  VLQ_CONTINUATION_BIT = 1 << VLQ_SHIFT;

  VLQ_VALUE_MASK = VLQ_CONTINUATION_BIT - 1;

  BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  return SourceMap;

}).call(this);

export default SourceMap;
