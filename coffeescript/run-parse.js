#!/usr/bin/env node

// Wire Solar-generated CoffeeScript parser with CoffeeScript lexer and nodes
const path = require('path');
const parserMod = require('./lib/coffeescript/parser-solar-1.1.0.js');
const nodes = require('./lib/coffeescript/nodes.js');
const { Lexer } = require('./lib/coffeescript/lexer.js');

class AdapterLexer {
  constructor(tokens) {
    this.all = tokens || [];
    this.i = 0;
    this.yytext = '';
    this.yyleng = 0;
    this.yylineno = 0;
    this.yylloc = {};
  }
  setInput(input, yy) {
    // tokens are precomputed; just reset
    this.yy = yy || {};
    this.i = 0;
    this.yytext = '';
    this.yyleng = 0;
    this.yylineno = 0;
    this.yylloc = {};
    return this;
  }
  lex() {
    if (this.i >= this.all.length) return 1; // $end
    const tok = this.all[this.i++];
    const tag = tok && tok[0];
    const val = tok && tok[1];
    const loc = tok && tok[2];
    this.yytext = String(val ?? tag);
    this.yyleng = this.yytext.length;
    this.yylloc = loc || {};
    this.yylineno = (this.yylloc && this.yylloc.first_line) || 0;
    return tag;
  }
  showPosition() { return ''; }
}

function main() {
  const src = process.argv.slice(2).join(' ') || 'a = 1 + 2\nif a then b = a';

  const lex = new Lexer();
  const tokens = lex.tokenize(src); // [[tag, value, loc], ...]

  // Provide expected runtime
  parserMod.parser.yy = nodes;
  parserMod.parser.tokens = tokens; // helpers will read parser.tokens
  parserMod.parser.lexer = new AdapterLexer(tokens);

  const res = parserMod.parse(src);
  console.log(typeof res === 'boolean' ? 'accepted' : 'ok');
}

if (require.main === module) main();
