#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');
const { attachBlocks } = require('../blocks.coffee');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const src = 'SET X=1 WRITE "A" READ X:1 DO ^R\n';
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
  assert.equal(ast.lines.length, 1, 'single line expected');
  const line = ast.lines[0];
  assert.ok(line.cmds && line.cmds.length === 4, 'expected 4 commands on the line');
  assert.equal(line.cmds[0].op, 'SET');
  assert.equal(line.cmds[1].op, 'WRITE');
  assert.equal(line.cmds[2].op, 'READ');
  assert.equal(line.cmds[3].op, 'DO');
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


