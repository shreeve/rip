// The `rip schema` CLI — the bin/rip dispatch and the
// loader-preloaded harness (src/schema-cli.js), end-to-end in
// subprocesses (the cli.test.js conventions: real fixture files in a
// temp cwd, stdout/stderr/exit-status assertions). The fixture
// adapter is FILE-BACKED (Contract v2 with introspect()), so state —
// the `_rip_migrations` history and the statement log — survives
// across the separate `make` and `migrate` processes; it has no
// begin(), so the non-transactional posture surfaces exactly as a
// real begin-less adapter would.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, appendFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const BIN = resolve(import.meta.dir, '../bin/rip');

// RIP_DB_URL in the ambient environment would defeat the
// unconfigured-adapter pin (and configure nothing real anywhere
// else) — every spawn runs without it.
const ENV = { ...process.env };
delete ENV.RIP_DB_URL;
delete ENV.RIP_DB_TOKEN;

let dir;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'rip-schema-cli-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (name, text) => writeFileSync(join(dir, name), text);

const rip = (args, opts = {}) => {
  const r = spawnSync('bun', [BIN, ...args], { cwd: opts.cwd ?? dir, encoding: 'utf8', env: ENV });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

// The file-backed Contract-v2 fake. State: { deployed, history, log }.
const FILEDB = `import { readFileSync, writeFileSync, existsSync } from 'fs';
export function fileDB(path) {
  const load = () => existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { deployed: { tables: [] }, history: [], log: [] };
  const save = (s) => writeFileSync(path, JSON.stringify(s));
  return {
    introspect: async () => load().deployed,
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
      } else if (sql.startsWith('INSERT INTO _rip_migrations')) {
        if (s.history.some((h) => h.version === params[0])) {
          save(s);
          throw new Error('Duplicate key "version: ' + params[0] + '" violates primary key constraint');
        }
        s.history.push({ version: params[0], name: params[1], checksum: params[2] });
      } else if (sql.startsWith('UPDATE _rip_migrations')) {
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
  @belongs_to User
`;

const dbState = () => JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));

describe('rip schema: usage surface', () => {
  test('help exits 0; unknown verb, unknown flag, missing make name, and misplaced flags exit 2', () => {
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

    const noName = rip(['schema', 'make']);
    expect(noName.status).toBe(2);
    expect(noName.stderr).toContain('a migration name is required');

    const misplaced = rip(['schema', 'plan', '--repair']);
    expect(misplaced.status).toBe(2);
    expect(misplaced.stderr).toContain('--repair only applies to migrate');
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
    expect(r.stdout).toContain('CREATE UNIQUE INDEX idx_users_email');
    expect(r.stdout.indexOf('create-table users')).toBeLessThan(r.stdout.indexOf('create-table orders'));
    expect(r.stdout).toContain('2 safe');
  });

  test('make writes the numbered file; migrate applies it with the non-transactional posture warning; a second migrate is idempotent; status reports', () => {
    write('filedb.js', FILEDB);
    write('models.rip', MODELS);
    rmSync(join(dir, 'db.json'), { force: true });
    rmSync(join(dir, 'migrations'), { recursive: true, force: true });

    const make = rip(['schema', 'make', 'init', 'models.rip']);
    expect(make.status).toBe(0);
    expect(make.stdout).toContain('wrote ' + join('migrations', '0001_init.sql'));
    const body = readFileSync(join(dir, 'migrations/0001_init.sql'), 'utf8');
    expect(body).toContain('-- [safe] create-table users');
    expect(body).toContain('CREATE TABLE users');

    const migrate = rip(['schema', 'migrate', 'models.rip']);
    expect(migrate.status).toBe(0);
    expect(migrate.stdout).toContain('applied 0001_init');
    expect(migrate.stderr).toContain('WITHOUT transactions'); // the loud posture (no begin())
    const state = dbState();
    expect(state.history.map((h) => h.version)).toEqual(['0001']);
    expect(state.log.some((s) => s.includes('CREATE TABLE users'))).toBe(true);
    expect(state.log.some((s) => s.includes('CREATE TABLE orders'))).toBe(true);

    const again = rip(['schema', 'migrate', 'models.rip']);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('no pending migrations');

    const status = rip(['schema', 'status', 'models.rip']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('applied:  0001_init');
    expect(status.stdout).toContain('pending:  (none)');
    // The fake DB never really creates tables, so the models still
    // diff against an empty deployed schema — the drift line proves
    // status distinguishes "unexplained difference" from "pending".
    expect(status.stdout).toContain('drift: the database differs from the models');
  });

  test('checksum mismatch: status reports it, migrate refuses it, --repair re-records', () => {
    // Continues from the applied 0001_init above.
    appendFileSync(join(dir, 'migrations/0001_init.sql'), '\n-- edited after apply\n');
    const status = rip(['schema', 'status', 'models.rip']);
    expect(status.stdout).toContain('edited after apply: 0001_init');

    const refuse = rip(['schema', 'migrate', 'models.rip']);
    expect(refuse.status).toBe(1);
    expect(refuse.stderr).toContain('checksum mismatch on applied migration 0001_init');
    expect(refuse.stderr).toContain('--repair');

    const repair = rip(['schema', 'migrate', '--repair', 'models.rip']);
    expect(repair.status).toBe(0);
    const ok = rip(['schema', 'migrate', 'models.rip']);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('no pending migrations');
  });

  test('an interrupted run: the failure names the file, the statement, and the partial state; conflicting versions refuse upfront', () => {
    // Continues from the repaired state above.
    write('migrations/0002_bad.sql', 'CREATE TABLE extras (x INTEGER);\nSELECT FAIL_NOW;\nCREATE TABLE more (x INTEGER);\n');
    const r = rip(['schema', 'migrate', 'models.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('0002_bad failed at statement 2 of 3');
    expect(r.stderr).toContain('Parser Error: FAIL_NOW tripped');
    expect(r.stderr).toContain('statements 1-1 of 0002_bad ARE applied');
    expect(dbState().history.map((h) => h.version)).toEqual(['0001']); // no row for the failed file

    write('migrations/0002_other.sql', 'SELECT 1;\n');
    const dup = rip(['schema', 'migrate', 'models.rip']);
    expect(dup.status).toBe(1);
    expect(dup.stderr).toContain('conflicting migration files share a version number');
    expect(dup.stderr).toContain('0002_bad');
    expect(dup.stderr).toContain('0002_other');
    rmSync(join(dir, 'migrations/0002_bad.sql'));
    rmSync(join(dir, 'migrations/0002_other.sql'));
  });

  test('make gates: a destructive plan refuses without the flag and writes with it', () => {
    write('filedb.js', FILEDB);
    write('gated.rip', MODELS.replace('"./db.json"', '"./gated-db.json"'));
    // Deployed: users exists with a stray column and a stray table —
    // drop-column + drop-table are both destructive.
    writeFileSync(join(dir, 'gated-db.json'), JSON.stringify({
      deployed: { tables: [
        {
          name: 'users', sequence: { name: 'users_seq', start: 1 }, primaryKey: 'id',
          columns: [
            { name: 'id', type: 'INTEGER', notNull: true, unique: false, primary: true, default: "nextval('users_seq')" },
            { name: 'name', type: 'VARCHAR', notNull: true, unique: false, default: null },
            { name: 'email', type: 'VARCHAR', notNull: true, unique: true, default: null },
            { name: 'legacy', type: 'VARCHAR', notNull: false, unique: false, default: null },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
          foreignKeys: [], tableWas: null,
        },
      ] },
      history: [], log: [],
    }));
    rmSync(join(dir, 'gated-migrations'), { recursive: true, force: true });

    const refuse = rip(['schema', 'make', 'cleanup', 'gated.rip', '--dir', 'gated-migrations']);
    expect(refuse.status).toBe(1);
    expect(refuse.stderr).toContain('gated steps');
    expect(refuse.stderr).toContain('[destructive] drop-column users');
    expect(refuse.stderr).toContain('--allow-lossy / --allow-destructive');
    expect(existsSync(join(dir, 'gated-migrations'))).toBe(false);

    const allow = rip(['schema', 'make', 'cleanup', 'gated.rip', '--dir', 'gated-migrations', '--allow-destructive']);
    expect(allow.status).toBe(0);
    expect(allow.stdout).toContain('wrote ' + join('gated-migrations', '0001_cleanup.sql'));
    const body = readFileSync(join(dir, 'gated-migrations/0001_cleanup.sql'), 'utf8');
    expect(body).toContain('ALTER TABLE users DROP COLUMN legacy;');
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
