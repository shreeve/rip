import { parseMumps, parseMumpsWithTokens } from "./mumps-parser-pro.js";
import { zigLex } from "./zig-lex.js";

const src = `
HELLO  W "Hi",!  S A=1,B(2)="ok"  I A?1A1N W "OK",!  H  ; greet
SETTEST  S A=1,B(10)=2,C=333  ; align equals
`;

const buf = new TextEncoder().encode(src);
const toks = zigLex(buf);
const ast = toks ? parseMumpsWithTokens(buf, toks) : parseMumps(buf);

console.log(ast.format({
  abbreviateCommands: true,         // S, W, I, H…
  alignSetEquals: true,             // align '=' in SET list
  commentColumn: 50,                // pad comments to column 50
  betweenCommands: "  ",            // spacing between commands
  spaceAfterCommand: " "            // spacing after command before args
}));
