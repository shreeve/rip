// The `rip schema` harness — the process bin/rip spawns with
// the .rip loader preloaded, so importing the models entry compiles
// its modules transitively and every `:model` it declares registers
// into THIS process's schema registry (one module instance per
// process — the loader delivers runtimes as imports of the same
// files this harness imports).
//
//   rip schema status  [entry.rip] [--dir DIR]
//   rip schema plan    [entry.rip]
//   rip schema dump    [entry.rip] [--out FILE] [--check]
//   rip schema make [name…] [entry.rip] [--dir DIR] [--allow-lossy] [--allow-destructive]
//   rip schema migrate [entry.rip] [--dir DIR] [--repair]
//   rip schema unlock  [entry.rip] [--force]
//
// `entry.rip` is a file whose import registers every :model schema
// (your models file — it may also call schema.setAdapter()/connect()
// to point at the database). When omitted, conventional locations
// are tried. Database connection comes from the entry's own adapter
// installation, or from RIP_DB_URL / RIP_DB_TOKEN for the default
// duckdb-harbor adapter — an unconfigured adapter fails HERE, named,
// before any verb touches the network.
//
// Exit codes follow the rip CLI's convention: 2 for usage errors,
// 1 for operational failures, 0 for success.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { CompileError } from '../compile.js';
import { adapterFor } from '../runtime/orm.js';
import * as migration from './migrate.js';

const ENTRY_CANDIDATES = [
  'models.rip', 'api/models.rip', 'app/models.rip', 'db/models.rip', 'src/models.rip',
];

const USAGE = `rip schema — diff declared :model schemas against the database and manage migrations.

Usage:
  rip schema status  [entry.rip] [--dir DIR]        applied / pending / drift + the current plan
  rip schema plan    [entry.rip]                    print the classified diff (no files touched)
  rip schema dump    [entry.rip] [--out FILE]       write schema.sql — the declared shape of every table
                     [--check]                      (no database touched; --check verifies instead of writing)
  rip schema make [name…] [entry.rip] [--dir DIR]   write migrations/<UTC>_<name>.sql from the diff
                     [--allow-lossy] [--allow-destructive]   (bare words are joined:
                     make add partner emails -> 20260829174501_add_partner_emails.sql)
                     the name is optional; without one the file is just 20260829174501.sql
  rip schema migrate [entry.rip] [--dir DIR]        apply pending migration files in order
                     [--repair] [--force]
  rip schema unlock  [entry.rip] [--force]          break a stale migration lock — applies NOTHING,
                                                    prints exactly what it displaced; refuses when the
                                                    holder is a live pid on THIS host (--force overrides)
  rip schema push    [name…] [entry.rip] [--dir DIR]  diff, write migrations/<UTC>_<name>.sql,
                     [--allow-lossy] [--allow-destructive]   and apply it — one motion (rapid iteration;
                     refuses when pending/edited/conflicting migrations make the state unclear;
                     the name is optional, exactly as for make)

Migration files are named <YYYYMMDDHHMMSS>_<description>.sql, the timestamp in UTC.
UTC because the version is the sort key and the sort is the apply order — local
time would reorder the directory across zones or a DST boundary. Legacy NNNN_name
files still apply, and sort ahead of every timestamp, which is where they belong.

entry.rip       file that declares/imports every :model (default: ${ENTRY_CANDIDATES.join(' | ')})
--dir DIR       migrations directory (default: migrations/ beside the models entry —
                e.g. api/models.rip -> api/migrations — falling back to ./migrations)
--out FILE      dump output file (default: schema.sql beside the models entry —
                e.g. api/models.rip -> api/schema.sql — falling back to ./schema.sql)
--check         dump only: exit nonzero when the file on disk differs from the
                declared models (the CI seam) — writes nothing
--allow-lossy   include steps that may lose data on existing rows (type changes, SET NOT NULL)
--allow-destructive   include DROP TABLE / DROP COLUMN steps
--repair        re-record checksums for applied migrations whose files changed
--force         migrate: take the migration lock in ONE atomic statement and then deploy every
                pending migration. It cannot leave the lock vacant and it reports whom it
                displaced, but it does NOT wait for a live run — when all you want is the lock
                back, use “rip schema unlock”, which applies nothing.
                unlock: override the refusal to break a lock whose pid is alive on this host

Connection: the entry's schema.setAdapter()/connect() call, or RIP_DB_URL / RIP_DB_TOKEN.`;

const die = (msg, code = 1) => {
  console.error(`rip schema: ${msg}`);
  process.exit(code);
};

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}
if (!['status', 'plan', 'dump', 'make', 'migrate', 'push', 'unlock'].includes(cmd)) {
  die(`unknown subcommand '${cmd}' — expected status, plan, dump, make, migrate, push, or unlock\n\n${USAGE}`, 2);
}

const rest = args.slice(1);
const flags = {
  dir: null,
  out: null,
  check: false,
  allowLossy: false,
  allowDestructive: false,
  repair: false,
  force: false,
  coordinated: false,
  operationId: null,
};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--dir') {
    flags.dir = rest[++i];
    if (!flags.dir) die('--dir requires a directory argument', 2);
  }
  else if (a === '--out') {
    flags.out = rest[++i];
    if (!flags.out) die('--out requires a file argument', 2);
  }
  else if (a === '--check') flags.check = true;
  else if (a === '--allow-lossy') flags.allowLossy = true;
  else if (a === '--allow-destructive') flags.allowDestructive = true;
  else if (a === '--repair') flags.repair = true;
  else if (a === '--force') flags.force = true;
  else if (a === '--coordinated') flags.coordinated = true;
  else if (a === '--operation-id') {
    flags.operationId = rest[++i];
    if (!flags.operationId) die('--operation-id requires a value', 2);
  }
  else if (a.startsWith('-')) die(`unknown flag: ${a}\n\n${USAGE}`, 2);
  else positional.push(a);
}
if (flags.out && cmd !== 'dump') die('--out only applies to dump', 2);
if (flags.check && cmd !== 'dump') die('--check only applies to dump', 2);
if (flags.allowLossy && cmd !== 'make' && cmd !== 'push') die('--allow-lossy only applies to make and push', 2);
if (flags.allowDestructive && cmd !== 'make' && cmd !== 'push') die('--allow-destructive only applies to make and push', 2);
if (flags.repair && cmd !== 'migrate') die('--repair only applies to migrate', 2);
if (flags.force && cmd !== 'migrate' && cmd !== 'unlock') die('--force only applies to migrate and unlock', 2);
if (flags.coordinated && cmd !== 'migrate') die('--coordinated only applies to migrate', 2);
if (flags.operationId && cmd !== 'migrate') die('--operation-id only applies to migrate', 2);

// `make` and `push` take a migration description; every command takes
// an optional models entry. Disambiguate by file existence: a
// positional that names an existing file is the entry, and the rest
// are description words.
//
// The words are JOINED rather than requiring one quoted argument, so
// `rip schema make add partner emails` works — the shell alias people
// write for every other migration tool, built in instead.
let entry = null;
const words = [];
for (const p of positional) {
  if (existsSync(p) && /\.(rip|js|ts)$/.test(p)) entry = p;
  else if (cmd === 'make' || cmd === 'push') words.push(p);
  else die(`unexpected argument: ${p} (no such file)`, 2);
}
// Optional for both verbs: the timestamp already names the file
// uniquely, so a description is something you add because a human will
// read it, not something the tool can insist on.
const name = words.length ? words.join(' ') : null;
if (!entry) entry = ENTRY_CANDIDATES.find((c) => existsSync(c)) || null;
if (!entry) {
  die(
    `no models entry found. Pass one explicitly (rip schema ${cmd}${cmd === 'make' ? ' <name>' : ''} path/to/models.rip)\n` +
    'or create one of: ' + ENTRY_CANDIDATES.join(', '));
}

// Migrations live beside the models entry (api/models.rip ->
// api/migrations), with ./migrations kept as a fallback for layouts
// that hold them at the root. An explicit --dir always wins; when
// neither candidate exists (a first `make`), create beside the entry.
if (!flags.dir) {
  const beside = join(dirname(entry), 'migrations');
  flags.dir = [beside, 'migrations'].find((c) => existsSync(c)) || beside;
}

// The dump file follows the same idiom: schema.sql beside the models
// entry (api/models.rip -> api/schema.sql), with ./schema.sql kept as
// a fallback for layouts that hold it at the root. An explicit --out
// always wins; when neither candidate exists (a first dump), write
// beside the entry.
if (cmd === 'dump' && !flags.out) {
  const beside = join(dirname(entry), 'schema.sql');
  flags.out = [beside, 'schema.sql'].find((c) => existsSync(c)) || beside;
}

// Importing the entry registers every :model it declares (directly
// or transitively) and runs any adapter installation it performs.
try {
  await import(pathToFileURL(resolve(entry)).href);
} catch (e) {
  // `unlock` is the exception, and the reason is the whole point of the
  // verb: a models entry that fails to compile or throws on import is
  // one of the commonest ways a migrate dies and leaves its lock
  // behind. Refusing to unlock until the entry is fixed would gate the
  // recovery on the thing that broke. It needs no models — it deletes
  // one row by key — so it degrades to RIP_DB_URL and says so.
  if (cmd === 'unlock') {
    console.error(
      `rip schema: the models entry could not be loaded (${entry}) — continuing anyway, ` +
      'because unlock needs no models. The database comes from RIP_DB_URL.');
  } else if (e instanceof CompileError) {
    die(`the models entry failed to compile\n${e.message}`);
  } else {
    die(`the models entry threw while loading (${entry}):\n${e?.message || String(e)}`);
  }
}

// Pre-flight: an unconfigured adapter means every database-touching
// verb would surface a connection error against the default endpoint —
// name the real problem instead. `dump` is exempt: it renders the
// DECLARED schema from the registry alone and must work with no
// database reachable.
if (cmd !== 'dump' && !migration.adapterConfigured()) {
  die(
    'no database is configured — the entry installed no adapter and RIP_DB_URL is unset.\n' +
    `Call schema.setAdapter(adapter) or schema.connect({url}) + setAdapter in ${entry}, ` +
    'or set RIP_DB_URL (and RIP_DB_TOKEN) for the default duckdb-harbor adapter.');
}

function printSteps(steps) {
  if (!steps.length) {
    console.log('database matches the declared models — no changes');
    return;
  }
  for (const s of steps) {
    console.log(`[${s.class}] ${s.kind} ${s.table}`);
    for (const n of s.notes) console.log(`    ${n}`);
    for (const line of s.sql) console.log(`    ${line}`);
  }
  const counts = {};
  for (const s of steps) counts[s.class] = (counts[s.class] || 0) + 1;
  console.log('\n' + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', '));
}

try {
  if (cmd === 'plan') {
    printSteps(await migration.plan());

  } else if (cmd === 'status') {
    const st = await migration.status({ dir: flags.dir });
    const label = migration.migrationLabel;
    console.log(`applied:  ${st.applied.length ? st.applied.map(label).join(', ') : '(none)'}`);
    console.log(`pending:  ${st.pending.length ? st.pending.map(label).join(', ') : '(none)'}`);
    if (st.lock) {
      console.log(`lock:     ${migration.describeLockHolder(st.lock)}`);
      console.log('          break it with `rip schema unlock` (applies nothing)');
    }
    if (st.mismatched.length) {
      console.log(`edited after apply: ${st.mismatched.join(', ')} — restore the files or migrate --repair`);
    }
    if (st.missing.length) {
      console.log(`applied but file missing: ${st.missing.join(', ')} — history names migrations the directory no longer holds`);
    }
    if (st.duplicates.length) {
      console.log(`conflicting versions: ${st.duplicates.join('; ')} — renumber before migrating`);
    }
    console.log('');
    if (st.steps.length && !st.pending.length && (st.applied.length || st.files.length)) {
      console.log('drift: the database differs from the models in ways no pending migration explains');
    }
    printSteps(st.steps);

  } else if (cmd === 'dump') {
    const text = migration.dump();
    if (flags.check) {
      if (!existsSync(flags.out)) {
        die(`${flags.out} does not exist — write it with \`rip schema dump\``);
      }
      if (readFileSync(flags.out, 'utf8') !== text) {
        die(`${flags.out} differs from the declared models — regenerate with \`rip schema dump\``);
      }
      console.log(`${flags.out} matches the declared models`);
    } else {
      writeFileSync(flags.out, text);
      console.log(`wrote ${flags.out}`);
    }

  } else if (cmd === 'make') {
    const out = await migration.make(name, {
      dir: flags.dir,
      allowLossy: flags.allowLossy,
      allowDestructive: flags.allowDestructive,
    });
    if (!out) {
      console.log('no changes — nothing to write');
    } else {
      printSteps(out.steps);
      console.log(`\nwrote ${out.file}`);
      console.log('review the file, then apply with: rip schema migrate');
    }

  } else if (cmd === 'push') {
    const adapter = adapterFor(null);
    if (typeof adapter.begin !== 'function') {
      console.error(
        'rip schema: warning — the adapter has no begin(): migrations apply WITHOUT transactions, ' +
        'so an interrupted run leaves partial state (the failure report will say exactly what applied).');
    }
    const out = await migration.push({
      name,
      dir: flags.dir,
      allowLossy: flags.allowLossy,
      allowDestructive: flags.allowDestructive,
    });
    if (!out) {
      console.log('database matches the declared models — nothing to push');
    } else if (!out.file) {
      printSteps(out.steps);
      console.log('\nnothing to apply — informational notes only, no migration written');
    } else {
      printSteps(out.steps);
      console.log(`\npushed ${out.file} (written and applied)`);
    }

  } else if (cmd === 'migrate') {
    const adapter = adapterFor(null);
    if (typeof adapter.begin !== 'function') {
      console.error(
        'rip schema: warning — the adapter has no begin(): migrations apply WITHOUT transactions, ' +
        'so an interrupted run leaves partial state (the failure report will say exactly what applied).');
    }
    const out = await migration.migrate({
      dir: flags.dir,
      repair: flags.repair,
      force: flags.force,
      coordinated: flags.coordinated,
      operationId: flags.operationId,
    });
    // A force that took the lock off somebody is never silent, and it
    // goes to stderr: it is a warning about what this run did, not part
    // of the applied-migrations report a script may be parsing.
    if (out.displaced) {
      console.error('rip schema: --force displaced the migration lock, which was held by ' + out.displaced);
    }
    if (!out.ran.length) console.log('no pending migrations');
    else for (const r of out.ran) console.log(`applied ${r}`);
    if (flags.coordinated) console.log('RIP_MIGRATION_OUTCOME=' + JSON.stringify(out));

  } else if (cmd === 'unlock') {
    const out = await migration.unlock({ force: flags.force });
    if (!out.released) {
      console.log('no migration lock is held — nothing to break');
    } else {
      console.log('broke the migration lock');
      console.log('  it was ' + out.describe);
      console.log('  nothing was applied; run `rip schema migrate` when you are ready');
    }
  }
  process.exit(0);
} catch (e) {
  if (flags.coordinated) {
    console.error('RIP_MIGRATION_OUTCOME=' + JSON.stringify({
      outcome: e?.migrationOutcome || 'unknown',
      error: e?.message || String(e),
    }));
  }
  die(e?.message || String(e));
}
