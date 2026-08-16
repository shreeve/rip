// Find every reference to a name or path, INCLUDING the ones an import
// graph cannot see.
//
// Five renames on the cleanup branch broke through a string rather than
// an import: a test asserting an emitted import line verbatim, a
// computed path (`join(dirname(preload), 'stdlib.js')`), a basename
// regex in browser-bundle.mjs, a prefixed name used as an absence
// marker, and a dynamic-import URL in the VS Code extension's dual-path
// loader. The last cost 82 tests and three rounds to find.
//
// The lesson each time was the same: searching for the bare token finds
// it, and filtering that search — by `from '...'`, by `import`, by
// directory — is what loses it. So this greps bare tokens over every
// text file and classifies each hit by WHERE it sits, because a hit
// inside a string literal is the one that breaks silently.
//
//   bun scripts/refcheck.mjs rewriteTypes VALUE_WORDS
//   bun scripts/refcheck.mjs --exclude src/lexer.js -- types/schema
//
// Exit code is 1 when any string-literal hit is found outside the
// excluded files — those are the ones that need a decision.

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.zig-cache', '.vscode']);
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.rip', '.json', '.md',
  '.zig', '.sh', '.html', '.css', '.toml', '.yml', '.yaml',
]);

const argv = process.argv.slice(2);
const exclude = [];
const tokens = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--exclude') exclude.push(argv[++i]);
  else if (argv[i] === '--') tokens.push(...argv.slice(i + 1)), (i = argv.length);
  else tokens.push(argv[i]);
}
if (!tokens.length) {
  console.error('usage: bun scripts/refcheck.mjs [--exclude <path>]... <token>...');
  process.exit(2);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (TEXT_EXT.has(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
};

// Where in the line does the hit sit? Comments are usually prose and
// safe; strings are the silent breakers; code is what an import graph
// would already have caught.
const HASH_COMMENT_EXT = new Set(['.rip', '.sh', '.toml', '.yml', '.yaml']);
const classify = (line, col, ext) => {
  const before = line.slice(0, col);
  if (before.includes('//')) return 'comment';
  if (HASH_COMMENT_EXT.has(ext) && before.includes('#')) return 'comment';
  if (before.trimStart().startsWith('*')) return 'comment';
  let quote = null;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (quote) { if (c === quote && before[i - 1] !== '\\') quote = null; }
    else if (c === '"' || c === "'" || c === '`') quote = c;
  }
  return quote ? 'string' : 'code';
};

const files = walk(root).filter((f) => !exclude.some((x) => f.endsWith(x)));
const found = { code: [], string: [], comment: [] };

for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (!tokens.some((t) => text.includes(t))) continue;
  const rel = path.relative(root, file);
  const ext = path.extname(file);
  text.split('\n').forEach((line, i) => {
    for (const t of tokens) {
      const re = new RegExp(`(?<![\\w$])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g');
      let m;
      while ((m = re.exec(line)) !== null) {
        found[classify(line, m.index, ext)].push({ rel, line: i + 1, t, text: line.trim().slice(0, 96) });
      }
    }
  });
}

const show = (kind, label) => {
  const rows = found[kind];
  if (!rows.length) return;
  console.log(`\n${label} — ${rows.length}`);
  for (const r of rows) console.log(`  ${r.rel}:${r.line}  ${r.text}`);
};

show('string', 'IN A STRING LITERAL — an import graph cannot see these');
show('code', 'in code');
show('comment', 'in a comment');

const total = found.string.length + found.code.length + found.comment.length;
if (!total) console.log('no references found');
console.log(`\n${total} reference(s): ${found.string.length} string, ${found.code.length} code, ${found.comment.length} comment`);
process.exit(found.string.length ? 1 : 0);
