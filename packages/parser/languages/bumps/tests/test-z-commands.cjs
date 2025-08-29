#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');

  // Test various Z-commands used in VistA
  const samples = [
    // Supported Z-commands with specific parsing
    { src: 'ZWRITE\n', cmd: 'ZWRITE', hasArgs: false },
    { src: 'ZWRITE X,Y,^GLOBAL\n', cmd: 'ZWRITE', hasArgs: true },
    { src: 'ZWR X,Y(1,2)\n', cmd: 'ZWRITE', hasArgs: true },
    { src: 'ZBREAK LABEL^ROUTINE\n', cmd: 'ZBREAK', hasArgs: true },
    { src: 'ZBREAK LABEL^ROUTINE:"WRITE ""BREAK"""\n', cmd: 'ZBREAK', hasArgs: true },
    { src: 'ZBREAK -LABEL^ROUTINE\n', cmd: 'ZBREAK', hasArgs: true },
    { src: 'ZKILL X,Y(1)\n', cmd: 'ZKILL', hasArgs: true },
    { src: 'ZSYSTEM "ls -la"\n', cmd: 'ZSYSTEM', hasArgs: true },
    { src: 'ZETRAP "^ERROR"\n', cmd: 'ZETRAP', hasArgs: true },
    { src: 'ZSHOW "V"\n', cmd: 'ZSHOW', hasArgs: true },
    { src: 'ZLOAD "ROUTINE"\n', cmd: 'ZLOAD', hasArgs: true },
    { src: 'ZSAVE "ROUTINE"\n', cmd: 'ZSAVE', hasArgs: true },

    // Generic Z-commands (fallback)
    { src: 'ZTEST 1,2\n', cmd: 'ZTEST', hasArgs: true },
    { src: 'ZINSERT "LABEL"\n', cmd: 'ZINSERT', hasArgs: true },
    { src: 'ZREMOVE 5\n', cmd: 'ZREMOVE', hasArgs: true },
    { src: 'ZALLOCATE ^LOCK(1)\n', cmd: 'ZALLOCATE', hasArgs: true },
    { src: 'ZDEALLOCATE ^LOCK(1)\n', cmd: 'ZDEALLOCATE', hasArgs: true },
    { src: 'ZCOMPILE "ROUTINE"\n', cmd: 'ZCOMPILE', hasArgs: true },
    { src: 'ZLINK "ROUTINE"\n', cmd: 'ZLINK', hasArgs: true }
  ];

    let passed = 0;
  let failed = 0;

  for (const sample of samples) {
    const { src, cmd, hasArgs } = sample;
    const lex = new BumpsLexer();
    const toks = lex.tokenize(src);
    const p = parserMod.parser;
    p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}) };
    p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
      setInput(){ this.i=0; return this; },
      lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
      showPosition(){ return ''; }
    };

    try {
      const ast = parserMod.parse(src);
      assert.equal(ast.type, 'Program');
      const cmdNode = ast.lines[0].cmds[0];
      assert.equal(cmdNode.type, 'Cmd');
      assert.equal(cmdNode.op, cmd);

      // Check if args are properly structured
      if (hasArgs) {
        assert(cmdNode.args, `Expected args for ${cmd}`);
        if (cmd === 'ZWRITE' || cmd === 'ZKILL') {
          assert(cmdNode.args.type === 'ArgsZWRITE' || cmdNode.args.type === 'ArgsZKILL',
                 `Expected Args node for ${cmd}, got ${cmdNode.args.type}`);
        } else if (cmd === 'ZBREAK') {
          assert.equal(cmdNode.args.type, 'ArgsZBREAK');
        }
      }

      console.log(`✓ ${src.trim()}`);
      passed++;
    } catch (e) {
      console.error(`✗ Failed to parse: ${src.trim()}`);
      console.error(`  Error: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nZ-Command Support Status:');
    console.log('  Specific: ZWRITE, ZBREAK, ZKILL, ZSYSTEM, ZETRAP, ZSHOW, ZLOAD, ZSAVE');
    console.log('  Generic:  All other Z-commands (ZTEST, ZINSERT, ZREMOVE, etc.)');
    process.exit(1);
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
