// The Bun pin is spelled once, in `.bun-version`. CI's setup-bun steps
// read it through `bun-version-file`, and scripts/browser-bundle.mjs
// reads it to refuse regeneration of the byte-gated dist/@rip artifacts
// under any other Bun. That refusal is what protects the artifact; this
// file covers the one thing it cannot see, because the bundle script
// never runs there: how CI provisions Bun in the first place.
//
// Three properties of setup-bun make that provisioning load-bearing. A
// `bun-version:` input WINS over `bun-version-file:`, so a stray literal
// silently governs. A step carrying NEITHER input falls back to reading
// package.json, and that read is silent: a miss resolves to `latest`,
// which for a byte-gated artifact is the wrong failure. And the file is
// resolved against GITHUB_WORKSPACE, so a step that runs before the
// checkout reads nothing and takes that same silent path to `latest`.
//
// Scope is every tracked `.github` YAML, not just the workflows: a
// setup-bun step factored into a composite action pins the toolchain
// exactly as much as one written inline.
import { test, expect } from 'bun:test';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const PIN_FILE = '.bun-version';
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// `git ls-files -z` (NUL-delimited: filenames are data, not lines). A
// tracked path deleted from the working tree still lists, so existence
// filters — the sweep reads bytes and a ghost entry would throw.
const trackedFiles = (pattern) =>
  execSync(`git ls-files -z -- ${pattern}`, { cwd: ROOT }).toString().split('\0')
    .filter((rel) => rel && existsSync(join(ROOT, rel)));

// The action is a step's `uses:` VALUE. Matching the name anywhere on a
// line would count a comment that merely names the action as a step, and
// then report the comment for carrying no inputs.
const SETUP_BUN = /^\s*(?:-\s*)?uses:\s*oven-sh\/setup-bun@/;
const CHECKOUT = /^\s*(?:-\s*)?uses:\s*actions\/checkout@/;

test('every setup-bun step reads the pin file; no CI file spells a version', () => {
  const ci = trackedFiles("'.github'").filter((rel) => /\.(yml|yaml)$/.test(rel));
  expect(ci.length).toBeGreaterThan(0);

  const offenders = [];
  let steps = 0;
  for (const rel of ci) {
    const lines = read(rel).split('\n');
    lines.forEach((line, i) => {
      // A literal input wins over the file input — it must not exist.
      if (/^\s*bun-version:/.test(line)) offenders.push(`${rel}:${i + 1} spells a version`);
      if (!SETUP_BUN.test(line)) return;
      steps += 1;
      // The step's inputs run until the next list item at or above the
      // `uses:` indent — the `with:` block is nested deeper.
      const indent = line.search(/\S/);
      const inputs = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() && next.search(/\S/) <= indent && /^\s*-\s/.test(next)) break;
        if (next.trim() && next.search(/\S/) < indent) break;
        inputs.push(next);
      }
      const file = inputs.find((input) => /^\s*bun-version-file:/.test(input));
      if (!file) offenders.push(`${rel}:${i + 1} names no bun-version-file (resolves to latest)`);
      else if (file.split(':')[1].trim() !== PIN_FILE) {
        offenders.push(`${rel}:${i + 1} reads ${file.split(':')[1].trim()}, not ${PIN_FILE}`);
      }
      // The pin file only exists once the repository is on disk. Each
      // job owns its own `steps:` list, so the checkout that must
      // precede this step is the one inside the same list. A composite
      // action carries no checkout of its own — its caller owns that.
      if (!rel.startsWith('.github/workflows/')) return;
      const start = lines.slice(0, i).findLastIndex((prior) => /^\s*steps:\s*$/.test(prior));
      const checkedOut = start >= 0 && lines.slice(start + 1, i).some((prior) => CHECKOUT.test(prior));
      if (!checkedOut) offenders.push(`${rel}:${i + 1} runs before its job checks out (reads no pin file)`);
    });
  }
  expect(offenders).toEqual([]);
  expect(steps).toBeGreaterThan(0);
});
