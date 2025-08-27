#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');
const { attachBlocks } = require('../blocks.coffee');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'SET ^G(1,2)=3, @X=5, @("^"_"G")=7\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks;
  p.yy = p.yy || {};
  p.yy.node = p.yy.node || ((type, props) => ({ type, ...(props || {}) }));
  p.lexer = {
    all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(input, yy){ this.i=0; return this; },
    lex(){ if (this.i >= this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  const ast = parserMod.parse(src);
  assert.equal(ast.type, 'Program');
  const items = ast.lines[0].cmds[0].args.items;
  assert.equal(items.length, 3);
  assert.equal(items[0].lhs.global, true);
  assert.equal(items[0].lhs.name, 'G');
  assert.equal(items[0].lhs.subs.length, 2);
  assert.equal(items[1].lhs.type, 'Indirect');
  assert.equal(items[2].lhs.type, 'Indirect');
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
