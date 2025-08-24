import { parseMumps } from "./mumps-parser-pro.js";

const src = 'HELLO  W "Hi",!  S A=1,B=2  I A?1A1N W "OK",!  H';
const ast = parseMumps(src);

console.log(ast.format());          // pretty print
console.log(ast.symbols.get(1));    // first interned symbol (example)
