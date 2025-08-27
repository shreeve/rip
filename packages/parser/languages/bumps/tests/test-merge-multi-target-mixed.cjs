#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'MERGE (A,^G(1),@H)=@(S+1)\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}) };
  p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylleno: 0,
    setInput(){ this.i=0; return this; },
    lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylleno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  const ast = parserMod.parse(src);
  const merges = ast.lines[0].cmds[0].args;
  assert.equal(merges.length, 3);
  assert.equal(merges[0].target.type, 'Var');
  assert.equal(merges[1].target.type, 'Var');
  assert.equal(merges[1].target.global, true);
  assert.equal(merges[2].target.type, 'Indirect');
  assert.equal(merges[0].source.type, 'Indirect');
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


