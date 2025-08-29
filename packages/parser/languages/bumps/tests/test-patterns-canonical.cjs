#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const { parsePattern } = require('../patterns.coffee');
  const src = 'IF X?2AN\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}), parsePattern };
  p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(){ this.i=0; return this; },
    lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  const ast = parserMod.parse(src);
  const ifn = ast.lines[0].cmds[0];
  const first = ifn.cond.pat.items[0];
  assert.equal(first.type, 'ClassSet');
  assert.deepEqual(first.canonicals, ['ALPHA','NUM']);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


