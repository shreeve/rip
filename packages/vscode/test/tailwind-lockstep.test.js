// The Tailwind LOCKSTEP check: the extension ships
// `tailwindCSS.experimental.classRegex` patterns (package.json
// configurationDefaults) so Tailwind's IntelliSense completes inside
// the render DSL's class-value spellings. Those regexes are DATA the
// Tailwind extension consumes — nothing in this repo executes them —
// so nothing structural stops the DSL and the patterns drifting
// apart. This suite is the lockstep:
//
//   1. every fixture is a REAL class-value spelling (it compiles
//      through the actual render DSL — a stale fixture fails here
//      first), and
//   2. every class token the fixture spells is extracted by the
//      shipped regexes, evaluated exactly the way the Tailwind
//      extension evaluates them (a string entry matches groups; an
//      array entry is the container/item two-stage form).
//
// A future wave adding a class-value spelling to the DSL adds its
// fixture here in the same commit (the §9-agreement-8 pattern, editor
// tier) — without a regex covering it, the new spelling ships without
// Tailwind completions and this suite is where that shows.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'node:path';
import { compile } from '../../../src/compile.js';

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dir, '..', 'package.json'), 'utf8'));
const CLASS_REGEXES = pkg.contributes.configurationDefaults['tailwindCSS.experimental.classRegex'];

// The Tailwind extension's evaluation: a STRING pattern's first group
// captures a class list; an ARRAY pattern matches a container with
// its first regex, then captures class lists inside the container
// with its second. (tailwindlabs/tailwindcss-intellisense's
// documented experimental.classRegex semantics.)
const extract = (source) => {
  const tokens = new Set();
  const capture = (re, text) => {
    const found = [];
    for (const m of text.matchAll(new RegExp(re, 'g'))) found.push(m[1]);
    return found;
  };
  for (const entry of CLASS_REGEXES) {
    if (typeof entry === 'string') {
      for (const list of capture(entry, source)) {
        for (const t of list.split(/\s+/)) if (t) tokens.add(t);
      }
    } else {
      const [container, item] = entry;
      for (const m of source.matchAll(new RegExp(container, 'g'))) {
        for (const list of capture(item, m[1])) {
          for (const t of list.split(/\s+/)) if (t) tokens.add(t);
        }
      }
    }
  }
  return tokens;
};

// [the DSL line, the class tokens it spells]. Selector classes
// (`div.card`) are deliberately absent: they are markup shorthand for
// STATIC single classes, not Tailwind-style class lists — the value
// spellings below are where utility lists live.
const FIXTURES = [
  ['p class: "static px-2"', ['static', 'px-2']],
  ['p class: ["px-2", active && "font-bold"]', ['px-2', 'font-bold']],
  [".('grid gap-2', active && 'bg-red-500')", ['grid', 'gap-2', 'bg-red-500']],
  ['p class: (active ? "mt-1" : "mb-1")', ['mt-1', 'mb-1']],
];

describe('Tailwind classRegex lockstep: every DSL class-value spelling both compiles and extracts', () => {
  test('the shipped configuration exists and keeps its two-stage shapes', () => {
    expect(Array.isArray(CLASS_REGEXES)).toBe(true);
    expect(CLASS_REGEXES.length).toBeGreaterThanOrEqual(3);
    expect(pkg.contributes.configurationDefaults['tailwindCSS.includeLanguages'].rip).toBe('html');
  });

  for (const [line, expected] of FIXTURES) {
    test(JSON.stringify(line), () => {
      // 1. The spelling is real DSL — it compiles inside a render.
      const src = 'Card = component\n  active := true\n  render\n    div\n      ' + line + '\nconsole.log Card\n';
      expect(() => compile(src, { runtimeDelivery: 'none' })).not.toThrow();
      // 2. The shipped regexes extract every class token it spells.
      const tokens = extract(line);
      for (const t of expected) {
        expect(tokens.has(t), `class token '${t}' not extracted from ${JSON.stringify(line)} by the shipped classRegex set`).toBe(true);
      }
    });
  }
});
