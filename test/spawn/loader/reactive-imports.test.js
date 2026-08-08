// The cross-module contract for a reactive binding: THE CELL IS THE API.
//
// Reactivity is module-scoped in the compiler — `collectReactiveNames` builds
// the deref set from the declaring scope's OWN reactive names, so an importer
// emits the binding verbatim and holds the cell itself. That is the settled
// model (the alternative, reactivity metadata crossing the module boundary so
// importers deref, was ruled out), and this file is what makes it a stated
// contract rather than an accident of scoping.
//
// The corpus cannot hold this. Its twin models a reactive export as a plain
// value (`export tally := 0` twins as `export let tally = 0`), which works
// because in-module reads deref — but across a module boundary rip's importer
// holds a cell and the twin's holds a number, so a bare read diverges one way
// (object vs value) and a `.value` read diverges the other (works vs. a type
// error on `number`). The twin is an oracle for what TypeScript would do, and
// a rip cell has no TypeScript equivalent, so no twin can witness this. The
// assertions therefore live here, driven against the real CLI and the real
// checker.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { spawnSync } from '../../support/spawn.js';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { describeExtended } from '../../support/extended.js';
import { openSession } from '../../support/lsp-session.js';

const BIN = resolve(import.meta.dir, '../../../bin/rip');
const TSCONFIG = resolve(import.meta.dir, '../../audit/tsconfig.json');

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rip-reactive-import-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"reactive-import-fixture"}');
  writeFileSync(join(dir, 'tsconfig.json'), readFileSync(TSCONFIG, 'utf8'));
  // ANNOTATED: the checker assertions below ride the gate's ACROSS rule —
  // an importer's cell misuse publishes because the export carries a type.
  // The cell CONTRACT is annotation-blind (erasure), so the runtime and
  // hover tests read the same either way.
  writeFileSync(join(dir, 'store.rip'), 'export count: number := 0\nexport bump = -> count += 1\n');
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (name, text) => { writeFileSync(join(dir, name), text); return name; };
const run = (name) => spawnSync('bun', [BIN, name], { cwd: dir, encoding: 'utf8' });
const check = (name) => spawnSync('bun', [BIN, 'check', name], { cwd: dir, encoding: 'utf8' });

describe('a reactive import — the runtime contract', () => {
  // `.value` IS the contract. Everything else here describes what the cell
  // does around it, but this is the line a consumer is told to write.
  test('`.value` reads through, and reflects a write made inside the module', () => {
    write('v.rip', [
      "import { count, bump } from './store.rip'",
      'bump()',
      'bump()',
      'console.log count.value',
      '',
    ].join('\n'));
    const r = run('v.rip');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('2');
  });

  // The primitive-coercion protocol (`valueOf` / `toString` /
  // `Symbol.toPrimitive` on the cell) exists for exactly this consumer: one
  // holding a raw cell. In-module reads compile to `.value` and never coerce,
  // so an importer is its only beneficiary — which is itself evidence that the
  // cell was always meant to be what crosses the boundary.
  test('a coercing context yields the value — arithmetic and interpolation alike', () => {
    write('c.rip', [
      "import { count, bump } from './store.rip'",
      'bump()',
      'console.log (count + 1)',
      'console.log "n=#{count}"',
      '',
    ].join('\n'));
    const r = run('c.rip');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['2', 'n=1']);
  });

  // The one surface the ruling leaves visible: a NON-coercing context shows
  // the cell object. Asserted rather than tolerated, because it is the
  // behaviour a reader is most likely to mistake for a bug, and the reason
  // `.value` has to be documented rather than merely available.
  test('a non-coercing read shows the cell itself — the contract made visible', () => {
    write('b.rip', [
      "import { count } from './store.rip'",
      'console.log (typeof count)',
      "console.log ('value' of count)",
      '',
    ].join('\n'));
    const r = run('b.rip');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['object', 'true']);
  });
});

describeExtended('a reactive import — what the checker says', () => {
  // The served answer AT THE BARE READ. This is the row's own gate: under
  // this model the importer holds a cell, and the face says so rather than
  // pretending the importer holds the value.
  test('the bare read is typed as the cell, and the face names it', () => {
    write('t.rip', [
      "import { count } from './store.rip'",
      'n: number = count',
      'console.log n',
      '',
    ].join('\n'));
    const out = check('t.rip').stdout;
    expect(out).toContain('TS2322');
    expect(out).toContain('{ value: number; read(): number; touch(): void; }');
  });

  // `touch()` is the notify seam a consumer reaches for after mutating
  // through `.value` — and on an EXPORTED `:=` the container is one
  // `__state` minted, so the call can never meet an absent method. The
  // gate is the STRICT posture and nothing else: spelling `touch`
  // optional draws TS2722 ("possibly 'undefined'") on this line, and
  // strictNullChecks is off in the gradual posture, so a default-mode run
  // is quiet whichever way the face spells it and witnesses nothing.
  test('a consumer notifies through `touch()` unguarded — under rip.strict too', () => {
    const strictDir = mkdtempSync(join(tmpdir(), 'rip-reactive-strict-'));
    try {
      writeFileSync(join(strictDir, 'package.json'), '{"name":"strict-fixture","rip":{"strict":true}}');
      writeFileSync(join(strictDir, 'tsconfig.json'), readFileSync(TSCONFIG, 'utf8'));
      writeFileSync(join(strictDir, 'store.rip'), 'export count: number := 0\n');
      writeFileSync(join(strictDir, 'notify.rip'), [
        "import { count } from './store.rip'",
        'count.touch()',
        'console.log count.value',
        '',
      ].join('\n'));
      const r = spawnSync('bun', [BIN, 'check', 'notify.rip'], { cwd: strictDir, encoding: 'utf8' });
      expect(r.stdout).toContain('No type errors');
      expect(r.status).toBe(0);
    } finally { rmSync(strictDir, { recursive: true, force: true }); }
  });

  test('`.value` checks clean — the contract type-checks, not merely runs', () => {
    write('ok.rip', [
      "import { count } from './store.rip'",
      'n: number = count.value',
      'console.log n',
      '',
    ].join('\n'));
    const r = check('ok.rip');
    expect(r.stdout).toContain('No type errors');
    expect(r.status).toBe(0);
  });

  // The bare WRITE needs no compiler work: it is refused twice over, here and
  // again by the bundler at build time. Pinned so a future change that made an
  // import assignable would have to argue with this line first.
  test('a bare write is refused — TS2632, before the bundler ever sees it', () => {
    write('w.rip', [
      "import { count } from './store.rip'",
      'count = 5',
      '',
    ].join('\n'));
    expect(check('w.rip').stdout).toContain('TS2632');
  });

  // THE HOVER, which is the surface the ruling actually names — and it holds
  // for a reason nothing else states. `presentReactiveCellHover` rewrites a
  // cell type to its VALUE type, which is the answer the rejected model would
  // give (the importer holds the value); an imported symbol escapes only
  // because tsgo prefixes it `(alias)` and the rewrite is anchored at
  // `^(const|let|(property))`. Driven: `const count: { value: … }` IS
  // rewritten, `(alias) const count: { value: … }` is not. So relaxing that
  // anchor would silently flip the importer's answer to the foreclosed model,
  // and without this line no gate would notice.
  test('the hover at an imported read names the cell, not its value', async () => {
    const session = await openSession({
      'store.rip': 'export count := 0\n',
      'app.rip': "import { count } from './store.rip'\nconsole.log count\n",
    });
    try {
      session.open('app.rip');
      const text = await session.hover('app.rip', 1, 12);   // the `count` read
      expect(text, 'the read serves a hover at all').toBeTruthy();
      expect(text).toContain('value:');
      expect(text).not.toBe('const count: number');
    } finally {
      await session.close();
    }
  }, 60000);

  // THE ACCEPTED LIMIT, asserted as such. Arithmetic on an imported cell
  // RUNS — the coercion test above proves it — and cannot be made to
  // type-check: TypeScript requires an operand to BE number-ish, not to be
  // coercible, so neither `valueOf(): number` nor `[Symbol.toPrimitive]` on
  // the cell changes the answer (driven against plain `tsc --strict`). The
  // divergence is therefore permanent under this model, and `.value` is the
  // spelling that satisfies both halves. If TypeScript ever admits a
  // coercible operand this reds, which is the cue to drop the limit.
  test('arithmetic on the bare cell runs but cannot type-check — the limit, pinned', () => {
    write('lim.rip', [
      "import { count } from './store.rip'",
      'console.log (count + 1)',
      '',
    ].join('\n'));
    expect(check('lim.rip').stdout).toContain('TS2365');
  });
});
