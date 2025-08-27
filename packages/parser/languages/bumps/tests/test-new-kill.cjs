#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');
const { attachBlocks } = require('../blocks.coffee');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'NEW X,Y\nKILL X,Y\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const p = parserMod.parser;
  p.tokens = toks;
  p.yy = p.yy || {};
  p.yy.node = p.yy.node || ((type, props) => ({ type, ...(props || {}) }));
  p.lexer = {
    all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(input, yy){ this.i=0; return this; },
    lex(){ if (this.i >= this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  let ast = parserMod.parse(src);
  if (ast && ast.type === 'Program') ast = attachBlocks(ast);
  assert.equal(ast.type, 'Program');
  const l1 = ast.lines[0], l2 = ast.lines[1];
  assert.equal(l1.cmds[0].op, 'NEW');
  assert.equal(l1.cmds[0].args.names.length, 2);
  assert.equal(l2.cmds[0].op, 'KILL');
  assert.equal(l2.cmds[0].args.items.length, 2);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


