#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'SET @X=1\nREAD @Y:2\n';
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
  const setIt = ast.lines[0].cmds[0].args.items[0];
  const readIt = ast.lines[1].cmds[0].args.items[0];
  assert.equal(setIt.lhs.type, 'Indirect');
  assert.equal(readIt.lhs.type, 'Indirect');
  assert.equal(readIt.timeout.value, 2);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


