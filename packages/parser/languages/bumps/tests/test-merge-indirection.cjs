#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const src = 'MERGE @X=@Y\nMERGE @(A)=^G(1)\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}) };
  p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(){ this.i=0; return this; },
    lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  const ast = parserMod.parse(src);
  const m1 = ast.lines[0].cmds[0].args[0];
  assert.equal(m1.type, 'Merge');
  assert.equal(m1.target.type, 'Indirect');
  assert.equal(m1.source.type, 'Indirect');
  const m2 = ast.lines[1].cmds[0].args[0];
  assert.equal(m2.type, 'Merge');
  assert.equal(m2.target.type, 'Indirect');
  assert.equal(m2.source.type, 'Var');
  assert.equal(m2.source.global, true);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


