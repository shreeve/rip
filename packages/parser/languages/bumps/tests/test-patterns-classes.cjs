#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'SET X=1 W X?2AN(1"-")3AL\n';
  const lex = new BumpsLexer();
  const { parsePattern } = require('../patterns.cjs');
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}), parsePattern };
  p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(){ this.i=0; return this; },
    lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylleno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  const ast = parserMod.parse(src);
  const cmd = ast.lines[0].cmds[1];
  const pm = cmd.args.items[0];
  assert.equal(pm.type, 'PatternMatch');
  const pat = pm.pat;
  assert.equal(pat.type, 'PatternSeq');
  assert.ok(pat.items[0].min === 2);
  assert.ok(pat.items[0].type === 'ClassSet');
  assert.deepEqual(pat.items[0].names, ['A','N']);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


