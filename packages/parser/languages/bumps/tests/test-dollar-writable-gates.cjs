#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');

(function () {
  const { BumpsLexer } = require('../lexer.coffee');

  function parseWithOpts(src, opts) {
    const lex = new BumpsLexer();
    const toks = lex.tokenize(src);
    const p = parserMod.parser;
    p.tokens = toks;
    p.yy = p.yy || {};
    p.yy.node = p.yy.node || ((type, props) => ({ type, ...(props || {}) }));
    p.yy.options = opts || {};
    p.lexer = {
      all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
      setInput(input, yy){ this.i=0; return this; },
      lex(){ if (this.i >= this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
      showPosition(){ return ''; }
    };
    return parserMod.parse(src);
  }

  // $IO gating
  assert.throws(() => parseWithOpts('SET $IO=1\n', { allowWritableDeviceVars: false }), /Parse error|Expecting/);
  let ast = parseWithOpts('SET $IO=1\n', { allowWritableDeviceVars: true });
  let set = ast.lines[0].cmds[0];
  assert.equal(set.op, 'SET');
  assert.equal(set.args.items[0].lhs.type, 'DollarVar');
  assert.equal(set.args.items[0].lhs.name, 'IO');

  // $SYSTEM gating
  assert.throws(() => parseWithOpts('SET $SYSTEM=42\n', { allowWritableSystemVar: false }), /Parse error|Expecting/);
  ast = parseWithOpts('SET $SYSTEM=42\n', { allowWritableSystemVar: true });
  set = ast.lines[0].cmds[0];
  assert.equal(set.args.items[0].lhs.type, 'DollarVar');
  assert.equal(set.args.items[0].lhs.name, 'SYSTEM');

  // $JOB always read-only (should fail even if both flags are on)
  assert.throws(() => parseWithOpts('SET $JOB=99\n', { allowWritableDeviceVars: true, allowWritableSystemVar: true }), /Parse error|Expecting/);

  console.log('PASS');
})();
