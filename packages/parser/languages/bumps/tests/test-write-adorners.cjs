#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const src = 'WRITE !,"Hello",*65,?10,#\n';

  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);

  console.log('Tokens:', toks.map(([t,v]) => `${t}${v&&v!==t?`(${v})`:''}`).join(' '));

  // Check that adorners are properly recognized
  const tokenTypes = toks.map(([t]) => t);
  assert(tokenTypes.includes('WBANG'), 'Should have WBANG');
  assert(tokenTypes.includes('WSTAR'), 'Should have WSTAR');
  assert(tokenTypes.includes('WTAB'), 'Should have WTAB');
  assert(tokenTypes.includes('WPOUND'), 'Should have WPOUND');

  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
