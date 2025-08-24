import { parseMumps, NodeKind, text } from "./mumps-parser.js";

const src = 'W "Hello",!  S A=1,B(2)="ok"  I A=1 W "yep",!  H';
const ast = parseMumps(src);

// Example: print normalized commands on each line
for (const line of ast.program.lines) {
  const cmds = line.commands.map(c => c.cmd);
  console.log(cmds.join(" ; "));
}
