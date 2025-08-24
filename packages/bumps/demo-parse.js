// demo-parse.js
// Tiny example script. Run with Bun:
//   bun run demo-parse.js [optional-file.m]
//
// If a Zig dylib/so is present, it will use token-driven top-level parsing.
// Otherwise it falls back to pure-JS parsing.

import { parseMumps, parseMumpsWithTokens, formatMumps, text } from "./mumps-parser-pro.js";
import { zigLex } from "./zig-lex.js";

async function readInput(pathOpt) {
  if (pathOpt) {
    const f = Bun.file(pathOpt);
    if (!(await f.exists())) throw new Error(`No such file: ${pathOpt}`);
    return new Uint8Array(await f.arrayBuffer());
  }
  // Default sample program
  const sample = `
HELLO  W "Hi",!  S A=1,B(2)="ok"  I A?1A1N W "OK",!  H  ; greet

SETTEST  S A=1,B(10)=2,C=333  ; align equals
READLINE R X S Y=$L(X) W "LEN=",Y,!
NEWLAB   N I,J S I=1,J=2  W I+J,!  Q
`;
  return new TextEncoder().encode(sample);
}

function hr() {
  if (typeof Bun !== "undefined" && Bun.nanoseconds) return Number(Bun.nanoseconds()) / 1e6;
  if (globalThis.performance?.now) return performance.now();
  return Date.now();
}

const pathArg = process.argv[2];
const buf = await readInput(pathArg);

const t0 = hr();
const toks = zigLex(buf);
const t1 = hr();

let ast, mode;
if (toks) {
  mode = "zig+js";
  const t2 = hr();
  ast = parseMumpsWithTokens(buf, toks);
  const t3 = hr();
  console.log(`[lexer ${Math.max(0, t1 - t0).toFixed(3)} ms] [parse ${Math.max(0, t3 - t2).toFixed(3)} ms] (zig tokens)`);
} else {
  mode = "js-only";
  const t2 = hr();
  ast = parseMumps(buf);
  const t3 = hr();
  console.log(`[parse ${Math.max(0, t3 - t2).toFixed(3)} ms] (pure JS)`);
}

console.log(`mode: ${mode}, lines: ${ast.program.lines.length}, nodes: ${ast.nodes.length}`);

// print formatted output
const pretty = formatMumps(ast, {
  abbreviateCommands: true,
  alignSetEquals: true,
  commentColumn: 48
});
console.log("----- formatted -----");
console.log(pretty);
