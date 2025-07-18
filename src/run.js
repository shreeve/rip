const show = (obj) => console.dir(obj, { depth: null, maxArrayLength: null, colors: false });

// Process the grammar fully
const grammar = require("./grammar");
const jison = require("./jison");
const gen = new jison.Generator({
  "bnf": grammar.grammar,
  "operators": grammar.operators,
  "tokens": grammar.tokens,
  "start": grammar.start
});

// Show key variables
show(gen.symbolMap);
show(gen.symbolMap);
show(gen.symbolMap);
show(gen.symbolMap);

console.log("// State machine variables\n\n");
console.log("const symbolMap       = "); show(gen.symbolMap      ); console.log(";\n");
console.log("const terminals_      = "); show(gen.terminals_     ); console.log(";\n");
console.log("const productionTable = "); show(gen.productionTable); console.log(";\n");
console.log("const stateTable      = "); show(gen.stateTable     ); console.log(";\n");
console.log("const defaultActions  = "); show(gen.defaultActions ); console.log(";\n");

// Display all inner state for the grammar
// show(gen);

// // Show generated parser (Javascript source code)
// const js = gen.generate();
// process.stdout.write(js);
