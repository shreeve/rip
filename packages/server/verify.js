import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = import.meta.dir;
const verify = join(root, "verify");
const rip = Bun.which("rip");

if (!rip) {
  throw new Error("server verification requires the rip executable");
}

const tests = readdirSync(verify, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(verify, entry.name, "test.rip"))
  .filter(existsSync)
  .sort();

if (tests.length === 0) {
  throw new Error("server verification found no verify/*/test.rip files");
}

for (const test of tests) {
  const name = relative(root, test);
  console.log(`$ rip ${name}`);
  const child = Bun.spawn([rip, test], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    process.exit(code);
  }
}
