#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'SET X=@("^"_"G"),Y="HELLO"\nWRITE X, Y\n';
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
  const items = ast.lines[0].cmds[0].args.items;
  assert.equal(items.length, 2);
  assert.equal(items[0].rhs.type, 'Indirect');
  assert.equal(items[1].rhs.type, 'String');
  const wItems = ast.lines[1].cmds[0].args.items;
  assert.equal(wItems.length, 2);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
