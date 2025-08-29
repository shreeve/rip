#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const src = 'KILL A(1),B(2,3)\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}) };
  p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(){ this.i=0; return this; },
    lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylleno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  const ast = parserMod.parse(src);
  const it = ast.lines[0].cmds[0].args.items;
  assert.equal(it.length, 2);
  assert.equal(it[0].type, 'Var');
  assert.equal(it[0].subs.length, 1);
  assert.equal(it[1].type, 'Var');
  assert.equal(it[1].subs.length, 2);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


