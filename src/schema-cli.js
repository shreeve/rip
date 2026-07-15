// The `rip schema` harness — the process bin/rip spawns with
// the .rip loader preloaded, so importing the models entry compiles
// its modules transitively and every `:model` it declares registers
// into THIS process's schema registry (one module instance per
// process — the loader delivers runtimes as imports of the same
// files this harness imports).
//
//   rip schema status  [entry.rip] [--dir DIR]
//   rip schema plan    [entry.rip]
//   rip schema make <name> [entry.rip] [--dir DIR] [--allow-lossy] [--allow-destructive]
//   rip schema migrate [entry.rip] [--dir DIR] [--repair]
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

import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { CompileError } from './compile.js';
import { __schemaAdapterFor } from './runtime/schema-orm.js';
import * as evolution from './migrate.js';

const ENTRY_CANDIDATES = [
  'models.rip', 'api/models.rip', 'app/models.rip', 'db/models.rip', 'src/models.rip',
];

const USAGE = `rip schema — diff declared :model schemas against the database and manage migrations.

Usage:
  rip schema status  [entry.rip] [--dir DIR]        applied / pending / drift + the current plan
  rip schema plan    [entry.rip]                    print the classified diff (no files touched)
  rip schema make <name> [entry.rip] [--dir DIR]    write migrations/NNNN_<name>.sql from the diff
                     [--allow-lossy] [--allow-destructive]
  rip schema migrate [entry.rip] [--dir DIR]        apply pending migration files in order
                     [--repair] [--force]

entry.rip       file that declares/imports every :model (default: ${ENTRY_CANDIDATES.join(' | ')})
--dir DIR       migrations directory (default: migrations)
--allow-lossy   include steps that may lose data on existing rows (type changes, SET NOT NULL)
--allow-destructive   include DROP TABLE / DROP COLUMN steps
--repair        re-record checksums for applied migrations whose files changed
--force         take over the migration lock — use ONLY when no migration is running;
                it steals the lock even from a live run, so a concurrent migrate is unsafe

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
if (!['status', 'plan', 'make', 'migrate'].includes(cmd)) {
  die(`unknown subcommand '${cmd}' — expected status, plan, make, or migrate\n\n${USAGE}`, 2);
}

const rest = args.slice(1);
const flags = {
  dir: 'migrations',
  allowLossy: false,
  allowDestructive: false,
  repair: false,
  force: false,
};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--dir') {
    flags.dir = rest[++i];
    if (!flags.dir) die('--dir requires a directory argument', 2);
  }
  else if (a === '--allow-lossy') flags.allowLossy = true;
  else if (a === '--allow-destructive') flags.allowDestructive = true;
  else if (a === '--repair') flags.repair = true;
  else if (a === '--force') flags.force = true;
  else if (a.startsWith('-')) die(`unknown flag: ${a}\n\n${USAGE}`, 2);
  else positional.push(a);
}
if (flags.allowLossy && cmd !== 'make') die('--allow-lossy only applies to make', 2);
if (flags.allowDestructive && cmd !== 'make') die('--allow-destructive only applies to make', 2);
if (flags.repair && cmd !== 'migrate') die('--repair only applies to migrate', 2);
if (flags.force && cmd !== 'migrate') die('--force only applies to migrate', 2);

// `make` takes a migration name first; every command takes an
// optional models entry. Disambiguate by file existence: a
// positional that names an existing file is the entry, anything else
// (for make) is the name.
let name = null;
let entry = null;
for (const p of positional) {
  if (existsSync(p) && /\.(rip|js|ts)$/.test(p)) entry = p;
  else if (cmd === 'make' && !name) name = p;
  else die(`unexpected argument: ${p} (no such file)`, 2);
}
if (cmd === 'make' && !name) {
  die('a migration name is required — rip schema make <name> [entry.rip]', 2);
}
if (!entry) entry = ENTRY_CANDIDATES.find((c) => existsSync(c)) || null;
if (!entry) {
  die(
    `no models entry found. Pass one explicitly (rip schema ${cmd}${cmd === 'make' ? ' <name>' : ''} path/to/models.rip)\n` +
    'or create one of: ' + ENTRY_CANDIDATES.join(', '));
}

// Importing the entry registers every :model it declares (directly
// or transitively) and runs any adapter installation it performs.
try {
  await import(pathToFileURL(resolve(entry)).href);
} catch (e) {
  if (e instanceof CompileError) die(`the models entry failed to compile\n${e.message}`);
  die(`the models entry threw while loading (${entry}):\n${e?.message || String(e)}`);
}

// Pre-flight: an unconfigured adapter means every verb would surface
// a connection error against the default endpoint — name the real
// problem instead.
if (!evolution.adapterConfigured()) {
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
    printSteps(await evolution.plan());

  } else if (cmd === 'status') {
    const st = await evolution.status({ dir: flags.dir });
    console.log(`applied:  ${st.applied.length ? st.applied.map((a) => a.version + '_' + a.name).join(', ') : '(none)'}`);
    console.log(`pending:  ${st.pending.length ? st.pending.map((f) => f.version + '_' + f.name).join(', ') : '(none)'}`);
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

  } else if (cmd === 'make') {
    const out = await evolution.make(name, {
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

  } else if (cmd === 'migrate') {
    const adapter = __schemaAdapterFor(null);
    if (typeof adapter.begin !== 'function') {
      console.error(
        'rip schema: warning — the adapter has no begin(): migrations apply WITHOUT transactions, ' +
        'so an interrupted run leaves partial state (the failure report will say exactly what applied).');
    }
    const out = await evolution.migrate({ dir: flags.dir, repair: flags.repair, force: flags.force });
    if (!out.ran.length) console.log('no pending migrations');
    else for (const r of out.ran) console.log(`applied ${r}`);
  }
  process.exit(0);
} catch (e) {
  die(e?.message || String(e));
}
