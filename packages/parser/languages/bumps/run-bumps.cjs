#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const parserMod = require('./parser.cjs');
let BumpsLexer;
class BumpsRewriter { rewrite(tokens){ return tokens; } }

function readSource(argv) {
  if (argv.length > 2) {
    const p = path.resolve(argv[2]);
    return fs.readFileSync(p, 'utf8');
  }
  return 'SET X=1\nWRITE "OK"';
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
    this.yylleno = 0;
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
  // Lazy import ESM lexer
  const loadLexer = () => import('./lexer.js').then(m => m.BumpsLexer);

  loadLexer().then((Ctor) => {
    BumpsLexer = Ctor;
  const src = readSource(process.argv);
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const rewritten = new BumpsRewriter().rewrite(toks);

  const p = parserMod.parser;
  p.tokens = rewritten;
  p.yy = p.yy || {};
  p.yy.node = p.yy.node || ((type, props) => ({ type, ...(props || {}) }));
  p.lexer = new Adapter(p.tokens);

  try {
    const ok = parserMod.parse(src);
    console.log(ok === true ? 'accepted' : 'ok');
  } catch (e) {
    console.error('Parse error:', e.message);
    process.exit(1);
  }
  }).catch((e) => { console.error('Failed to load lexer:', e.message); process.exit(1); });
}

if (require.main === module) main();
