#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');
const { attachBlocks } = require('../blocks.coffee');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'GOTO LABEL^ROUT, ^ROUT, LABEL+1^ROUT\n';
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
  const [line] = ast.lines;
  assert.equal(line.cmds[0].op, 'GOTO');
  const targets = line.cmds[0].args;
  assert.equal(targets.length, 3);
  assert.equal(targets[0].label, 'LABEL'); assert.equal(targets[0].routine, 'ROUT');
  assert.equal(targets[1].label, null);     assert.equal(targets[1].routine, 'ROUT');
  assert.equal(targets[2].offset, 1);       assert.equal(targets[2].routine, 'ROUT');
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
