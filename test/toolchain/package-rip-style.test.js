// Authored Rip uses its own call and construction vocabulary. Dammit is the
// call-and-await form; a written `await` is reserved for promise values already
// in hand. `.new` is construction, and `.new!` is construction plus await.
// These are `rip lint` rules, read from each file's own compile, so examples
// embedded in strings and comments are never mistaken for authored
// operations. Language fixtures keep the alternate spellings because their
// job is to exercise the complete accepted grammar.
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile } from '../../src/compiler.js';
import { lintFindingsOf, lintRulesOf } from '../../src/lint.js';

const ROOT = join(import.meta.dir, '../..');
const RULES = lintRulesOf({ construction: '.new', await: 'dammit', dammit: 'bare' });

// Dot-directories are never authored sources: the sites suites build
// and tear down `.rip-*` scratch trees under their fixtures while this
// lane runs, and a walk that descended into one read a file that was
// gone by the time it opened it.
const ripFiles = (directory, files = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) ripFiles(path, files);
    else if (entry.name.endsWith('.rip')) files.push(path);
  }
  return files;
};

const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

test('authored Rip uses dammit calls, Ruby construction, and awaits only stored promises', () => {
  const violations = [];
  const files = [
    ...ripFiles(join(ROOT, 'packages')),
    join(ROOT, 'src/grammar/solar.rip'),
  ];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const result = compile(source, { path: file, face: 'js' });
    for (const f of lintFindingsOf(result.tokens, result.stores, source, RULES)) {
      violations.push(`${relative(ROOT, file)}:${lineAt(source, f.start)}: lint/${f.rule}: ${f.message}`);
    }
  }

  expect(files.length).toBeGreaterThan(150);
  expect(violations, violations.join('\n')).toEqual([]);
});
