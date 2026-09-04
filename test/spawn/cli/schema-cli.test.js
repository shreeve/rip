// The `rip schema` CLI — the bin/rip dispatch and the
// loader-preloaded harness (src/cli/schema.js), end-to-end in
// subprocesses (the cli.test.js conventions: real fixture files in a
// temp cwd, stdout/stderr/exit-status assertions). The fixture
// adapter is FILE-BACKED (Contract v2 with catalog()), so state —
// the `schema` history and the statement log — survives
// across the separate `make` and `migrate` processes; it has no
// begin(), so the non-transactional posture surfaces exactly as a
// real begin-less adapter would.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, appendFileSync, existsSync } from 'fs';
import { spawnSync } from '../../support/spawn.js';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const BIN = resolve(import.meta.dir, '../../../bin/rip');

// RIP_DB_URL in the ambient environment would defeat the
// unconfigured-adapter pin (and configure nothing real anywhere
// else) — every spawn runs without it.
const ENV = { ...process.env };
delete ENV.RIP_DB_URL;

let dir;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'rip-schema-cli-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (name, text) => writeFileSync(join(dir, name), text);

const rip = (args, opts = {}) => {
  const r = spawnSync('bun', [BIN, ...args], { cwd: opts.cwd ?? dir, encoding: 'utf8', env: ENV });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

// The file-backed Contract-v2 fake. State: { deployed, history, log }.
// Its catalog() serves the stored canonical `deployed` spec as the
// `GET /catalog` contract document — the mapping duckdb-harbor
// performs — with a spec column's `unique` flag materialized as its
// auto-named single-column unique index (the one shape the ORM's DDL
// ever gives uniqueness).
const FILEDB = `import { readFileSync, writeFileSync, existsSync } from 'fs';
export function fileDB(path) {
  const load = () => existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { deployed: { tables: [] }, history: [], log: [] };
  const save = (s) => writeFileSync(path, JSON.stringify(s));
  const contractDoc = (tables) => ({
    harborVersion: '0.9.0',
    duckdbVersion: 'v1.5.5',
    tables: [...tables]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((t) => {
        const indexes = (t.indexes || []).map((ix) => ({ name: ix.name, columns: [...ix.columns], unique: ix.unique === true }));
        for (const c of t.columns) {
          const auto = 'idx_' + t.name + '_' + c.name;
          if (c.unique && !indexes.some((ix) => ix.name === auto)) indexes.push({ name: auto, columns: [c.name], unique: true });
        }
        return {
          name: t.name,
          schema: 'main',
          columns: t.columns.map((c) => ({
            name: c.name, type: c.type, notNull: c.notNull === true,
            default: c.default ?? null, primary: c.primary === true,
          })),
          primaryKey: t.primaryKey != null ? [t.primaryKey] : [],
          indexes,
          foreignKeys: (t.foreignKeys || []).map((fk) => ({
            columns: fk.column.split(', '), refTable: fk.refTable, refSchema: 'main',
            refColumns: fk.refColumn != null ? fk.refColumn.split(', ') : [],
          })),
        };
      }),
    sequences: tables.filter((t) => t.sequence)
      .map((t) => ({ name: t.sequence.name, start: t.sequence.start }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  });
  return {
    async catalog() {
      const s = load();
      s.log.push('GET /catalog');
      save(s);
      return contractDoc((s.deployed && s.deployed.tables) || []);
    },
    async query(sql, params = []) {
      const s = load();
      s.log.push(sql);
      if (/FAIL_NOW/.test(sql)) { save(s); throw new Error('Parser Error: FAIL_NOW tripped'); }
      let out = { columns: [], data: [], rowCount: 0 };
      if (sql.startsWith('SELECT version')) {
        out = {
          columns: ['version', 'name', 'checksum', 'applied_at'].map((name) => ({ name })),
          data: s.history.map((h) => [h.version, h.name, h.checksum, null]),
          rowCount: s.history.length,
        };
      } else if (sql.startsWith('INSERT INTO schema (version, name, checksum)')) {
        if (s.history.some((h) => h.version === params[0])) {
          save(s);
          throw new Error('Duplicate key "version: ' + params[0] + '" violates primary key constraint');
        }
        s.history.push({ version: params[0], name: params[1], checksum: params[2] });
      } else if (sql.startsWith('INSERT INTO schema (version, name, applied_at)')) {
        // The lease acquire: a row back means acquired, zero rows means
        // a live lease elsewhere — never a constraint error.
        if (s.lock) {
          out = { columns: [{ name: 'version' }], data: [], rowCount: 0 };
        } else {
          s.lock = { owner: params[1], at: Date.now() };
          out = { columns: [{ name: 'version' }], data: [['@lock']], rowCount: 1 };
        }
      } else if (sql.startsWith('UPDATE schema SET applied_at = now()')) {
        const renewed = s.lock && s.lock.owner === params[1];
        if (renewed) s.lock.at = Date.now();
        out = { columns: [{ name: 'version' }], data: renewed ? [['@lock']] : [], rowCount: renewed ? 1 : 0 };
      } else if (sql.startsWith('SELECT name AS owner')) {
        const rows = s.lock ? [[s.lock.owner, null, (Date.now() - s.lock.at) / 1000]] : [];
        out = { columns: ['owner', 'applied_at', 'age_seconds'].map((name) => ({ name })), data: rows, rowCount: rows.length };
      } else if (sql.startsWith('DELETE FROM schema') && params[0] === '@lock') {
        delete s.lock;
      } else if (sql.startsWith('UPDATE schema')) {
        const h = s.history.find((x) => x.version === params[1]);
        if (h) h.checksum = params[0];
      }
      save(s);
      return out;
    },
  };
}
`;

const MODELS = `import { fileDB } from "./filedb.js"
schema.setAdapter fileDB("./db.json")

export User = schema :model
  name! string
  email! email @unique

export Order = schema :model
  total! integer
  @belongsTo User
`;

const dbState = () => JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));

describe('rip schema: usage surface', () => {
  test('help exits 0; unknown verb, unknown flag, and misplaced flags exit 2', () => {
    const help = rip(['schema', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('rip schema status');
    expect(help.stdout).toContain('--allow-destructive');

    const bogus = rip(['schema', 'bogus']);
    expect(bogus.status).toBe(2);
    expect(bogus.stderr).toContain("unknown subcommand 'bogus'");

    const flag = rip(['schema', 'plan', '--definitely-bogus']);
    expect(flag.status).toBe(2);
    expect(flag.stderr).toContain('unknown flag: --definitely-bogus');

    const misplaced = rip(['schema', 'plan', '--repair']);
    expect(misplaced.status).toBe(2);
    expect(misplaced.stderr).toContain('--repair only applies to migrate');

    // migrate lost --force to the lease: the refusal explains that a
    // crashed run's lock expires on its own, and points at unlock.
    const forceMigrate = rip(['schema', 'migrate', '--force']);
    expect(forceMigrate.status).toBe(2);
    expect(forceMigrate.stderr).toContain('migrate no longer takes --force');
    expect(forceMigrate.stderr).toContain('rip schema unlock --force');

    const forceMisplaced = rip(['schema', 'status', '--force']);
    expect(forceMisplaced.status).toBe(2);
    expect(forceMisplaced.stderr).toContain('--force only applies to unlock');
    expect(help.stdout).toContain('--force'); // documented in the usage
  });

  test('the top-level rip help names the schema subcommand', () => {
    const h = rip(['--help']);
    expect(h.status).toBe(0);
    expect(h.stdout).toContain('rip schema <verb>');
  });

  test('no models entry anywhere: exit 1 naming the candidates', () => {
    const empty = mkdtempSync(join(tmpdir(), 'rip-schema-empty-'));
    try {
      const r = rip(['schema', 'plan'], { cwd: empty });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no models entry found');
      expect(r.stderr).toContain('models.rip');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('rip schema: entry loading failure modes', () => {
  test('a compile error in the entry surfaces with its position, exit 1', () => {
    write('badentry.rip', 'x = (1 +\n');
    const r = rip(['schema', 'plan', 'badentry.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('failed to compile');
    expect(r.stderr).toMatch(/badentry\.rip:\d+:\d+/);
  });

  test('an entry that registers no models: exit 1, loud', () => {
    write('filedb.js', FILEDB);
    write('nomodels.rip', 'import { fileDB } from "./filedb.js"\nschema.setAdapter fileDB("./db.json")\n');
    const r = rip(['schema', 'plan', 'nomodels.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no :model schemas are registered');
  });

  test('no adapter configured (no setAdapter, no RIP_DB_URL): exit 1 naming the fix', () => {
    write('noadapter.rip', 'export User = schema :model\n  name! string\n');
    const r = rip(['schema', 'plan', 'noadapter.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no database is configured');
    expect(r.stderr).toContain('RIP_DB_URL');
  });
});

describe('rip schema: the verb workflow end-to-end (file-backed adapter, separate processes)', () => {
  test('plan prints classified steps and the summary line', () => {
    write('filedb.js', FILEDB);
    write('models.rip', MODELS);
    rmSync(join(dir, 'db.json'), { force: true });
    const r = rip(['schema', 'plan', 'models.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[safe] create-table users');
    expect(r.stdout).toContain('[safe] create-table orders');
    // Single-column uniqueness is an inline constraint, not an index —
    // a standalone index would freeze the table against every later ALTER.
    expect(r.stdout).toContain('"email" VARCHAR NOT NULL UNIQUE');
    expect(r.stdout.indexOf('create-table users')).toBeLessThan(r.stdout.indexOf('create-table orders'));
    expect(r.stdout).toContain('2 safe');
  });

  // The made file is named by the UTC clock, so later tests in this
  // sequence learn its version from make's own output.
  let initVersion;

  test('make writes the timestamped file; migrate applies it with the non-transactional posture warning; a second migrate is idempotent; status reports', () => {
    write('filedb.js', FILEDB);
    write('models.rip', MODELS);
    rmSync(join(dir, 'db.json'), { force: true });
    rmSync(join(dir, 'migrations'), { recursive: true, force: true });

    const make = rip(['schema', 'make', 'init', 'models.rip']);
    expect(make.status).toBe(0);
    const wrote = make.stdout.match(/wrote migrations[\/\\](\d{14})_init\.sql/);
    expect(wrote).not.toBeNull();
    initVersion = wrote[1];
    const body = readFileSync(join(dir, 'migrations', initVersion + '_init.sql'), 'utf8');
    expect(body).toContain('-- [safe] create-table users');
    expect(body).toContain('CREATE TABLE "users"');

    const migrate = rip(['schema', 'migrate', 'models.rip']);
    expect(migrate.status).toBe(0);
    expect(migrate.stdout).toContain('applied ' + initVersion + '_init');
    expect(migrate.stderr).toContain('WITHOUT transactions'); // the loud posture (no begin())
    const state = dbState();
    expect(state.history.map((h) => h.version)).toEqual([initVersion]);
    expect(state.log.some((s) => s.includes('CREATE TABLE "users"'))).toBe(true);
    expect(state.log.some((s) => s.includes('CREATE TABLE "orders"'))).toBe(true);

    const again = rip(['schema', 'migrate', 'models.rip']);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('no pending migrations');

    const status = rip(['schema', 'status', 'models.rip']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('applied:  ' + initVersion + '_init');
    expect(status.stdout).toContain('pending:  (none)');
    // The fake DB never really creates tables, so the models still
    // diff against an empty deployed schema — the drift line proves
    // status distinguishes "unexplained difference" from "pending".
    expect(status.stdout).toContain('drift: the database differs from the models');
  });

  test('checksum mismatch: status reports it, migrate refuses it, --repair re-records', () => {
    // Continues from the applied init above.
    appendFileSync(join(dir, 'migrations', initVersion + '_init.sql'), '\n-- edited after apply\n');
    const status = rip(['schema', 'status', 'models.rip']);
    expect(status.stdout).toContain('edited after apply: ' + initVersion + '_init');

    const refuse = rip(['schema', 'migrate', 'models.rip']);
    expect(refuse.status).toBe(1);
    expect(refuse.stderr).toContain('checksum mismatch on applied migration ' + initVersion + '_init');
    expect(refuse.stderr).toContain('--repair');

    const repair = rip(['schema', 'migrate', '--repair', 'models.rip']);
    expect(repair.status).toBe(0);
    const ok = rip(['schema', 'migrate', 'models.rip']);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('no pending migrations');
  });

  test('an interrupted run: the failure names the file, the statement, and the partial state; conflicting versions refuse upfront', () => {
    // Continues from the repaired state above. A hand-written version
    // stamped after the applied one, so it is plainly pending.
    write('migrations/30000101000000_bad.sql', 'CREATE TABLE extras (x INTEGER);\nSELECT FAIL_NOW;\nCREATE TABLE more (x INTEGER);\n');
    const r = rip(['schema', 'migrate', 'models.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('30000101000000_bad failed at statement 2 of 3');
    expect(r.stderr).toContain('Parser Error: FAIL_NOW tripped');
    expect(r.stderr).toContain('statements 1-1 of 30000101000000_bad ARE applied');
    expect(dbState().history.map((h) => h.version)).toEqual([initVersion]); // no row for the failed file

    write('migrations/30000101000000_other.sql', 'SELECT 1;\n');
    const dup = rip(['schema', 'migrate', 'models.rip']);
    expect(dup.status).toBe(1);
    expect(dup.stderr).toContain('conflicting migration files share a version number');
    expect(dup.stderr).toContain('30000101000000_bad');
    expect(dup.stderr).toContain('30000101000000_other');
    rmSync(join(dir, 'migrations/30000101000000_bad.sql'));
    rmSync(join(dir, 'migrations/30000101000000_other.sql'));
  });

  test('make gates: a destructive plan refuses without the flag and writes with it', () => {
    write('filedb.js', FILEDB);
    write('gated.rip', MODELS.replace('"./db.json"', '"./gated-db.json"'));
    // Deployed: users matches its model; a stray table the models do not
    // declare makes the plan destructive. A stray COLUMN would not serve
    // here: users carries an index, and DuckDB refuses every non-ADD
    // ALTER on an indexed table, so a drop-column step is blocked, not
    // destructive (pinned in test/schema/migrate.test.js) — DROP TABLE
    // stays legal because a table drops its own indexes with it.
    writeFileSync(join(dir, 'gated-db.json'), JSON.stringify({
      deployed: { tables: [
        {
          name: 'users', sequence: { name: 'users_seq', start: 1 }, primaryKey: 'id',
          columns: [
            { name: 'id', type: 'INTEGER', notNull: true, unique: false, primary: true, default: "nextval('users_seq')" },
            { name: 'name', type: 'VARCHAR', notNull: true, unique: false, default: null },
            { name: 'email', type: 'VARCHAR', notNull: true, unique: true, default: null },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
          foreignKeys: [], tableWas: null,
        },
        {
          name: 'staging', sequence: null, primaryKey: null,
          columns: [
            { name: 'x', type: 'INTEGER', notNull: false, unique: false, default: null },
          ],
          indexes: [], foreignKeys: [], tableWas: null,
        },
      ] },
      history: [], log: [],
    }));
    rmSync(join(dir, 'gated-migrations'), { recursive: true, force: true });

    const refuse = rip(['schema', 'make', 'cleanup', 'gated.rip', '--dir', 'gated-migrations']);
    expect(refuse.status).toBe(1);
    expect(refuse.stderr).toContain('gated steps');
    expect(refuse.stderr).toContain('[destructive] drop-table staging');
    expect(refuse.stderr).toContain('--allow-lossy / --allow-destructive');
    expect(existsSync(join(dir, 'gated-migrations'))).toBe(false);

    const allow = rip(['schema', 'make', 'cleanup', 'gated.rip', '--dir', 'gated-migrations', '--allow-destructive']);
    expect(allow.status).toBe(0);
    const wrote = allow.stdout.match(/wrote gated-migrations[\/\\](\d{14}_cleanup\.sql)/);
    expect(wrote).not.toBeNull();
    const body = readFileSync(join(dir, 'gated-migrations', wrote[1]), 'utf8');
    expect(body).toContain('DROP TABLE "staging";');
  });

  test('entry auto-discovery: a cwd models.rip is found without naming it', () => {
    const auto = mkdtempSync(join(tmpdir(), 'rip-schema-auto-'));
    try {
      writeFileSync(join(auto, 'filedb.js'), FILEDB);
      writeFileSync(join(auto, 'models.rip'), MODELS);
      const r = spawnSync('bun', [BIN, 'schema', 'plan'], { cwd: auto, encoding: 'utf8', env: ENV });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('[safe] create-table users');
    } finally {
      rmSync(auto, { recursive: true, force: true });
    }
  });

  test('dump writes schema.sql beside the entry with no adapter configured, prints the path, and two runs are byte-identical', () => {
    const d = mkdtempSync(join(tmpdir(), 'rip-schema-dump-'));
    try {
      // No setAdapter, no RIP_DB_URL: dump is registry-side and must
      // work with no database reachable.
      writeFileSync(join(d, 'models.rip'), `export User = schema :model
  name! string
  email! email @unique

export Order = schema :model
  total! integer
  @belongsTo User
`);
      const r = spawnSync('bun', [BIN, 'schema', 'dump', 'models.rip'], { cwd: d, encoding: 'utf8', env: ENV });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('wrote schema.sql');
      const first = readFileSync(join(d, 'schema.sql'), 'utf8');
      expect(first).toContain('rip schema dump'); // the generated header
      expect(first).toContain('CREATE TABLE "users"');
      expect(first).toContain('CREATE TABLE "orders"');
      expect(first).toContain('"email" VARCHAR NOT NULL UNIQUE');
      // FK-dependency order: users (the parent) renders before orders.
      expect(first.indexOf('-- users')).toBeLessThan(first.indexOf('-- orders'));
      expect(first.endsWith('\n')).toBe(true);
      const again = spawnSync('bun', [BIN, 'schema', 'dump', 'models.rip'], { cwd: d, encoding: 'utf8', env: ENV });
      expect(again.status).toBe(0);
      expect(readFileSync(join(d, 'schema.sql'), 'utf8')).toBe(first);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('dump --check: clean exits 0; a drifted file exits nonzero with the drift message and is NOT rewritten; a missing file exits nonzero', () => {
    const d = mkdtempSync(join(tmpdir(), 'rip-schema-check-'));
    try {
      writeFileSync(join(d, 'models.rip'), 'export User = schema :model\n  name! string\n');
      const run = (...args) => spawnSync('bun', [BIN, 'schema', ...args], { cwd: d, encoding: 'utf8', env: ENV });

      const missing = run('dump', '--check', 'models.rip');
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('schema.sql does not exist');

      expect(run('dump', 'models.rip').status).toBe(0);
      const clean = run('dump', '--check', 'models.rip');
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain('schema.sql matches the declared models');

      appendFileSync(join(d, 'schema.sql'), '-- drifted\n');
      const drifted = readFileSync(join(d, 'schema.sql'), 'utf8');
      const drift = run('dump', '--check', 'models.rip');
      expect(drift.status).toBe(1);
      expect(drift.stderr).toContain('schema.sql differs from the declared models');
      expect(drift.stderr).toContain('rip schema dump');
      // Check mode writes nothing — the drifted bytes stay.
      expect(readFileSync(join(d, 'schema.sql'), 'utf8')).toBe(drifted);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('dump --out targets an explicit file; --out/--check on other verbs exit 2; --help mentions dump; zero models refuse', () => {
    const d = mkdtempSync(join(tmpdir(), 'rip-schema-out-'));
    try {
      writeFileSync(join(d, 'models.rip'), 'export User = schema :model\n  name! string\n');
      const run = (...args) => spawnSync('bun', [BIN, 'schema', ...args], { cwd: d, encoding: 'utf8', env: ENV });

      const out = run('dump', 'models.rip', '--out', 'declared.sql');
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('wrote declared.sql');
      expect(readFileSync(join(d, 'declared.sql'), 'utf8')).toContain('CREATE TABLE "users"');
      expect(existsSync(join(d, 'schema.sql'))).toBe(false);

      const misOut = run('plan', '--out', 'x.sql');
      expect(misOut.status).toBe(2);
      expect(misOut.stderr).toContain('--out only applies to dump');
      const misCheck = run('status', '--check');
      expect(misCheck.status).toBe(2);
      expect(misCheck.stderr).toContain('--check only applies to dump');

      const help = run('--help');
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('rip schema dump');
      expect(help.stdout).toContain('--check');

      writeFileSync(join(d, 'nomodels.rip'), 'x = 1\n');
      const none = run('dump', 'nomodels.rip');
      expect(none.status).toBe(1);
      expect(none.stderr).toContain('no :model schemas are registered');
      expect(existsSync(join(d, 'schema.sql'))).toBe(false); // no empty file
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('the differ rejections surface through the CLI as loud exit-1 failures (an ambiguous rename)', () => {
    write('filedb.js', FILEDB);
    write('ambig.rip', `import { fileDB } from "./filedb.js"
schema.setAdapter fileDB("./ambig-db.json")

export User = schema :model
  firstName! string, {was: "old_name"}
  lastName!  string, {was: "old_name"}
`);
    writeFileSync(join(dir, 'ambig-db.json'), JSON.stringify({
      deployed: { tables: [{
        name: 'users', sequence: { name: 'users_seq', start: 1 }, primaryKey: 'id',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: true, unique: false, primary: true, default: "nextval('users_seq')" },
          { name: 'old_name', type: 'VARCHAR', notNull: true, unique: false, default: null },
        ],
        indexes: [], foreignKeys: [], tableWas: null,
      }] },
      history: [], log: [],
    }));
    const r = rip(['schema', 'plan', 'ambig.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("{was: 'old_name'} is claimed by both users.first_name and users.last_name");
  });
});
