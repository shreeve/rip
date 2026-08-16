// Process pins for the persistence runtime: absent-persistence clean
// process, ALS cold-start race, sentinel meeting, and loader CLI.
// In-process bulk lives in test/schema/runtime-orm.test.js.
import { test, expect, describe } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from '../../support/spawn.js';
import parser from '../../../src/parser.js';
import { makeParserLexer } from '../../../src/lexer.js';
import { emit } from '../../../src/emitter.js';

parser.lexer = makeParserLexer();

const compile = (source, opts = {}) => {
  const result = parser.parse(source);
  if (result.diagnostics?.length) throw new Error(result.diagnostics[0].message);
  return emit(result, { source, ...opts });
};

const ORM_SRC = 'schema.setAdapter({query: (sql) -> {columns: [], data: [], rowCount: 0}})\nconsole.log "installed"';

describe('orm runtime: process pins', () => {
  test("a hand-built model descriptor in a process WITHOUT the persistence runtime rejects at __schema()", () => {
    const runtimePath = new URL('../../../src/runtime/schema.js', import.meta.url).pathname;
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-orm-absent-'));
    try {
      writeFileSync(join(dir2, 'main.js'),
        `import { __schema } from ${JSON.stringify(runtimePath)};\n` +
        `__schema({ kind: 'model', name: 'User', entries: [] });\n`);
      const r = spawnSync('bun', [join(dir2, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("kind 'model' needs the persistence runtime");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('concurrent FIRST transactions share one AsyncLocalStorage — no statement escapes to autocommit ()', () => {
    // The race exists only at process cold start (this test file's own
    // transactions already initialized the singleton), so the pin runs
    // in a fresh subprocess: two parallel first transactions on
    // separate adapters, the second staggered by a microtask to cover
    // the overwrite interleaving. Every INSERT must ride a
    // transaction handle (tx === true); an escaped statement is the
    // silent atomicity loss the memoized init promise removes.
    const schemaPath = new URL('../../../src/runtime/schema.js', import.meta.url).pathname;
    const ormPath = new URL('../../../src/runtime/orm.js', import.meta.url).pathname;
    const script = `
import { __schema } from ${JSON.stringify(schemaPath)};
import { transaction } from ${JSON.stringify(ormPath)};
const mk = () => {
  const calls = [];
  const answer = { columns: [{ name: 'id' }], data: [[1]], rowCount: 1 };
  return {
    calls,
    async query(sql) { calls.push({ sql, tx: false }); return answer; },
    async begin() {
      calls.push({ sql: '<BEGIN>', tx: null });
      return {
        async query(sql) { calls.push({ sql, tx: true }); return answer; },
        async commit() { calls.push({ sql: '<COMMIT>', tx: null }); },
        async rollback() { calls.push({ sql: '<ROLLBACK>', tx: null }); },
      };
    },
    capabilities: { tx: true },
  };
};
const a1 = mk(), a2 = mk();
const fieldEntry = { tag: 'field', name: 'name', modifiers: ['!'], typeName: 'string', array: false };
const U = __schema({ kind: 'model', name: 'User', entries: [fieldEntry], adapter: a1 });
const V = __schema({ kind: 'model', name: 'Wing', entries: [fieldEntry], adapter: a2 });
await Promise.all([
  transaction({ on: a1 }, async () => { await U.create({ name: 'a' }); }),
  Promise.resolve().then(() => transaction({ on: a2 }, async () => { await V.create({ name: 'b' }); })),
]);
const all = [...a1.calls, ...a2.calls];
const escaped = all.filter((c) => c.tx === false);
console.log(JSON.stringify({
  escaped: escaped.length,
  inserts: all.filter((c) => c.sql.startsWith('INSERT')).map((c) => c.tx),
  shapes: [a1.calls.map((c) => c.sql.split(' ')[0]), a2.calls.map((c) => c.sql.split(' ')[0])],
}));
`;
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-als-race-'));
    try {
      writeFileSync(join(dir2, 'race.mjs'), script);
      const r = spawnSync('bun', [join(dir2, 'race.mjs')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout.trim());
      expect(out.escaped).toBe(0);
      expect(out.inserts).toEqual([true, true]);
      expect(out.shapes).toEqual([['<BEGIN>', 'INSERT', '<COMMIT>'], ['<BEGIN>', 'INSERT', '<COMMIT>']]);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('the sentinel: a standalone fused copy meeting the shared modules rejects loudly', () => {
    const { code } = compile(ORM_SRC, { runtimeDelivery: 'inline' });
    const ormPath = new URL('../../../src/runtime/orm.js', import.meta.url).pathname;
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-orm-sentinel-'));
    try {
      writeFileSync(join(dir2, 'one.js'), code);
      writeFileSync(join(dir2, 'main.js'), `import './one.js';\nimport ${JSON.stringify(ormPath)};\n`);
      const r = spawnSync('bun', [join(dir2, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip schema runtime');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('the loader path runs a DSL-declared model through the shared modules (rip CLI, import mode)', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-model-loader-'));
    try {
      writeFileSync(join(dir2, 'main.rip'), [
 'schema.setAdapter({',
 '  query: (sql, params) ->',
 '    if sql.indexOf("INSERT") is 0',
 '      {columns: [{name: "id"}, {name: "name"}], data: [[1, "Al"]], rowCount: 1}',
 '    else',
 '      {columns: [], data: [], rowCount: 0}',
 '})',
 'User = schema :model',
 '  name! string',
 '  beforeSave: -> @name = @name.trim()',
 'u = await User.create({name: " Al "})',
 'console.log u.id, u.name',
 '',
      ].join('\n'));
      const rip = join(import.meta.dir, '../../../bin/rip');
      const r = spawnSync('bun', [rip, join(dir2, 'main.rip')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('1 Al');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
