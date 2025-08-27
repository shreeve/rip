#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const parser = require('./parser.js');
const { BumpsLexer } = require('./lexer.coffee');
const { BumpsRewriter } = require('./rewriter.coffee');

function readSource(argv) {
  if (argv.length > 2) {
    const p = path.resolve(argv[2]);
    return fs.readFileSync(p, 'utf8');
  }
  return 'SET X=1\nWRITE "OK"';
}

function toJisonTokens(tokens) {
  // Our parser wants tokens via lexer.lex(); keep [[tag, value, loc]] in lexer.
  return tokens;
}

class Adapter {
  constructor(tokens) {
    this.all = tokens || [];
    this.i = 0;
    this.yytext = '';
    this.yyleng = 0;
    this.yylineno = 0;
    this.yylloc = {};
  }
  setInput(input, yy) {
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
    const [tag, val, loc] = this.all[this.i++];
    this.yytext = String(val ?? tag);
    this.yyleng = this.yytext.length;
    this.yylloc = loc || {};
    this.yylineno = this.yylloc.first_line || 0;
    return tag;
  }
  showPosition() { return ''; }
}

function main() {
  const src = readSource(process.argv);
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const rewritten = new BumpsRewriter().rewrite(toks);

  parser.tokens = toJisonTokens(rewritten);
  parser.yy = parser.yy || {};
  parser.yy.node = parser.yy.node || ((type, props) => ({ type, ...(props || {}) }));
  parser.lexer = new Adapter(parser.tokens);

  try {
    const ok = parser.parse(src);
    console.log(ok === true ? 'accepted' : 'ok');
  } catch (e) {
    console.error('Parse error:', e.message);
    process.exit(1);
  }
}

if (require.main === module) main();


