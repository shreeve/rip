#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');
const { attachBlocks } = require('../blocks.coffee');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'SET X=1+2*3, Y=2**3+1, B=1_2_3, C=1&0!1\n';
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
  const set = ast.lines[0].cmds[0];
  assert.equal(set.op, 'SET');
  // Light structure checks
  assert.equal(set.args.items.length, 4);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
