const fs = require('fs');
const crypto = require('crypto');

function hash(obj){
  const str = JSON.stringify(obj);
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Load grammar and generator
const grammar = require('./grammar');
const Jison    = require('./jison');

function build(opts={}){
  const gen = new Jison.Generator({
    bnf       : grammar.grammar,
    operators : grammar.operators,
    tokens    : grammar.tokens,
    start     : grammar.start
  }, opts);
  return gen;
}

function snapshot(gen){
  return {
    nullableCount: Object.values(gen.nonterminals).filter(n=>n.nullable).length,
    firstTotal   : Object.values(gen.nonterminals).reduce((a,n)=>a+Object.keys(n.first).length,0),
    followTotal  : Object.values(gen.nonterminals).reduce((a,n)=>a+Object.keys(n.follows).length,0),
    stateCount   : gen.states.length,
    productionCount: gen.productions.length,
    conflictCount: gen.conflictStates.length,
    stateHash    : hash(gen.stateTable),
    prodHash     : hash(gen.productionTable)
  };
}

const gen = build();
const snap = snapshot(gen);

if (require.main === module) {
  console.log(JSON.stringify(snap, null, 2));
} else {
  module.exports = snap;
}