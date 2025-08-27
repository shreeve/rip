#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'KILL ^G\nKILL ^G(1,2)\n';
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
  const l1 = ast.lines[0].cmds[0];
  const l2 = ast.lines[1].cmds[0];
  assert.equal(l1.op, 'KILL');
  assert.equal(l2.op, 'KILL');
  assert.equal(l1.args.items.length, 1);
  assert.equal(l2.args.items.length, 1);
  const v1 = l1.args.items[0];
  const v2 = l2.args.items[0];
  assert.equal(v1.global, true);
  assert.equal(v1.name, 'G');
  assert.equal(v1.subs.length, 0);
  assert.equal(v2.global, true);
  assert.equal(v2.name, 'G');
  assert.equal(v2.subs.length, 2);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


