#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const src = 'JOB LABEL^RTN(1,2):0:1, ^RTN2:5\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}) };
  p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(){ this.i=0; return this; },
    lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yyllineno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  const ast = parserMod.parse(src);
  const cmd = ast.lines[0].cmds[0];
  assert.equal(cmd.op, 'JOB');
  assert.equal(cmd.args.length, 2);
  // First job item should carry target and params
  assert.equal(cmd.args[0].type, 'JobTarget');
  assert.equal(cmd.args[0].params.length, 2);
  assert.equal(cmd.args[1].params.length, 1);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
