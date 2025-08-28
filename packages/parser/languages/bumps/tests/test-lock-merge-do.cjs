#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');
const { attachBlocks } = require('../blocks.coffee');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'LOCK X:1,Y\nMERGE A=B\nDO ^ROUT(1,2)\n';
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
  // LOCK
  const l1 = ast.lines[0];
  assert.equal(l1.cmds[0].op, 'LOCK');
  assert.equal(l1.cmds[0].args.length, 2);
  assert.equal(l1.cmds[0].args[0].timeout.value, 1);
  // MERGE
  const l2 = ast.lines[1];
  assert.equal(l2.cmds[0].op, 'MERGE');
  assert.equal(Array.isArray(l2.cmds[0].args), true);
  assert.equal(l2.cmds[0].args[0].type, 'Merge');
  // DO
  const l3 = ast.lines[2];
  assert.equal(l3.cmds[0].op, 'DO');
  assert.equal(l3.cmds[0].args.targets[0].routine, 'ROUT');
  assert.equal(l3.cmds[0].args.targets[0].label, null);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


