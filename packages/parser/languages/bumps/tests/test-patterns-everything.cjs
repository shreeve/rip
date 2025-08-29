#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const { parsePattern } = require('../patterns.coffee');

  // Test the E (Everything) pattern class
  const samples = [
    {
      src: 'IF X?1E\n',
      desc: 'Single E (exactly one of anything)',
      check(pat) {
        assert.equal(pat.items[0].type, 'Class');
        assert.equal(pat.items[0].name, 'E');
        assert.equal(pat.items[0].canonical, 'EVERYTHING');
        assert.equal(pat.items[0].min, 1);
        assert.equal(pat.items[0].max, 1);
      }
    },
    {
      src: 'IF X?.E\n',
      desc: 'Zero or more of everything',
      check(pat) {
        assert.equal(pat.items[0].type, 'Class');
        assert.equal(pat.items[0].canonical, 'EVERYTHING');
        assert.equal(pat.items[0].min, 0);
        assert.equal(pat.items[0].max, undefined);
      }
    },
    {
      src: 'IF X?1.E\n',
      desc: 'One or more of everything (common VistA pattern)',
      check(pat) {
        assert.equal(pat.items[0].type, 'Class');
        assert.equal(pat.items[0].canonical, 'EVERYTHING');
        assert.equal(pat.items[0].min, 1);
        assert.equal(pat.items[0].max, undefined);
      }
    },
    {
      src: 'IF X?1.5E\n',
      desc: '1 to 5 of any character',
      check(pat) {
        assert.equal(pat.items[0].canonical, 'EVERYTHING');
        assert.equal(pat.items[0].min, 1);
        assert.equal(pat.items[0].max, 5);
      }
    },
    {
      src: 'IF SSN?3N1"-"2N1"-"4N.E\n',
      desc: 'SSN pattern with optional trailing characters',
      check(pat) {
        const last = pat.items[pat.items.length - 1];
        assert.equal(last.canonical, 'EVERYTHING');
        assert.equal(last.min, 0);
      }
    },
    {
      src: 'IF X?1A.E1N\n',
      desc: 'Letter, any chars, then number',
      check(pat) {
        assert.equal(pat.items[0].canonical, 'ALPHA');
        assert.equal(pat.items[1].canonical, 'EVERYTHING');
        assert.equal(pat.items[2].canonical, 'NUM');
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const sample of samples) {
    const { src, desc, check } = sample;
    const lex = new BumpsLexer();
    const toks = lex.tokenize(src);
    const p = parserMod.parser;
    p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}), parsePattern };
    p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
      setInput(){ this.i=0; return this; },
      lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
      showPosition(){ return ''; }
    };

    try {
      const ast = parserMod.parse(src);
      const ifCmd = ast.lines[0].cmds[0];
      const pat = ifCmd.cond.pat;
      check(pat);
      console.log(`✓ ${desc}: ${src.trim()}`);
      passed++;
    } catch (e) {
      console.error(`✗ ${desc}: ${src.trim()}`);
      console.error(`  Error: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
