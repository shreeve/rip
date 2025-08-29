#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const src = 'TSTART "SERIAL"\nTCOMMIT\nTROLLBACK\nTRESTART "SP"\n';
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
  const ops = ast.lines.map(l=>l.cmds[0].op);
  assert.deepEqual(ops, ['TSTART','TCOMMIT','TROLLBACK','TRESTART']);
  assert.equal(ast.lines[0].cmds[0].args.length, 1);
  assert.equal(ast.lines[3].cmds[0].args.length, 1);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


