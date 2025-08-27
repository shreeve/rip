#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');
const { attachBlocks } = require('../blocks.coffee');
const { BumpsRewriter } = require('../rewriter.coffee');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'IF 1\n. WRITE "OK"\nELSE\n. WRITE "NO"\n';
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const rewritten = toks; // rewriter is pass-through for now

  const p = parserMod.parser;
  p.tokens = rewritten;
  p.yy = p.yy || {};
  p.yy.node = p.yy.node || ((type, props) => ({ type, ...(props || {}) }));
  p.lexer = {
    all: rewritten, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
    setInput(input, yy){ this.i=0; return this; },
    lex(){ if (this.i >= this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
    showPosition(){ return ''; }
  };
  let ast = parserMod.parse(src);
  if (ast && ast.type === 'Program') ast = attachBlocks(ast);
  assert.equal(ast.type, 'Program');
  const ifLine = ast.lines.find(l => l.cmds && l.cmds[0] && l.cmds[0].type === 'If');
  assert.ok(ifLine, 'IF line not found');
  const ifCmd = ifLine.cmds[0];
  assert.ok(Array.isArray(ifCmd.then) && ifCmd.then.length === 1, 'then block should have 1 line');
  assert.ok(Array.isArray(ifCmd.else) && ifCmd.else.length === 1, 'else block should have 1 line');
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
