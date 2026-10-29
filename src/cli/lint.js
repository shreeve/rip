// `rip lint` — the project's spelling rules (package.json#rip.lint), checked
// from each file's own compile: no type face, no checker, no import closure.
// A package without the key is not linted.

import fs from 'node:fs';
import path from 'node:path';
import { compile } from '../compiler.js';
import { readProjectConfig } from '../config.js';
import { applyEdits, lintFindingsOf, lintRulesOf } from '../lint.js';

const HELP = `rip lint — check .rip files against the project's lint rules

Usage:
  rip lint [paths...]      Lint the given files/directories
                           (default: the current directory, recursively)

Options:
  --fix                    Rewrite what the rules report, file by file, where
                           the rewritten file compiles to the same JavaScript;
                           then report what remains
  --json                   Emit findings as a JSON array
  --no-frame               Suppress the source line under each finding
  -h, --help               Show this help

Rules are set per package in package.json#rip.lint (the nearest package.json
wins); a package without the key is not linted:

  { "rip": { "lint": { "calls": "explicit" } } }

  calls: "explicit"
          every call with arguments is spelled with parentheses and every
          object argument with braces — except a call whose last argument
          opens a block on the lines below (a function body, keyword pairs,
          or a heredoc), and a render tree

A rule the block leaves out is off.

Exit status is 0 when nothing is reported, 1 when anything is, 2 on a usage
or configuration error.`;

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) { console.log(HELP); process.exit(0); }
const KNOWN = new Set(['--fix', '--json', '--no-frame']);
const unknown = argv.filter((a) => a.startsWith('-') && !KNOWN.has(a));
if (unknown.length) fail(`rip lint: unknown option${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}\n\nRun 'rip lint --help' for usage.`);
const fix = argv.includes('--fix');
const asJson = argv.includes('--json');
const showFrames = !argv.includes('--no-frame') && !asJson;
const targets = argv.filter((a) => !a.startsWith('-'));

const files = [];
for (const target of targets.length ? targets : ['.']) {
  const abs = path.resolve(target);
  let stat;
  try { stat = fs.statSync(abs); } catch { fail(`rip lint: no such file or directory: ${target}`); }
  if (stat.isDirectory()) files.push(...walk(abs));
  else files.push(abs);
}

const rulesByDir = new Map();
const rows = [];
let linted = 0;
let rewritten = 0;
for (const file of files) {
  const rules = rulesFor(path.dirname(file));
  if (rules === null) continue;
  linted++;
  let source = fs.readFileSync(file, 'utf8');
  let found;
  try {
    found = findingsOf(source, file, rules);
  } catch (err) {
    if (err?.name !== 'CompileError') throw err;
    rows.push(row(file, source, typeof err.start === 'number' ? err.start : 0, typeof err.end === 'number' ? err.end : 0, null, String(err.message).split('\n')[0]));
    continue;
  }
  if (fix && found.some((f) => f.edits !== null)) {
    const next = applyEdits(source, found.flatMap((f) => f.edits ?? []));
    if (sameProgram(source, next, file)) {
      fs.writeFileSync(file, next);
      rewritten++;
      source = next;
      found = findingsOf(source, file, rules);
    }
  }
  for (const f of found) rows.push(row(file, source, f.start, f.end, `lint/${f.rule}`, f.message));
}

if (asJson) {
  console.log(JSON.stringify(rows.map(({ source, ...r }) => r), null, 2));
} else {
  for (const r of rows) {
    console.log(`${r.file}:${r.line}:${r.column} - error${r.rule ? ` ${r.rule}` : ''}: ${r.message}`);
    if (showFrames) {
      const text = r.source.split('\n')[r.line - 1] ?? '';
      const width = r.endLine === r.line ? Math.max(1, r.endColumn - r.column) : Math.max(1, text.length - r.column + 1);
      console.log(`\n${String(r.line).padStart(5)} | ${text}\n${' '.repeat(5)} | ${' '.repeat(r.column - 1)}${'~'.repeat(width)}\n`);
    }
  }
  if (linted === 0) {
    console.log('rip lint: no package in these paths sets rip.lint — nothing was linted');
  } else {
    const perFile = new Set(rows.map((r) => r.file)).size;
    if (rows.length === 0) console.log(`✓ No lint problems (${linted} file${linted === 1 ? '' : 's'} linted)`);
    else console.log(`Found ${rows.length} problem${rows.length === 1 ? '' : 's'} in ${perFile} file${perFile === 1 ? '' : 's'} (${linted} linted).`);
    if (fix) console.log(`${rewritten} file${rewritten === 1 ? '' : 's'} rewritten by --fix`);
  }
}
process.exit(rows.length > 0 ? 1 : 0);

function findingsOf(source, file, rules) {
  const r = compile(source, { path: file, face: 'js' });
  return lintFindingsOf(r.tokens, r.stores, source, rules);
}

// A fix changes spelling and nothing else: both texts compile, to the same
// JavaScript.
function sameProgram(before, after, file) {
  try { return compile(after, { path: file, face: 'js' }).code === compile(before, { path: file, face: 'js' }).code; }
  catch { return false; }
}

// A malformed block is the package's own error and ends the run naming it.
function rulesFor(dir) {
  if (!rulesByDir.has(dir)) {
    const cfg = readProjectConfig(dir);
    try { rulesByDir.set(dir, lintRulesOf(cfg.lint)); }
    catch (err) { fail(`rip lint: ${path.join(cfg._configDir ?? dir, 'package.json')}: ${err.message}`); }
  }
  return rulesByDir.get(dir);
}

function row(file, source, start, end, rule, message) {
  const s = position(source, start);
  const e = position(source, end);
  return { file: path.relative(process.cwd(), file), line: s.line, column: s.column, endLine: e.line, endColumn: e.column, rule, message, source };
}

function position(source, offset) {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 };
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile() && entry.name.endsWith('.rip')) yield p;
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
