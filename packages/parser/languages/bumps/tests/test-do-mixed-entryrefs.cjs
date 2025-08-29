#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const src = 'DO L1^R1(1), ^R2, L2+1^R3(2,3)\n';
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
  const targets = ast.lines[0].cmds[0].args.targets;
  assert.equal(targets.length, 3);
  assert.equal(targets[0].label, 'L1');
  assert.equal(targets[0].routine, 'R1');
  assert.equal(targets[1].routine, 'R2');
  assert.equal(targets[2].offset, 1);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


