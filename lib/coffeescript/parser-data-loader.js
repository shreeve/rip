/* Parser that loads table data from disk */
const fs = require('fs');
const path = require('path');

// Load parse data from JSON file
function loadParseData(filename) {
  const dataPath = path.resolve(__dirname, filename);
  const rawData = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(rawData);
}

// Default to original data, can be overridden
const parseDataFile = process.env.COFFEESCRIPT_PARSE_DATA || 'parse-data-original.json';
const parseData = loadParseData(parseDataFile);

const parser = {
  trace: function trace() {},
  yy: {},
  symbolMap: parseData.symbolMap,
  terminals_: parseData.terminals_,
  productionTable: parseData.productionTable,
  stateTable: parseData.stateTable,
  defaultActions: parseData.defaultActions,

  performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
    switch(yystate) {
    default:
      this.$ = $$[0];
      break;
    }
  },

  parseError: function parseError(str, hash) {
    if (hash.recoverable) {
      this.trace(str);
    } else {
      var error = new Error(str);
      error.hash = hash;
      throw error;
    }
  },

  parse: function parse(input) {
    var stk = [0], val = [null], loc = [{}];
    var stateTable = this.stateTable, yytext = '', yylineno = 0, yyleng = 0, recovering = 0;
    var TERROR = 2, EOF = 1;

    var lexer = Object.create(this.lexer);
    var sharedState = {yy: {}};

    for (var k in this.yy) {
      if (this.yy.hasOwnProperty(k)) {
        sharedState.yy[k] = this.yy[k];
      }
    }

    lexer.setInput(input, sharedState.yy);
    sharedState.yy.lexer = lexer;
    sharedState.yy.parser = this;

    if (!lexer.yylloc) lexer.yylloc = {};
    var yyloc = lexer.yylloc;
    loc.push(yyloc);

    var ranges = lexer.options && lexer.options.ranges;
    var self = this;

    if (typeof sharedState.yy.parseError === 'function') {
      this.parseError = sharedState.yy.parseError;
    }

    function lex() {
      var token = lexer.lex() || EOF;
      if (typeof token !== 'number') {
        token = self.symbolMap[token] || token;
      }
      return token;
    }

    var symbol = null, preErrorSymbol = null, state, action, r, yyval = {};
    var p, len, newState, expected;

    while (true) {
      state = stk[stk.length - 1];

      if (this.defaultActions[state]) {
        action = this.defaultActions[state];
      } else {
        if (!symbol) symbol = lex();
        action = stateTable[state] && stateTable[state][symbol];
      }

      if (!action || !action.length || !action[0]) {
        var errStr = '';
        if (!recovering) {
          expected = [];
          for (p in stateTable[state]) {
            if (this.terminals_[p] && p > TERROR) {
              expected.push("'" + this.terminals_[p] + "'");
            }
          }
          errStr = lexer.showPosition ?
            "Parse error on line " + (yylineno + 1) + ":\n" + lexer.showPosition() + "\nExpecting " + expected.join(', ') + ", got '" + (this.terminals_[symbol] || symbol) + "'" :
            "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == EOF ? "end of input" : "'" + (this.terminals_[symbol] || symbol) + "'");

          this.parseError(errStr, {
            text: lexer.match,
            token: this.terminals_[symbol] || symbol,
            line: lexer.yylineno,
            loc: yyloc,
            expected: expected
          });
        }
        throw new Error(errStr);
      }

      if (action[0] instanceof Array && action.length > 1) {
        throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
      }

      switch (action[0]) {
        case 1: // shift
          stk.push(symbol, action[1]);
          val.push(lexer.yytext);
          loc.push(lexer.yylloc);
          symbol = null;
          if (!preErrorSymbol) {
            yyleng = lexer.yyleng;
            yytext = lexer.yytext;
            yylineno = lexer.yylineno;
            yyloc = lexer.yylloc;
            if (recovering > 0) recovering--;
          } else {
            symbol = preErrorSymbol;
            preErrorSymbol = null;
          }
          break;

        case 2: // reduce
          len = this.productionTable[action[1]][1];
          yyval.$ = val[val.length - len];
          var locFirst = loc[loc.length - (len || 1)];
          var locLast = loc[loc.length - 1];
          yyval._$ = {
            first_line: locFirst.first_line,
            last_line: locLast.last_line,
            first_column: locFirst.first_column,
            last_column: locLast.last_column
          };
          if (ranges) {
            yyval._$.range = [locFirst.range[0], locLast.range[1]];
          }

          r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], val, loc]);
          if (typeof r !== 'undefined') {
            return r;
          }

          if (len) {
            stk = stk.slice(0, -len * 2);
            val = val.slice(0, -len);
            loc = loc.slice(0, -len);
          }

          stk.push(this.productionTable[action[1]][0]);
          val.push(yyval.$);
          loc.push(yyval._$);
          newState = stateTable[stk[stk.length - 2]][stk[stk.length - 1]];
          stk.push(newState);
          break;

        case 3: // accept
          return true;
      }
    }
  }
};

function Parser () { this.yy = {}; }
Parser.prototype = parser;
parser.Parser = Parser;

if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
  exports.parser = parser;
  exports.Parser = parser.Parser;
  exports.parse = function () { return parser.parse.apply(parser, arguments); };
  exports.main = function() {};
  if (typeof module !== 'undefined' && require.main === module) { exports.main(process.argv.slice(1)); }
}

module.exports = new Parser;